/*
 * Picks the database the shop runs on, and re-exports one surface for it.
 *
 *   DATABASE_URL=postgres://…   -> Postgres  (the hosted deployment)
 *   anything else, or unset     -> SQLite    (a shop running on one computer)
 *
 * Routes import from here and never learn which one answered. The choice is
 * made from the environment alone so the same source tree ships to both.
 */
const url = (process.env.DATABASE_URL || '').trim();
const usePostgres = /^postgres(ql)?:\/\//i.test(url);

const driver = usePostgres
  ? await import('./db-postgres.js')
  : await import('./db-sqlite.js');

export const kind = usePostgres ? 'postgres' : 'sqlite';

export const q = driver.q;
export const transaction = driver.transaction;
export const ready = driver.ready;
export const getSettings = driver.getSettings;
export const setSetting = driver.setSetting;
export const applyDefaultSettings = driver.applyDefaultSettings;
export const pool = driver.pool;
export const dbTarget = driver.dbTarget;

/*
 * Postgres can TRUNCATE every table in one statement; SQLite has to delete them
 * one at a time and reset its own id counters. `npm run reset` asks for the
 * outcome and lets whichever driver answered decide how to get there.
 */
export const resetAllTables =
  driver.resetAllTables ??
  (async () => {
    await driver.q.exec(`TRUNCATE TABLE
      sale_items, sales, stock_movements, products, categories, suppliers, users, settings
      RESTART IDENTITY CASCADE`);
  });
