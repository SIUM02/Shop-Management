import pg from 'pg';

const { Pool, types } = pg;

/*
 * Postgres returns some numeric types as strings to avoid precision loss.
 * COUNT(*) and SUM(integer) come back as int8, so without these parsers every
 * total on the dashboard would be a string and "12" + 1 would render "121".
 * Every value we store fits comfortably in a JS number.
 */
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

/*
 * DATE columns are handed back as plain 'YYYY-MM-DD' strings instead of JS
 * Dates. The report endpoints group by day and the front end uses those keys
 * as chart labels; a Date would serialise to a UTC instant and shift the label
 * across a day boundary.
 */
types.setTypeParser(1082, (v) => v);

const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres database.'
  );
}

/**
 * Hosted Postgres (Supabase, Neon, …) requires TLS; a local server usually
 * refuses it outright. DATABASE_SSL=on/off overrides the guess.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);
const sslOverride = (process.env.DATABASE_SSL || '').toLowerCase();
const useSsl = sslOverride
  ? ['1', 'on', 'true', 'require'].includes(sslOverride)
  : !LOCAL_HOSTS.has((() => {
      try { return new URL(connectionString).hostname; } catch { return ''; }
    })());

export const pool = new Pool({
  connectionString,
  // Serverless functions each hold their own pool, so keep it small. The
  // pooled Supabase endpoint is what makes many small pools workable.
  max: Number(process.env.PG_POOL_MAX || 3),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

// A pool error (server restart, idle connection reaped) must not take the
// process down — the next query simply opens a fresh connection.
pool.on('error', (err) => console.error('[pg pool]', err.message));

/** Redacted connection target, safe to print in a boot log. */
export const dbTarget = (() => {
  try {
    const u = new URL(connectionString);
    return `${u.host}${u.pathname}`;
  } catch {
    return 'postgres';
  }
})();

/**
 * Rewrite SQLite's `?` placeholders into Postgres' `$1, $2, …`.
 *
 * Quoted literals are skipped so a `?` inside a string is left alone. Keeping
 * this translation here means the queries throughout the app stay readable and
 * unchanged rather than being renumbered by hand.
 */
export function toPgPlaceholders(sql) {
  let out = '';
  let n = 0;
  let quote = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) { out += sql[++i]; }  // escaped '' or ""
        else quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === '?') { out += `$${++n}`; continue; }
    out += ch;
  }
  return out;
}

/**
 * Query surface shared by the pool and by a transaction's client, so the same
 * calls work inside and outside a transaction.
 */
function surface(runner) {
  const exec = async (sql, params) => runner.query(toPgPlaceholders(sql), params);

  return {
    /** Every matching row. */
    async all(sql, ...params) {
      return (await exec(sql, params)).rows;
    },

    /** First matching row, or undefined. */
    async get(sql, ...params) {
      return (await exec(sql, params)).rows[0];
    },

    /** Statement with no rows to read back; reports how many rows changed. */
    async run(sql, ...params) {
      const res = await exec(sql, params);
      return { changes: res.rowCount };
    },

    /**
     * INSERT that reports the new row's id. Appends RETURNING id unless the
     * caller already asked for something back.
     */
    async insert(sql, ...params) {
      const sqlWithId = /returning\s/i.test(sql) ? sql : `${sql} RETURNING id`;
      const res = await exec(sqlWithId, params);
      return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount };
    },

    /** Multi-statement DDL. No placeholders. */
    async exec(sql) {
      await runner.query(sql);
    },
  };
}

/** The default, pool-backed query surface. */
export const q = surface(pool);

/**
 * Run `fn` against a single connection wrapped in BEGIN/COMMIT, rolling back
 * and re-throwing if it fails. The callback receives its own query surface —
 * using the pool inside a transaction would run on a different connection and
 * silently escape it.
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(surface(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the transaction was already unwound */
    }
    throw err;
  } finally {
    client.release();
  }
}

/*
 * Timestamps stay TEXT in 'YYYY-MM-DD HH:MM:SS' UTC, exactly as SQLite wrote
 * them, so stored data and the JSON the front end already parses are unchanged.
 *
 * The shop's day, though, is a local one. SQLite used date('now','localtime'),
 * which followed the machine's clock; on a hosting platform that clock is UTC,
 * so "today's sales" would have rolled over mid-morning in Dhaka. Naming the
 * zone explicitly fixes that.
 */
const TZ = process.env.SHOP_TZ || 'Asia/Dhaka';

// The zone name is baked into a function body rather than passed as a query
// parameter, so it is validated as an IANA-shaped name before it gets there.
if (!/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+){0,2}$/.test(TZ)) {
  throw new Error(`SHOP_TZ is not a valid timezone name: ${TZ}`);
}

const TIME_HELPERS = `
-- Current UTC instant in the app's stored text format.
CREATE OR REPLACE FUNCTION shop_utc_now() RETURNS text AS $fn$
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
$fn$ LANGUAGE sql STABLE;

-- The shop-local calendar date of a stored UTC timestamp.
CREATE OR REPLACE FUNCTION shop_date(ts text) RETURNS date AS $fn$
  SELECT ((ts::timestamp AT TIME ZONE 'UTC') AT TIME ZONE %L)::date
$fn$ LANGUAGE sql STABLE;

-- Today, in the shop's timezone.
CREATE OR REPLACE FUNCTION shop_today() RETURNS date AS $fn$
  SELECT ((now() AT TIME ZONE 'UTC') AT TIME ZONE %L)::date
$fn$ LANGUAGE sql STABLE;
`;

/*
 * citext gives the case-insensitive uniqueness and comparison that SQLite's
 * COLLATE NOCASE provided, so "Rice" and "rice" still collide as one SKU.
 */
const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  username      CITEXT  NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','manager','staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT shop_utc_now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name        CITEXT  NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT shop_utc_now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name           CITEXT  NOT NULL UNIQUE,
  contact_person TEXT    NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL DEFAULT '',
  email          TEXT    NOT NULL DEFAULT '',
  address        TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT shop_utc_now()
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sku           CITEXT  NOT NULL UNIQUE,
  barcode       TEXT    DEFAULT NULL,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_price    DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sell_price    DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  quantity      INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit          TEXT    NOT NULL DEFAULT 'pcs',
  location      TEXT    NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT shop_utc_now(),
  updated_at    TEXT    NOT NULL DEFAULT shop_utc_now()
);

-- Full audit trail. Every change to products.quantity writes a row here.
CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('in','out','adjust','sale','return')),
  quantity   INTEGER NOT NULL,
  before_qty INTEGER NOT NULL,
  after_qty  INTEGER NOT NULL,
  unit_cost  DOUBLE PRECISION NOT NULL DEFAULT 0,
  reference  TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT shop_utc_now()
);

CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  invoice_no     TEXT    NOT NULL UNIQUE,
  customer_name  TEXT    NOT NULL DEFAULT '',
  customer_phone TEXT    NOT NULL DEFAULT '',
  subtotal       DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount       DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax            DOUBLE PRECISION NOT NULL DEFAULT 0,
  total          DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_total     DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_method TEXT    NOT NULL DEFAULT 'cash',
  note           TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT shop_utc_now()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id           INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT    NOT NULL,
  sku          TEXT    NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   DOUBLE PRECISION NOT NULL,
  unit_cost    DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_total   DOUBLE PRECISION NOT NULL
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

// Keep products.updated_at honest without every query having to remember it.
// Postgres does this in a BEFORE trigger, so unlike the SQLite version it
// does not re-enter the table with a second UPDATE.
const TRIGGERS = `
CREATE OR REPLACE FUNCTION trg_products_touch() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := shop_utc_now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION trg_products_touch();
`;

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
export async function applyDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await q.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
      key,
      value
    );
  }
}

/**
 * Creates the schema if it is missing and tops up default settings.
 * Safe to run on every boot, and safe to run concurrently — two serverless
 * instances racing here both end up with the same result.
 */
let readyPromise = null;
export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      // The time helpers define shop_utc_now(), which the schema below uses as
      // a column default, so they have to be created first.
      await q.exec(TIME_HELPERS.replaceAll('%L', `'${TZ}'`));
      await q.exec(SCHEMA);
      await q.exec(TRIGGERS);
      await applyDefaultSettings();
    })().catch((err) => {
      readyPromise = null; // let a later request retry rather than wedging
      throw err;
    });
  }
  return readyPromise;
}

export async function getSettings() {
  const rows = await q.all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(key, value) {
  await q.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    String(value)
  );
}
