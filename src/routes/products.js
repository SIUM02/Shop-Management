import express from 'express';
import { db, transaction } from '../db.js';
import { requireRole } from '../auth.js';
import {
  HttpError, badRequest, int, money, notFound, num, optionalId, str, wrap,
} from '../helpers.js';

const router = express.Router();

const SELECT_PRODUCT = `
  SELECT p.*,
         c.name AS category_name,
         s.name AS supplier_name,
         (p.quantity * p.cost_price) AS stock_value,
         CASE
           WHEN p.quantity <= 0 THEN 'out'
           WHEN p.quantity <= p.reorder_level THEN 'low'
           ELSE 'ok'
         END AS stock_status
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers  s ON s.id = p.supplier_id
`;

const SORTABLE = {
  name: 'p.name COLLATE NOCASE',
  sku: 'p.sku COLLATE NOCASE',
  quantity: 'p.quantity',
  sell_price: 'p.sell_price',
  cost_price: 'p.cost_price',
  stock_value: 'stock_value',
  created_at: 'p.created_at',
  category: 'c.name COLLATE NOCASE',
};

router.get(
  '/',
  wrap((req, res) => {
    const { search, category_id, supplier_id, status, sort, dir, limit, offset } = req.query;

    const where = [];
    const params = [];

    if (req.query.include_inactive !== '1') where.push('p.active = 1');

    if (search && String(search).trim()) {
      const like = `%${String(search).trim()}%`;
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)');
      params.push(like, like, like, like);
    }
    if (category_id) {
      where.push('p.category_id = ?');
      params.push(Number(category_id));
    }
    if (supplier_id) {
      where.push('p.supplier_id = ?');
      params.push(Number(supplier_id));
    }
    if (status === 'low') where.push('p.quantity > 0 AND p.quantity <= p.reorder_level');
    else if (status === 'out') where.push('p.quantity <= 0');
    else if (status === 'ok') where.push('p.quantity > p.reorder_level');

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = `ORDER BY ${SORTABLE[sort] || SORTABLE.name} ${dir === 'desc' ? 'DESC' : 'ASC'}`;

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`)
      .get(...params).n;

    const take = Math.min(Number(limit) || 100, 500);
    const skip = Number(offset) || 0;
    const items = db
      .prepare(`${SELECT_PRODUCT} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
      .all(...params, take, skip);

    res.json({ items, total, limit: take, offset: skip });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const product = db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(Number(req.params.id));
    if (!product) throw notFound('Product not found');

    product.movements = db
      .prepare(
        `SELECT m.*, u.username
         FROM stock_movements m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.product_id = ?
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 50`
      )
      .all(product.id);
    res.json(product);
  })
);

function readBody(body) {
  const data = {
    sku: str(body.sku, { field: 'SKU', required: true, max: 60 }),
    name: str(body.name, { field: 'Name', required: true, max: 200 }),
    barcode: str(body.barcode, { field: 'Barcode', max: 60 }) || null,
    description: str(body.description, { field: 'Description', max: 2000 }),
    category_id: optionalId(body.category_id),
    supplier_id: optionalId(body.supplier_id),
    cost_price: money(num(body.cost_price, { field: 'Cost price', min: 0 })),
    sell_price: money(num(body.sell_price, { field: 'Selling price', min: 0 })),
    reorder_level: int(body.reorder_level, { field: 'Reorder level', min: 0 }),
    unit: str(body.unit, { field: 'Unit', max: 20, fallback: 'pcs' }) || 'pcs',
    location: str(body.location, { field: 'Location', max: 100 }),
    active: body.active === undefined ? 1 : body.active ? 1 : 0,
  };

  if (data.category_id && !db.prepare('SELECT id FROM categories WHERE id = ?').get(data.category_id)) {
    throw badRequest('Selected category no longer exists');
  }
  if (data.supplier_id && !db.prepare('SELECT id FROM suppliers WHERE id = ?').get(data.supplier_id)) {
    throw badRequest('Selected supplier no longer exists');
  }
  return data;
}

router.post(
  '/',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const data = readBody(req.body);
    const openingQty = int(req.body.quantity, { field: 'Opening quantity', min: 0 });

    if (db.prepare('SELECT id FROM products WHERE sku = ?').get(data.sku)) {
      throw new HttpError(409, `SKU "${data.sku}" is already in use`);
    }

    const id = transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO products
             (sku, barcode, name, description, category_id, supplier_id,
              cost_price, sell_price, quantity, reorder_level, unit, location, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.sku, data.barcode, data.name, data.description, data.category_id,
          data.supplier_id, data.cost_price, data.sell_price, openingQty,
          data.reorder_level, data.unit, data.location, data.active
        );
      const newId = Number(info.lastInsertRowid);

      // Opening stock is a real movement so the audit trail starts from zero.
      if (openingQty > 0) {
        db.prepare(
          `INSERT INTO stock_movements
             (product_id, type, quantity, before_qty, after_qty, unit_cost, reference, note, user_id)
           VALUES (?, 'in', ?, 0, ?, ?, 'OPENING', 'Opening stock', ?)`
        ).run(newId, openingQty, openingQty, data.cost_price, req.user.id);
      }
      return newId;
    });

    res.status(201).json(db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id));
  })
);

router.put(
  '/:id',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM products WHERE id = ?').get(id)) {
      throw notFound('Product not found');
    }
    const data = readBody(req.body);

    if (db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(data.sku, id)) {
      throw new HttpError(409, `SKU "${data.sku}" is already in use`);
    }

    // quantity is deliberately not editable here — it only moves through
    // /api/stock so that every change leaves an audit trail.
    db.prepare(
      `UPDATE products SET
         sku = ?, barcode = ?, name = ?, description = ?, category_id = ?, supplier_id = ?,
         cost_price = ?, sell_price = ?, reorder_level = ?, unit = ?, location = ?, active = ?
       WHERE id = ?`
    ).run(
      data.sku, data.barcode, data.name, data.description, data.category_id, data.supplier_id,
      data.cost_price, data.sell_price, data.reorder_level, data.unit, data.location, data.active, id
    );

    res.json(db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id));
  })
);

router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) throw notFound('Product not found');

    const soldCount = db
      .prepare('SELECT COUNT(*) AS n FROM sale_items WHERE product_id = ?')
      .get(id).n;

    // Deleting a product that appears on past invoices would rewrite history,
    // so archive it instead and let the caller know which happened.
    if (soldCount > 0) {
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      return res.json({
        ok: true,
        archived: true,
        message: `"${product.name}" appears on ${soldCount} sale(s), so it was archived instead of deleted.`,
      });
    }

    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ ok: true, archived: false, message: `"${product.name}" was deleted.` });
  })
);

/** Barcode / SKU lookup used by the point-of-sale screen. */
router.get(
  '/lookup/:code',
  wrap((req, res) => {
    const code = String(req.params.code).trim();
    const product = db
      .prepare(`${SELECT_PRODUCT} WHERE p.active = 1 AND (p.barcode = ? OR p.sku = ?)`)
      .get(code, code);
    if (!product) throw notFound('No product matches that code');
    res.json(product);
  })
);

export default router;
