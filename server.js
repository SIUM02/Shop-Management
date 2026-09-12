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
  console.log(`\n  ${created ? '✨ ' : ''}দোকান ইনভেন্টরি চালু আছে`);
  console.log(`  →  http://localhost:${PORT}`);
  console.log(`  ডেটাবেস:  ${dbTarget}`);
  if (created) {
    console.log('\n  প্রথমবার চালু — এই তথ্য দিয়ে সাইন ইন করুন:');
    console.log(`     ইউজারনেম: ${created.username}`);
    console.log(`     পাসওয়ার্ড: ${created.password}`);
    if (created.source === 'generated') {
      console.log('\n  এই পাসওয়ার্ডটি তৈরি করা হয়েছে এবং একবারই দেখানো হবে। এখনই সংরক্ষণ করুন।');
    } else {
      console.log('\n  ভেতরে ঢুকে সেটিংস থেকে এই পাসওয়ার্ডটি বদলে নিন।');
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
