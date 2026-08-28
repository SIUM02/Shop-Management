import { api } from '../api.js';
import {
  canEdit, confirmDialog, empty, esc, int, loading, modal, money, toast, when,
} from '../ui.js';
import { showReceipt } from './pos.js';

const filters = { search: '', from: '', to: '', status: '', offset: 0 };
const PAGE = 50;

export async function render(root, ctx) {
  const actions = ctx.setActions(`
    <button class="btn" id="export-btn">Export CSV</button>
    <button class="btn btn-primary" id="new-sale">＋ New Sale</button>
  `);
  actions.querySelector('#export-btn').addEventListener('click', () => {
    window.location.href = '/api/reports/export/sales';
  });
  actions.querySelector('#new-sale').addEventListener('click', () => ctx.navigate('pos'));

  root.innerHTML = `
    <div class="toolbar">
      <input class="search" id="f-search" type="search" placeholder="Search invoice or customer…" value="${esc(filters.search)}" />
      <input id="f-from" type="date" value="${esc(filters.from)}" title="From date" />
      <input id="f-to"   type="date" value="${esc(filters.to)}" title="To date" />
      <select id="f-status">
        <option value="">All invoices</option>
        <option value="completed" ${filters.status === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="voided"    ${filters.status === 'voided' ? 'selected' : ''}>Voided</option>
      </select>
      <button class="btn btn-sm" id="f-clear">Clear</button>
    </div>
    <div class="card"><div class="card-body tight" id="list">${loading()}</div></div>`;

  let debounce;
  root.querySelector('#f-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.search = e.target.value.trim();
      filters.offset = 0;
      load(root, ctx);
    }, 250);
  });

  for (const [id, key] of [['#f-from', 'from'], ['#f-to', 'to'], ['#f-status', 'status']]) {
    root.querySelector(id).addEventListener('change', (e) => {
      filters[key] = e.target.value;
      filters.offset = 0;
      load(root, ctx);
    });
  }

  root.querySelector('#f-clear').addEventListener('click', () => {
    Object.assign(filters, { search: '', from: '', to: '', status: '', offset: 0 });
    render(root, ctx);
  });

  await load(root, ctx);
}

async function load(root, ctx) {
  const box = root.querySelector('#list');
  box.innerHTML = loading();

  const { items, total } = await api.sales({ ...filters, limit: PAGE });
  if (!items.length) return void (box.innerHTML = empty('No sales match these filters', '🧾'));

  const completed = items.filter((s) => s.status === 'completed');
  const pageRevenue = completed.reduce((a, s) => a + s.total, 0);

  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Invoice</th><th>When</th><th>Customer</th>
        <th class="num">Items</th><th class="num">Total</th>
        <th>Payment</th><th>Status</th><th>By</th>
      </tr></thead>
      <tbody>${items.map((s) => `
        <tr class="clickable" data-id="${s.id}">
          <td class="mono">${esc(s.invoice_no)}</td>
          <td class="small nowrap">${esc(when(s.created_at))}</td>
          <td>${esc(s.customer_name || 'Walk-in')}</td>
          <td class="num">${int(s.item_count)}</td>
          <td class="num"><strong>${money(s.total)}</strong></td>
          <td class="small" style="text-transform:capitalize">${esc(s.payment_method)}</td>
          <td>${s.status === 'voided'
            ? '<span class="badge badge-danger">Voided</span>'
            : '<span class="badge badge-ok">Completed</span>'}</td>
          <td class="small muted">${esc(s.username || '—')}</td>
        </tr>`).join('')}</tbody>
      <tfoot><tr>
        <td colspan="4">Page total (${completed.length} completed)</td>
        <td class="num">${money(pageRevenue)}</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table></div>
    <div class="pager">
      <span>Showing ${filters.offset + 1}–${filters.offset + items.length} of ${int(total)}</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="prev" ${filters.offset === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn btn-sm" id="next" ${filters.offset + PAGE >= total ? 'disabled' : ''}>Next →</button>
    </div>`;

  box.querySelector('#prev')?.addEventListener('click', () => {
    filters.offset = Math.max(0, filters.offset - PAGE);
    load(root, ctx);
  });
  box.querySelector('#next')?.addEventListener('click', () => {
    filters.offset += PAGE;
    load(root, ctx);
  });

  box.querySelectorAll('tr[data-id]').forEach((row) =>
    row.addEventListener('click', () => openSale(Number(row.dataset.id), root, ctx)));
}

async function openSale(id, root, ctx) {
  const sale = await api.sale(id);
  // The server omits profit for anyone who may not see margin, so its presence
  // is the permission check — deriving it here would leak it.
  const showsProfit = sale.profit !== undefined;

  modal({
    title: `${sale.invoice_no}${sale.status === 'voided' ? ' (voided)' : ''}`,
    large: true,
    body: `
      ${sale.status === 'voided'
        ? '<div class="alert alert-error">This sale was voided and the stock has been returned.</div>' : ''}

      <table style="margin-bottom:18px">
        <tbody>
          <tr><td class="muted">Date</td><td>${esc(when(sale.created_at))}</td>
              <td class="muted">Cashier</td><td>${esc(sale.cashier_name || sale.username || '—')}</td></tr>
          <tr><td class="muted">Customer</td><td>${esc(sale.customer_name || 'Walk-in')}</td>
              <td class="muted">Phone</td><td>${esc(sale.customer_phone || '—')}</td></tr>
          <tr><td class="muted">Payment</td><td style="text-transform:capitalize">${esc(sale.payment_method)}</td>
              ${showsProfit
                ? `<td class="muted">Profit</td>
                   <td class="${sale.profit >= 0 ? 'text-ok' : 'text-danger'}">
                     ${money(sale.profit)} <span class="muted small">· ${int(sale.margin_percent)}% margin</span>
                   </td>`
                : '<td></td><td></td>'}</tr>
        </tbody>
      </table>

      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead>
        <tbody>${sale.items.map((i) => `
          <tr>
            <td>
              <div class="cell-main">${esc(i.product_name)}</div>
              <div class="cell-sub mono">${esc(i.sku)}</div>
            </td>
            <td class="num">${int(i.quantity)}</td>
            <td class="num">${money(i.unit_price)}</td>
            <td class="num">${money(i.line_total)}</td>
          </tr>`).join('')}</tbody>
      </table></div>

      <div class="totals">
        <div class="total-row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
        <div class="total-row"><span>Discount</span><span>−${money(sale.discount)}</span></div>
        <div class="total-row"><span>Tax</span><span>${money(sale.tax)}</span></div>
        <div class="total-row grand"><span>Total</span><span>${money(sale.total)}</span></div>
      </div>`,
    footer: `
      <button class="btn" data-close>Close</button>
      <button class="btn" id="print-btn">Print receipt</button>
      ${sale.status === 'completed' && canEdit()
        ? '<button class="btn btn-danger" id="void-btn">Void sale</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#print-btn').addEventListener('click', () => { close(); showReceipt(sale); });

      el.querySelector('#void-btn')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Void this sale?',
          message: `Voiding <strong>${esc(sale.invoice_no)}</strong> returns all ${sale.items.length} line(s) to stock. The invoice stays in your records marked as voided.`,
          confirmLabel: 'Void sale',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api.voidSale(sale.id, 'Voided from sales list');
          toast(res.message);
          close();
          load(root, ctx);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
