import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, dbPath } from './src/db.js';
import { requireAuth } from './src/auth.js';
import { ensureSeed } from './src/seed.js';

import authRoutes from './src/routes/auth.js';
import productRoutes from './src/routes/products.js';
import categoryRoutes from './src/routes/categories.js';
import supplierRoutes from './src/routes/suppliers.js';
import stockRoutes from './src/routes/stock.js';
import salesRoutes from './src/routes/sales.js';
import reportRoutes from './src/routes/reports.js';
import userRoutes, { settingsRouter } from './src/routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';

// Refuse to serve the internet with a guessable session secret.
const SECRET = process.env.JWT_SECRET || '';
if (IS_PROD && (SECRET.length < 32 || SECRET.includes('change-me'))) {
  console.error(
    '\n  Refusing to start: JWT_SECRET is missing, too short, or still the placeholder.\n' +
      '  Generate one with:\n' +
      "    node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n"
  );
  process.exit(1);
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

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);

  let message = err.message || 'Something went wrong';
  // Turn SQLite constraint errors into something a shopkeeper can act on.
  if (/UNIQUE constraint failed/i.test(message)) {
    message = 'That value must be unique — a record with it already exists.';
  } else if (/FOREIGN KEY constraint failed/i.test(message)) {
    message = 'That record is still referenced elsewhere and cannot be changed.';
  } else if (status >= 500) {
    message = 'Something went wrong on the server. Please try again.';
  }
  res.status(status).json({ error: message });
});

const created = ensureSeed();

app.listen(PORT, HOST, () => {
  console.log(`\n  ${created ? '✨ ' : ''}Shop Inventory is running`);
  console.log(`  →  http://localhost:${PORT}`);
  console.log(`  DB:  ${dbPath}`);
  if (created) {
    console.log('\n  First run — sign in with:');
    console.log(`     username: ${created.username}`);
    console.log(`     password: ${created.password}`);
    if (created.source === 'generated') {
      console.log('\n  This password was generated and is shown only once. Save it now.');
    } else {
      console.log('\n  Change this password from Settings once you are in.');
    }
    console.log('');
  } else {
    console.log('');
  }
});

const shutdown = () => {
  try { db.close(); } catch { /* already closed */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
