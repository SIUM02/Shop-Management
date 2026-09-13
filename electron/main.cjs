/*
 * Electron main process — the Windows 7 build.
 *
 * Why Electron at all, when the other package is a plain Node server: Windows 7
 * cannot run Node 18 or newer, and every browser it can still install stopped
 * at Chrome 109. Electron 22 is the last release that supports Windows 7, and
 * it carries its own Chromium and its own Node, so the shop depends on neither
 * the system browser nor a system runtime.
 *
 * CommonJS on purpose: Electron 22 cannot use an ES module as its entry point.
 * The .cjs extension keeps this file CommonJS even though the app around it
 * declares "type": "module", and the app itself is pulled in with a dynamic
 * import, which Node 16 supports.
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// One shop, one window. Without this a second launch would start a second
// server against the same database file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const DATA_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'DokanInventory'
);
fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PASSWORD_NOTE = path.join(DATA_DIR, 'প্রথমবার-লগইন.txt');

/*
 * Secrets are per installation, never shipped. One signing key baked into
 * every copy would let a token minted at one shop authenticate at another.
 */
function loadOrCreateConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return { config: JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')), created: false };
    } catch {
      // A corrupt config must not brick the till. Rebuilding costs one
      // fresh sign-in; the database is untouched.
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

let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14304F',
    title: 'জনতা ইলেকট্রিক এন্ড ইলেকট্রনিক্স',
    icon: path.join(__dirname, 'icons', 'app.ico'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // The page is our own server over loopback, but it never needs Node,
      // so it does not get it.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(url);

  // Anything aiming outside the app opens in the real browser rather than
  // replacing the till with a page the shopkeeper cannot navigate back from.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function start() {
  const { config, created } = loadOrCreateConfig();

  // Set before the app is imported: app.js reads JWT_SECRET and the database
  // location at import time, not per request.
  process.env.JWT_SECRET = config.jwtSecret;
  process.env.DB_PATH = path.join(DATA_DIR, 'shop.db');
  process.env.DATABASE_URL = '';        // force the SQLite driver
  process.env.ADMIN_PASSWORD = config.adminPassword;
  process.env.SHOP_TZ = process.env.SHOP_TZ || 'Asia/Dhaka';
  process.env.SKIP_DEMO_DATA = '1';     // the shop starts empty

  const appRoot = path.join(__dirname);
  const { default: expressApp, boot } = await import(
    require('url').pathToFileURL(path.join(appRoot, 'src', 'app.js')).href
  );

  const seeded = await boot();

  if (seeded && created) {
    fs.writeFileSync(
      PASSWORD_NOTE,
      ['জনতা ইলেকট্রিক এন্ড ইলেকট্রনিক্স — প্রথমবার লগইনের তথ্য',
       '',
       `ইউজারনেম: ${seeded.username}`,
       `পাসওয়ার্ড: ${config.adminPassword}`,
       '',
       'লগইন করার পর সেটিংস থেকে পাসওয়ার্ডটি বদলে নিন।',
       ''].join('\r\n'),
      'utf8'
    );
  }

  const port = await findPort();
  await new Promise((resolve) => expressApp.listen(port, '127.0.0.1', resolve));

  createWindow(`http://localhost:${port}`);

  if (seeded && created) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'প্রথমবার লগইন',
      message: 'আপনার লগইনের তথ্য',
      detail: `ইউজারনেম:  ${seeded.username}\nপাসওয়ার্ড:  ${config.adminPassword}\n\n`
            + 'লগইন করার পর সেটিংস থেকে পাসওয়ার্ডটি বদলে নিন।\n'
            + `এই তথ্য এখানেও রাখা আছে:\n${PASSWORD_NOTE}`,
      buttons: ['ঠিক আছে'],
    });
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(start).catch((err) => {
  dialog.showErrorBox('দোকান ইনভেন্টরি চালু হয়নি', String(err && err.stack ? err.stack : err));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
