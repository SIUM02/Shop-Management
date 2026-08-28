import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ready } from './db.js';
import { requireAuth } from './auth.js';
import { redactResponses } from './permissions.js';
import { ensureSeed } from './seed.js';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import categoryRoutes from './routes/categories.js';
import supplierRoutes from './routes/suppliers.js';
import stockRoutes from './routes/stock.js';
import salesRoutes from './routes/sales.js';
import reportRoutes from './routes/reports.js';
import userRoutes, { settingsRouter } from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';

// Refuse to serve the internet with a guessable session secret.
const SECRET = process.env.JWT_SECRET || '';
if (IS_PROD && (SECRET.length < 32 || SECRET.includes('change-me'))) {
  throw new Error(
    'Refusing to start: JWT_SECRET is missing, too short, or still the placeholder. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}

app.disable('x-powered-by');

// Hosting platforms terminate TLS in front of us; without this, req.ip is the
// proxy's address and the login throttle would count every user as one client.
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Conservative headers — this app serves only its own assets, so the CSP can
// forbid every external origin. There are no inline scripts or handlers.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // a few components set style attributes
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/*
 * A serverless instance starts cold with no boot phase, so the schema check
 * and first-run seed hang off the first API request instead. Both are
 * memoised, so this is a resolved-promise await on every later request and on
 * every request of a normal long-running server.
 */
let bootPromise = null;
export function boot() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await ready();
      return ensureSeed();
    })().catch((err) => {
      bootPromise = null; // a later request may succeed
      throw err;
    });
  }
  return bootPromise;
}

app.use('/api', (req, res, next) => {
  boot().then(() => next(), next);
});

/*
 * Strip margin from every JSON response the caller is not entitled to see.
 * Mounted ahead of the routes but reads req.user at send time, by which point
 * requireAuth has run — so a new endpoint is covered without having to
 * remember to filter it.
 */
app.use('/api', redactResponses);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);

// Everything past this point needs a signed-in user.
app.use('/api/products', requireAuth, productRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/suppliers', requireAuth, supplierRoutes);
app.use('/api/stock', requireAuth, stockRoutes);
app.use('/api/sales', requireAuth, salesRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/settings', requireAuth, settingsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

// The SPA owns client-side routing, so any other GET returns the shell.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);

  let message = err.message || 'Something went wrong';
  // Turn database constraint errors into something a shopkeeper can act on.
  // Postgres reports these as SQLSTATE codes rather than message text.
  if (err.code === '23505' || /duplicate key value/i.test(message)) {
    message = 'That value must be unique — a record with it already exists.';
  } else if (err.code === '23503' || /foreign key constraint/i.test(message)) {
    message = 'That record is still referenced elsewhere and cannot be changed.';
  } else if (status >= 500) {
    message = 'Something went wrong on the server. Please try again.';
  }
  res.status(status).json({ error: message });
});

export default app;
