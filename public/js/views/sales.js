import { api } from '../api.js';
import {
  canEdit, confirmDialog, empty, esc, int, loading, modal, money, toast, when,
} from '../ui.js';
import { paymentLabel, showReceipt } from './pos.js';

const filters = { search: '', from: '', to: '', status: '', offset: 0 };
const PAGE = 50;

export async function render(root, ctx) {
  const actions = ctx.setActions(`
    <button class="btn" id="export-btn">CSV এক্সপোর্ট</button>
    <button class="btn btn-primary" id="new-sale">＋ নতুন বিক্রয়</button>
  `);
  actions.querySelector('#export-btn').addEventListener('click', () => {
    window.location.href = '/api/reports/export/sales';
  });
  actions.querySelector('#new-sale').addEventListener('click', () => ctx.navigate('pos'));

  root.innerHTML = `
    <div class="toolbar">
      <input class="search" id="f-search" type="search" placeholder="চালান বা ক্রেতা খুঁজুন…" value="${esc(filters.search)}" />
      <input id="f-from" type="date" value="${esc(filters.from)}" title="শুরুর তারিখ" />
      <input id="f-to"   type="date" value="${esc(filters.to)}" title="শেষ তারিখ" />
      <select id="f-status">
        <option value="">সব চালান</option>
        <option value="completed" ${filters.status === 'completed' ? 'selected' : ''}>সম্পন্ন</option>
        <option value="voided"    ${filters.status === 'voided' ? 'selected' : ''}>বাতিল</option>
      </select>
      <button class="btn btn-sm" id="f-clear">মুছুন</button>
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
  if (!items.length) return void (box.innerHTML = empty('এই ফিল্টারে কোনো বিক্রয় মেলেনি', '🧾'));

  const completed = items.filter((s) => s.status === 'completed');
  const pageRevenue = completed.reduce((a, s) => a + s.total, 0);

  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>চালান</th><th>কখন</th><th>ক্রেতা</th>
        <th class="num">পণ্য</th><th class="num">মোট</th>
        <th>পরিশোধ</th><th>অবস্থা</th><th>কে করেছেন</th>
      </tr></thead>
      <tbody>${items.map((s) => `
        <tr class="clickable" data-id="${s.id}">
          <td class="mono">${esc(s.invoice_no)}</td>
          <td class="small nowrap">${esc(when(s.created_at))}</td>
          <td>${esc(s.customer_name || 'সাধারণ ক্রেতা')}</td>
          <td class="num">${int(s.item_count)}</td>
          <td class="num"><strong>${money(s.total)}</strong></td>
          <td class="small">${esc(paymentLabel(s.payment_method))}</td>
          <td>${s.status === 'voided'
            ? '<span class="badge badge-danger">বাতিল</span>'
            : '<span class="badge badge-ok">সম্পন্ন</span>'}</td>
          <td class="small muted">${esc(s.username || '—')}</td>
        </tr>`).join('')}</tbody>
      <tfoot><tr>
        <td colspan="4">এই পাতার মোট (${completed.length}টি সম্পন্ন)</td>
        <td class="num">${money(pageRevenue)}</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table></div>
    <div class="pager">
      <span>${int(total)}টির মধ্যে ${filters.offset + 1}–${filters.offset + items.length} দেখানো হচ্ছে</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="prev" ${filters.offset === 0 ? 'disabled' : ''}>← আগের</button>
      <button class="btn btn-sm" id="next" ${filters.offset + PAGE >= total ? 'disabled' : ''}>পরের →</button>
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
    title: `${sale.invoice_no}${sale.status === 'voided' ? ' (বাতিল)' : ''}`,
    large: true,
    body: `
      ${sale.status === 'voided'
        ? '<div class="alert alert-error">এই বিক্রয়টি বাতিল করা হয়েছে এবং স্টক ফেরত দেওয়া হয়েছে।</div>' : ''}

      <table style="margin-bottom:18px">
        <tbody>
          <tr><td class="muted">তারিখ</td><td>${esc(when(sale.created_at))}</td>
              <td class="muted">ক্যাশিয়ার</td><td>${esc(sale.cashier_name || sale.username || '—')}</td></tr>
          <tr><td class="muted">ক্রেতা</td><td>${esc(sale.customer_name || 'সাধারণ ক্রেতা')}</td>
              <td class="muted">ফোন</td><td>${esc(sale.customer_phone || '—')}</td></tr>
          <tr><td class="muted">পরিশোধ</td><td>${esc(paymentLabel(sale.payment_method))}</td>
              ${showsProfit
                ? `<td class="muted">লাভ</td>
                   <td class="${sale.profit >= 0 ? 'text-ok' : 'text-danger'}">
                     ${money(sale.profit)} <span class="muted small">· ${int(sale.margin_percent)}% মার্জিন</span>
                   </td>`
                : '<td></td><td></td>'}</tr>
        </tbody>
      </table>

      <div class="table-wrap"><table>
        <thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">একক দর</th><th class="num">লাইন মোট</th></tr></thead>
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
        <div class="total-row"><span>উপমোট</span><span>${money(sale.subtotal)}</span></div>
        <div class="total-row"><span>ছাড়</span><span>−${money(sale.discount)}</span></div>
        <div class="total-row"><span>কর</span><span>${money(sale.tax)}</span></div>
        <div class="total-row grand"><span>সর্বমোট</span><span>${money(sale.total)}</span></div>
      </div>`,
    footer: `
      <button class="btn" data-close>বন্ধ</button>
      <button class="btn" id="print-btn">রসিদ প্রিন্ট</button>
      ${sale.status === 'completed' && canEdit()
        ? '<button class="btn btn-danger" id="void-btn">বিক্রয় বাতিল</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#print-btn').addEventListener('click', () => { close(); showReceipt(sale); });

      el.querySelector('#void-btn')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'এই বিক্রয়টি বাতিল করবেন?',
          message: `<strong>${esc(sale.invoice_no)}</strong> বাতিল করলে ${sale.items.length}টি লাইনের পণ্যই স্টকে ফিরে যাবে। চালানটি বাতিল হিসেবে চিহ্নিত হয়ে আপনার নথিতে থেকে যাবে।`,
          confirmLabel: 'বিক্রয় বাতিল',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api.voidSale(sale.id, 'বিক্রয় তালিকা থেকে বাতিল করা হয়েছে');
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
