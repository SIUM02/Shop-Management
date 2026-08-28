import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'insecure-dev-secret-change-me';
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
export const COOKIE_NAME = 'shop_session';

const SCRYPT_KEYLEN = 64;

/** Hash a plaintext password as `scrypt$<salt-hex>$<key-hex>`. */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length);
  // Constant-time compare so a wrong password can't be narrowed down by timing.
  return crypto.timingSafeEqual(expected, actual);
}

export function issueToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: `${SESSION_HOURS}h` }
  );
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  };
}

const findUser = () =>
  db.prepare(
    'SELECT id, username, full_name, role, active FROM users WHERE id = ?'
  );

/** Populates req.user from the session cookie, or 401s. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }

  // Re-read the user each request so a deactivated account loses access
  // immediately rather than when their token happens to expire.
  const user = findUser().get(payload.sub);
  if (!user || !user.active) {
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Account is no longer active' });
  }

  req.user = user;
  next();
}

/** Route guard: requireRole('admin') or requireRole('admin', 'manager'). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}
