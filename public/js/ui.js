/* Shared rendering helpers: escaping, formatting, modals, toasts. */

export const state = {
  user: null,
  settings: {
    shop_name: 'My Shop',
    currency_symbol: '৳',
    number_locale: 'en-IN',
    tax_percent: '0',
  },
};

/** Number-grouping choices offered in Settings. */
export const NUMBER_LOCALES = [
  ['en-IN', 'South Asian — 1,23,456.78 (lakh grouping)'],
  ['en-US', 'Western — 123,456.78'],
  ['bn-BD', 'Bengali digits — \u09e7,\u09e8\u09e9,\u09ea\u09eb\u09ec.\u09ed\u09ee'],
];

/** Escape untrusted text before it goes into innerHTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Grouping follows the number_locale setting; falls back if it is unknown. */
function group(value, opts) {
  try {
    return value.toLocaleString(state.settings.number_locale || 'en-IN', opts);
  } catch {
    return value.toLocaleString(undefined, opts);
  }
}

export function money(n) {
  // A field the server withheld arrives as undefined; show a dash rather than
  // NaN if some corner of the interface forgets to check.
  if (n === undefined || n === null) return '—';
  const v = Number(n || 0);
  const sign = v < 0 ? '-' : '';
  // Whole amounts print without the '.00' noise; anything fractional keeps
  // its two decimals so historical totals still read exactly.
  const rounded = Math.round(Math.abs(v) * 100) / 100;
  const amount = group(rounded, Number.isInteger(rounded)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${state.settings.currency_symbol}${amount}`;
}

export const int = (n) => group(Number(n || 0), {});

/**
 * Count each .kpi-value up from zero to the figure it already displays.
 *
 * Strictly decorative: the element's exact original text is restored on the
 * final frame, so an interpolation or grouping quirk can never change the
 * number a shopkeeper actually reads. Skipped entirely when the visitor has
 * asked for reduced motion.
 */
export function animateCounters(root) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  for (const el of root.querySelectorAll('.kpi-value')) {
    const original = el.textContent;
    // A currency symbol or minus sign, then the digits, then any trailing unit.
    const parts = original.match(/^(\D*?)(\d[\d.,\s]*)(.*)$/s);
    if (!parts) continue;

    const [, prefix, digits, suffix] = parts;
    const decimals = (digits.split('.')[1] || '').replace(/\D/g, '').length;
    const target = Number(digits.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(target) || target === 0) continue;

    el.classList.add('counting');
    const DURATION = 750;
    const started = performance.now();

    const frame = (now) => {
      const t = Math.min((now - started) / DURATION, 1);
      if (t < 1) {
        const eased = 1 - Math.pow(1 - t, 3); // decelerate into the figure
        el.textContent =
          prefix +
          group(target * eased, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }) +
          suffix;
        requestAnimationFrame(frame);
      } else {
        el.textContent = original;
        el.classList.remove('counting');
      }
    };
    requestAnimationFrame(frame);
  }
}

/** SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC; render it in local time. */
export function when(value, { withTime = true } = {}) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(value);
  const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function relative(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return when(value, { withTime: false });
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function stockBadge(product) {
  if (product.quantity <= 0) return '<span class="badge badge-danger">Out of stock</span>';
  if (product.quantity <= product.reorder_level) return '<span class="badge badge-warn">Low stock</span>';
  return '<span class="badge badge-ok">In stock</span>';
}

const MOVEMENT_LABELS = {
  in:     ['badge-ok', 'Stock in'],
  out:    ['badge-danger', 'Stock out'],
  adjust: ['badge-info', 'Adjustment'],
  sale:   ['badge-muted', 'Sale'],
  return: ['badge-info', 'Return'],
};

export function movementBadge(type) {
  const [cls, label] = MOVEMENT_LABELS[type] || ['badge-muted', type];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export const can = (...roles) => state.user && roles.includes(state.user.role);
export const canEdit = () => can('admin', 'manager');

/*
 * Who sees margin. These mirror src/permissions.js and decide only what gets
 * drawn — the server is what actually withholds the numbers, so editing these
 * cannot reveal anything the response did not already contain.
 */
export const seesProfit = () => can('admin');
export const seesCost = () => can('admin', 'manager');

/* -------------------------------------------------------------- toasts */
export function toast(message, kind = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, kind === 'error' ? 5200 : 2900);
}

/* -------------------------------------------------------------- modals */
let closeCurrentModal = null;

/**
 * Show a modal. `onMount(bodyEl, close)` wires up the content.
 * Returns a function that closes it.
 */
export function modal({ title, body, footer = '', large = false, onMount }) {
  closeModal();

  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${large ? 'modal-lg' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    closeCurrentModal = null;
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.hasAttribute('data-close')) close();
  });
  closeCurrentModal = close;

  onMount?.(backdrop.querySelector('.modal'), close);
  backdrop.querySelector('input, select, textarea')?.focus();
  return close;
}

export function closeModal() {
  closeCurrentModal?.();
}

/** Promise-based confirm dialog. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

    const close = modal({
      title,
      body: `<p style="margin:0;line-height:1.55">${message}</p>`,
      footer: `
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>`,
      onMount: (el) => {
        el.querySelector('[data-ok]').addEventListener('click', () => { finish(true); close(); });
        el.querySelector('[data-cancel]').addEventListener('click', () => { finish(false); close(); });
      },
    });

    // Escape / backdrop click resolve false once the node is gone.
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.modal-backdrop')) { finish(false); observer.disconnect(); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/* -------------------------------------------------------------- fragments */
export const loading = () => '<div class="loading">Loading…</div>';

export function empty(message, icon = '🗒') {
  return `<div class="empty"><div class="empty-icon">${icon}</div><p>${esc(message)}</p></div>`;
}

export function errorBox(message) {
  return `<div class="alert alert-error">${esc(message)}</div>`;
}

/** Read a form into a plain object (checkboxes become booleans). */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

/** Simple bar chart as inline SVG — no chart library needed. */
export function barChart(points, { valueKey = 'revenue', labelKey = 'day', format = money } = {}) {
  if (!points.length) return empty('No data yet', '📈');

  const W = 100, H = 40, pad = 1;
  const max = Math.max(...points.map((p) => Number(p[valueKey]) || 0), 1);
  const slot = W / points.length;
  const barW = Math.max(slot - pad * 2, 0.6);

  const bars = points.map((p, i) => {
    const v = Number(p[valueKey]) || 0;
    const h = (v / max) * (H - 6);
    const x = i * slot + pad;
    const y = H - h;
    const label = `${p[labelKey]}: ${format(v)}`;
    return `<rect class="bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}"
              height="${Math.max(h, 0.6).toFixed(2)}" rx="0.5"><title>${esc(label)}</title></rect>`;
  }).join('');

  const first = String(points[0][labelKey]).slice(5);
  const last = String(points[points.length - 1][labelKey]).slice(5);

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H + 6}" preserveAspectRatio="none" role="img"
         aria-label="Chart of ${esc(valueKey)} over time">
      ${bars}
      <line class="axis" x1="0" y1="${H}" x2="${W}" y2="${H}" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="small muted" style="display:flex;justify-content:space-between;margin-top:4px">
      <span>${esc(first)}</span><span>Peak ${format(max)}</span><span>${esc(last)}</span>
    </div>`;
}
