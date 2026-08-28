import express from 'express';
import { q } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, notFound, str, wrap } from '../helpers.js';

const router = express.Router();

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await q.all(`SELECT c.*,
                (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c
         ORDER BY lower(c.name)`);
    res.json(rows);
  })
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const name = str(req.body.name, { field: 'Name', required: true, max: 100 });
    const description = str(req.body.description, { field: 'Description', max: 500 });

    const exists = await q.get('SELECT id FROM categories WHERE name = ?', name);
    if (exists) throw new HttpError(409, `Category "${name}" already exists`);

    const info = await q.insert('INSERT INTO categories (name, description) VALUES (?, ?)', name, description);
    res.status(201).json(
      await q.get('SELECT * FROM categories WHERE id = ?', info.lastInsertRowid)
    );
  })
);

router.put(
  '/:id',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const current = await q.get('SELECT * FROM categories WHERE id = ?', id);
    if (!current) throw notFound('Category not found');

    const name = str(req.body.name, { field: 'Name', required: true, max: 100 });
    const description = str(req.body.description, { field: 'Description', max: 500 });

    const clash = await q.get('SELECT id FROM categories WHERE name = ? AND id != ?', name, id);
    if (clash) throw new HttpError(409, `Category "${name}" already exists`);

    await q.run('UPDATE categories SET name = ?, description = ? WHERE id = ?', name, description, id);
    res.json(await q.get('SELECT * FROM categories WHERE id = ?', id));
  })
);

router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const current = await q.get('SELECT * FROM categories WHERE id = ?', id);
    if (!current) throw notFound('Category not found');

    // Products survive; the FK is ON DELETE SET NULL so they become uncategorised.
    await q.run('DELETE FROM categories WHERE id = ?', id);
    res.json({ ok: true });
  })
);

export default router;
