import { api } from '../api.js';
import {
  canEdit, confirmDialog, empty, esc, formData, int, loading, modal, money, toast, when,
} from '../ui.js';
import { paymentLabel, PAYMENT_LABELS } from './pos.js';

const filters = { search: '', due: '' };

export async function render(root, ctx) {
  const actions = ctx.setActions(
    canEdit() ? '<button class="btn btn-primary" id="add-btn">＋ ক্রেতা যোগ করুন</button>' : ''
  );
  actions.querySelector('#add-btn')?.addEventListener('click', () => openForm(null, ctx));

  root.innerHTML = `
    <div class="toolbar">
      <input class="search" id="f-search" type="search" placeholder="নাম বা ফোন দিয়ে খুঁজুন…" value="${esc(filters.search)}" />
      <select id="f-due">
        <option value="">সব ক্রেতা</option>
        <option value="1" ${filters.due === '1' ? 'selected' : ''}>শুধু যাদের বাকি আছে</option>
      </select>
      <button class="btn btn-sm" id="f-clear">মুছুন</button>
    </div>
    <div id="summary"></div>
    <div class="card"><div class="card-body tight" id="list">${loading()}</div></div>`;

  let debounce;
  root.querySelector('#f-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { filters.search = e.target.value.trim(); load(root, ctx); }, 250);
  });
  root.querySelector('#f-due').addEventListener('change', (e) => {
    filters.due = e.target.value;
    load(root, ctx);
  });
  root.querySelector('#f-clear').addEventListener('click', () => {
    Object.assign(filters, { search: '', due: '' });
    render(root, ctx);
  });

  // Delegated, so reloading the list cannot stack duplicate handlers.
  root.querySelector('#list').addEventListener('click', (e) => {
    const pay = e.target.closest('button[data-pay]');
    if (pay) {
      e.stopPropagation();
      openPayment(Number(pay.dataset.pay), ctx);
      return;
    }
    const row = e.target.closest('tr[data-id]');
    if (row) openDetail(Number(row.dataset.id), ctx);
  });

  await load(root, ctx);
}

async function load(root, ctx) {
  const box = root.querySelector('#list');
  box.innerHTML = loading();

  const { items, totals } = await api.customers(filters);

  root.querySelector('#summary').innerHTML = totals.due > 0 ? `
    <div class="alert alert-warn">
      <strong>${int(totals.owing)} জন ক্রেতার কাছে মোট ${money(totals.due)} বাকি আছে।</strong>
      মোট ${int(totals.customers)} জন ক্রেতা তালিকায় আছেন।
    </div>` : `
    <div class="alert alert-info">
      মোট ${int(totals.customers)} জন ক্রেতা — কারও কোনো বাকি নেই।
    </div>`;

  if (!items.length) {
    box.innerHTML = empty(
      filters.search || filters.due
        ? 'এই খোঁজে কোনো ক্রেতা মেলেনি'
        : 'এখনও কোনো ক্রেতা নেই — বাকিতে বিক্রি করতে ক্রেতা যোগ করুন',
      '🧑'
    );
    return;
  }

  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>ক্রেতা আইডি</th><th>নাম</th><th>ফোন</th>
        <th class="num">চালান</th><th class="num">মোট বিল</th>
        <th class="num">পরিশোধ</th><th class="num">বাকি</th><th></th>
      </tr></thead>
      <tbody>${items.map((c) => `
        <tr class="clickable" data-id="${c.id}">
          <td class="mono">${custId(c.id)}</td>
          <td>
            <div class="cell-main">${esc(c.name)}</div>
            ${c.address ? `<div class="cell-sub">${esc(c.address)}</div>` : ''}
          </td>
          <td class="small">${esc(c.phone || '—')}</td>
          <td class="num">${int(c.sale_count)}</td>
          <td class="num">${money(c.billed)}</td>
          <td class="num muted">${money(c.paid)}</td>
          <td class="num">${dueBadge(c.due)}</td>
          <td><div class="row-actions">
            ${c.due > 0 ? `<button class="btn btn-sm btn-primary" data-pay="${c.id}">টাকা জমা</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
      <tfoot><tr>
        <td colspan="4">মোট</td>
        <td class="num">${money(items.reduce((a, c) => a + c.billed, 0))}</td>
        <td class="num">${money(items.reduce((a, c) => a + c.paid, 0))}</td>
        <td class="num"><strong>${money(items.reduce((a, c) => a + c.due, 0))}</strong></td>
        <td></td>
      </tr></tfoot>
    </table></div>`;
}

/** A stable, readable account number the shop can say out loud. */
export const custId = (id) => `C-${String(id).padStart(4, '0')}`;

const dueBadge = (due) => (due > 0.005
  ? `<strong class="text-danger">${money(due)}</strong>`
  : '<span class="badge badge-ok">পরিশোধিত</span>');

/* ------------------------------------------------------------------ detail */

async function openDetail(id, ctx) {
  const c = await api.customer(id);

  modal({
    title: `${c.name} · ${custId(c.id)}`,
    large: true,
    body: `
      <div class="grid grid-kpi" style="margin-bottom:18px">
        <div class="card kpi">
          <div class="kpi-label">মোট বিল</div>
          <div class="kpi-value">${money(c.billed)}</div>
          <div class="kpi-sub">${c.sales.length}টি চালান</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">পরিশোধ</div>
          <div class="kpi-value">${money(c.paid)}</div>
          <div class="kpi-sub">${c.payments.length}টি জমা</div>
        </div>
        <div class="card kpi ${c.due > 0.005 ? 'kpi-tint-danger' : 'kpi-tint-ok'}">
          <div class="kpi-label">বাকি</div>
          <div class="kpi-value">${money(c.due)}</div>
          <div class="kpi-sub">${c.due > 0.005 ? 'এখনও পাওনা' : 'সব মিটে গেছে'}</div>
        </div>
      </div>

      <table style="margin-bottom:18px"><tbody>
        <tr><td class="muted">ক্রেতা আইডি</td><td class="mono">${custId(c.id)}</td>
            <td class="muted">ফোন</td><td>${esc(c.phone || '—')}</td></tr>
        <tr><td class="muted">ঠিকানা</td><td colspan="3">${esc(c.address || '—')}</td></tr>
        ${c.note ? `<tr><td class="muted">নোট</td><td colspan="3">${esc(c.note)}</td></tr>` : ''}
      </tbody></table>

      <h3 style="font-size:14px;margin-bottom:10px">চালান</h3>
      ${c.sales.length ? `
        <div class="table-wrap" style="max-height:230px;overflow-y:auto"><table>
          <thead><tr><th>চালান</th><th>তারিখ</th><th class="num">মোট</th><th class="num">পরিশোধ</th><th class="num">বাকি</th><th>অবস্থা</th></tr></thead>
          <tbody>${c.sales.map((s) => `
            <tr>
              <td class="mono">${esc(s.invoice_no)}</td>
              <td class="small nowrap">${esc(when(s.created_at, { withTime: false }))}</td>
              <td class="num">${money(s.total)}</td>
              <td class="num muted">${money(s.paid_amount)}</td>
              <td class="num">${s.status === 'voided' ? '—' : dueBadge(s.due)}</td>
              <td>${s.status === 'voided'
                ? '<span class="badge badge-danger">বাতিল</span>'
                : '<span class="badge badge-muted">' + esc(paymentLabel(s.payment_method)) + '</span>'}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : empty('কোনো চালান নেই', '🧾')}

      <h3 style="font-size:14px;margin:18px 0 10px">জমার হিসাব</h3>
      ${c.payments.length ? `
        <div class="table-wrap" style="max-height:200px;overflow-y:auto"><table>
          <thead><tr><th>তারিখ</th><th class="num">টাকা</th><th>মাধ্যম</th><th>চালান</th><th>নোট</th><th>কে নিয়েছেন</th></tr></thead>
          <tbody>${c.payments.map((p) => `
            <tr>
              <td class="small nowrap">${esc(when(p.created_at))}</td>
              <td class="num text-ok"><strong>${money(p.amount)}</strong></td>
              <td class="small">${esc(paymentLabel(p.method))}</td>
              <td class="small mono">${esc(p.invoice_no || '—')}</td>
              <td class="small muted">${esc(p.note || '—')}</td>
              <td class="small muted">${esc(p.username || '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : empty('এখনও কোনো জমা হয়নি', '💵')}`,
    footer: `
      <button class="btn" data-close>বন্ধ</button>
      ${canEdit() ? `<button class="btn" id="d-edit">সম্পাদনা</button>` : ''}
      ${c.due > 0.005 ? '<button class="btn btn-primary" id="d-pay">টাকা জমা নিন</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#d-edit')?.addEventListener('click', () => { close(); openForm(c, ctx); });
      el.querySelector('#d-pay')?.addEventListener('click', () => { close(); openPayment(c.id, ctx); });
    },
  });
}

/* ----------------------------------------------------------------- payment */

async function openPayment(id, ctx) {
  const c = await api.customer(id);
  const unpaid = c.sales.filter((s) => s.status === 'completed' && s.due > 0.005);

  modal({
    title: `টাকা জমা — ${c.name}`,
    body: `
      <div class="alert alert-warn">
        <strong>${custId(c.id)}</strong> · বর্তমানে বাকি <strong>${money(c.due)}</strong>
      </div>
      <form id="pay-form">
        <div class="form-grid">
          <label class="field">
            <span>কত টাকা জমা নিচ্ছেন? *</span>
            <input name="amount" type="number" step="0.01" min="0.01" max="${c.due}"
                   value="${c.due}" required autofocus />
          </label>
          <label class="field">
            <span>মাধ্যম</span>
            <select name="method">
              ${Object.entries(PAYMENT_LABELS)
                .filter(([m]) => m !== 'credit')
                .map(([m, label]) => `<option value="${m}">${label}</option>`).join('')}
            </select>
          </label>
          ${unpaid.length ? `
            <label class="field span-2">
              <span>কোন চালানের বিপরীতে? <span class="hint">ঐচ্ছিক</span></span>
              <select name="sale_id">
                <option value="">— সাধারণ জমা —</option>
                ${unpaid.map((s) => `<option value="${s.id}">${esc(s.invoice_no)} · বাকি ${money(s.due)}</option>`).join('')}
              </select>
            </label>` : ''}
          <label class="field span-2">
            <span>নোট</span>
            <input name="note" maxlength="300" />
          </label>
        </div>
        <div id="pay-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      <button class="btn btn-primary" id="pay-save">জমা নিন</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#pay-form');
      const errBox = el.querySelector('#pay-error');
      const btn = el.querySelector('#pay-save');

      const submit = async (e) => {
        e?.preventDefault();
        btn.disabled = true;
        btn.textContent = 'জমা হচ্ছে…';
        errBox.innerHTML = '';
        try {
          const data = formData(form);
          const res = await api.payCustomer(c.id, {
            amount: data.amount,
            method: data.method,
            note: data.note,
            sale_id: data.sale_id || null,
          });
          toast(`${money(data.amount)} জমা হয়েছে · বাকি ${money(res.due)}`);
          close();
          ctx.refresh();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'জমা নিন';
        }
      };

      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);
    },
  });
}

/* -------------------------------------------------------------- add / edit */

function openForm(customer, ctx) {
  const c = customer || {};
  const isEdit = Boolean(customer);

  modal({
    title: isEdit ? `${c.name} সম্পাদনা` : 'ক্রেতা যোগ করুন',
    body: `
      <form id="cust-form">
        <div class="form-grid">
          <label class="field span-2">
            <span>ক্রেতার নাম *</span>
            <input name="name" required maxlength="120" value="${esc(c.name || '')}" />
          </label>
          <label class="field">
            <span>ফোন</span>
            <input name="phone" maxlength="40" value="${esc(c.phone || '')}" />
          </label>
          <label class="field">
            <span>ঠিকানা</span>
            <input name="address" maxlength="200" value="${esc(c.address || '')}" />
          </label>
          <label class="field span-2">
            <span>নোট</span>
            <input name="note" maxlength="500" value="${esc(c.note || '')}" />
          </label>
        </div>
        <div id="cust-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      ${isEdit && canEdit() ? '<button class="btn btn-danger" id="del-btn">মুছে ফেলুন</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'সংরক্ষণ' : 'যোগ করুন'}</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#cust-form');
      const errBox = el.querySelector('#cust-error');
      const btn = el.querySelector('#save-btn');

      const submit = async (e) => {
        e?.preventDefault();
        btn.disabled = true;
        errBox.innerHTML = '';
        try {
          const data = formData(form);
          if (isEdit) await api.updateCustomer(c.id, data);
          else await api.createCustomer(data);
          toast(isEdit ? 'ক্রেতার তথ্য হালনাগাদ হয়েছে' : `"${data.name}" যোগ করা হয়েছে`);
          close();
          ctx.refresh();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          btn.disabled = false;
        }
      };

      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);

      el.querySelector('#del-btn')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'ক্রেতা মুছে ফেলবেন?',
          message: `<strong>${esc(c.name)}</strong> মুছে ফেলবেন? তাঁর চালান থাকলে তালিকা থেকে সরানো হবে, কিন্তু হিসাব মুছবে না।`,
          confirmLabel: 'মুছে ফেলুন',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api.deleteCustomer(c.id);
          toast(res.message);
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
