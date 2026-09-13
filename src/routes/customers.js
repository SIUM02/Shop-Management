/*
 * Customer accounts and what each of them still owes.
 *
 * A sale records what was billed and how much of it was handed over at the
 * counter; anything paid afterwards is a row in customer_payments. A
 * customer's balance is therefore never stored, only derived:
 *
 *     due = billed − paid at the counter − paid since
 *
 * Keeping it derived is deliberate. A stored balance is one missed update away
 * from disagreeing with the invoices it is supposed to summarise, and the
 * invoices are what the customer can see.
 */
import express from 'express';
import { q, transaction } from '../db.js';
import { requireRole } from '../auth.js';
import { HttpError, badRequest, money, notFound, num, str, wrap } from '../helpers.js';

const router = express.Router();

/* Voided sales are excluded everywhere: the goods went back on the shelf, so
 * the customer was never billed for them. */
const BALANCE_SQL = `
  COALESCE((SELECT SUM(s.total) FROM sales s
             WHERE s.customer_id = c.id AND s.status = 'completed'), 0) AS billed,
  COALESCE((SELECT SUM(s.paid_amount) FROM sales s
             WHERE s.customer_id = c.id AND s.status = 'completed'), 0) AS paid_at_sale,
  COALESCE((SELECT SUM(p.amount) FROM customer_payments p
             WHERE p.customer_id = c.id), 0) AS paid_later`;

const withDue = (row) => {
  const billed = Number(row.billed || 0);
  const paid = Number(row.paid_at_sale || 0) + Number(row.paid_later || 0);
  return { ...row, billed: money(billed), paid: money(paid), due: money(billed - paid) };
};

/** Everyone, newest first, with what each still owes. */
router.get(
  '/',
  wrap(async (req, res) => {
    const search = str(req.query.search, { field: 'খোঁজ', max: 120 });
    const onlyDue = String(req.query.due || '') === '1';

    const where = ['c.active = 1'];
    const params = [];
    if (search) {
      where.push('(c.name ILIKE ? OR c.phone ILIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const rows = (await q.all(
      `SELECT c.id, c.name, c.phone, c.address, c.note, c.created_at,
              (SELECT COUNT(*) FROM sales s
                WHERE s.customer_id = c.id AND s.status = 'completed') AS sale_count,
              ${BALANCE_SQL}
         FROM customers c
        WHERE ${where.join(' AND ')}
        ORDER BY c.name`,
      ...params
    )).map(withDue);

    const visible = onlyDue ? rows.filter((r) => r.due > 0.005) : rows;

    res.json({
      items: visible,
      totals: {
        customers: rows.length,
        due: money(rows.reduce((a, r) => a + r.due, 0)),
        owing: rows.filter((r) => r.due > 0.005).length,
      },
    });
  })
);

/** One customer, with every invoice and every payment against the account. */
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = num(req.params.id, { field: 'আইডি', required: true, min: 1 });

    const customer = await q.get(
      `SELECT c.*, ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, id);
    if (!customer) throw notFound('ক্রেতা পাওয়া যায়নি');

    const sales = await q.all(
      `SELECT id, invoice_no, created_at, total, paid_amount, status, payment_method
         FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 200`, id);

    const payments = await q.all(
      `SELECT p.id, p.amount, p.method, p.note, p.created_at,
              s.invoice_no, u.username
         FROM customer_payments p
         LEFT JOIN sales s ON s.id = p.sale_id
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.customer_id = ? ORDER BY p.id DESC LIMIT 200`, id);

    res.json({
      ...withDue(customer),
      sales: sales.map((s) => ({ ...s, due: money(Number(s.total) - Number(s.paid_amount || 0)) })),
      payments,
    });
  })
);

function readBody(body) {
  return {
    name: str(body.name, { field: 'ক্রেতার নাম', required: true, max: 120 }),
    phone: str(body.phone, { field: 'ফোন', max: 40 }),
    address: str(body.address, { field: 'ঠিকানা', max: 200 }),
    note: str(body.note, { field: 'নোট', max: 500 }),
  };
}

router.post(
  '/',
  wrap(async (req, res) => {
    const data = readBody(req.body || {});
    const clash = await q.get(
      'SELECT id FROM customers WHERE name = ? AND phone = ? AND active = 1',
      data.name, data.phone);
    if (clash) throw new HttpError(409, `"${data.name}" নামে এই ফোন নম্বরে একজন ক্রেতা আগে থেকেই আছেন`);

    const info = await q.insert(
      'INSERT INTO customers (name, phone, address, note) VALUES (?, ?, ?, ?)',
      data.name, data.phone, data.address, data.note);

    res.status(201).json(await q.get('SELECT * FROM customers WHERE id = ?', Number(info.lastInsertRowid)));
  })
);

router.put(
  '/:id',
  wrap(async (req, res) => {
    const id = num(req.params.id, { field: 'আইডি', required: true, min: 1 });
    const existing = await q.get('SELECT * FROM customers WHERE id = ?', id);
    if (!existing) throw notFound('ক্রেতা পাওয়া যায়নি');

    const data = readBody(req.body || {});
    await q.run(
      'UPDATE customers SET name = ?, phone = ?, address = ?, note = ? WHERE id = ?',
      data.name, data.phone, data.address, data.note, id);

    res.json(await q.get('SELECT * FROM customers WHERE id = ?', id));
  })
);

/*
 * Removing a customer archives rather than deletes when money is involved:
 * their invoices are the shop's own record, and an outstanding balance must
 * not be made to disappear by tidying the list.
 */
router.delete(
  '/:id',
  requireRole('admin', 'manager'),
  wrap(async (req, res) => {
    const id = num(req.params.id, { field: 'আইডি', required: true, min: 1 });
    const customer = await q.get(`SELECT c.*, ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, id);
    if (!customer) throw notFound('ক্রেতা পাওয়া যায়নি');

    const { due } = withDue(customer);
    if (due > 0.005) {
      throw badRequest(`এই ক্রেতার ${due} টাকা বাকি আছে — আগে হিসাব মিটিয়ে নিন`);
    }

    const sold = await q.get('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?', id);
    if (Number(sold.n) > 0) {
      await q.run('UPDATE customers SET active = 0 WHERE id = ?', id);
      return res.json({
        ok: true, archived: true,
        message: `"${customer.name}" এর ${sold.n}টি চালান আছে, তাই মোছার বদলে তালিকা থেকে সরানো হয়েছে।`,
      });
    }

    await q.run('DELETE FROM customers WHERE id = ?', id);
    res.json({ ok: true, archived: false, message: `"${customer.name}" মুছে ফেলা হয়েছে।` });
  })
);

/** Record money received against the account — a আংশিক (partial) payment. */
router.post(
  '/:id/payments',
  wrap(async (req, res) => {
    const id = num(req.params.id, { field: 'আইডি', required: true, min: 1 });
    const amount = money(num(req.body.amount, { field: 'টাকার পরিমাণ', required: true, min: 0.01 }));
    const method = str(req.body.method, { field: 'পরিশোধের মাধ্যম', max: 30, fallback: 'cash' }) || 'cash';
    const note = str(req.body.note, { field: 'নোট', max: 300 });
    const saleId = req.body.sale_id ? num(req.body.sale_id, { field: 'চালান', min: 1 }) : null;

    const payment = await transaction(async (tx) => {
      const customer = await tx.get(`SELECT c.*, ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, id);
      if (!customer) throw notFound('ক্রেতা পাওয়া যায়নি');

      const { due } = withDue(customer);
      // Taking more than is owed would leave a negative balance, which reads
      // as the shop owing the customer — refuse rather than record a fiction.
      if (amount > due + 0.005) {
        throw badRequest(`বাকি আছে ${due} টাকা, তার বেশি নেওয়া যাবে না`);
      }

      if (saleId) {
        const sale = await tx.get('SELECT id FROM sales WHERE id = ? AND customer_id = ?', saleId, id);
        if (!sale) throw badRequest('এই চালানটি এই ক্রেতার নয়');
      }

      const info = await tx.insert(
        `INSERT INTO customer_payments (customer_id, sale_id, amount, method, note, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id, saleId, amount, method, note, req.user.id);

      return tx.get('SELECT * FROM customer_payments WHERE id = ?', Number(info.lastInsertRowid));
    });

    const after = await q.get(`SELECT c.*, ${BALANCE_SQL} FROM customers c WHERE c.id = ?`, id);
    res.status(201).json({ payment, ...withDue(after) });
  })
);

export default router;
