import 'dotenv/config';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { applyDefaultSettings, pool, q, ready, transaction } from './db.js';
import { hashPassword } from './auth.js';

const DEMO_CATEGORIES = [
  ['পানীয়', 'কোমল পানীয়, পানি, জুস ও চা'],
  ['স্ন্যাকস', 'চিপস, বিস্কুট ও মিষ্টান্ন'],
  ['স্টেশনারি', 'কলম, কাগজ ও অফিস সামগ্রী'],
  ['গৃহস্থালি', 'পরিষ্কারক ও দৈনন্দিন ঘরোয়া জিনিস'],
  ['ইলেকট্রনিকস', 'তার, ব্যাটারি ও ছোট যন্ত্রাংশ'],
];

const DEMO_SUPPLIERS = [
  ['মেট্রো হোলসেল', 'রিনা আহমেদ', '01711-000111', 'orders@metrowholesale.example', '১২ মার্কেট রোড'],
  ['সিটিলাইন ডিস্ট্রিবিউটরস', 'কামাল হোসেন', '01822-000222', 'sales@cityline.example', '৫ ইন্ডাস্ট্রিয়াল এভিনিউ'],
  ['ব্রাইট সাপ্লাইজ কোং', 'নাদিয়া ইসলাম', '01933-000333', 'hello@brightsupplies.example', '৭৭ ট্রেড সেন্টার'],
];

// sku, name, category index, supplier index, cost, sell, qty, reorder level, unit
// Prices are in Taka, at typical Bangladeshi retail levels.
const DEMO_PRODUCTS = [
  ['BEV-001', 'মিনারেল ওয়াটার ৫০০ মিলি',     0, 0,  12,  20, 240,  60, 'পিস'],
  ['BEV-002', 'কোলা ক্যান ৩৩০ মিলি',          0, 0,  38,  55, 180,  48, 'পিস'],
  ['BEV-003', 'কমলার জুস ১ লিটার',            0, 1, 150, 220,  36,  24, 'পিস'],
  ['BEV-004', 'গ্রিন টি বক্স (২৫ ব্যাগ)',       0, 1, 180, 260,  14,  20, 'বক্স'],
  ['SNK-001', 'পটেটো চিপস ১০০ গ্রাম',         1, 0,  75, 110, 120,  40, 'পিস'],
  ['SNK-002', 'চকলেট বার ৪৫ গ্রাম',           1, 2,  45,  70,  95,  50, 'পিস'],
  ['SNK-003', 'সল্টেড বিস্কুট ২০০ গ্রাম',       1, 2,  55,  85,   8,  25, 'প্যাক'],
  ['STA-001', 'বলপয়েন্ট কলম (নীল)',          2, 2,   8,  15, 500, 100, 'পিস'],
  ['STA-002', 'এ৪ খাতা ১০০ পাতা',            2, 2,  60, 100,  64,  30, 'পিস'],
  ['STA-003', 'স্টিকি নোট ৩x৩',              2, 1,  45,  80,   0,  20, 'প্যাড'],
  ['HHD-001', 'ডিশ সোপ ৫০০ মিলি',            3, 1,  95, 145,  42,  20, 'বোতল'],
  ['HHD-002', 'কাপড় ধোয়ার ডিটারজেন্ট ১ কেজি', 3, 1, 210, 320,  18,  15, 'প্যাক'],
  ['HHD-003', 'পেপার টাওয়েল ২ রোল',          3, 0, 110, 170,   6,  18, 'প্যাক'],
  ['ELC-001', 'এএ ব্যাটারি (৪টির প্যাক)',      4, 2, 130, 200,  55,  24, 'প্যাক'],
  ['ELC-002', 'ইউএসবি-সি কেবল ১ মিটার',      4, 2, 180, 350,  27,  15, 'পিস'],
  ['ELC-003', 'ফোন চার্জার ২০ওয়াট',          4, 2, 450, 850,   9,  10, 'পিস'],
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
      throw new Error('ADMIN_PASSWORD কমপক্ষে ৮ অক্ষরের হতে হবে');
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
        'admin', hashPassword(admin.password), 'দোকান মালিক'
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
           VALUES (?, 'in', ?, 0, ?, ?, 'OPENING', 'প্রারম্ভিক স্টক', ?)`,
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
    console.log('সব তথ্য মুছে ফেলা হচ্ছে…');
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
    console.log(`প্রাথমিক তথ্য যোগ হয়েছে। "${seeded.username}" হিসেবে এই পাসওয়ার্ড দিয়ে সাইন ইন করুন: ${seeded.password}`);
    if (seeded.source === 'generated') console.log('পাসওয়ার্ডটি এখনই সংরক্ষণ করুন — এটি কোথাও সাধারণ লেখায় রাখা হয় না।');
  } else {
    console.log('ডেটাবেসে আগে থেকেই ব্যবহারকারী আছে — কিছু করার নেই।');
  }
  await pool.end();
}
