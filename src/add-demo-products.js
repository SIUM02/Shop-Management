import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pool, q, ready, transaction } from './db.js';

/*
 * Adds a batch of realistic demo products to the catalogue: `npm run add-products`.
 *
 * Names are assembled from per-category pools at typical Bangladeshi retail
 * prices, SKUs continue each category's existing prefix from 100 upward so
 * they can never collide with the seed data, and every opening quantity is
 * written through stock_movements so the audit trail still reconciles with
 * products.quantity — the same invariant the seed keeps.
 *
 * Safe to re-run: numbering continues after the highest SKU already present.
 */

const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 100);

// category name -> SKU prefix, name fragments, price band (cost min/max, margin)
const POOLS = {
  Beverages: {
    prefix: 'BEV',
    items: ['Mango Juice', 'Lemon Soda', 'Iced Tea', 'Black Coffee', 'Milk Tea',
            'Energy Drink', 'Coconut Water', 'Lassi', 'Apple Juice', 'Ginger Tea'],
    variants: ['250ml', '330ml', '500ml', '1L', '6-pack'],
    unit: 'pcs', cost: [10, 220], markup: [1.3, 1.7],
  },
  Snacks: {
    prefix: 'SNK',
    items: ['Banana Chips', 'Peanut Bar', 'Rice Crackers', 'Chanachur', 'Cookies',
            'Wafer Roll', 'Cake Slice', 'Instant Noodles', 'Popcorn', 'Toast Biscuit'],
    variants: ['50g', '100g', '150g', '250g', 'family pack'],
    unit: 'pack', cost: [15, 180], markup: [1.35, 1.8],
  },
  Stationery: {
    prefix: 'STA',
    items: ['Gel Pen', 'Pencil', 'Eraser', 'Ruler 30cm', 'Marker', 'Highlighter',
            'Stapler', 'File Folder', 'Envelope Pack', 'Drawing Book'],
    variants: ['single', '2-pack', '5-pack', 'box of 12', 'jumbo'],
    unit: 'pcs', cost: [5, 260], markup: [1.4, 2.0],
  },
  Household: {
    prefix: 'HHD',
    items: ['Hand Soap', 'Toilet Cleaner', 'Air Freshener', 'Mosquito Coil', 'Matchbox',
            'Scrub Sponge', 'Floor Cleaner', 'Bleach', 'Trash Bags', 'Candles'],
    variants: ['small', 'medium', 'large', 'refill', 'twin pack'],
    unit: 'pcs', cost: [12, 320], markup: [1.3, 1.75],
  },
  Electronics: {
    prefix: 'ELC',
    items: ['AAA Batteries', 'LED Bulb', 'Extension Cord', 'Earphones', 'Memory Card',
            'Phone Case', 'Wall Adapter', 'HDMI Cable', 'Mouse', 'Power Strip'],
    variants: ['basic', 'standard', 'premium', '2-pack', 'pro'],
    unit: 'pcs', cost: [40, 900], markup: [1.35, 1.9],
  },
};

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];

function barcodeFor(sku) {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (Math.imul(31, h) + sku.charCodeAt(i)) | 0;
  return '20' + String(Math.abs(h)).padStart(11, '0').slice(0, 11);
}

async function main() {
  await ready();

  const categories = await q.all('SELECT id, name FROM categories ORDER BY id');
  const suppliers = await q.all('SELECT id FROM suppliers ORDER BY id');
  const admin = await q.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!categories.length || !suppliers.length || !admin) {
    throw new Error('Seed the database first — categories, suppliers and an admin must exist.');
  }

  const pools = categories.filter((c) => POOLS[c.name]);
  if (!pools.length) throw new Error('No known category names found to generate for.');

  // Continue numbering after whatever is already there, per prefix.
  const next = {};
  for (const { name } of pools) {
    const { prefix } = POOLS[name];
    const row = await q.get(
      "SELECT MAX(NULLIF(regexp_replace(sku::text, '^' || ? || '-', ''), '')::int) AS n FROM products WHERE sku::text LIKE ?",
      prefix, `${prefix}-%`
    );
    next[prefix] = Math.max(Number(row?.n) || 0, 99) + 1;
  }

  const created = await transaction(async (tx) => {
    const made = [];
    const usedNames = new Set(
      (await tx.all('SELECT name FROM products')).map((r) => r.name)
    );

    let guard = 0;
    while (made.length < COUNT && guard < COUNT * 30) {
      guard++;
      const cat = pick(pools);
      const pool = POOLS[cat.name];
      const name = `${pick(pool.items)} ${pick(pool.variants)}`;
      if (usedNames.has(name)) continue; // keep names unique and readable
      usedNames.add(name);

      const sku = `${pool.prefix}-${String(next[pool.prefix]++).padStart(3, '0')}`;
      // Whole taka, the way prices are actually written on Bangladeshi shelves.
      const cost = Math.round(rand(pool.cost[0], pool.cost[1]));
      const sell = Math.max(Math.round(cost * rand(pool.markup[0], pool.markup[1])), cost + 1);
      // Some shelves full, some low, a few empty — so the dashboard has texture.
      const qty = pick([0, randInt(2, 15), randInt(20, 80), randInt(100, 400)]);
      const reorder = randInt(5, 40);

      const { lastInsertRowid } = await tx.insert(
        `INSERT INTO products
           (sku, name, category_id, supplier_id, cost_price, sell_price,
            quantity, reorder_level, unit, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sku, name, cat.id, pick(suppliers).id, cost, sell, qty, reorder, pool.unit, barcodeFor(sku)
      );

      if (qty > 0) {
        await tx.run(
          `INSERT INTO stock_movements
             (product_id, type, quantity, before_qty, after_qty, unit_cost, reference, note, user_id)
           VALUES (?, 'in', ?, 0, ?, ?, 'OPENING', 'Opening stock', ?)`,
          Number(lastInsertRowid), qty, qty, cost, admin.id
        );
      }
      made.push({ sku, name });
    }
    return made;
  });

  console.log(`Added ${created.length} products.`);
  console.log(`  first: ${created[0].sku}  ${created[0].name}`);
  console.log(`  last:  ${created.at(-1).sku}  ${created.at(-1).name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
