import express from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, notFound, str, wrap } from '../helpers.js';

const router = express.Router();

router.get(
  '/',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c
         ORDER BY c.name COLLATE NOCASE`
      )
      .all();
    res.json(rows);
  })
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const name = str(req.body.name, { field: 'Name', required: true, max: 100 });
    const description = str(req.body.description, { field: 'Description', max: 500 });

    const exists = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (exists) throw new HttpError(409, `Category "${name}" already exists`);

    const info = db
      .prepare('INSERT INTO categories (name, description) VALUES (?, ?)')
      .run(name, description);
    res.status(201).json(
      db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid)
    );
  })
);

router.put(
  '/:id',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!current) throw notFound('Category not found');

    const name = str(req.body.name, { field: 'Name', required: true, max: 100 });
    const description = str(req.body.description, { field: 'Description', max: 500 });

    const clash = db
      .prepare('SELECT id FROM categories WHERE name = ? AND id != ?')
      .get(name, id);
    if (clash) throw new HttpError(409, `Category "${name}" already exists`);

    db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?')
      .run(name, description, id);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
  })
);

router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!current) throw notFound('Category not found');

    // Products survive; the FK is ON DELETE SET NULL so they become uncategorised.
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

export default router;
