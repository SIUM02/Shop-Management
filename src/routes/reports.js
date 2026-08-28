import express from 'express';
import { db } from '../db.js';
import { wrap } from '../helpers.js';

const router = express.Router();

/** Everything the dashboard needs, in one round trip. */
router.get(
  '/dashboard',
  wrap((req, res) => {
    const totals = db
      .prepare(
        `SELECT COUNT(*)                                  AS product_count,
                COALESCE(SUM(quantity), 0)                AS total_units,
                COALESCE(SUM(quantity * cost_price), 0)   AS stock_value_cost,
                COALESCE(SUM(quantity * sell_price), 0)   AS stock_value_retail,
                COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
                COALESCE(SUM(CASE WHEN quantity > 0 AND quantity <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock
         FROM products WHERE active = 1`
      )
      .get();

    const today = db
      .prepare(
        `SELECT COUNT(*) AS sale_count,
                COALESCE(SUM(total), 0)                  AS revenue,
                COALESCE(SUM(total - tax - cost_total), 0) AS profit
         FROM sales
         WHERE status = 'completed' AND date(created_at) = date('now','localtime')`
      )
      .get();

    const month = db
      .prepare(
        `SELECT COUNT(*) AS sale_count,
                COALESCE(SUM(total), 0)                  AS revenue,
                COALESCE(SUM(total - tax - cost_total), 0) AS profit
         FROM sales
         WHERE status = 'completed'
           AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now','localtime')`
      )
      .get();

    // Zero-fill the last 14 days so the chart never shows gaps.
    const salesRows = db
      .prepare(
        `SELECT date(created_at) AS day,
                COALESCE(SUM(total), 0) AS revenue,
                COUNT(*) AS orders
         FROM sales
         WHERE status = 'completed' AND date(created_at) >= date('now','localtime','-13 days')
         GROUP BY day`
      )
      .all();
    const byDay = new Map(salesRows.map((r) => [r.day, r]));
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const hit = byDay.get(key);
      trend.push({ day: key, revenue: hit ? hit.revenue : 0, orders: hit ? hit.orders : 0 });
    }

    const lowStock = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.quantity, p.reorder_level, p.unit, s.name AS supplier_name
         FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.active = 1 AND p.quantity <= p.reorder_level
         ORDER BY (p.quantity - p.reorder_level), p.name
         LIMIT 12`
      )
      .all();

    const topProducts = db
      .prepare(
        `SELECT si.product_id, si.product_name, si.sku,
                SUM(si.quantity)   AS units_sold,
                SUM(si.line_total) AS revenue
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.status = 'completed' AND date(s.created_at) >= date('now','localtime','-30 days')
         GROUP BY si.product_id, si.product_name, si.sku
         ORDER BY revenue DESC
         LIMIT 8`
      )
      .all();

    const recentMovements = db
      .prepare(
        `SELECT m.id, m.type, m.quantity, m.after_qty, m.reference, m.created_at,
                p.name AS product_name, p.sku, u.username
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN users u ON u.id = m.user_id
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 10`
      )
      .all();

    const byCategory = db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorised') AS category,
                COUNT(p.id) AS products,
                COALESCE(SUM(p.quantity), 0) AS units,
                COALESCE(SUM(p.quantity * p.cost_price), 0) AS value
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1
         GROUP BY category
         ORDER BY value DESC`
      )
      .all();

    res.json({ totals, today, month, trend, lowStock, topProducts, recentMovements, byCategory });
  })
);

/** Full valuation list — what the stock on hand is worth. */
router.get(
  '/valuation',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT p.sku, p.name, p.unit, p.quantity, p.cost_price, p.sell_price,
                COALESCE(c.name, 'Uncategorised') AS category,
                (p.quantity * p.cost_price) AS cost_value,
                (p.quantity * p.sell_price) AS retail_value,
                (p.quantity * (p.sell_price - p.cost_price)) AS potential_profit
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1
         ORDER BY cost_value DESC`
      )
      .all();

    const totals = rows.reduce(
      (acc, r) => ({
        units: acc.units + r.quantity,
        cost_value: acc.cost_value + r.cost_value,
        retail_value: acc.retail_value + r.retail_value,
        potential_profit: acc.potential_profit + r.potential_profit,
      }),
      { units: 0, cost_value: 0, retail_value: 0, potential_profit: 0 }
    );

    res.json({ rows, totals });
  })
);

/** Items at or below their reorder level, with a suggested order quantity. */
router.get(
  '/reorder',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.quantity, p.reorder_level, p.unit, p.cost_price,
                MAX(p.reorder_level * 2 - p.quantity, 1) AS suggested_qty,
                (MAX(p.reorder_level * 2 - p.quantity, 1) * p.cost_price) AS estimated_cost,
                COALESCE(s.name, '—') AS supplier_name,
                COALESCE(s.phone, '') AS supplier_phone,
                COALESCE(s.email, '') AS supplier_email
         FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.active = 1 AND p.quantity <= p.reorder_level
         ORDER BY s.name, p.name`
      )
      .all();
    const estimated_total = rows.reduce((a, r) => a + r.estimated_cost, 0);
    res.json({ rows, estimated_total });
  })
);

/** Sales performance over a date range, grouped by day. */
router.get(
  '/sales',
  wrap((req, res) => {
    const from = String(req.query.from || '').trim() || null;
    const to = String(req.query.to || '').trim() || null;

    const where = ["s.status = 'completed'"];
    const params = [];
    if (from) { where.push('date(s.created_at) >= date(?)'); params.push(from); }
    if (to)   { where.push('date(s.created_at) <= date(?)'); params.push(to); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const summary = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(s.subtotal), 0)   AS subtotal,
                COALESCE(SUM(s.discount), 0)   AS discount,
                COALESCE(SUM(s.tax), 0)        AS tax,
                COALESCE(SUM(s.total), 0)      AS revenue,
                COALESCE(SUM(s.cost_total), 0) AS cost,
                COALESCE(SUM(s.total - s.tax - s.cost_total), 0) AS profit
         FROM sales s ${whereSql}`
      )
      .get(...params);

    const daily = db
      .prepare(
        `SELECT date(s.created_at) AS day,
                COUNT(*) AS orders,
                COALESCE(SUM(s.total), 0) AS revenue,
                COALESCE(SUM(s.total - s.tax - s.cost_total), 0) AS profit
         FROM sales s ${whereSql}
         GROUP BY day ORDER BY day`
      )
      .all(...params);

    const byProduct = db
      .prepare(
        `SELECT si.product_name, si.sku,
                SUM(si.quantity) AS units_sold,
                SUM(si.line_total) AS revenue,
                SUM(si.line_total - (si.unit_cost * si.quantity)) AS profit
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         ${whereSql}
         GROUP BY si.product_name, si.sku
         ORDER BY revenue DESC LIMIT 50`
      )
      .all(...params);

    res.json({ summary, daily, byProduct, from, to });
  })
);

const CSV_SOURCES = {
  products: {
    filename: 'products.csv',
    query: `SELECT p.sku, p.barcode, p.name, COALESCE(c.name,'') AS category,
                   COALESCE(s.name,'') AS supplier, p.quantity, p.unit,
                   p.cost_price, p.sell_price, p.reorder_level, p.location,
                   (p.quantity * p.cost_price) AS stock_value
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN suppliers  s ON s.id = p.supplier_id
            WHERE p.active = 1 ORDER BY p.name`,
  },
  movements: {
    filename: 'stock-movements.csv',
    query: `SELECT m.created_at, p.sku, p.name AS product, m.type, m.quantity,
                   m.before_qty, m.after_qty, m.reference, m.note,
                   COALESCE(u.username,'') AS user
            FROM stock_movements m
            JOIN products p ON p.id = m.product_id
            LEFT JOIN users u ON u.id = m.user_id
            ORDER BY m.created_at DESC LIMIT 5000`,
  },
  sales: {
    filename: 'sales.csv',
    query: `SELECT s.invoice_no, s.created_at, s.customer_name, s.subtotal,
                   s.discount, s.tax, s.total, s.cost_total,
                   (s.total - s.tax - s.cost_total) AS profit,
                   s.payment_method, s.status, COALESCE(u.username,'') AS user
            FROM sales s LEFT JOIN users u ON u.id = s.user_id
            ORDER BY s.created_at DESC LIMIT 5000`,
  },
};

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\r\n');
}

router.get(
  '/export/:what',
  wrap((req, res) => {
    const source = CSV_SOURCES[req.params.what];
    if (!source) return res.status(404).json({ error: 'Unknown export' });

    const csv = toCsv(db.prepare(source.query).all());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${source.filename}"`);
    res.send('﻿' + csv); // BOM so Excel reads UTF-8 correctly
  })
);

export default router;
