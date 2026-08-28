import express from 'express';
import { q, getSettings, transaction } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, int, money, notFound, num, str, wrap } from '../helpers.js';
import { applyMovement } from './stock.js';

const router = express.Router();

/** Invoice numbers look like INV-20260828-0007 and reset their counter daily. */
async function nextInvoiceNo(tx) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${stamp}-`;
  const last = await tx.get(
    'SELECT invoice_no FROM sales WHERE invoice_no ILIKE ? ORDER BY id DESC LIMIT 1',
    `${prefix}%`
  );
  const n = last ? Number(last.invoice_no.slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

router.get(
  '/',
  wrap(async (req, res) => {
    const { from, to, status, search, limit, offset } = req.query;
    const where = [];
    const params = [];

    if (from)   { where.push('shop_date(s.created_at) >= ?::date'); params.push(String(from)); }
    if (to)     { where.push('shop_date(s.created_at) <= ?::date'); params.push(String(to)); }
    if (status) { where.push('s.status = ?'); params.push(String(status)); }
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where.push('(s.invoice_no ILIKE ? OR s.customer_name ILIKE ? OR s.customer_phone ILIKE ?)');
      params.push(like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM sales s LEFT JOIN users u ON u.id = s.user_id ${whereSql}`;

    const total = (await q.get(`SELECT COUNT(*) AS n ${base}`, ...params)).n;
    const take = Math.min(Number(limit) || 50, 500);
    const skip = Number(offset) || 0;

    const items = await q.all(`SELECT s.*, u.username,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
         ${base}
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT ? OFFSET ?`, ...params, take, skip);

    res.json({ items, total, limit: take, offset: skip });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const sale = await q.get(`SELECT s.*, u.username, u.full_name AS cashier_name
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`, Number(req.params.id));
    if (!sale) throw notFound('Sale not found');

    sale.items = await q.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', sale.id);
    res.json(sale);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const lines = Array.isArray(req.body.items) ? req.body.items : [];
    if (!lines.length) throw badRequest('Add at least one item to the sale');
    if (lines.length > 200) throw badRequest('A single sale can hold at most 200 lines');

    const customerName = str(req.body.customer_name, { field: 'Customer name', max: 120 });
    const customerPhone = str(req.body.customer_phone, { field: 'Customer phone', max: 40 });
    const paymentMethod = str(req.body.payment_method, { field: 'Payment method', max: 30, fallback: 'cash' }) || 'cash';
    const note = str(req.body.note, { field: 'Note', max: 500 });
    const discount = money(num(req.body.discount, { field: 'Discount', min: 0 }));
    const settings = await getSettings();
    const taxPercent = req.body.tax_percent === undefined
      ? Number(settings.tax_percent || 0)
      : num(req.body.tax_percent, { field: 'Tax percent', min: 0, max: 100 });

    const sale = await transaction(async (tx) => {
      const priced = [];
      let subtotal = 0;
      let costTotal = 0;

      for (const [i, line] of lines.entries()) {
        const productId = int(line.product_id, { field: `Item ${i + 1} product`, required: true, min: 1 });
        const qty = int(line.quantity, { field: `Item ${i + 1} quantity`, required: true, min: 1 });

        const product = await tx.get('SELECT * FROM products WHERE id = ?', productId);
        if (!product) throw badRequest(`Item ${i + 1}: product no longer exists`);

        // Price defaults to the catalogue price but can be overridden per line.
        const unitPrice = line.unit_price === undefined || line.unit_price === ''
          ? product.sell_price
          : money(num(line.unit_price, { field: `Item ${i + 1} price`, min: 0 }));

        const lineTotal = money(unitPrice * qty);
        subtotal += lineTotal;
        costTotal += money(product.cost_price * qty);

        priced.push({
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          quantity: qty,
          unit_price: unitPrice,
          unit_cost: product.cost_price,
          line_total: lineTotal,
        });
      }

      subtotal = money(subtotal);
      costTotal = money(costTotal);
      if (discount > subtotal) throw badRequest('Discount cannot be larger than the subtotal');

      const taxable = subtotal - discount;
      const tax = money(taxable * (taxPercent / 100));
      const total = money(taxable + tax);

      const invoiceNo = await nextInvoiceNo(tx);
      const info = await tx.insert(`INSERT INTO sales
             (invoice_no, customer_name, customer_phone, subtotal, discount, tax,
              total, cost_total, payment_method, note, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, invoiceNo, customerName, customerPhone, subtotal, discount, tax,
             total, costTotal, paymentMethod, note, req.user.id);

      const saleId = Number(info.lastInsertRowid);

      for (const item of priced) {
        await tx.run(
          `INSERT INTO sale_items
             (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          saleId, item.product_id, item.product_name, item.sku,
          item.quantity, item.unit_price, item.unit_cost, item.line_total
        );
        // Throws (and rolls back the whole sale) if stock is insufficient.
        await applyMovement(tx, {
          productId: item.product_id,
          type: 'sale',
          quantity: item.quantity,
          unitCost: item.unit_cost,
          reference: invoiceNo,
          note: customerName ? `Sold to ${customerName}` : 'Counter sale',
          userId: req.user.id,
        });
      }

      return tx.get('SELECT * FROM sales WHERE id = ?', saleId);
    });

    sale.items = await q.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', sale.id);
    res.status(201).json(sale);
  })
);

/** Void a sale: return every line to stock and mark the invoice voided. */
router.post(
  '/:id/void',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const sale = await q.get('SELECT * FROM sales WHERE id = ?', id);
    if (!sale) throw notFound('Sale not found');
    if (sale.status === 'voided') throw badRequest('That sale is already voided');

    const reason = str(req.body.reason, { field: 'Reason', max: 300 });

    await transaction(async (tx) => {
      const items = await tx.all('SELECT * FROM sale_items WHERE sale_id = ?', id);
      for (const item of items) {
        if (!item.product_id) continue; // product was deleted; nothing to restock
        await applyMovement(tx, {
          productId: item.product_id,
          type: 'return',
          quantity: item.quantity,
          unitCost: item.unit_cost,
          reference: sale.invoice_no,
          note: reason ? `Void: ${reason}` : 'Sale voided',
          userId: req.user.id,
        });
      }
      await tx.run("UPDATE sales SET status = 'voided' WHERE id = ?", id);
    });

    res.json({ ok: true, message: `${sale.invoice_no} voided and stock returned.` });
  })
);

export default router;
