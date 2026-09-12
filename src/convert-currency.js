/**
 * Re-price an existing database into another currency.
 *
 *   npm run convert-currency -- --rate 122.5              # preview only
 *   npm run convert-currency -- --rate 122.5 --apply      # actually write
 *
 * Multiplies every stored money value by --rate and updates the currency
 * symbol. Historical invoices are converted too, so past sales stay
 * comparable with new ones in your reports.
 *
 * Nothing is written unless you pass --apply.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { q, dbTarget, getSettings, pool, ready, transaction } from './db.js';

// table -> money columns to scale
const MONEY_COLUMNS = {
  products: ['cost_price', 'sell_price'],
  sales: ['subtotal', 'discount', 'tax', 'total', 'cost_total'],
  sale_items: ['unit_price', 'unit_cost', 'line_total'],
  stock_movements: ['unit_cost'],
};

function parseArgs(argv) {
  const args = { apply: false, symbol: '৳', locale: 'en-IN', rate: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--rate') args.rate = Number(argv[++i]);
    else if (a === '--symbol') args.symbol = argv[++i];
    else if (a === '--locale') args.locale = argv[++i];
  }
  return args;
}

export async function convertCurrency({ rate, symbol, locale, apply }) {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('একটি ধনাত্মক বিনিময় হার দিন, যেমন --rate 122.5');
  }

  const before = await getSettings();
  const counts = {};
  const samples = await q.all('SELECT sku, name, cost_price, sell_price FROM products ORDER BY id LIMIT 5');

  for (const table of Object.keys(MONEY_COLUMNS)) {
    counts[table] = (await q.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
  }

  console.log(`\nডেটাবেস:  ${dbTarget}`);
  console.log(`হার:      ১ পুরনো একক = ${rate} নতুন একক`);
  console.log(`চিহ্ন:     ${before.currency_symbol} → ${symbol}`);
  console.log(`বিন্যাস:   ${before.number_locale || 'en-IN'} → ${locale}\n`);

  console.log('যেসব সারি বদলাবে:');
  for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
    console.log(`  ${table.padEnd(17)} ${String(counts[table]).padStart(6)} সারি  (${cols.join(', ')})`);
  }

  if (samples.length) {
    console.log('\nনমুনা পণ্য:');
    for (const p of samples) {
      const c = (p.cost_price * rate).toFixed(2);
      const s = (p.sell_price * rate).toFixed(2);
      console.log(
        `  ${p.sku.padEnd(9)} ${p.name.slice(0, 26).padEnd(28)}` +
          `cost ${before.currency_symbol}${p.cost_price} → ${symbol}${c}   ` +
          `sell ${before.currency_symbol}${p.sell_price} → ${symbol}${s}`
      );
    }
  }

  if (!apply) {
    console.log('\nশুধু প্রিভিউ — কিছুই লেখা হয়নি। রূপান্তর করতে --apply দিয়ে আবার চালান।\n');
    return { applied: false };
  }

  await transaction(async (tx) => {
    for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
      // Postgres only rounds to a scale on numeric, so the double is cast
      // through numeric and back rather than using ROUND(double, int).
      const sets = cols.map((c) => `${c} = ROUND((${c} * ?)::numeric, 2)::double precision`).join(', ');
      await tx.run(`UPDATE ${table} SET ${sets}`, ...cols.map(() => rate));
    }
    for (const [key, value] of [['currency_symbol', symbol], ['number_locale', locale]]) {
      await tx.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        key, String(value)
      );
    }
  });

  console.log('\nরূপান্তর সম্পন্ন। নতুন দাম দেখতে অ্যাপটি আবার লোড করুন।\n');
  return { applied: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  try {
    await ready();
    await convertCurrency(args);
  } catch (err) {
    console.error(`\nত্রুটি: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
