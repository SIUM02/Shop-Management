import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pool, q, ready, transaction } from './db.js';

/*
 * Adds a batch of realistic demo products to the catalogue: `npm run add-products`.
 *
 * Names are assembled from per-category pools at typical Bangladeshi retail
 * prices, SKUs continue each category's existing prefix from 100 upward so
 * they can never collide with the seed data, and every opening quantity is
 * written through stock_movements so the audit trail still reconciles with
 * products.quantity — the same invariant the seed keeps.
 *
 * Safe to re-run: numbering continues after the highest SKU already present.
 */

const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 100);

// category name -> SKU prefix, name fragments, price band (cost min/max, margin)
const POOLS = {
  'পানীয়': {
    prefix: 'BEV',
    items: ['আমের জুস', 'লেবু সোডা', 'আইস টি', 'ব্ল্যাক কফি', 'দুধ চা',
            'এনার্জি ড্রিংক', 'ডাবের পানি', 'লাচ্ছি', 'আপেলের জুস', 'আদা চা'],
    variants: ['২৫০ মিলি', '৩৩০ মিলি', '৫০০ মিলি', '১ লিটার', '৬টির প্যাক'],
    unit: 'পিস', cost: [10, 220], markup: [1.3, 1.7],
  },
  'স্ন্যাকস': {
    prefix: 'SNK',
    items: ['কলার চিপস', 'বাদামের বার', 'রাইস ক্র্যাকার', 'চানাচুর', 'কুকিজ',
            'ওয়েফার রোল', 'কেকের স্লাইস', 'ইনস্ট্যান্ট নুডলস', 'পপকর্ন', 'টোস্ট বিস্কুট'],
    variants: ['৫০ গ্রাম', '১০০ গ্রাম', '১৫০ গ্রাম', '২৫০ গ্রাম', 'ফ্যামিলি প্যাক'],
    unit: 'প্যাক', cost: [15, 180], markup: [1.35, 1.8],
  },
  'স্টেশনারি': {
    prefix: 'STA',
    items: ['জেল কলম', 'পেন্সিল', 'রাবার', 'স্কেল ৩০ সেমি', 'মার্কার', 'হাইলাইটার',
            'স্ট্যাপলার', 'ফাইল ফোল্ডার', 'খামের প্যাক', 'ড্রয়িং খাতা'],
    variants: ['একটি', '২টির প্যাক', '৫টির প্যাক', '১২টির বক্স', 'জাম্বো'],
    unit: 'পিস', cost: [5, 260], markup: [1.4, 2.0],
  },
  'গৃহস্থালি': {
    prefix: 'HHD',
    items: ['হ্যান্ড সোপ', 'টয়লেট ক্লিনার', 'এয়ার ফ্রেশনার', 'মশার কয়েল', 'দেশলাই',
            'স্ক্রাব স্পঞ্জ', 'ফ্লোর ক্লিনার', 'ব্লিচ', 'ময়লার ব্যাগ', 'মোমবাতি'],
    variants: ['ছোট', 'মাঝারি', 'বড়', 'রিফিল', 'জোড়া প্যাক'],
    unit: 'পিস', cost: [12, 320], markup: [1.3, 1.75],
  },
  'ইলেকট্রনিকস': {
    prefix: 'ELC',
    items: ['এএএ ব্যাটারি', 'এলইডি বাল্ব', 'এক্সটেনশন কর্ড', 'ইয়ারফোন', 'মেমরি কার্ড',
            'ফোন কেস', 'ওয়াল অ্যাডাপ্টার', 'এইচডিএমআই কেবল', 'মাউস', 'পাওয়ার স্ট্রিপ'],
    variants: ['বেসিক', 'স্ট্যান্ডার্ড', 'প্রিমিয়াম', '২টির প্যাক', 'প্রো'],
    unit: 'পিস', cost: [40, 900], markup: [1.35, 1.9],
  },
};

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];

function barcodeFor(sku) {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (Math.imul(31, h) + sku.charCodeAt(i)) | 0;
  return '20' + String(Math.abs(h)).padStart(11, '0').slice(0, 11);
}

async function main() {
  await ready();

  const categories = await q.all('SELECT id, name FROM categories ORDER BY id');
  const suppliers = await q.all('SELECT id FROM suppliers ORDER BY id');
  const admin = await q.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (!categories.length || !suppliers.length || !admin) {
    throw new Error('আগে ডেটাবেসে প্রাথমিক তথ্য দিন — ক্যাটাগরি, সরবরাহকারী ও একজন অ্যাডমিন থাকতে হবে।');
  }

  const pools = categories.filter((c) => POOLS[c.name]);
  if (!pools.length) throw new Error('পণ্য তৈরির মতো পরিচিত কোনো ক্যাটাগরির নাম পাওয়া যায়নি।');

  // Continue numbering after whatever is already there, per prefix.
  const next = {};
  for (const { name } of pools) {
    const { prefix } = POOLS[name];
    const row = await q.get(
      "SELECT MAX(NULLIF(regexp_replace(sku::text, '^' || ? || '-', ''), '')::int) AS n FROM products WHERE sku::text LIKE ?",
      prefix, `${prefix}-%`
    );
    next[prefix] = Math.max(Number(row?.n) || 0, 99) + 1;
  }

  const created = await transaction(async (tx) => {
    const made = [];
    const usedNames = new Set(
      (await tx.all('SELECT name FROM products')).map((r) => r.name)
    );

    let guard = 0;
    while (made.length < COUNT && guard < COUNT * 30) {
      guard++;
      const cat = pick(pools);
      const pool = POOLS[cat.name];
      const name = `${pick(pool.items)} ${pick(pool.variants)}`;
      if (usedNames.has(name)) continue; // keep names unique and readable
      usedNames.add(name);

      const sku = `${pool.prefix}-${String(next[pool.prefix]++).padStart(3, '0')}`;
      // Whole taka, the way prices are actually written on Bangladeshi shelves.
      const cost = Math.round(rand(pool.cost[0], pool.cost[1]));
      const sell = Math.max(Math.round(cost * rand(pool.markup[0], pool.markup[1])), cost + 1);
      // Some shelves full, some low, a few empty — so the dashboard has texture.
      const qty = pick([0, randInt(2, 15), randInt(20, 80), randInt(100, 400)]);
      const reorder = randInt(5, 40);

      const { lastInsertRowid } = await tx.insert(
        `INSERT INTO products
           (sku, name, category_id, supplier_id, cost_price, sell_price,
            quantity, reorder_level, unit, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sku, name, cat.id, pick(suppliers).id, cost, sell, qty, reorder, pool.unit, barcodeFor(sku)
      );

      if (qty > 0) {
        await tx.run(
          `INSERT INTO stock_movements
             (product_id, type, quantity, before_qty, after_qty, unit_cost, reference, note, user_id)
           VALUES (?, 'in', ?, 0, ?, ?, 'OPENING', 'প্রারম্ভিক স্টক', ?)`,
          Number(lastInsertRowid), qty, qty, cost, admin.id
        );
      }
      made.push({ sku, name });
    }
    return made;
  });

  console.log(`${created.length}টি পণ্য যোগ করা হয়েছে।`);
  console.log(`  প্রথম: ${created[0].sku}  ${created[0].name}`);
  console.log(`  শেষ:  ${created.at(-1).sku}  ${created.at(-1).name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(`\nত্রুটি: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
