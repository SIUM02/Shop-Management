import express from 'express';
import { db, getSettings, setSetting } from '../db.js';
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
  wrap((req, res) => {
    res.json(
      db.prepare(
        'SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username'
      ).all()
    );
  })
);

router.post(
  '/',
  requireRole('admin'),
  wrap((req, res) => {
    const username = str(req.body.username, { field: 'Username', required: true, max: 60 });
    const password = str(req.body.password, { field: 'Password', required: true, max: 200 });
    const fullName = str(req.body.full_name, { field: 'Full name', max: 120 });
    const role = str(req.body.role, { field: 'Role', required: true, max: 20 });

    if (!ROLES.includes(role)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}`);
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw badRequest('Username may only contain letters, numbers, dots, dashes and underscores');
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, `Username "${username}" is taken`);
    }

    const info = db
      .prepare(
        'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
      )
      .run(username, hashPassword(password), fullName, role);

    res.status(201).json(
      db.prepare('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?')
        .get(info.lastInsertRowid)
    );
  })
);

router.put(
  '/:id',
  requireRole('admin'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User not found');

    const fullName = str(req.body.full_name, { field: 'Full name', max: 120 });
    const role = str(req.body.role, { field: 'Role', required: true, max: 20 });
    const active = req.body.active ? 1 : 0;

    if (!ROLES.includes(role)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}`);

    // Guard against an admin locking everyone out of the admin area.
    if (user.role === 'admin' && (role !== 'admin' || !active)) {
      const otherAdmins = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
        .get(id).n;
      if (otherAdmins === 0) throw badRequest('This is the last active admin — keep at least one');
    }

    db.prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?')
      .run(fullName, role, active, id);

    if (req.body.new_password) {
      const pw = str(req.body.new_password, { field: 'New password', max: 200 });
      if (pw.length < 8) throw badRequest('Password must be at least 8 characters');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), id);
    }

    res.json(
      db.prepare('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?').get(id)
    );
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User not found');
    if (id === req.user.id) throw badRequest('You cannot delete your own account');

    if (user.role === 'admin') {
      const otherAdmins = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
        .get(id).n;
      if (otherAdmins === 0) throw badRequest('This is the last active admin — keep at least one');
    }

    // Sales and movements keep their history; user_id becomes NULL.
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  })
);

export const settingsRouter = express.Router();

settingsRouter.get('/', wrap((req, res) => res.json(getSettings())));

settingsRouter.put(
  '/',
  requireRole('admin'),
  wrap((req, res) => {
    const body = req.body || {};
    if (body.shop_name !== undefined) {
      setSetting('shop_name', str(body.shop_name, { field: 'Shop name', required: true, max: 120 }));
    }
    if (body.currency_symbol !== undefined) {
      setSetting('currency_symbol', str(body.currency_symbol, { field: 'Currency symbol', required: true, max: 5 }));
    }
    if (body.tax_percent !== undefined) {
      setSetting('tax_percent', num(body.tax_percent, { field: 'Tax percent', min: 0, max: 100 }));
    }
    if (body.number_locale !== undefined) {
      const locale = str(body.number_locale, { field: 'Number format', required: true, max: 10 });
      if (!NUMBER_LOCALES.includes(locale)) throw badRequest('Unsupported number format');
      setSetting('number_locale', locale);
    }
    res.json(getSettings());
  })
);

export default router;
