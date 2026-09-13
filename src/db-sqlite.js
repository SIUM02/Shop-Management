/*
 * SQLite data layer, for the shop that runs on one computer.
 *
 * Exposes exactly the surface db-postgres.js does — q, transaction, ready,
 * getSettings, setSetting, applyDefaultSettings, pool, dbTarget — so the
 * routes cannot tell which database is underneath and none of their SQL
 * changes. The dialect gaps are closed in two places rather than in the
 * queries: translate() rewrites the handful of Postgres-only keywords, and
 * the shop_* helpers Postgres declares as SQL functions are registered here
 * as JavaScript ones.
 *
 * The whole shop lives in a single file, which is what makes an offline
 * install possible: nothing to configure, and a backup is a file copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Accepts a bare path, a file: URL or a sqlite: URL, so either env var works. */
function resolveDbPath() {
  const raw = (process.env.DB_PATH || process.env.DATABASE_URL || './data/shop.db').trim();
  const stripped = raw.replace(/^sqlite:(\/\/)?/i, '').replace(/^file:(\/\/)?/i, '');
  return path.resolve(ROOT, stripped || './data/shop.db');
}

export const dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

/*
 * Two SQLite engines, one behaviour.
 *
 * node:sqlite is built into Node 22.5+ and is used wherever it exists. It does
 * not exist on the runtime that can still reach Windows 7 — that machine tops
 * out at Electron 22, whose Node is 16 — so the fallback is SQLite compiled to
 * WebAssembly. The WASM build carries no compiled binary, which is what makes
 * a 32-bit Windows build possible at all: there is no per-architecture
 * artifact to match.
 *
 * The two libraries differ only in how a statement is called, so the
 * difference is absorbed here and nothing below this point knows which is
 * running.
 */
const require = createRequire(import.meta.url);

function openDatabase() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const handle = new DatabaseSync(dbPath);
    return {
      engine: 'node:sqlite',
      exec: (sql) => handle.exec(sql),
      all: (sql, params) => handle.prepare(sql).all(...params),
      get: (sql, params) => handle.prepare(sql).get(...params),
      run: (sql, params) => {
        const r = handle.prepare(sql).run(...params);
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
      fn: (name, impl) => handle.function(name, impl),
      close: () => handle.close(),
    };
  } catch (err) {
    if (err?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && !/Cannot find module/.test(err?.message || '')) {
      throw err;
    }
    const { Database } = require('node-sqlite3-wasm');
    const handle = new Database(dbPath);
    return {
      engine: 'node-sqlite3-wasm',
      exec: (sql) => handle.exec(sql),
      all: (sql, params) => handle.all(sql, params),
      get: (sql, params) => handle.get(sql, params),
      run: (sql, params) => {
        const r = handle.run(sql, params);
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
      fn: (name, impl) => handle.function(name, impl),
      close: () => handle.close(),
    };
  }
}

export const db = openDatabase();
export const engine = db.engine;

// WAL keeps reads responsive while a sale is being written; foreign keys are
// off by default in SQLite and the schema leans on them. busy_timeout matters
// because a second process (a stray CLI script) would otherwise fail instantly
// rather than waiting for the write lock.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

export const dbTarget = dbPath;

/* ------------------------------------------------------- dialect bridging */

const TZ = process.env.SHOP_TZ || 'Asia/Dhaka';

/** 'YYYY-MM-DD HH:MM:SS' UTC — the exact text format the app stores. */
const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/*
 * The shop-local calendar date of a stored UTC timestamp.
 *
 * Postgres names the zone explicitly because its server clock is UTC. Here the
 * zone is named too rather than trusting the PC's clock: a shop machine set to
 * the wrong timezone would otherwise silently file a sale under the wrong day,
 * and "today's takings" is the number the owner checks at closing time.
 */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function shopDate(ts) {
  if (ts === null || ts === undefined) return null;
  const text = String(ts);
  const d = new Date(text.replace(' ', 'T') + (text.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return null;
  return dateFormatter.format(d); // en-CA formats as YYYY-MM-DD
}

db.fn('shop_utc_now', () => utcNow());
db.fn('shop_date', (ts) => shopDate(ts));
db.fn('shop_today', () => dateFormatter.format(new Date()));

/*
 * Postgres takes this advisory lock so several serverless instances cannot
 * seed at once. One local process cannot race itself, and every write is
 * already serialised through the mutex below, so it is a no-op here — defined
 * rather than rewritten so seed.js keeps one query for both databases.
 *
 * The unused parameter is load-bearing: node:sqlite takes the function's
 * declared arity as the SQL arity, so a zero-argument version is rejected at
 * call time with "wrong number of arguments".
 */
db.fn('pg_advisory_xact_lock', (_key) => 0);

/*
 * to_char over a date. The shop_* helpers above hand back 'YYYY-MM-DD' text,
 * so every pattern the reports use is a prefix of that.
 *
 * An unrecognised pattern throws rather than falling back to the raw value:
 * these strings group revenue into months, and a silently mis-grouped total
 * is far worse than a visible error.
 */
const TO_CHAR_WIDTHS = { 'YYYY': 4, 'YYYY-MM': 7, 'YYYY-MM-DD': 10 };

db.fn('to_char', (value, fmt) => {
  if (value === null || value === undefined) return null;
  const width = TO_CHAR_WIDTHS[String(fmt)];
  if (!width) throw new Error(`to_char: unsupported format '${fmt}'`);
  return String(value).slice(0, width);
});

/**
 * Rewrites the few Postgres-only spellings. Kept deliberately small: anything
 * more than a keyword swap belongs in the query itself, where it can be read.
 */
export function translate(sql) {
  return sql
    // SQLite's LIKE is already case-insensitive for ASCII, which is what
    // ILIKE was chosen for.
    .replace(/\bILIKE\b/gi, 'LIKE')
    // Row locking: SQLite serialises writers, so the lock FOR UPDATE provided
    // is already held by the transaction.
    .replace(/\bFOR\s+UPDATE\b/gi, '')
    // Date comparisons are against shop_date(), which returns 'YYYY-MM-DD'
    // text here; comparing that to a 'YYYY-MM-DD' parameter already orders
    // correctly, so the cast has nothing left to do.
    .replace(/::date\b/gi, '')
    // SQLite spells the multi-argument forms MAX/MIN; with two or more
    // arguments those are the scalar functions, not the aggregates.
    .replace(/\bGREATEST\s*\(/gi, 'MAX(')
    .replace(/\bLEAST\s*\(/gi, 'MIN(');
}

/**
 * node:sqlite binds only null, number, bigint, string and buffers. The routes
 * pass through whatever the request held, so undefined and booleans arrive and
 * would throw a TypeError deep inside a query.
 */
function normalise(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString().slice(0, 19).replace('T', ' ');
    return p;
  });
}

/* ------------------------------------------------------------ query surface */

function makeSurface() {
  return {
    async all(sql, ...params) {
      return db.all(translate(sql), normalise(params));
    },

    async get(sql, ...params) {
      return db.get(translate(sql), normalise(params));
    },

    async run(sql, ...params) {
      const res = db.run(translate(sql), normalise(params));
      return { changes: res.changes };
    },

    /** INSERT that reports the new row's id, matching the Postgres surface. */
    async insert(sql, ...params) {
      const res = db.run(translate(sql), normalise(params));
      return { lastInsertRowid: res.lastInsertRowid, changes: res.changes };
    },

    async exec(sql) {
      db.exec(translate(sql));
    },
  };
}

const surface = makeSurface();
export const q = surface;

/*
 * One connection serves every request, so unlike the Postgres pool a
 * transaction cannot be isolated onto a client of its own: an await between
 * BEGIN and COMMIT would let another request's statements land inside this
 * transaction and be rolled back with it. Transactions are therefore taken one
 * at a time. The callback is handed the same surface, which is safe because no
 * route reaches for the shared `q` while inside a transaction.
 */
let writeQueue = Promise.resolve();

export function transaction(fn) {
  const run = async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(surface);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already unwound */
      }
      throw err;
    }
  };

  // Chain onto the queue, and keep the queue alive when this one rejects.
  const result = writeQueue.then(run, run);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

/* ---------------------------------------------------------------- schema */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','manager','staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (shop_utc_now())
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (shop_utc_now())
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  contact_person TEXT    NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL DEFAULT '',
  email          TEXT    NOT NULL DEFAULT '',
  address        TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (shop_utc_now())
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
  created_at    TEXT    NOT NULL DEFAULT (shop_utc_now()),
  updated_at    TEXT    NOT NULL DEFAULT (shop_utc_now())
);

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
  created_at TEXT    NOT NULL DEFAULT (shop_utc_now())
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
  created_at     TEXT    NOT NULL DEFAULT (shop_utc_now())
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

// Postgres does this with a plpgsql trigger function; SQLite states it inline.
const TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS trg_products_updated
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
  UPDATE products SET updated_at = shop_utc_now() WHERE id = OLD.id;
END;
`;

const DEFAULT_SETTINGS = {
  shop_name: 'জনতা ইলেকট্রিক এন্ড ইলেকট্রনিক্স',
  shop_proprietor: 'মোঃ মাইনুল হাসান (রিপন)',
  shop_proprietor_title: 'প্রোপ্রাইটর',
  shop_phone: '০১৭১৯-২০৯৭৯৩ • ০১৬৬০-১৮৭৮০৭',
  shop_address: 'জালালপুর বাজার, গয়েশপুর রোড, পাবনা সদর, পাবনা',
  currency_symbol: '৳',
  number_locale: 'en-IN',
  tax_percent: '0',
  low_stock_only_active: '1',
};

export async function applyDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
}

let readyPromise = null;

export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      db.exec(SCHEMA);
      db.exec(TRIGGERS);
      await applyDefaultSettings();
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export async function getSettings() {
  const rows = db.all('SELECT key, value FROM settings', []);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(key, value) {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)]
  );
}

/** Wipes every table and restarts ids, for `npm run reset`. */
export async function resetAllTables() {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of ['sale_items', 'sales', 'stock_movements', 'products',
                   'categories', 'suppliers', 'users', 'settings']) {
    db.exec(`DELETE FROM ${t}`);
  }
  // AUTOINCREMENT keeps its high-water mark here, so ids restart at 1.
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('sale_items','sales','stock_movements','products','categories','suppliers','users')");
  db.exec('PRAGMA foreign_keys = ON');
}

/** Mirrors the pg Pool's shutdown hook so callers can close either database. */
export const pool = {
  end: async () => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  },
};
