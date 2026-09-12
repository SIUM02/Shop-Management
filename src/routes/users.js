import express from 'express';
import { q, getSettings, setSetting } from '../db.js';
import { hashPassword, requireRole } from '../auth.js';
import { HttpError, badRequest, notFound, num, str, wrap } from '../helpers.js';

const router = express.Router();

const ROLES = ['admin', 'manager', 'staff'];

// Grouping styles offered in Settings; anything else is rejected so the
// front-end never has to guess at an unusable locale tag.
const NUMBER_LOCALES = ['en-IN', 'en-US', 'bn-BD'];

router.get(
  '/',
  requireRole('admin'),
  wrap(async (req, res) => {
    res.json(
      await q.all('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username')
    );
  })
);

router.post(
  '/',
  requireRole('admin'),
  wrap(async (req, res) => {
    const username = str(req.body.username, { field: 'ইউজারনেম', required: true, max: 60 });
    const password = str(req.body.password, { field: 'পাসওয়ার্ড', required: true, max: 200 });
    const fullName = str(req.body.full_name, { field: 'পুরো নাম', max: 120 });
    const role = str(req.body.role, { field: 'ভূমিকা', required: true, max: 20 });

    if (!ROLES.includes(role)) throw badRequest(`ভূমিকা এর মধ্যে একটি হতে হবে: ${ROLES.join(', ')}`);
    if (password.length < 8) throw badRequest('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw badRequest('ইউজারনেমে শুধু অক্ষর, সংখ্যা, ডট, ড্যাশ ও আন্ডারস্কোর থাকতে পারবে');
    }
    if (await q.get('SELECT id FROM users WHERE username = ?', username)) {
      throw new HttpError(409, `"${username}" ইউজারনেমটি আগেই নেওয়া হয়েছে`);
    }

    const info = await q.insert('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', username, hashPassword(password), fullName, role);

    res.status(201).json(
      await q.get('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?', info.lastInsertRowid)
    );
  })
);

router.put(
  '/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const user = await q.get('SELECT * FROM users WHERE id = ?', id);
    if (!user) throw notFound('ব্যবহারকারী পাওয়া যায়নি');

    const fullName = str(req.body.full_name, { field: 'পুরো নাম', max: 120 });
    const role = str(req.body.role, { field: 'ভূমিকা', required: true, max: 20 });
    const active = req.body.active ? 1 : 0;

    if (!ROLES.includes(role)) throw badRequest(`ভূমিকা এর মধ্যে একটি হতে হবে: ${ROLES.join(', ')}`);

    // Guard against an admin locking everyone out of the admin area.
    if (user.role === 'admin' && (role !== 'admin' || !active)) {
      const otherAdmins = (await q.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", id)).n;
      if (otherAdmins === 0) throw badRequest('এটিই শেষ সক্রিয় অ্যাডমিন — অন্তত একজন রাখতে হবে');
    }

    await q.run('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?', fullName, role, active, id);

    if (req.body.new_password) {
      const pw = str(req.body.new_password, { field: 'নতুন পাসওয়ার্ড', max: 200 });
      if (pw.length < 8) throw badRequest('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
      await q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), id);
    }

    res.json(
      await q.get('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?', id)
    );
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const user = await q.get('SELECT * FROM users WHERE id = ?', id);
    if (!user) throw notFound('ব্যবহারকারী পাওয়া যায়নি');
    if (id === req.user.id) throw badRequest('আপনি নিজের অ্যাকাউন্ট মুছতে পারবেন না');

    if (user.role === 'admin') {
      const otherAdmins = (await q.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", id)).n;
      if (otherAdmins === 0) throw badRequest('এটিই শেষ সক্রিয় অ্যাডমিন — অন্তত একজন রাখতে হবে');
    }

    // Sales and movements keep their history; user_id becomes NULL.
    await q.run('DELETE FROM users WHERE id = ?', id);
    res.json({ ok: true });
  })
);

export const settingsRouter = express.Router();

settingsRouter.get('/', wrap(async (req, res) => res.json(await getSettings())));

settingsRouter.put(
  '/',
  requireRole('admin'),
  wrap(async (req, res) => {
    const body = req.body || {};
    if (body.shop_name !== undefined) {
      await setSetting('shop_name', str(body.shop_name, { field: 'দোকানের নাম', required: true, max: 120 }));
    }
    if (body.currency_symbol !== undefined) {
      await setSetting('currency_symbol', str(body.currency_symbol, { field: 'মুদ্রার চিহ্ন', required: true, max: 5 }));
    }
    if (body.tax_percent !== undefined) {
      await setSetting('tax_percent', num(body.tax_percent, { field: 'কর শতাংশ', min: 0, max: 100 }));
    }
    if (body.number_locale !== undefined) {
      const locale = str(body.number_locale, { field: 'সংখ্যার বিন্যাস', required: true, max: 10 });
      if (!NUMBER_LOCALES.includes(locale)) throw badRequest('এই সংখ্যার বিন্যাস সমর্থিত নয়');
      await setSetting('number_locale', locale);
    }
    res.json(await getSettings());
  })
);

export default router;
