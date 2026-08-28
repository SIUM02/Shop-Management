import express from 'express';
import { q, transaction } from '../db.js';
import { badRequest, int, money, notFound, num, str, wrap } from '../helpers.js';

const router = express.Router();

/**
 * Apply one stock change and record it. Must run inside a transaction, so it
 * takes that transaction's query surface (`tx`) rather than reaching for the
 * pool — a pooled query would run on another connection and escape the
 * rollback, leaving stock changed after a failed sale.
 *
 * `type` is 'in' | 'out' | 'adjust' | 'sale' | 'return'.
 * For 'adjust', `quantity` is the new absolute count; otherwise it is a delta.
 */
export async function applyMovement(tx, { productId, type, quantity, unitCost, reference, note, userId, allowNegative = false }) {
  // FOR UPDATE locks the row for the life of the transaction, so two tills
  // selling the last unit at once cannot both read the same "before" quantity.
  const product = await tx.get('SELECT * FROM products WHERE id = ? FOR UPDATE', productId);
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

  await tx.run('UPDATE products SET quantity = ? WHERE id = ?', after, productId);
  await tx.run(`INSERT INTO stock_movements
       (product_id, type, quantity, before_qty, after_qty, unit_cost, reference, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, productId, type, delta, before, after,
    unitCost ?? product.cost_price, reference || '', note || '', userId ?? null);

  return { product, before, after, delta };
}

router.get(
  '/movements',
  wrap(async (req, res) => {
    const { product_id, type, from, to, limit, offset, search } = req.query;
    const where = [];
    const params = [];

    if (product_id) { where.push('m.product_id = ?'); params.push(Number(product_id)); }
    if (type)       { where.push('m.type = ?');       params.push(String(type)); }
    if (from)       { where.push('shop_date(m.created_at) >= ?::date'); params.push(String(from)); }
    if (to)         { where.push('shop_date(m.created_at) <= ?::date'); params.push(String(to)); }
    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where.push('(p.name ILIKE ? OR p.sku ILIKE ? OR m.reference ILIKE ? OR m.note ILIKE ?)');
      params.push(like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM stock_movements m
                  JOIN products p ON p.id = m.product_id
                  LEFT JOIN users u ON u.id = m.user_id
                  ${whereSql}`;

    const total = (await q.get(`SELECT COUNT(*) AS n ${base}`, ...params)).n;
    const take = Math.min(Number(limit) || 100, 500);
    const skip = Number(offset) || 0;

    const items = await q.all(`SELECT m.*, p.name AS product_name, p.sku, p.unit, u.username
         ${base}
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ? OFFSET ?`, ...params, take, skip);

    res.json({ items, total, limit: take, offset: skip });
  })
);

/** Receive stock (purchase / delivery in). */
router.post(
  '/in',
  wrap(async (req, res) => {
    const productId = int(req.body.product_id, { field: 'Product', required: true, min: 1 });
    const quantity = int(req.body.quantity, { field: 'Quantity', required: true, min: 1 });
    const unitCost = req.body.unit_cost === undefined || req.body.unit_cost === ''
      ? null
      : money(num(req.body.unit_cost, { field: 'Unit cost', min: 0 }));

    const result = await transaction(async (tx) => {
      const out = await applyMovement(tx, {
        productId, type: 'in', quantity, unitCost,
        reference: str(req.body.reference, { field: 'Reference', max: 100 }),
        note: str(req.body.note, { field: 'Note', max: 500 }),
        userId: req.user.id,
      });
      // Receiving at a new price updates the product's cost basis.
      if (unitCost !== null) {
        await tx.run('UPDATE products SET cost_price = ? WHERE id = ?', unitCost, productId);
      }
      return out;
    });

    res.status(201).json({ ok: true, ...result });
  })
);

/** Remove stock for a non-sale reason: damage, theft, internal use, returns to supplier. */
router.post(
  '/out',
  wrap(async (req, res) => {
    const productId = int(req.body.product_id, { field: 'Product', required: true, min: 1 });
    const quantity = int(req.body.quantity, { field: 'Quantity', required: true, min: 1 });

    const result = await transaction((tx) =>
      applyMovement(tx, {
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
  wrap(async (req, res) => {
    const productId = int(req.body.product_id, { field: 'Product', required: true, min: 1 });
    const counted = int(req.body.quantity, { field: 'Counted quantity', required: true, min: 0 });
    const note = str(req.body.note, { field: 'Reason', required: true, max: 500 });

    const result = await transaction((tx) =>
      applyMovement(tx, {
        productId, type: 'adjust', quantity: counted,
        reference: str(req.body.reference, { field: 'Reference', max: 100, fallback: 'STOCKTAKE' }),
        note, userId: req.user.id,
      })
    );

    res.status(201).json({ ok: true, ...result });
  })
);

export default router;
