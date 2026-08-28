import { api } from '../api.js';
import { canEdit, confirmDialog, empty, esc, formData, int, modal, toast } from '../ui.js';

export async function render(root, ctx) {
  const rows = await api.categories();

  if (canEdit()) {
    ctx.setActions('<button class="btn btn-primary" id="add-btn">＋ Add Category</button>')
      .querySelector('#add-btn')
      .addEventListener('click', () => openForm(null, ctx));
  }

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Categories</h2>
        <span class="sub">${rows.length} total</span>
      </div>
      <div class="card-body tight">
        ${rows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Description</th><th class="num">Products</th><th></th></tr></thead>
            <tbody>${rows.map((c) => `
              <tr>
                <td class="cell-main">${esc(c.name)}</td>
                <td class="small muted">${esc(c.description || '—')}</td>
                <td class="num">${int(c.product_count)}</td>
                <td><div class="row-actions">
                  <a class="btn btn-sm" href="#/products?category=${c.id}">View</a>
                  ${canEdit() ? `<button class="btn btn-sm" data-edit="${c.id}">Edit</button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>` : empty('No categories yet — group your products to find them faster', '🏷')}
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
    title: isEdit ? `Edit ${c.name}` : 'Add Category',
    body: `
      <form id="cat-form">
        <label class="field">
          <span>Name *</span>
          <input name="name" required maxlength="100" value="${esc(c.name || '')}" />
        </label>
        <label class="field">
          <span>Description</span>
          <textarea name="description" maxlength="500">${esc(c.description || '')}</textarea>
        </label>
        <div id="cat-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>Cancel</button>
      ${isEdit ? '<button class="btn btn-danger" id="del-btn">Delete</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'Save' : 'Add category'}</button>`,
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
          toast(isEdit ? 'Category updated' : 'Category added');
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
          title: 'Delete category?',
          message: c.product_count
            ? `<strong>${esc(c.name)}</strong> is used by ${c.product_count} product(s). They will stay, but become uncategorised.`
            : `Delete <strong>${esc(c.name)}</strong>?`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteCategory(c.id);
          toast('Category deleted');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
