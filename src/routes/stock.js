import express from 'express';
import { db, transaction } from '../db.js';
import { badRequest, int, money, notFound, num, str, wrap } from '../helpers.js';

const router = express.Router();

/**
 * Apply one stock change and record it. Must run inside a transaction.
 * `type` is 'in' | 'out' | 'adjust' | 'sale' | 'return'.
 * For 'adjust', `quantity` is the new absolute count; otherwise it is a delta.
 */
export function applyMovement({ productId, type, quantity, unitCost, reference, note, userId, allowNegative = false }) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) throw notFound(`Product ${productId} not found`);

  const before = product.quantity;
  let after;
  let delta;

  if (type === 'adjust') {
    after = quantity;
    delta = after - before;
  } else if (type === 'in' || type === 'return') {
    delta = Math.abs(quantity);
    after = before + delta;
  } else {
    delta = -Math.abs(quantity);
    after = before + delta;
  }

  if (after < 0 && !allowNegative) {
    throw badRequest(
      `Not enough stock for "${product.name}". In stock: ${before}, requested: ${Math.abs(delta)}.`
    );
  }

  db.prepare('UPDATE products SET quantity = ? WHERE id = ?').run(after, productId);
  db.prepare(
    `INSERT INTO stock_movements
       (product_id, type, quantity, before_qty, after_qty, unit_cost, reference, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    productId, type, delta, before, after,
    unitCost ?? product.cost_price, reference || '', note || '', userId ?? null
  );

  return { product, before, after, delta };
}

router.get(
  '/movements',
  wrap((req, res) => {
    const { product_id, type, from, to, limit, offset, search } = req.query;
    const where = [];
    const params = [];

    if (product_id) { where.push('m.product_id = ?'); params.push(Number(product_id)); }
    if (type)       { where.push('m.type = ?');       params.push(String(type)); }
    if (from)       { where.push('date(m.created_at) >= date(?)'); params.push(String(from)); }
    if (to)         { where.push('date(m.created_at) <= date(?)'); params.push(String(to)); }
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR m.reference LIKE ? OR m.note LIKE ?)');
      params.push(like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM stock_movements m
                  JOIN products p ON p.id = m.product_id
                  LEFT JOIN users u ON u.id = m.user_id
                  ${whereSql}`;

    const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...params).n;
    const take = Math.min(Number(limit) || 100, 500);
    const skip = Number(offset) || 0;

    const items = db
      .prepare(
        `SELECT m.*, p.name AS product_name, p.sku, p.unit, u.username
         ${base}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, take, skip);

    res.json({ items, total, limit: take, offset: skip });
  })
);

/** Receive stock (purchase / delivery in). */
router.post(
  '/in',
  wrap((req, res) => {
    const productId = int(req.body.product_id, { field: 'Product', required: true, min: 1 });
    const quantity = int(req.body.quantity, { field: 'Quantity', required: true, min: 1 });
    const unitCost = req.body.unit_cost === undefined || req.body.unit_cost === ''
      ? null
      : money(num(req.body.unit_cost, { field: 'Unit cost', min: 0 }));

    const result = transaction(() => {
      const out = applyMovement({
        productId, type: 'in', quantity, unitCost,
        reference: str(req.body.reference, { field: 'Reference', max: 100 }),
        note: str(req.body.note, { field: 'Note', max: 500 }),
        userId: req.user.id,
      });
      // Receiving at a new price updates the product's cost basis.
      if (unitCost !== null) {
        db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(unitCost, productId);
      }
      return out;
    });

    res.status(201).json({ ok: true, ...result });
  })
);

/** Remove stock for a non-sale reason: damage, theft, internal use, returns to supplier. */
router.post(
  '/out',
  wrap((req, res) => {
    const productId = int(req.body.product_id, { field: 'Product', required: true, min: 1 });
    const quantity = int(req.body.quantity, { field: 'Quantity', required: true, min: 1 });

    const result = transaction(() =>
      applyMovement({
        productId, type: 'out', quantity,
        reference: str(req.body.reference, { field: 'Reference', max: 100 }),
        note: str(req.body.note, { field: 'Reason', max: 500 }),
        userId: req.user.id,
      })
    );

    res.status(201).json({ ok: true, ...result });
  })
);

/** Set stock to a counted figure (stocktake). */
router.post(
  '/adjust',
  wrap((req, res) => {
    const productId = int(req.body.product_id, { field: 'Product', required: true, min: 1 });
    const counted = int(req.body.quantity, { field: 'Counted quantity', required: true, min: 0 });
    const note = str(req.body.note, { field: 'Reason', required: true, max: 500 });

    const result = transaction(() =>
      applyMovement({
        productId, type: 'adjust', quantity: counted,
        reference: str(req.body.reference, { field: 'Reference', max: 100, fallback: 'STOCKTAKE' }),
        note, userId: req.user.id,
      })
    );

    res.status(201).json({ ok: true, ...result });
  })
);

export default router;
