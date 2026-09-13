/*
 * Clears the shop's records from the CLOUD (Supabase) database.
 *
 * Deletes every product, category, supplier, sale, sale line and stock
 * movement, and restarts the id counters so the first new product is #1.
 *
 * User accounts and settings are deliberately KEPT. Deleting the users would
 * leave nobody able to sign in: the app recreates an admin on an empty users
 * table, but in production it invents a random password and prints it only to
 * the server log, which on Vercel you would likely never see.
 *
 * There is no undo. Take a backup first — backups/ already holds one made
 * before this script was written.
 *
 *   node wipe-cloud-data.mjs                          # dry run, shows counts
 *   node wipe-cloud-data.mjs --yes-delete-everything  # actually deletes
 */
import fs from 'node:fs';
import path from 'node:path';

// Read the cloud URL from the saved backup of .env, so this cannot go off
// against whatever .env happens to point at today.
const envFile = fs.existsSync('.env.cloud.backup') ? '.env.cloud.backup' : '.env';
const line = fs.readFileSync(envFile, 'utf8')
  .split('\n').find((l) => l.startsWith('DATABASE_URL='));

if (!line) {
  console.error(`DATABASE_URL not found in ${envFile}`);
  process.exit(1);
}
process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim();

const { q, transaction, pool } = await import('./src/db-postgres.js');

const host = process.env.DATABASE_URL.replace(/\/\/[^@]*@/, '//***@').slice(0, 72);
console.log(`\nTarget: ${host}…\n`);

const before = await q.get(`SELECT
  (SELECT count(*) FROM products) p, (SELECT count(*) FROM sales) s,
  (SELECT count(*) FROM sale_items) si, (SELECT count(*) FROM stock_movements) m,
  (SELECT count(*) FROM categories) c, (SELECT count(*) FROM suppliers) sup,
  (SELECT count(*) FROM users) u`);

console.log('Currently holds:');
console.log(`  products ${before.p} | categories ${before.c} | suppliers ${before.sup}`);
console.log(`  sales ${before.s} | sale lines ${before.si} | stock movements ${before.m}`);
console.log(`  users ${before.u}  (these are kept)\n`);

if (!process.argv.includes('--yes-delete-everything')) {
  const backups = fs.existsSync('backups')
    ? fs.readdirSync('backups').filter((f) => f.endsWith('.json'))
    : [];
  console.log('DRY RUN — nothing was deleted.');
  console.log(backups.length
    ? `Backup on disk: backups/${backups.sort().at(-1)}`
    : 'WARNING: no backup found in backups/ — make one before deleting.');
  console.log('\nTo delete for real:\n  node wipe-cloud-data.mjs --yes-delete-everything\n');
  await pool.end();
  process.exit(0);
}

// Children before parents, so a foreign key never blocks a delete.
const ORDER = ['sale_items', 'sales', 'stock_movements', 'products', 'categories', 'suppliers'];

await transaction(async (tx) => {
  for (const t of ORDER) {
    const { changes } = await tx.run(`DELETE FROM ${t}`);
    console.log(`  cleared ${t.padEnd(16)} ${String(changes).padStart(4)} rows`);
    await tx.run(`SELECT setval(pg_get_serial_sequence('${t}','id'), 1, false)`);
  }
});

const after = await q.get(`SELECT
  (SELECT count(*) FROM products) p, (SELECT count(*) FROM sales) s,
  (SELECT count(*) FROM stock_movements) m, (SELECT count(*) FROM users) u`);
const name = await q.get("SELECT value FROM settings WHERE key='shop_name'");

console.log('\nDone. Now holds:');
console.log(`  products ${after.p} | sales ${after.s} | movements ${after.m}`);
console.log(`  users ${after.u} (kept) | shop_name = ${name.value}\n`);

await pool.end();
