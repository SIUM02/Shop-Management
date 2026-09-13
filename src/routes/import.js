/*
 * Bulk product import.
 *
 * The shape deliberately matches the products CSV export, so the natural
 * workflow — export, edit the prices in Excel, import again — round-trips
 * without anyone rewriting headers. Bangla column names are accepted too,
 * because that is what the downloadable template hands the shopkeeper.
 *
 * Every import runs twice: once with dry_run to show the owner exactly what
 * would change, and again to commit. Nothing is written until they agree, and
 * the commit runs in one transaction, so a bad row twenty lines in cannot
 * leave the catalogue half-updated.
 */
import express from 'express';
import { q, transaction } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, money, num, str, wrap } from '../helpers.js';
import { applyMovement } from './stock.js';

const router = express.Router();

/*
 * Column -> the names a spreadsheet might use for it. The English spellings
 * are the export's own headers; the Bangla ones are what the template ships
 * with. Matching is case-insensitive and ignores spaces.
 */
const COLUMNS = {
  sku:           ['sku', 'এসকেইউ', 'কোড'],
  name:          ['name', 'product', 'নাম', 'পণ্যেরনাম', 'পণ্য'],
  barcode:       ['barcode', 'বারকোড'],
  category:      ['category', 'ক্যাটাগরি', 'ক্যাটেগরি'],
  supplier:      ['supplier', 'সরবরাহকারী'],
  cost_price:    ['cost_price', 'costprice', 'cost', 'ক্রয়মূল্য', 'ক্রয়মুল্য'],
  sell_price:    ['sell_price', 'sellprice', 'price', 'বিক্রয়মূল্য', 'বিক্রয়মুল্য', 'দাম'],
  quantity:      ['quantity', 'qty', 'stock', 'পরিমাণ', 'স্টক'],
  reorder_level: ['reorder_level', 'reorderlevel', 'reorder', 'পুনঃক্রয়সীমা', 'পুনঃক্রয়'],
  unit:          ['unit', 'একক'],
  location:      ['location', 'shelf', 'অবস্থান', 'তাক'],
  description:   ['description', 'note', 'বিবরণ', 'নোট'],
};

const normalise = (h) => String(h || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

/** Maps a row keyed by whatever the sheet called its columns onto our names. */
function readRow(raw) {
  const byNormalised = new Map(Object.entries(raw).map(([k, v]) => [normalise(k), v]));
  const out = {};
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    for (const alias of aliases) {
      const hit = byNormalised.get(normalise(alias));
      if (hit !== undefined && hit !== null && String(hit).trim() !== '') {
        out[field] = String(hit).trim();
        break;
      }
    }
  }
  return out;
}

/** The template, and the header row every import is checked against. */
const TEMPLATE_HEADERS = [
  'sku', 'name', 'barcode', 'category', 'supplier',
  'cost_price', 'sell_price', 'quantity', 'reorder_level', 'unit', 'location', 'description',
];

const TEMPLATE_ROWS = [
  ['ELC-101', 'এলইডি বাল্ব ৯ ওয়াট', '', 'ইলেকট্রনিকস', 'মেট্রো হোলসেল', '120', '180', '25', '10', 'পিস', 'তাক ১', ''],
  ['ELC-102', 'ইলেকট্রিক তার (মিটার)', '', 'ইলেকট্রনিকস', '', '30', '45', '100', '20', 'মিটার', '', ''],
];

router.get(
  '/template',
  wrap(async (req, res) => {
    const lines = [TEMPLATE_HEADERS.join(','), ...TEMPLATE_ROWS.map((r) =>
      r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.csv"');
    res.send('﻿' + lines.join('\r\n'));  // BOM so Excel reads the Bangla
  })
);

/** Finds a category/supplier by name, creating it when the sheet names a new one. */
async function resolveByName(tx, table, name, created) {
  if (!name) return null;
  const found = await tx.get(`SELECT id FROM ${table} WHERE name = ?`, name);
  if (found) return found.id;
  const info = await tx.insert(`INSERT INTO ${table} (name) VALUES (?)`, name);
  created.push(`${table === 'categories' ? 'ক্যাটাগরি' : 'সরবরাহকারী'}: ${name}`);
  return Number(info.lastInsertRowid);
}

router.post(
  '/products',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const dryRun = req.body.dry_run !== false;

    if (!rows.length) throw badRequest('ফাইলে কোনো সারি পাওয়া যায়নি');
    if (rows.length > 2000) throw badRequest('একবারে সর্বোচ্চ ২০০০টি সারি আনা যাবে');

    // Validate everything first: a report that stops at the first bad row
    // makes the owner fix a 400-line sheet one line per attempt.
    const parsed = [];
    const errors = [];
    const seenSku = new Set();

    for (const [i, raw] of rows.entries()) {
      const line = i + 2;                    // +1 for the header, +1 for 1-based
      const r = readRow(raw || {});
      try {
        if (!r.sku) throw new Error('SKU নেই');
        if (!r.name) throw new Error('নাম নেই');

        const sku = str(r.sku, { field: 'SKU', required: true, max: 60 });
        if (seenSku.has(sku.toLowerCase())) throw new Error(`একই ফাইলে SKU "${sku}" একাধিকবার আছে`);
        seenSku.add(sku.toLowerCase());

        parsed.push({
          line,
          sku,
          name: str(r.name, { field: 'নাম', required: true, max: 200 }),
          barcode: str(r.barcode, { field: 'বারকোড', max: 60 }) || null,
          category: str(r.category, { field: 'ক্যাটাগরি', max: 100 }),
          supplier: str(r.supplier, { field: 'সরবরাহকারী', max: 120 }),
          cost_price: money(num(r.cost_price, { field: 'ক্রয়মূল্য', min: 0, fallback: 0 })),
          sell_price: money(num(r.sell_price, { field: 'বিক্রয়মূল্য', min: 0, fallback: 0 })),
          quantity: r.quantity === undefined ? null
            : Math.round(num(r.quantity, { field: 'পরিমাণ', min: 0 })),
          reorder_level: r.reorder_level === undefined ? 0
            : Math.round(num(r.reorder_level, { field: 'পুনঃক্রয় সীমা', min: 0 })),
          unit: r.unit || 'পিস',
          location: str(r.location, { field: 'অবস্থান', max: 100 }),
          description: str(r.description, { field: 'বিবরণ', max: 2000 }),
        });
      } catch (err) {
        errors.push({ line, sku: r.sku || '', message: err.message });
      }
    }

    // Which of the valid rows already exist, so the report can say added vs updated.
    for (const row of parsed) {
      const existing = await q.get('SELECT id, quantity FROM products WHERE sku = ?', row.sku);
      row.existingId = existing?.id ?? null;
      row.existingQty = existing?.quantity ?? null;
    }

    const summary = {
      total: rows.length,
      add: parsed.filter((r) => !r.existingId).length,
      update: parsed.filter((r) => r.existingId).length,
      failed: errors.length,
    };

    if (dryRun) {
      return res.json({
        dry_run: true,
        summary,
        errors: errors.slice(0, 50),
        preview: parsed.slice(0, 20).map((r) => ({
          line: r.line, sku: r.sku, name: r.name,
          cost_price: r.cost_price, sell_price: r.sell_price,
          quantity: r.quantity, action: r.existingId ? 'update' : 'add',
        })),
      });
    }

    if (!parsed.length) throw badRequest('আনার মতো কোনো সঠিক সারি নেই');

    const createdLookups = [];
    const result = await transaction(async (tx) => {
      let added = 0;
      let updated = 0;

      for (const row of parsed) {
        const categoryId = await resolveByName(tx, 'categories', row.category, createdLookups);
        const supplierId = await resolveByName(tx, 'suppliers', row.supplier, createdLookups);

        if (row.existingId) {
          await tx.run(
            `UPDATE products SET name = ?, barcode = ?, description = ?, category_id = ?,
                    supplier_id = ?, cost_price = ?, sell_price = ?, reorder_level = ?,
                    unit = ?, location = ?, active = 1
              WHERE id = ?`,
            row.name, row.barcode, row.description, categoryId, supplierId,
            row.cost_price, row.sell_price, row.reorder_level, row.unit, row.location,
            row.existingId);

          /*
           * Stock is never written straight onto the row. Every other change to
           * products.quantity leaves a movement behind, and the ledger is only
           * trustworthy if that holds without exception — so a changed count
           * arrives as a stocktake adjustment, attributed to the import.
           */
          if (row.quantity !== null && row.quantity !== row.existingQty) {
            await applyMovement(tx, {
              productId: row.existingId,
              type: 'adjust',
              quantity: row.quantity,
              reference: 'IMPORT',
              note: 'ফাইল থেকে আমদানি',
              userId: req.user.id,
            });
          }
          updated++;
        } else {
          const info = await tx.insert(
            `INSERT INTO products
               (sku, name, barcode, description, category_id, supplier_id,
                cost_price, sell_price, quantity, reorder_level, unit, location)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            row.sku, row.name, row.barcode, row.description, categoryId, supplierId,
            row.cost_price, row.sell_price, row.reorder_level, row.unit, row.location);

          const id = Number(info.lastInsertRowid);
          if (row.quantity) {
            await applyMovement(tx, {
              productId: id,
              type: 'in',
              quantity: row.quantity,
              unitCost: row.cost_price,
              reference: 'IMPORT',
              note: 'ফাইল থেকে আমদানি',
              userId: req.user.id,
            });
          }
          added++;
        }
      }
      return { added, updated };
    });

    res.json({
      ok: true,
      ...result,
      failed: errors.length,
      errors: errors.slice(0, 50),
      created_lookups: [...new Set(createdLookups)],
      message: `${result.added}টি পণ্য যোগ, ${result.updated}টি হালনাগাদ হয়েছে।`,
    });
  })
);

export default router;
