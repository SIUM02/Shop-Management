/*
 * Stops a running shop, for the Stop shortcut and the uninstaller.
 *
 * Kills the recorded process rather than every node.exe on the machine: the
 * owner may be running something else, and a blanket taskkill would take it
 * down with us.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base =
  process.env.SHOP_DATA_DIR ||
  (process.platform === 'win32'
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : path.join(os.homedir(), '.local', 'share'));

const runtimePath = path.join(base, 'DokanInventory', 'runtime.json');

let runtime;
try {
  runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
} catch {
  console.log('দোকান ইনভেন্টরি চালু নেই।');
  process.exit(0);
}

try {
  process.kill(runtime.pid);
  console.log(`দোকান ইনভেন্টরি বন্ধ করা হয়েছে (pid ${runtime.pid})।`);
} catch {
  console.log('দোকান ইনভেন্টরি আগে থেকেই বন্ধ ছিল।');
}

try {
  fs.unlinkSync(runtimePath);
} catch {
  /* nothing to clear */
}
