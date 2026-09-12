import { api } from '../api.js';
import { canEdit, confirmDialog, empty, esc, formData, int, modal, toast } from '../ui.js';

export async function render(root, ctx) {
  const rows = await api.categories();

  if (canEdit()) {
    ctx.setActions('<button class="btn btn-primary" id="add-btn">＋ ক্যাটাগরি যোগ করুন</button>')
      .querySelector('#add-btn')
      .addEventListener('click', () => openForm(null, ctx));
  }

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>ক্যাটাগরি</h2>
        <span class="sub">মোট ${rows.length}টি</span>
      </div>
      <div class="card-body tight">
        ${rows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>নাম</th><th>বিবরণ</th><th class="num">পণ্য</th><th></th></tr></thead>
            <tbody>${rows.map((c) => `
              <tr>
                <td class="cell-main">${esc(c.name)}</td>
                <td class="small muted">${esc(c.description || '—')}</td>
                <td class="num">${int(c.product_count)}</td>
                <td><div class="row-actions">
                  <a class="btn btn-sm" href="#/products?category=${c.id}">দেখুন</a>
                  ${canEdit() ? `<button class="btn btn-sm" data-edit="${c.id}">সম্পাদনা</button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>` : empty('এখনও কোনো ক্যাটাগরি নেই — দ্রুত খুঁজে পেতে পণ্য ভাগ করে রাখুন', '🏷')}
      </div>
    </div>`;

  root.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () =>
      openForm(rows.find((c) => c.id === Number(b.dataset.edit)), ctx)));
}

function openForm(category, ctx) {
  const c = category || {};
  const isEdit = Boolean(category);

  modal({
    title: isEdit ? `${c.name} সম্পাদনা` : 'ক্যাটাগরি যোগ করুন',
    body: `
      <form id="cat-form">
        <label class="field">
          <span>নাম *</span>
          <input name="name" required maxlength="100" value="${esc(c.name || '')}" />
        </label>
        <label class="field">
          <span>বিবরণ</span>
          <textarea name="description" maxlength="500">${esc(c.description || '')}</textarea>
        </label>
        <div id="cat-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      ${isEdit ? '<button class="btn btn-danger" id="del-btn">মুছে ফেলুন</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'সংরক্ষণ' : 'ক্যাটাগরি যোগ করুন'}</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#cat-form');
      const errBox = el.querySelector('#cat-error');
      const btn = el.querySelector('#save-btn');

      const submit = async (e) => {
        e?.preventDefault();
        btn.disabled = true;
        errBox.innerHTML = '';
        try {
          const data = formData(form);
          if (isEdit) await api.updateCategory(c.id, data);
          else await api.createCategory(data);
          toast(isEdit ? 'ক্যাটাগরি হালনাগাদ হয়েছে' : 'ক্যাটাগরি যোগ হয়েছে');
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
          title: 'ক্যাটাগরি মুছে ফেলবেন?',
          message: c.product_count
            ? `<strong>${esc(c.name)}</strong> ${c.product_count}টি পণ্যে ব্যবহৃত হচ্ছে। পণ্যগুলো থেকে যাবে, তবে ক্যাটাগরিহীন হয়ে যাবে।`
            : `<strong>${esc(c.name)}</strong> মুছে ফেলবেন?`,
          confirmLabel: 'মুছে ফেলুন',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteCategory(c.id);
          toast('ক্যাটাগরি মুছে ফেলা হয়েছে');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
