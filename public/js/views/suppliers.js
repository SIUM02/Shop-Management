import { api } from '../api.js';
import { canEdit, confirmDialog, empty, esc, formData, int, modal, money, seesCost, toast } from '../ui.js';

export async function render(root, ctx) {
  const rows = await api.suppliers();

  if (canEdit()) {
    ctx.setActions('<button class="btn btn-primary" id="add-btn">＋ Add Supplier</button>')
      .querySelector('#add-btn')
      .addEventListener('click', () => openForm(null, ctx));
  }

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Suppliers</h2>
        <span class="sub">${rows.length} total</span>
      </div>
      <div class="card-body tight">
        ${rows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th class="num">Products</th><th></th></tr></thead>
            <tbody>${rows.map((s) => `
              <tr class="clickable" data-id="${s.id}">
                <td class="cell-main">${esc(s.name)}</td>
                <td class="small">${esc(s.contact_person || '—')}</td>
                <td class="small">${esc(s.phone || '—')}</td>
                <td class="small">${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '—'}</td>
                <td class="num">${int(s.product_count)}</td>
                <td><div class="row-actions">
                  ${canEdit() ? `<button class="btn btn-sm" data-edit="${s.id}">Edit</button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>` : empty('No suppliers yet — add who you buy from', '🚚')}
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
          <tr><td class="muted">Contact</td><td>${esc(s.contact_person || '—')}</td>
              <td class="muted">Phone</td><td>${esc(s.phone || '—')}</td></tr>
          <tr><td class="muted">Email</td><td>${esc(s.email || '—')}</td>
              <td class="muted">Stock value</td><td>${money(value)}</td></tr>
          ${s.address ? `<tr><td class="muted">Address</td><td colspan="3">${esc(s.address)}</td></tr>` : ''}
          ${s.notes ? `<tr><td class="muted">Notes</td><td colspan="3">${esc(s.notes)}</td></tr>` : ''}
        </tbody>
      </table>

      <h3 style="font-size:14px;margin-bottom:10px">Products from this supplier (${s.products.length})</h3>
      ${s.products.length ? `
        <div class="table-wrap" style="max-height:300px;overflow-y:auto"><table>
          <thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Cost</th><th class="num">Value</th></tr></thead>
          <tbody>${s.products.map((p) => `
            <tr>
              <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub mono">${esc(p.sku)}</div></td>
              <td class="num">${int(p.quantity)}</td>
              ${seesCost() ? `<td class="num">${money(p.cost_price)}</td>` : ''}
              ${seesCost() ? `<td class="num">${money(p.quantity * (p.cost_price ?? 0))}</td>` : ''}
            </tr>`).join('')}</tbody>
        </table></div>` : empty('No products linked to this supplier yet', '📦')}`,
    footer: `
      <button class="btn" data-close>Close</button>
      ${canEdit() ? '<button class="btn btn-primary" id="edit-btn">Edit supplier</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#edit-btn')?.addEventListener('click', () => { close(); openForm(s, ctx); });
    },
  });
}

function openForm(supplier, ctx) {
  const s = supplier || {};
  const isEdit = Boolean(supplier);

  modal({
    title: isEdit ? `Edit ${s.name}` : 'Add Supplier',
    body: `
      <form id="sup-form">
        <div class="form-grid">
          <label class="field span-2">
            <span>Supplier name *</span>
            <input name="name" required maxlength="120" value="${esc(s.name || '')}" />
          </label>
          <label class="field">
            <span>Contact person</span>
            <input name="contact_person" maxlength="120" value="${esc(s.contact_person || '')}" />
          </label>
          <label class="field">
            <span>Phone</span>
            <input name="phone" maxlength="40" value="${esc(s.phone || '')}" />
          </label>
          <label class="field span-2">
            <span>Email</span>
            <input name="email" type="email" maxlength="120" value="${esc(s.email || '')}" />
          </label>
          <label class="field span-2">
            <span>Address</span>
            <input name="address" maxlength="300" value="${esc(s.address || '')}" />
          </label>
          <label class="field span-2">
            <span>Notes</span>
            <textarea name="notes" maxlength="1000">${esc(s.notes || '')}</textarea>
          </label>
        </div>
        <div id="sup-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>Cancel</button>
      ${isEdit ? '<button class="btn btn-danger" id="del-btn">Delete</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'Save' : 'Add supplier'}</button>`,
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
          toast(isEdit ? 'Supplier updated' : 'Supplier added');
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
          title: 'Delete supplier?',
          message: `Delete <strong>${esc(s.name)}</strong>? Their products stay in your catalogue but lose the supplier link.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteSupplier(s.id);
          toast('Supplier deleted');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
