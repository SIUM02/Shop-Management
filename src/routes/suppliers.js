import express from 'express';
import { q } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, notFound, str, wrap } from '../helpers.js';

const router = express.Router();

function readBody(body) {
  return {
    name: str(body.name, { field: 'নাম', required: true, max: 120 }),
    contact_person: str(body.contact_person, { field: 'যোগাযোগকারী ব্যক্তি', max: 120 }),
    phone: str(body.phone, { field: 'ফোন', max: 40 }),
    email: str(body.email, { field: 'ইমেইল', max: 120 }),
    address: str(body.address, { field: 'ঠিকানা', max: 300 }),
    notes: str(body.notes, { field: 'নোট', max: 1000 }),
  };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await q.all(`SELECT s.*,
                (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count
         FROM suppliers s
         ORDER BY lower(s.name)`);
    res.json(rows);
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const supplier = await q.get('SELECT * FROM suppliers WHERE id = ?', Number(req.params.id));
    if (!supplier) throw notFound('সরবরাহকারী পাওয়া যায়নি');
    supplier.products = await q.all('SELECT id, sku, name, quantity, cost_price FROM products WHERE supplier_id = ? ORDER BY name', supplier.id);
    res.json(supplier);
  })
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const data = readBody(req.body);
    if (await q.get('SELECT id FROM suppliers WHERE name = ?', data.name)) {
      throw new HttpError(409, `"${data.name}" নামে একটি সরবরাহকারী আগে থেকেই আছে`);
    }
    const info = await q.insert(`INSERT INTO suppliers (name, contact_person, phone, email, address, notes)
         VALUES (?, ?, ?, ?, ?, ?)`, data.name, data.contact_person, data.phone, data.email, data.address, data.notes);
    res.status(201).json(
      await q.get('SELECT * FROM suppliers WHERE id = ?', info.lastInsertRowid)
    );
  })
);

router.put(
  '/:id',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!await q.get('SELECT id FROM suppliers WHERE id = ?', id)) {
      throw notFound('সরবরাহকারী পাওয়া যায়নি');
    }
    const data = readBody(req.body);
    if (await q.get('SELECT id FROM suppliers WHERE name = ? AND id != ?', data.name, id)) {
      throw new HttpError(409, `"${data.name}" নামে একটি সরবরাহকারী আগে থেকেই আছে`);
    }
    await q.run(`UPDATE suppliers
       SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ?
       WHERE id = ?`, data.name, data.contact_person, data.phone, data.email, data.address, data.notes, id);
    res.json(await q.get('SELECT * FROM suppliers WHERE id = ?', id));
  })
);

router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!await q.get('SELECT id FROM suppliers WHERE id = ?', id)) {
      throw notFound('সরবরাহকারী পাওয়া যায়নি');
    }
    await q.run('DELETE FROM suppliers WHERE id = ?', id);
    res.json({ ok: true });
  })
);

export default router;
