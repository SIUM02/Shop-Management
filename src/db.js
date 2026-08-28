import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const dbPath = path.resolve(ROOT, process.env.DB_PATH || './data/shop.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

// WAL keeps reads fast while a write is in progress; foreign keys are off by
// default in SQLite and we rely on them for referential integrity.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','manager','staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  contact_person TEXT    NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL DEFAULT '',
  email          TEXT    NOT NULL DEFAULT '',
  address        TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  barcode       TEXT    DEFAULT NULL,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_price    REAL    NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sell_price    REAL    NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  quantity      INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit          TEXT    NOT NULL DEFAULT 'pcs',
  location      TEXT    NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Full audit trail. Every change to products.quantity writes a row here.
CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('in','out','adjust','sale','return')),
  quantity   INTEGER NOT NULL,
  before_qty INTEGER NOT NULL,
  after_qty  INTEGER NOT NULL,
  unit_cost  REAL    NOT NULL DEFAULT 0,
  reference  TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no     TEXT    NOT NULL UNIQUE,
  customer_name  TEXT    NOT NULL DEFAULT '',
  customer_phone TEXT    NOT NULL DEFAULT '',
  subtotal       REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  tax            REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  cost_total     REAL    NOT NULL DEFAULT 0,
  payment_method TEXT    NOT NULL DEFAULT 'cash',
  note           TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT    NOT NULL,
  sku          TEXT    NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   REAL    NOT NULL,
  unit_cost    REAL    NOT NULL DEFAULT 0,
  line_total   REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_name      ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode   ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier  ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_movements_product  ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_created  ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_created      ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
`;

db.exec(SCHEMA);

// Keep products.updated_at honest without every query having to remember it.
db.exec(`
CREATE TRIGGER IF NOT EXISTS trg_products_updated
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
  UPDATE products SET updated_at = datetime('now') WHERE id = OLD.id;
END;
`);

const DEFAULT_SETTINGS = {
  shop_name: 'My Shop',
  currency_symbol: '৳',
  // en-IN gives South-Asian lakh/crore grouping with Latin digits (1,23,456.78),
  // which is how amounts are written in Bangladesh. See NUMBER_LOCALES.
  number_locale: 'en-IN',
  tax_percent: '0',
  low_stock_only_active: '1',
};

/** Fills in any setting the database is missing, leaving existing ones alone. */
export function applyDefaultSettings() {
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }
}

applyDefaultSettings();

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/**
 * Run `fn` inside a transaction. node:sqlite has no transaction helper, so we
 * drive BEGIN/COMMIT/ROLLBACK by hand and re-throw so the caller still sees
 * the original error.
 */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the transaction was already unwound */
    }
    throw err;
  }
}

export { dbPath };
