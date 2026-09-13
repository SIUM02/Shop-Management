import { api } from '../api.js';
import { empty, esc, formData, int, modal, money, seesProfit, state, toast, when } from '../ui.js';

/** Cart lives at module scope so switching pages and back keeps it. */
const cart = [];

/** Payment methods are stored in English; these are what the shop reads. */
export const PAYMENT_LABELS = {
  cash:   'নগদ',
  card:   'কার্ড',
  mobile: 'মোবাইল ব্যাংকিং',
  credit: 'বাকি',
};

export const paymentLabel = (method) => PAYMENT_LABELS[method] || method;

export async function render(root, ctx) {
  ctx.setActions('<button class="btn" id="clear-cart">কার্ট খালি করুন</button>');
  document.getElementById('clear-cart').addEventListener('click', () => {
    if (!cart.length) return;
    cart.length = 0;
    paint(root, ctx);
    toast('কার্ট খালি করা হয়েছে');
  });

  root.innerHTML = `
    <div class="pos">
      <div>
        <div class="card">
          <div class="card-head">
            <h2>পণ্য খুঁজুন</h2>
            <span class="sub">বারকোড স্ক্যান করুন বা নাম লিখুন</span>
          </div>
          <div class="card-body">
            <input id="pos-search" type="search" placeholder="বারকোড স্ক্যান করুন, বা নাম / SKU দিয়ে খুঁজুন…" autofocus />
          </div>
          <div class="card-body tight pos-results" id="pos-results"></div>
        </div>
      </div>

      <div class="card" id="cart-card"></div>
    </div>`;

  const search = root.querySelector('#pos-search');
  let debounce;

  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => searchProducts(root, ctx, search.value.trim()), 220);
  });

  // A barcode scanner types fast then sends Enter — treat that as an exact lookup.
  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = search.value.trim();
    if (!code) return;
    try {
      addToCart(await api.lookup(code), root, ctx);
      search.value = '';
      root.querySelector('#pos-results').innerHTML = '';
    } catch {
      searchProducts(root, ctx, code);
    }
  });

  await searchProducts(root, ctx, '');
  paint(root, ctx);
}

async function searchProducts(root, ctx, term) {
  const box = root.querySelector('#pos-results');
  if (!box) return;

  const { items } = await api.products({ search: term, limit: 40, sort: 'name' });
  if (!items.length) {
    box.innerHTML = empty(term ? `"${term}" এর সাথে কিছু মেলেনি` : 'কোনো পণ্য নেই', '🔍');
    return;
  }

  box.innerHTML = items.map((p) => `
    <div class="pos-pick ${p.quantity <= 0 ? 'disabled' : ''}" data-id="${p.id}">
      <div class="pos-pick-main">
        <div class="cell-main">${esc(p.name)}</div>
        <div class="cell-sub mono">${esc(p.sku)} · স্টকে ${int(p.quantity)} ${esc(p.unit)}</div>
      </div>
      <div class="num">
        <strong>${money(p.sell_price)}</strong>
        ${p.quantity <= 0 ? '<div class="small text-danger">স্টক শেষ</div>' : ''}
      </div>
    </div>`).join('');

  box.querySelectorAll('.pos-pick:not(.disabled)').forEach((el) => {
    el.addEventListener('click', () => {
      addToCart(items.find((p) => p.id === Number(el.dataset.id)), root, ctx);
    });
  });
}

function addToCart(product, root, ctx) {
  if (!product) return;
  const line = cart.find((l) => l.product_id === product.id);

  if (line) {
    if (line.quantity + 1 > product.quantity) {
      return toast(`${product.name} এর স্টকে আছে মাত্র ${product.quantity} ${product.unit}`, 'error');
    }
    line.quantity += 1;
  } else {
    if (product.quantity <= 0) return toast(`${product.name} এর স্টক শেষ`, 'error');
    cart.push({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      unit_price: product.sell_price,
      // Present only for roles the server sends costs to; that absence is what
      // keeps the running-profit row off everyone else's screen.
      cost_price: product.cost_price,
      available: product.quantity,
      quantity: 1,
    });
  }

  paint(root, ctx);
}

function totals() {
  const subtotal = cart.reduce((a, l) => a + l.unit_price * l.quantity, 0);
  const discount = Number(document.getElementById('pos-discount')?.value || 0) || 0;
  const taxPercent = Number(document.getElementById('pos-tax')?.value ?? state.settings.tax_percent) || 0;
  const capped = Math.min(discount, subtotal);
  const tax = (subtotal - capped) * (taxPercent / 100);

  /*
   * Running profit on the sale being rung up. Tax is excluded because it is
   * collected for the state, not earned, so margin is measured against the
   * net takings. Null unless every line carries a cost, which is the case
   * only for a role the server sends costs to.
   */
  const priced = cart.length > 0 && cart.every((l) => Number.isFinite(l.cost_price));
  const cost = priced ? cart.reduce((a, l) => a + l.cost_price * l.quantity, 0) : null;
  const net = subtotal - capped;
  const profit = priced ? net - cost : null;
  const margin = priced && net > 0 ? (profit / net) * 100 : null;

  return {
    subtotal, discount: capped, taxPercent, tax, total: subtotal - capped + tax,
    cost, profit, margin,
  };
}

function paint(root, ctx) {
  const card = root.querySelector('#cart-card');
  if (!card) return;

  // Preserve what the cashier already typed across re-renders.
  const prev = {
    discount: document.getElementById('pos-discount')?.value ?? '0',
    tax: document.getElementById('pos-tax')?.value ?? state.settings.tax_percent ?? '0',
    customer: document.getElementById('pos-customer')?.value ?? '',
    phone: document.getElementById('pos-phone')?.value ?? '',
    payment: document.getElementById('pos-payment')?.value ?? 'cash',
  };

  const t = totals();

  card.innerHTML = `
    <div class="card-head">
      <h2>চলতি বিক্রয়</h2>
      <span class="sub">${cart.length}টি লাইন</span>
    </div>
    <div class="card-body">
      ${cart.length ? cart.map((l, i) => `
        <div class="pos-cart-line">
          <div>
            <div class="cell-main">${esc(l.name)}</div>
            <div class="cell-sub mono">${esc(l.sku)} · প্রতিটি ${money(l.unit_price)}</div>
            <div class="qty-box">
              <button class="qty-btn" data-dec="${i}">−</button>
              <input type="number" min="1" max="${l.available}" value="${l.quantity}" data-qty="${i}" />
              <button class="qty-btn" data-inc="${i}">+</button>
              <span class="small muted">${int(l.available)} এর মধ্যে</span>
            </div>
          </div>
          <div class="num">
            <strong>${money(l.unit_price * l.quantity)}</strong>
            <div><button class="btn btn-sm" data-del="${i}" style="margin-top:6px">সরান</button></div>
          </div>
        </div>`).join('') : empty('কার্ট খালি — পণ্য যোগ করতে খুঁজুন বা স্ক্যান করুন', '🛒')}

      ${cart.length ? `
        <div class="totals">
          <div class="form-grid">
            <label class="field">
              <span>ছাড়</span>
              <input id="pos-discount" type="number" step="0.01" min="0" value="${esc(prev.discount)}" />
            </label>
            <label class="field">
              <span>কর %</span>
              <input id="pos-tax" type="number" step="0.01" min="0" max="100" value="${esc(prev.tax)}" />
            </label>
            <label class="field">
              <span>ক্রেতার নাম</span>
              <input id="pos-customer" maxlength="120" value="${esc(prev.customer)}" placeholder="সাধারণ ক্রেতা" />
            </label>
            <label class="field">
              <span>ফোন</span>
              <input id="pos-phone" maxlength="40" value="${esc(prev.phone)}" />
            </label>
            <label class="field span-2">
              <span>পরিশোধের মাধ্যম</span>
              <select id="pos-payment">
                ${['cash', 'card', 'mobile', 'credit'].map((m) =>
                  `<option value="${m}" ${prev.payment === m ? 'selected' : ''}>${PAYMENT_LABELS[m]}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="total-row"><span>উপমোট</span><span>${money(t.subtotal)}</span></div>
          <div class="total-row"><span>ছাড়</span><span>−${money(t.discount)}</span></div>
          <div class="total-row"><span>কর (${t.taxPercent}%)</span><span>${money(t.tax)}</span></div>
          <div class="total-row grand"><span>সর্বমোট</span><span>${money(t.total)}</span></div>
          ${seesProfit() && t.profit !== null ? `
            <div class="pos-profit" id="pos-profit">
              <div class="profit-head">শুধু মালিকের জন্য</div>
              <div class="total-row"><span>পণ্যের ক্রয়মূল্য</span><span id="t-cost">${money(t.cost)}</span></div>
              <div class="total-row profit-line">
                <span>এই বিক্রয়ে লাভ</span>
                <span id="t-profit" class="${t.profit >= 0 ? 'text-ok' : 'text-danger'}">
                  ${money(t.profit)}${t.margin === null ? '' : ` · ${t.margin.toFixed(1)}%`}
                </span>
              </div>
            </div>` : ''}

          <button class="btn btn-primary btn-block" id="checkout" style="margin-top:14px;padding:12px">
            বিক্রয় সম্পন্ন করুন · ${money(t.total)}
          </button>
        </div>` : ''}
    </div>`;

  card.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => { cart.splice(Number(b.dataset.del), 1); paint(root, ctx); }));

  card.querySelectorAll('[data-inc]').forEach((b) =>
    b.addEventListener('click', () => {
      const l = cart[Number(b.dataset.inc)];
      if (l.quantity + 1 > l.available) return toast(`স্টকে আছে মাত্র ${l.available}টি`, 'error');
      l.quantity += 1;
      paint(root, ctx);
    }));

  card.querySelectorAll('[data-dec]').forEach((b) =>
    b.addEventListener('click', () => {
      const l = cart[Number(b.dataset.dec)];
      if (l.quantity <= 1) cart.splice(Number(b.dataset.dec), 1);
      else l.quantity -= 1;
      paint(root, ctx);
    }));

  card.querySelectorAll('[data-qty]').forEach((input) =>
    input.addEventListener('change', () => {
      const l = cart[Number(input.dataset.qty)];
      const n = Math.max(1, Math.min(Number(input.value) || 1, l.available));
      if (n !== Number(input.value)) toast(`স্টকে থাকা ${l.available}টিতে সমন্বয় করা হয়েছে`, 'error');
      l.quantity = n;
      paint(root, ctx);
    }));

  // Totals recompute live as discount/tax change, without losing focus.
  for (const id of ['#pos-discount', '#pos-tax']) {
    card.querySelector(id)?.addEventListener('input', () => {
      const u = totals();
      const rows = card.querySelectorAll('.total-row');
      rows[0].lastElementChild.textContent = money(u.subtotal);
      rows[1].lastElementChild.textContent = '−' + money(u.discount);
      rows[2].firstElementChild.textContent = `কর (${u.taxPercent}%)`;
      rows[2].lastElementChild.textContent = money(u.tax);
      rows[3].lastElementChild.textContent = money(u.total);
      card.querySelector('#checkout').textContent = `বিক্রয় সম্পন্ন করুন · ${money(u.total)}`;

      // The owner-only figures move with the discount, so refresh them too.
      const costEl = card.querySelector('#t-cost');
      const profitEl = card.querySelector('#t-profit');
      if (costEl && profitEl && u.profit !== null) {
        costEl.textContent = money(u.cost);
        profitEl.textContent = money(u.profit) + (u.margin === null ? '' : ` · ${u.margin.toFixed(1)}%`);
        profitEl.className = u.profit >= 0 ? 'text-ok' : 'text-danger';
      }
    });
  }

  card.querySelector('#checkout')?.addEventListener('click', () => checkout(root, ctx));
}

async function checkout(root, ctx) {
  if (!cart.length) return;
  const btn = root.querySelector('#checkout');
  const t = totals();

  btn.disabled = true;
  btn.textContent = 'প্রক্রিয়াধীন…';

  try {
    const sale = await api.createSale({
      customer_name: document.getElementById('pos-customer').value.trim(),
      customer_phone: document.getElementById('pos-phone').value.trim(),
      payment_method: document.getElementById('pos-payment').value,
      discount: t.discount,
      tax_percent: t.taxPercent,
      items: cart.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
    });

    cart.length = 0;
    showReceipt(sale);
    toast(`বিক্রয় ${sale.invoice_no} সম্পন্ন হয়েছে`);
    await render(root, ctx);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = `বিক্রয় সম্পন্ন করুন · ${money(t.total)}`;
  }
}

/**
 * Profit on the completed sale, for the owner's eyes.
 *
 * The server withholds `profit` and `margin_percent` from anyone who may not
 * see margin, so its absence — not a role check here — is what hides this.
 *
 * Marked no-print so it never lands on the customer's copy of the receipt.
 */
function profitPanel(sale) {
  if (sale.profit === undefined || sale.margin_percent === undefined) return '';
  const tone = sale.profit >= 0 ? 'text-ok' : 'text-danger';
  return `
    <div class="profit-panel no-print">
      <div class="profit-head">শুধু মালিকের জন্য · ক্রেতার রসিদে দেখানো হয় না</div>
      <div class="profit-figures">
        <div>
          <span class="profit-label">লাভ</span>
          <strong class="${tone}">${money(sale.profit)}</strong>
        </div>
        <div>
          <span class="profit-label">মার্জিন</span>
          <strong class="${tone}">${int(sale.margin_percent)}%</strong>
        </div>
      </div>
    </div>`;
}

export function showReceipt(sale) {
  modal({
    title: `রসিদ · ${sale.invoice_no}`,
    body: `
      <div class="receipt">
        <div class="receipt-head">
          <div class="receipt-brand">
            <svg class="receipt-logo" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="5" fill="#14304F"/>
              <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" fill="#F5A524"/>
            </svg>
            <h3>${esc(state.settings.shop_name)}</h3>
          </div>
          ${state.settings.shop_proprietor ? `<div class="receipt-owner">${esc(state.settings.shop_proprietor)}${
            state.settings.shop_proprietor_title ? ` · ${esc(state.settings.shop_proprietor_title)}` : ''}</div>` : ''}
          ${state.settings.shop_phone ? `<div class="receipt-contact">${esc(state.settings.shop_phone)}</div>` : ''}
          ${state.settings.shop_address ? `<div class="receipt-contact">${esc(state.settings.shop_address)}</div>` : ''}
          <div class="receipt-rule"></div>
          <div>${esc(sale.invoice_no)}</div>
          <div>${esc(when(sale.created_at))}</div>
          ${sale.customer_name ? `<div>ক্রেতা: ${esc(sale.customer_name)}</div>` : ''}
        </div>
        <table>
          <thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">দর</th><th class="num">মোট</th></tr></thead>
          <tbody>${(sale.items || []).map((i) => `
            <tr>
              <td>${esc(i.product_name)}</td>
              <td class="num">${int(i.quantity)}</td>
              <td class="num">${money(i.unit_price)}</td>
              <td class="num">${money(i.line_total)}</td>
            </tr>`).join('')}</tbody>
        </table>
        <div class="totals">
          <div class="total-row"><span>উপমোট</span><span>${money(sale.subtotal)}</span></div>
          ${sale.discount ? `<div class="total-row"><span>ছাড়</span><span>−${money(sale.discount)}</span></div>` : ''}
          ${sale.tax ? `<div class="total-row"><span>কর</span><span>${money(sale.tax)}</span></div>` : ''}
          <div class="total-row grand"><span>সর্বমোট</span><span>${money(sale.total)}</span></div>
          <div class="total-row"><span>পরিশোধ</span><span>${esc(paymentLabel(sale.payment_method))}</span></div>
        </div>
        ${profitPanel(sale)}
        <p style="text-align:center;margin-top:18px">আপনার কেনাকাটার জন্য ধন্যবাদ!</p>
      </div>`,
    footer: `
      <button class="btn" data-close>বন্ধ</button>
      <button class="btn btn-primary" id="print-btn">প্রিন্ট</button>`,
    onMount: (el) => {
      el.querySelector('#print-btn').addEventListener('click', () => window.print());
    },
  });
}
