/**
 * Small in-memory throttle for the login endpoint.
 *
 * Tracks failures per client IP *and* per username, so one attacker cannot
 * spray many usernames from one address, and a distributed attack still cannot
 * hammer a single account. State lives in this process only — a restart clears
 * it, which is an acceptable trade for a single-instance shop app.
 */

const WINDOW_MS = 15 * 60 * 1000; // failures older than this are forgotten
const MAX_FAILURES = 8;           // failures allowed inside the window
const BLOCK_MS = 15 * 60 * 1000;  // how long a key stays locked out

const buckets = new Map();

function bucketFor(key) {
  let b = buckets.get(key);
  if (!b) {
    b = { failures: [], blockedUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

/** Milliseconds remaining on a block, or 0 if the key is free to try. */
function retryAfter(key, now) {
  const b = buckets.get(key);
  if (!b) return 0;
  if (b.blockedUntil > now) return b.blockedUntil - now;
  return 0;
}

export function recordFailure(key, now = Date.now()) {
  const b = bucketFor(key);
  b.failures = b.failures.filter((t) => now - t < WINDOW_MS);
  b.failures.push(now);
  if (b.failures.length >= MAX_FAILURES) {
    b.blockedUntil = now + BLOCK_MS;
    b.failures = [];
  }
}

export function clearFailures(key) {
  buckets.delete(key);
}

/** Client address, honouring X-Forwarded-For only when trust proxy is on. */
export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Returns { blocked, retryAfterSeconds }. Check before verifying a password.
 */
export function checkLogin(req, username) {
  const now = Date.now();
  const keys = [`ip:${clientKey(req)}`, `user:${String(username || '').toLowerCase()}`];
  const wait = Math.max(...keys.map((k) => retryAfter(k, now)));
  return {
    blocked: wait > 0,
    retryAfterSeconds: Math.ceil(wait / 1000),
    keys,
  };
}

// Drop idle buckets so a long-running server does not grow without bound.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    const stale = b.blockedUntil < now && !b.failures.some((t) => now - t < WINDOW_MS);
    if (stale) buckets.delete(key);
  }
}, WINDOW_MS);
sweeper.unref?.(); // never hold the process open
