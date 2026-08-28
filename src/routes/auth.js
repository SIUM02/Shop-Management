import express from 'express';
import { q } from '../db.js';
import {
  COOKIE_NAME,
  cookieOptions,
  hashPassword,
  issueToken,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import { HttpError, str, wrap } from '../helpers.js';
import { checkLogin, clearFailures, recordFailure } from '../rate-limit.js';

const router = express.Router();

router.post(
  '/login',
  wrap(async (req, res) => {
    const username = str(req.body.username, { field: 'Username', required: true, max: 60 });
    const password = str(req.body.password, { field: 'Password', required: true, max: 200 });

    // Refuse before touching the password hash, so a locked-out attacker
    // gets no timing signal and burns no CPU on scrypt.
    const limit = checkLogin(req, username);
    if (limit.blocked) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpError(
        429,
        `Too many failed sign-in attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`
      );
    }

    const user = await q.get('SELECT * FROM users WHERE username = ?', username);

    // Same message either way so the form can't be used to enumerate usernames.
    if (!user || !verifyPassword(password, user.password_hash)) {
      for (const key of limit.keys) recordFailure(key);
      throw new HttpError(401, 'Incorrect username or password');
    }
    if (!user.active) throw new HttpError(403, 'This account has been deactivated');

    for (const key of limit.keys) clearFailures(key);
    res.cookie(COOKIE_NAME, issueToken(user), cookieOptions());
    res.json({
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
    });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post(
  '/change-password',
  requireAuth,
  wrap(async (req, res) => {
    const current = str(req.body.current_password, { field: 'Current password', required: true, max: 200 });
    const next = str(req.body.new_password, { field: 'New password', required: true, max: 200 });
    if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');

    const row = await q.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(current, row.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect');
    }

    await q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
    res.json({ ok: true });
  })
);

export default router;
