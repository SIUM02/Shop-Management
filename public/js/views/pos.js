import { api } from '../api.js';
import { empty, esc, formData, int, modal, money, seesProfit, state, toast, when } from '../ui.js';

/** Cart lives at module scope so switching pages and back keeps it. */
const cart = [];

export async function render(root, ctx) {
  ctx.setActions('<button class="btn" id="clear-cart">Clear cart</button>');
  document.getElementById('clear-cart').addEventListener('click', () => {
    if (!cart.length) return;
    cart.length = 0;
    paint(root, ctx);
    toast('Cart cleared');
  });

  root.innerHTML = `
    <div class="pos">
      <div>
        <div class="card">
          <div class="card-head">
            <h2>Find products</h2>
            <span class="sub">Scan a barcode or type a name</span>
          </div>
          <div class="card-body">
            <input id="pos-search" type="search" placeholder="Scan barcode, or search by name / SKU…" autofocus />
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
    box.innerHTML = empty(term ? `Nothing matches "${term}"` : 'No products available', '🔍');
    return;
  }

  box.innerHTML = items.map((p) => `
    <div class="pos-pick ${p.quantity <= 0 ? 'disabled' : ''}" data-id="${p.id}">
      <div class="pos-pick-main">
        <div class="cell-main">${esc(p.name)}</div>
        <div class="cell-sub mono">${esc(p.sku)} · ${int(p.quantity)} ${esc(p.unit)} in stock</div>
      </div>
      <div class="num">
        <strong>${money(p.sell_price)}</strong>
        ${p.quantity <= 0 ? '<div class="small text-danger">Out of stock</div>' : ''}
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
      return toast(`Only ${product.quantity} ${product.unit} of ${product.name} in stock`, 'error');
    }
    line.quantity += 1;
  } else {
    if (product.quantity <= 0) return toast(`${product.name} is out of stock`, 'error');
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
      <h2>Current sale</h2>
      <span class="sub">${cart.length} line${cart.length === 1 ? '' : 's'}</span>
    </div>
    <div class="card-body">
      ${cart.length ? cart.map((l, i) => `
        <div class="pos-cart-line">
          <div>
            <div class="cell-main">${esc(l.name)}</div>
            <div class="cell-sub mono">${esc(l.sku)} · ${money(l.unit_price)} each</div>
            <div class="qty-box">
              <button class="qty-btn" data-dec="${i}">−</button>
              <input type="number" min="1" max="${l.available}" value="${l.quantity}" data-qty="${i}" />
              <button class="qty-btn" data-inc="${i}">+</button>
              <span class="small muted">of ${int(l.available)}</span>
            </div>
          </div>
          <div class="num">
            <strong>${money(l.unit_price * l.quantity)}</strong>
            <div><button class="btn btn-sm" data-del="${i}" style="margin-top:6px">Remove</button></div>
          </div>
        </div>`).join('') : empty('Cart is empty — search or scan to add items', '🛒')}

      ${cart.length ? `
        <div class="totals">
          <div class="form-grid">
            <label class="field">
              <span>Discount</span>
              <input id="pos-discount" type="number" step="0.01" min="0" value="${esc(prev.discount)}" />
            </label>
            <label class="field">
              <span>Tax %</span>
              <input id="pos-tax" type="number" step="0.01" min="0" max="100" value="${esc(prev.tax)}" />
            </label>
            <label class="field">
              <span>Customer name</span>
              <input id="pos-customer" maxlength="120" value="${esc(prev.customer)}" placeholder="Walk-in" />
            </label>
            <label class="field">
              <span>Phone</span>
              <input id="pos-phone" maxlength="40" value="${esc(prev.phone)}" />
            </label>
            <label class="field span-2">
              <span>Payment method</span>
              <select id="pos-payment">
                ${['cash', 'card', 'mobile', 'credit'].map((m) =>
                  `<option value="${m}" ${prev.payment === m ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="total-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
          <div class="total-row"><span>Discount</span><span>−${money(t.discount)}</span></div>
          <div class="total-row"><span>Tax (${t.taxPercent}%)</span><span>${money(t.tax)}</span></div>
          <div class="total-row grand"><span>Total</span><span>${money(t.total)}</span></div>
          ${seesProfit() && t.profit !== null ? `
            <div class="pos-profit" id="pos-profit">
              <div class="profit-head">Owner only</div>
              <div class="total-row"><span>Cost of goods</span><span id="t-cost">${money(t.cost)}</span></div>
              <div class="total-row profit-line">
                <span>Profit on this sale</span>
                <span id="t-profit" class="${t.profit >= 0 ? 'text-ok' : 'text-danger'}">
                  ${money(t.profit)}${t.margin === null ? '' : ` · ${t.margin.toFixed(1)}%`}
                </span>
              </div>
            </div>` : ''}

          <button class="btn btn-primary btn-block" id="checkout" style="margin-top:14px;padding:12px">
            Complete sale · ${money(t.total)}
          </button>
        </div>` : ''}
    </div>`;

  card.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => { cart.splice(Number(b.dataset.del), 1); paint(root, ctx); }));

  card.querySelectorAll('[data-inc]').forEach((b) =>
    b.addEventListener('click', () => {
      const l = cart[Number(b.dataset.inc)];
      if (l.quantity + 1 > l.available) return toast(`Only ${l.available} in stock`, 'error');
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
      if (n !== Number(input.value)) toast(`Adjusted to the ${l.available} available`, 'error');
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
      rows[2].firstElementChild.textContent = `Tax (${u.taxPercent}%)`;
      rows[2].lastElementChild.textContent = money(u.tax);
      rows[3].lastElementChild.textContent = money(u.total);
      card.querySelector('#checkout').textContent = `Complete sale · ${money(u.total)}`;

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
  btn.textContent = 'Processing…';

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
    toast(`Sale ${sale.invoice_no} completed`);
    await render(root, ctx);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = `Complete sale · ${money(t.total)}`;
  }
}

export function showReceipt(sale) {
  modal({
    title: `Receipt · ${sale.invoice_no}`,
    body: `
      <div class="receipt">
        <div class="receipt-head">
          <h3>${esc(state.settings.shop_name)}</h3>
          <div>${esc(sale.invoice_no)}</div>
          <div>${esc(when(sale.created_at))}</div>
          ${sale.customer_name ? `<div>Customer: ${esc(sale.customer_name)}</div>` : ''}
        </div>
        <table>
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
          <tbody>${(sale.items || []).map((i) => `
            <tr>
              <td>${esc(i.product_name)}</td>
              <td class="num">${int(i.quantity)}</td>
              <td class="num">${money(i.unit_price)}</td>
              <td class="num">${money(i.line_total)}</td>
            </tr>`).join('')}</tbody>
        </table>
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
          ${sale.discount ? `<div class="total-row"><span>Discount</span><span>−${money(sale.discount)}</span></div>` : ''}
          ${sale.tax ? `<div class="total-row"><span>Tax</span><span>${money(sale.tax)}</span></div>` : ''}
          <div class="total-row grand"><span>Total</span><span>${money(sale.total)}</span></div>
          <div class="total-row"><span>Paid by</span><span>${esc(sale.payment_method)}</span></div>
        </div>
        <p style="text-align:center;margin-top:18px">Thank you for your purchase!</p>
      </div>`,
    footer: `
      <button class="btn" data-close>Close</button>
      <button class="btn btn-primary" id="print-btn">Print</button>`,
    onMount: (el) => {
      el.querySelector('#print-btn').addEventListener('click', () => window.print());
    },
  });
}
