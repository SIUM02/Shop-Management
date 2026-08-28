/**
 * Who is allowed to see what a sale actually earned.
 *
 * The shop owner wants margin kept to themselves, so this is enforced on the
 * server rather than by hiding fields in the browser: a response that carries
 * `cost_total` is readable by anyone who opens the network tab, no matter what
 * the interface chooses to draw.
 *
 * Three tiers:
 *   admin    — everything, including profit and margin.
 *   manager  — may see and enter purchase costs, because receiving stock and
 *              pricing products is their job, but sees no profit figures.
 *   staff    — neither costs nor profit.
 *
 * Change the two predicates below to move the line; every endpoint follows
 * them automatically through the redaction middleware.
 */

export const canSeeProfit = (user) => user?.role === 'admin';
export const canSeeCost = (user) => user?.role === 'admin' || user?.role === 'manager';

/** Figures that state earnings outright. Owner only. */
const PROFIT_FIELDS = new Set([
  'profit',
  'margin_percent',
  'potential_profit',
  // A sale's cost of goods is one subtraction away from its profit, so it
  // belongs with the owner-only figures even though it is nominally a cost.
  'cost_total',
]);

/**
 * What things cost. A manager keeps these because receiving stock and pricing
 * products needs them — which does mean a manager can work margin out for
 * themselves. Move these into PROFIT_FIELDS, or make canSeeCost admin-only, if
 * that matters more than managers being able to do purchasing.
 */
const COST_FIELDS = new Set([
  'cost_price',
  'unit_cost',
  'cost_value',
  'stock_value',
  'stock_value_cost',
  'estimated_cost',
  'estimated_total',
]);

/**
 * Returns a copy of `payload` with the fields this user may not see removed.
 * Walks arrays and nested objects, so a sale's line items are covered as well
 * as the sale itself.
 */
export function redact(payload, user) {
  const hideProfit = !canSeeProfit(user);
  const hideCost = !canSeeCost(user);
  if (!hideProfit && !hideCost) return payload;

  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    // Dates and other non-plain objects pass through untouched.
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;

    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (hideProfit && PROFIT_FIELDS.has(key)) continue;
      if (hideCost && COST_FIELDS.has(key)) continue;
      out[key] = walk(v);
    }
    return out;
  };

  return walk(payload);
}

/**
 * Applies `redact` to every JSON body on its way out, so a new endpoint cannot
 * leak margin by forgetting to filter. Mount after the auth middleware has had
 * a chance to populate req.user.
 */
export function redactResponses(req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(redact(body, req.user));
  next();
}
