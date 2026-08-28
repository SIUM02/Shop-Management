import 'dotenv/config';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { applyDefaultSettings, pool, q, ready, transaction } from './db.js';
import { hashPassword } from './auth.js';

const DEMO_CATEGORIES = [
  ['Beverages', 'Soft drinks, water, juice and tea'],
  ['Snacks', 'Chips, biscuits and confectionery'],
  ['Stationery', 'Pens, paper and office supplies'],
  ['Household', 'Cleaning and everyday home items'],
  ['Electronics', 'Cables, batteries and small accessories'],
];

const DEMO_SUPPLIERS = [
  ['Metro Wholesale', 'Rina Ahmed', '01711-000111', 'orders@metrowholesale.example', '12 Market Road'],
  ['CityLine Distributors', 'Kamal Hossain', '01822-000222', 'sales@cityline.example', '5 Industrial Ave'],
  ['Bright Supplies Co.', 'Nadia Islam', '01933-000333', 'hello@brightsupplies.example', '77 Trade Center'],
];

// sku, name, category index, supplier index, cost, sell, qty, reorder level, unit
// Prices are in Taka, at typical Bangladeshi retail levels.
const DEMO_PRODUCTS = [
  ['BEV-001', 'Mineral Water 500ml',      0, 0,  12,  20, 240,  60, 'pcs'],
  ['BEV-002', 'Cola Can 330ml',           0, 0,  38,  55, 180,  48, 'pcs'],
  ['BEV-003', 'Orange Juice 1L',          0, 1, 150, 220,  36,  24, 'pcs'],
  ['BEV-004', 'Green Tea Box (25 bags)',  0, 1, 180, 260,  14,  20, 'box'],
  ['SNK-001', 'Potato Chips 100g',        1, 0,  75, 110, 120,  40, 'pcs'],
  ['SNK-002', 'Chocolate Bar 45g',        1, 2,  45,  70,  95,  50, 'pcs'],
  ['SNK-003', 'Salted Biscuits 200g',     1, 2,  55,  85,   8,  25, 'pack'],
  ['STA-001', 'Ballpoint Pen (Blue)',     2, 2,   8,  15, 500, 100, 'pcs'],
  ['STA-002', 'A4 Notebook 100 pages',    2, 2,  60, 100,  64,  30, 'pcs'],
  ['STA-003', 'Sticky Notes 3x3',         2, 1,  45,  80,   0,  20, 'pad'],
  ['HHD-001', 'Dish Soap 500ml',          3, 1,  95, 145,  42,  20, 'bottle'],
  ['HHD-002', 'Laundry Detergent 1kg',    3, 1, 210, 320,  18,  15, 'pack'],
  ['HHD-003', 'Paper Towels 2-roll',      3, 0, 110, 170,   6,  18, 'pack'],
  ['ELC-001', 'AA Batteries (4-pack)',    4, 2, 130, 200,  55,  24, 'pack'],
  ['ELC-002', 'USB-C Cable 1m',           4, 2, 180, 350,  27,  15, 'pcs'],
  ['ELC-003', 'Phone Charger 20W',        4, 2, 450, 850,   9,  10, 'pcs'],
];

/**
 * Picks the first admin password.
 *
 *   ADMIN_PASSWORD set  -> use it
 *   production          -> generate a strong random one (never a known default)
 *   otherwise           -> 'admin123', for local convenience only
 */
function initialAdminPassword() {
  const fromEnv = (process.env.ADMIN_PASSWORD || '').trim();
  if (fromEnv) {
    if (fromEnv.length < 8) {
      throw new Error('ADMIN_PASSWORD must be at least 8 characters');
    }
    return { password: fromEnv, source: 'env' };
  }
  if (process.env.NODE_ENV === 'production') {
    // base64url of 18 bytes -> 24 URL-safe characters
    return { password: crypto.randomBytes(18).toString('base64url'), source: 'generated' };
  }
  return { password: 'admin123', source: 'default' };
}

/**
 * Creates the first admin on an empty database, plus demo data unless
 * SKIP_DEMO_DATA=1. Returns false if nothing was needed, otherwise
 * { username, password, source } describing the account just created.
 */
export async function ensureSeed() {
  /*
   * The common case is a database that already has users, and on a serverless
   * host that case is hit on every cold start. Check it with one plain query
   * before paying for a connection, a transaction and a lock; the authoritative
   * re-check still happens inside the transaction below, so the race this
   * guards against is still handled.
   */
  const existing = await q.get('SELECT COUNT(*) AS n FROM users');
  if (existing.n > 0) return false;

  const admin = initialAdminPassword();

  return transaction(async (tx) => {
    /*
     * Several instances can boot at once on a serverless host and all find an
     * empty users table. This advisory lock is held until the transaction ends,
     * so the losers wait and then see the admin the winner just created,
     * instead of racing into a duplicate-key error.
     */
    await tx.run('SELECT pg_advisory_xact_lock(?)', 918_273_645);

    const userCount = (await tx.get('SELECT COUNT(*) AS n FROM users')).n;
    if (userCount > 0) return false;

    const adminId = Number(
      (await tx.insert(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')",
        'admin', hashPassword(admin.password), 'Shop Owner'
      )).lastInsertRowid
    );

    if (process.env.SKIP_DEMO_DATA === '1') return { username: 'admin', ...admin };

    const catIds = [];
    for (const [name, description] of DEMO_CATEGORIES) {
      const row = await tx.insert(
        'INSERT INTO categories (name, description) VALUES (?, ?)', name, description
      );
      catIds.push(Number(row.lastInsertRowid));
    }

    const supIds = [];
    for (const [name, person, phone, email, address] of DEMO_SUPPLIERS) {
      const row = await tx.insert(
        'INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)',
        name, person, phone, email, address
      );
      supIds.push(Number(row.lastInsertRowid));
    }

    for (const [sku, name, ci, si, cost, sell, qty, reorder, unit] of DEMO_PRODUCTS) {
      const barcode = '20' + String(Math.abs(hashCode(sku))).padStart(11, '0').slice(0, 11);
      const { lastInsertRowid } = await tx.insert(
        `INSERT INTO products
           (sku, name, category_id, supplier_id, cost_price, sell_price,
            quantity, reorder_level, unit, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sku, name, catIds[ci], supIds[si], cost, sell, qty, reorder, unit, barcode
      );
      const id = Number(lastInsertRowid);
      if (qty > 0) {
        await tx.run(
          `INSERT INTO stock_movements
             (product_id, type, quantity, before_qty, after_qty, unit_cost, reference, note, user_id)
           VALUES (?, 'in', ?, 0, ?, ?, 'OPENING', 'Opening stock', ?)`,
          id, qty, qty, cost, adminId
        );
      }
    }

    return { username: 'admin', ...admin };
  });
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// `npm run seed` / `npm run reset` run this file directly. Compare through
// pathToFileURL so paths containing spaces still match import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ready();

  if (process.argv.includes('--reset')) {
    console.log('Clearing all data…');
    // TRUNCATE ... RESTART IDENTITY replaces both the DELETEs and the
    // sqlite_sequence reset; CASCADE handles the foreign keys, so the
    // PRAGMA dance around them is not needed.
    await q.exec(`TRUNCATE TABLE
      sale_items, sales, stock_movements, products, categories, suppliers, users, settings
      RESTART IDENTITY CASCADE`);
    // settings were cleared too, so put the shipped defaults back.
    await applyDefaultSettings();
  }

  const seeded = await ensureSeed();
  if (seeded) {
    console.log(`Seeded. Sign in as "${seeded.username}" with password: ${seeded.password}`);
    if (seeded.source === 'generated') console.log('Save that password now — it is not stored anywhere in plain text.');
  } else {
    console.log('Database already has users — nothing to do.');
  }
  await pool.end();
}
