import { api } from '../api.js';
import { canEdit, confirmDialog, empty, esc, formData, int, modal, money, seesCost, toast } from '../ui.js';

export async function render(root, ctx) {
  const rows = await api.suppliers();

  if (canEdit()) {
    ctx.setActions('<button class="btn btn-primary" id="add-btn">＋ সরবরাহকারী যোগ করুন</button>')
      .querySelector('#add-btn')
      .addEventListener('click', () => openForm(null, ctx));
  }

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>সরবরাহকারী</h2>
        <span class="sub">মোট ${rows.length}টি</span>
      </div>
      <div class="card-body tight">
        ${rows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>সরবরাহকারী</th><th>যোগাযোগ</th><th>ফোন</th><th>ইমেইল</th><th class="num">পণ্য</th><th></th></tr></thead>
            <tbody>${rows.map((s) => `
              <tr class="clickable" data-id="${s.id}">
                <td class="cell-main">${esc(s.name)}</td>
                <td class="small">${esc(s.contact_person || '—')}</td>
                <td class="small">${esc(s.phone || '—')}</td>
                <td class="small">${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '—'}</td>
                <td class="num">${int(s.product_count)}</td>
                <td><div class="row-actions">
                  ${canEdit() ? `<button class="btn btn-sm" data-edit="${s.id}">সম্পাদনা</button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>` : empty('এখনও কোনো সরবরাহকারী নেই — যাদের কাছ থেকে কেনেন তাদের যোগ করুন', '🚚')}
      </div>
    </div>`;

  root.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openForm(rows.find((s) => s.id === Number(b.dataset.edit)), ctx);
    }));

  root.querySelectorAll('tr[data-id]').forEach((row) =>
    row.addEventListener('click', () => openDetail(Number(row.dataset.id), ctx)));
}

async function openDetail(id, ctx) {
  const s = await api.supplier(id);
  const value = s.products.reduce((a, p) => a + p.quantity * (p.cost_price ?? 0), 0);

  modal({
    title: s.name,
    large: true,
    body: `
      <table style="margin-bottom:18px">
        <tbody>
          <tr><td class="muted">যোগাযোগ</td><td>${esc(s.contact_person || '—')}</td>
              <td class="muted">ফোন</td><td>${esc(s.phone || '—')}</td></tr>
          <tr><td class="muted">ইমেইল</td><td>${esc(s.email || '—')}</td>
              <td class="muted">স্টকের মূল্য</td><td>${money(value)}</td></tr>
          ${s.address ? `<tr><td class="muted">ঠিকানা</td><td colspan="3">${esc(s.address)}</td></tr>` : ''}
          ${s.notes ? `<tr><td class="muted">নোট</td><td colspan="3">${esc(s.notes)}</td></tr>` : ''}
        </tbody>
      </table>

      <h3 style="font-size:14px;margin-bottom:10px">এই সরবরাহকারীর পণ্য (${s.products.length}টি)</h3>
      ${s.products.length ? `
        <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table>
          <thead><tr><th>পণ্য</th><th class="num">স্টকে</th><th class="num">ক্রয়মূল্য</th><th class="num">মূল্যমান</th></tr></thead>
          <tbody>${s.products.map((p) => `
            <tr>
              <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub mono">${esc(p.sku)}</div></td>
              <td class="num">${int(p.quantity)}</td>
              ${seesCost() ? `<td class="num">${money(p.cost_price)}</td>` : ''}
              ${seesCost() ? `<td class="num">${money(p.quantity * (p.cost_price ?? 0))}</td>` : ''}
            </tr>`).join('')}</tbody>
        </table></div>` : empty('এই সরবরাহকারীর সাথে এখনও কোনো পণ্য যুক্ত নেই', '📦')}`,
    footer: `
      <button class="btn" data-close>বন্ধ</button>
      ${canEdit() ? '<button class="btn btn-primary" id="edit-btn">সরবরাহকারী সম্পাদনা</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#edit-btn')?.addEventListener('click', () => { close(); openForm(s, ctx); });
    },
  });
}

function openForm(supplier, ctx) {
  const s = supplier || {};
  const isEdit = Boolean(supplier);

  modal({
    title: isEdit ? `${s.name} সম্পাদনা` : 'সরবরাহকারী যোগ করুন',
    body: `
      <form id="sup-form">
        <div class="form-grid">
          <label class="field span-2">
            <span>সরবরাহকারীর নাম *</span>
            <input name="name" required maxlength="120" value="${esc(s.name || '')}" />
          </label>
          <label class="field">
            <span>যোগাযোগকারী ব্যক্তি</span>
            <input name="contact_person" maxlength="120" value="${esc(s.contact_person || '')}" />
          </label>
          <label class="field">
            <span>ফোন</span>
            <input name="phone" maxlength="40" value="${esc(s.phone || '')}" />
          </label>
          <label class="field span-2">
            <span>ইমেইল</span>
            <input name="email" type="email" maxlength="120" value="${esc(s.email || '')}" />
          </label>
          <label class="field span-2">
            <span>ঠিকানা</span>
            <input name="address" maxlength="300" value="${esc(s.address || '')}" />
          </label>
          <label class="field span-2">
            <span>নোট</span>
            <textarea name="notes" maxlength="1000">${esc(s.notes || '')}</textarea>
          </label>
        </div>
        <div id="sup-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      ${isEdit ? '<button class="btn btn-danger" id="del-btn">মুছে ফেলুন</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'সংরক্ষণ' : 'সরবরাহকারী যোগ করুন'}</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#sup-form');
      const errBox = el.querySelector('#sup-error');
      const btn = el.querySelector('#save-btn');

      const submit = async (e) => {
        e?.preventDefault();
        btn.disabled = true;
        errBox.innerHTML = '';
        try {
          const data = formData(form);
          if (isEdit) await api.updateSupplier(s.id, data);
          else await api.createSupplier(data);
          toast(isEdit ? 'সরবরাহকারী হালনাগাদ হয়েছে' : 'সরবরাহকারী যোগ হয়েছে');
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
          title: 'সরবরাহকারী মুছে ফেলবেন?',
          message: `<strong>${esc(s.name)}</strong> মুছে ফেলবেন? তাদের পণ্য আপনার ক্যাটালগে থাকবে, তবে সরবরাহকারীর সংযোগ হারাবে।`,
          confirmLabel: 'মুছে ফেলুন',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteSupplier(s.id);
          toast('সরবরাহকারী মুছে ফেলা হয়েছে');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
