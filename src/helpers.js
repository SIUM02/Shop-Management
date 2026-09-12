/** Error type that carries an HTTP status through to the error handler. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'পাওয়া যায়নি') => new HttpError(404, msg);

/** Wraps a route handler so thrown errors reach Express' error middleware. */
export function wrap(handler) {
  return (req, res, next) => {
    try {
      const out = handler(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

export function str(value, { field, required = false, max = 500, fallback = '' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} দিতে হবে`);
    return fallback;
  }
  const s = String(value).trim();
  if (required && !s) throw badRequest(`${field} দিতে হবে`);
  if (s.length > max) throw badRequest(`${field} সর্বোচ্চ ${max} অক্ষরের হতে পারবে`);
  return s;
}

export function num(value, { field, required = false, min = null, max = null, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field} দিতে হবে`);
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} একটি সংখ্যা হতে হবে`);
  if (min !== null && n < min) throw badRequest(`${field} কমপক্ষে ${min} হতে হবে`);
  if (max !== null && n > max) throw badRequest(`${field} সর্বোচ্চ ${max} হতে পারবে`);
  return n;
}

export function int(value, opts = {}) {
  const n = num(value, opts);
  if (!Number.isInteger(n)) throw badRequest(`${opts.field} একটি পূর্ণ সংখ্যা হতে হবে`);
  return n;
}

/** Money values are stored as REAL; round to cents so totals stay exact-ish. */
export const money = (n) => Math.round(Number(n) * 100) / 100;

/** Optional foreign key: '' / null / 0 all mean "not set". */
export function optionalId(value) {
  if (value === undefined || value === null || value === '' || value === 0) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('রেফারেন্স আইডি সঠিক নয়');
  return n;
}
