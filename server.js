/*
 * Local / long-running entry point: `npm start`.
 * On Vercel the app is served by api/index.js instead, which imports the same
 * Express app without ever calling listen().
 */
import app, { boot } from './src/app.js';
import { dbTarget, pool } from './src/db.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const created = await boot();

app.listen(PORT, HOST, () => {
  console.log(`\n  ${created ? '✨ ' : ''}Shop Inventory is running`);
  console.log(`  →  http://localhost:${PORT}`);
  console.log(`  DB:  ${dbTarget}`);
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

const shutdown = async () => {
  try { await pool.end(); } catch { /* already closed */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
