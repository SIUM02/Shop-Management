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
import { db, dbPath, getSettings, setSetting, transaction } from './db.js';

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

export function convertCurrency({ rate, symbol, locale, apply }) {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Pass a positive exchange rate, e.g. --rate 122.5');
  }

  const before = getSettings();
  const counts = {};
  const samples = db
    .prepare('SELECT sku, name, cost_price, sell_price FROM products ORDER BY id LIMIT 5')
    .all();

  for (const table of Object.keys(MONEY_COLUMNS)) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }

  console.log(`\nDatabase: ${dbPath}`);
  console.log(`Rate:     1 old unit = ${rate} new units`);
  console.log(`Symbol:   ${before.currency_symbol} → ${symbol}`);
  console.log(`Format:   ${before.number_locale || 'en-IN'} → ${locale}\n`);

  console.log('Rows to update:');
  for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
    console.log(`  ${table.padEnd(17)} ${String(counts[table]).padStart(6)} rows  (${cols.join(', ')})`);
  }

  if (samples.length) {
    console.log('\nSample products:');
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
    console.log('\nPreview only — nothing was written. Re-run with --apply to convert.\n');
    return { applied: false };
  }

  transaction(() => {
    for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
      const sets = cols.map((c) => `${c} = ROUND(${c} * ?, 2)`).join(', ');
      db.prepare(`UPDATE ${table} SET ${sets}`).run(...cols.map(() => rate));
    }
    setSetting('currency_symbol', symbol);
    setSetting('number_locale', locale);
  });

  console.log('\nConverted. Reload the app to see the new prices.\n');
  return { applied: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  try {
    convertCurrency(args);
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
