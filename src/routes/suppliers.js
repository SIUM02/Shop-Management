import express from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, notFound, str, wrap } from '../helpers.js';

const router = express.Router();

function readBody(body) {
  return {
    name: str(body.name, { field: 'Name', required: true, max: 120 }),
    contact_person: str(body.contact_person, { field: 'Contact person', max: 120 }),
    phone: str(body.phone, { field: 'Phone', max: 40 }),
    email: str(body.email, { field: 'Email', max: 120 }),
    address: str(body.address, { field: 'Address', max: 300 }),
    notes: str(body.notes, { field: 'Notes', max: 1000 }),
  };
}

router.get(
  '/',
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count
         FROM suppliers s
         ORDER BY s.name COLLATE NOCASE`
      )
      .all();
    res.json(rows);
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(req.params.id));
    if (!supplier) throw notFound('Supplier not found');
    supplier.products = db
      .prepare('SELECT id, sku, name, quantity, cost_price FROM products WHERE supplier_id = ? ORDER BY name')
      .all(supplier.id);
    res.json(supplier);
  })
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const data = readBody(req.body);
    if (db.prepare('SELECT id FROM suppliers WHERE name = ?').get(data.name)) {
      throw new HttpError(409, `Supplier "${data.name}" already exists`);
    }
    const info = db
      .prepare(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(data.name, data.contact_person, data.phone, data.email, data.address, data.notes);
    res.status(201).json(
      db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid)
    );
  })
);

router.put(
  '/:id',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id)) {
      throw notFound('Supplier not found');
    }
    const data = readBody(req.body);
    if (db.prepare('SELECT id FROM suppliers WHERE name = ? AND id != ?').get(data.name, id)) {
      throw new HttpError(409, `Supplier "${data.name}" already exists`);
    }
    db.prepare(
      `UPDATE suppliers
       SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ?
       WHERE id = ?`
    ).run(data.name, data.contact_person, data.phone, data.email, data.address, data.notes, id);
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
  })
);

router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id)) {
      throw notFound('Supplier not found');
    }
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

export default router;
