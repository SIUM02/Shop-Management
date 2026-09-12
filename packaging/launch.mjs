/*
 * Desktop launcher for the packaged shop.
 *
 * A shopkeeper double-clicks a shortcut; this is what runs. It has to do the
 * things a terminal user would otherwise do by hand — decide where the data
 * lives, invent the secrets on first run, start the server, and open a window
 * pointed at it — and it has to keep working when the app is reinstalled over
 * the top, which is why nothing that matters is stored beside the program.
 *
 * Run with the bundled Node:  node.exe launch.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * In the built bundle this file sits beside src/; in the repo it sits one
 * level down in packaging/. Look for the app rather than assuming, so the
 * launcher can be run from a checkout to test exactly what ships.
 */
const APP_ROOT = [__dirname, path.resolve(__dirname, '..')].find((dir) =>
  fs.existsSync(path.join(dir, 'src', 'app.js'))
);

if (!APP_ROOT) {
  console.error('অ্যাপের ফাইল খুঁজে পাওয়া যায়নি (src/app.js নেই)।');
  process.exit(1);
}

/*
 * The shop's data lives in the user's profile, never inside the program
 * folder: Program Files is not writable by a standard account, and an
 * installer laying down a new version would otherwise sit on top of the
 * database. Uninstalling the app leaves the shop's records untouched.
 */
function dataDir() {
  const base =
    process.env.SHOP_DATA_DIR ||
    (process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'DokanInventory');
}

const DATA_DIR = dataDir();
fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PASSWORD_NOTE = path.join(DATA_DIR, 'প্রথমবার-লগইন.txt');

/*
 * Secrets are generated per installation, never shipped. A shared JWT_SECRET
 * across every copy of the software would let a token minted on one shop's
 * machine authenticate against another's.
 */
function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return { config: JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')), created: false };
    } catch {
      // A corrupt config must not brick the till; fall through and rebuild it.
      // The database is untouched, so only the signing key is lost, which
      // costs the staff one fresh sign-in.
    }
  }

  const config = {
    jwtSecret: crypto.randomBytes(48).toString('hex'),
    adminPassword: crypto.randomBytes(6).toString('base64url'),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { config, created: true };
}

/** First free port from 3000 up, so a busy port cannot stop the shop opening. */
function findPort(start = 3000, attempts = 40) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const srv = net.createServer();
      srv.once('error', () => {
        srv.close();
        if (++port >= start + attempts) return reject(new Error('no free port'));
        tryPort();
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

/**
 * Opens the shop in its own window. Edge and Chrome both support --app, which
 * drops the address bar and tabs, so it reads as a program rather than a web
 * page. Falls back to the default browser when neither is installed.
 */
function openWindow(url) {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
         '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];

  const browser = candidates.find((p) => fs.existsSync(p));
  if (browser) {
    spawn(browser, [`--app=${url}`, `--window-size=1280,860`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

const RUNTIME_PATH = path.join(DATA_DIR, 'runtime.json');

/**
 * Is the shop already running? Clicking the shortcut twice must reopen the
 * window, not start a second server: two processes on one SQLite file is
 * needless confusion, and the staff would be looking at two tills that each
 * think they are the only one.
 *
 * The recorded port is probed rather than trusted — a previous run that was
 * killed leaves the file behind, and something else may now hold the port.
 */
async function runningInstance() {
  let recorded;
  try {
    recorded = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
  } catch {
    return null;
  }
  if (!recorded?.port) return null;

  try {
    const res = await fetch(`http://localhost:${recorded.port}/api/auth/me`, {
      signal: AbortSignal.timeout(1200),
    });
    // 401 is the healthy answer here: the server is up and asking who we are.
    // Any answer at all proves this is our server and not a stray listener.
    if (res.status === 401 || res.ok) return recorded;
  } catch {
    /* nothing listening, or not ours */
  }
  return null;
}

/* --------------------------------------------------------------------- run */

const already = await runningInstance();
if (already) {
  console.log(`দোকান ইনভেন্টরি আগে থেকেই চালু আছে — উইন্ডো খোলা হচ্ছে (পোর্ট ${already.port})।`);
  openWindow(`http://localhost:${already.port}`);
  process.exit(0);
}

const { config, created } = loadOrCreateConfig();

// Set before the app is imported: src/app.js reads JWT_SECRET and db.js reads
// the database location at import time, not per request.
process.env.JWT_SECRET = config.jwtSecret;
process.env.DB_PATH = path.join(DATA_DIR, 'shop.db');
process.env.DATABASE_URL = '';          // force the SQLite driver
process.env.ADMIN_PASSWORD = config.adminPassword;
process.env.SHOP_TZ = process.env.SHOP_TZ || 'Asia/Dhaka';
process.env.SKIP_DEMO_DATA = process.env.SKIP_DEMO_DATA || '1';

const PORT = Number(process.env.PORT) || (await findPort());

const { default: app, boot } = await import(
  pathToFileURL(path.join(APP_ROOT, 'src', 'app.js')).href
);

const seeded = await boot();

// Only ever written on the run that actually creates the account, so a
// reinstall cannot overwrite the note with a password that is no longer real.
if (seeded && created) {
  fs.writeFileSync(
    PASSWORD_NOTE,
    ['দোকান ইনভেন্টরি — প্রথমবার লগইনের তথ্য',
     '',
     `ইউজারনেম: ${seeded.username}`,
     `পাসওয়ার্ড: ${config.adminPassword}`,
     '',
     'লগইন করার পর সেটিংস থেকে পাসওয়ার্ডটি বদলে নিন।',
     'এই ফাইলটি নিরাপদ জায়গায় রাখুন বা মুছে ফেলুন।',
     ''].join('\r\n'),
    'utf8'
  );
}

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify({ port: PORT, pid: process.pid }, null, 2));
  console.log(`দোকান ইনভেন্টরি চালু আছে  →  ${url}`);
  console.log(`তথ্য রাখা হচ্ছে: ${process.env.DB_PATH}`);
  if (seeded && created) {
    console.log(`\nপ্রথমবার লগইন:  ${seeded.username}  /  ${config.adminPassword}`);
    console.log(`(এই তথ্য এখানেও লেখা আছে: ${PASSWORD_NOTE})`);
    spawn('cmd', ['/c', 'start', '', PASSWORD_NOTE], { detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref();
  }
  openWindow(url);
});
