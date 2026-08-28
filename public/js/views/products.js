import { api } from '../api.js';
import {
  canEdit, confirmDialog, empty, esc, formData, int, loading, modal,
  money, movementBadge, seesCost, stockBadge, toast, when,
} from '../ui.js';

const filters = { search: '', category_id: '', supplier_id: '', status: '', sort: 'name', dir: 'asc', offset: 0 };
const PAGE = 50;

let categories = [];
let suppliers = [];

export async function render(root, ctx) {
  // Deep links like #/products?status=low come from the dashboard alert.
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  if (query.has('status')) { filters.status = query.get('status'); filters.offset = 0; }

  [categories, suppliers] = await Promise.all([api.categories(), api.suppliers()]);

  const actions = ctx.setActions(`
    <button class="btn" id="export-btn">Export CSV</button>
    ${canEdit() ? '<button class="btn btn-primary" id="add-btn">＋ Add Product</button>' : ''}
  `);

  actions.querySelector('#add-btn')?.addEventListener('click', () => openForm(null, ctx));
  actions.querySelector('#export-btn').addEventListener('click', () => {
    window.location.href = '/api/reports/export/products';
  });

  root.innerHTML = `
    <div class="toolbar">
      <input class="search" id="f-search" type="search" placeholder="Search name, SKU or barcode…" value="${esc(filters.search)}" />
      <select id="f-category">
        <option value="">All categories</option>
        ${categories.map((c) => `<option value="${c.id}" ${filters.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select id="f-supplier">
        <option value="">All suppliers</option>
        ${suppliers.map((s) => `<option value="${s.id}" ${filters.supplier_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
      <select id="f-status">
        <option value="">Any stock level</option>
        <option value="ok"   ${filters.status === 'ok' ? 'selected' : ''}>In stock</option>
        <option value="low"  ${filters.status === 'low' ? 'selected' : ''}>Low stock</option>
        <option value="out"  ${filters.status === 'out' ? 'selected' : ''}>Out of stock</option>
      </select>
      <button class="btn btn-sm" id="f-clear">Clear</button>
    </div>
    <div class="card"><div id="list" class="card-body tight">${loading()}</div></div>`;

  /*
   * Row and button clicks are delegated from #list, which lives for as long as
   * this view does. Binding here rather than inside load() matters: load()
   * only replaces #list's children, so a listener added there survives every
   * reload and stacks up — after three filter changes one click on "Stock"
   * ran the handler seven times, opening and closing the dialog on each pass.
   */
  root.querySelector('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      if (btn.dataset.act === 'edit') openForm(await api.product(id), ctx, root);
      else openStockDialog(await api.product(id), () => load(root, ctx));
      return;
    }
    const row = e.target.closest('tr[data-id]');
    if (row) openDetail(Number(row.dataset.id), ctx, root);
  });

  const search = root.querySelector('#f-search');
  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.search = search.value.trim();
      filters.offset = 0;
      load(root, ctx);
    }, 250);
  });

  for (const [id, key] of [['#f-category', 'category_id'], ['#f-supplier', 'supplier_id'], ['#f-status', 'status']]) {
    root.querySelector(id).addEventListener('change', (e) => {
      filters[key] = e.target.value;
      filters.offset = 0;
      load(root, ctx);
    });
  }

  root.querySelector('#f-clear').addEventListener('click', () => {
    Object.assign(filters, { search: '', category_id: '', supplier_id: '', status: '', offset: 0 });
    location.hash = '#/products';
    render(root, ctx);
  });

  await load(root, ctx);
}

async function load(root, ctx) {
  const box = root.querySelector('#list');
  box.innerHTML = loading();

  const { items, total } = await api.products({ ...filters, limit: PAGE });

  if (!items.length) {
    box.innerHTML = empty(
      filters.search || filters.status || filters.category_id
        ? 'No products match these filters'
        : 'No products yet — add your first one',
      '📦'
    );
    return;
  }

  const editable = canEdit();
  const sortIcon = (key) => (filters.sort === key ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : '');

  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="sortable" data-sort="name">Product${sortIcon('name')}</th>
        <th class="sortable" data-sort="category">Category${sortIcon('category')}</th>
        <th class="num sortable" data-sort="quantity">In stock${sortIcon('quantity')}</th>
        ${seesCost() ? `<th class="num sortable" data-sort="cost_price">Cost${sortIcon('cost_price')}</th>` : ''}
        <th class="num sortable" data-sort="sell_price">Price${sortIcon('sell_price')}</th>
        ${seesCost() ? `<th class="num sortable" data-sort="stock_value">Value${sortIcon('stock_value')}</th>` : ''}
        <th>Status</th>
        <th></th>
      </tr></thead>
      <tbody>${items.map((p) => `
        <tr class="clickable" data-id="${p.id}">
          <td>
            <div class="cell-main">${esc(p.name)}</div>
            <div class="cell-sub mono">${esc(p.sku)}</div>
          </td>
          <td class="small">${esc(p.category_name || '—')}</td>
          <td class="num"><strong>${int(p.quantity)}</strong> <span class="small muted">${esc(p.unit)}</span></td>
          ${seesCost() ? `<td class="num muted">${money(p.cost_price)}</td>` : ''}
          <td class="num">${money(p.sell_price)}</td>
          ${seesCost() ? `<td class="num">${money(p.stock_value)}</td>` : ''}
          <td>${stockBadge(p)}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm" data-act="stock" data-id="${p.id}">Stock</button>
              ${editable ? `<button class="btn btn-sm" data-act="edit" data-id="${p.id}">Edit</button>` : ''}
            </div>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="pager">
      <span>Showing ${filters.offset + 1}–${filters.offset + items.length} of ${int(total)}</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="prev" ${filters.offset === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn btn-sm" id="next" ${filters.offset + PAGE >= total ? 'disabled' : ''}>Next →</button>
    </div>`;

  box.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      filters.dir = filters.sort === key && filters.dir === 'asc' ? 'desc' : 'asc';
      filters.sort = key;
      filters.offset = 0;
      load(root, ctx);
    });
  });

  box.querySelector('#prev')?.addEventListener('click', () => {
    filters.offset = Math.max(0, filters.offset - PAGE);
    load(root, ctx);
  });
  box.querySelector('#next')?.addEventListener('click', () => {
    filters.offset += PAGE;
    load(root, ctx);
  });

}

/* ------------------------------------------------------------ add / edit */

function openForm(product, ctx, root) {
  const p = product || {};
  const isEdit = Boolean(product);

  const close = modal({
    title: isEdit ? `Edit ${p.name}` : 'Add Product',
    large: true,
    body: `
      <form id="product-form">
        <div class="form-grid">
          <label class="field span-2">
            <span>Product name *</span>
            <input name="name" required maxlength="200" value="${esc(p.name || '')}" />
          </label>
          <label class="field">
            <span>SKU * <span class="hint">unique code</span></span>
            <input name="sku" required maxlength="60" value="${esc(p.sku || '')}" />
          </label>
          <label class="field">
            <span>Barcode</span>
            <input name="barcode" maxlength="60" value="${esc(p.barcode || '')}" />
          </label>
          <label class="field">
            <span>Category</span>
            <select name="category_id">
              <option value="">— none —</option>
              ${categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Supplier</span>
            <select name="supplier_id">
              <option value="">— none —</option>
              ${suppliers.map((s) => `<option value="${s.id}" ${p.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Cost price</span>
            <input name="cost_price" type="number" step="0.01" min="0" value="${p.cost_price ?? 0}" />
          </label>
          <label class="field">
            <span>Selling price</span>
            <input name="sell_price" type="number" step="0.01" min="0" value="${p.sell_price ?? 0}" />
          </label>
          ${isEdit ? `
            <div class="field">
              <span>Current stock <span class="hint">change via Stock</span></span>
              <input value="${int(p.quantity)} ${esc(p.unit)}" disabled />
            </div>` : `
            <label class="field">
              <span>Opening quantity</span>
              <input name="quantity" type="number" step="1" min="0" value="0" />
            </label>`}
          <label class="field">
            <span>Reorder level <span class="hint">warn below this</span></span>
            <input name="reorder_level" type="number" step="1" min="0" value="${p.reorder_level ?? 0}" />
          </label>
          <label class="field">
            <span>Unit</span>
            <input name="unit" maxlength="20" value="${esc(p.unit || 'pcs')}" placeholder="pcs, box, kg…" />
          </label>
          <label class="field">
            <span>Shelf / location</span>
            <input name="location" maxlength="100" value="${esc(p.location || '')}" />
          </label>
          <label class="field span-2">
            <span>Description</span>
            <textarea name="description" maxlength="2000">${esc(p.description || '')}</textarea>
          </label>
        </div>
        ${isEdit ? `<label class="check">
          <input type="checkbox" name="active" ${p.active ? 'checked' : ''} />
          <span>Active — uncheck to hide from lists and the sales screen</span>
        </label>` : ''}
        <div id="form-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>Cancel</button>
      ${isEdit && canEdit() ? '<button class="btn btn-danger" id="delete-btn">Delete</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'Save changes' : 'Add product'}</button>`,
    onMount: (el) => {
      const form = el.querySelector('#product-form');
      const errBox = el.querySelector('#form-error');
      const saveBtn = el.querySelector('#save-btn');

      const submit = async (e) => {
        e?.preventDefault();
        const data = formData(form);
        if (!isEdit) data.active = 1;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        errBox.innerHTML = '';
        try {
          if (isEdit) await api.updateProduct(p.id, data);
          else await api.createProduct(data);
          toast(isEdit ? 'Product updated' : `"${data.name}" added`);
          close();
          ctx.refresh();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'Save changes' : 'Add product';
        }
      };

      form.addEventListener('submit', submit);
      saveBtn.addEventListener('click', submit);

      el.querySelector('#delete-btn')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Delete product?',
          message: `Delete <strong>${esc(p.name)}</strong>? If it appears on past sales it will be archived instead so your invoice history stays intact.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api.deleteProduct(p.id);
          toast(res.message || 'Product deleted');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}

/* ------------------------------------------------------------ detail */

async function openDetail(id, ctx, root) {
  const p = await api.product(id);
  const margin = p.sell_price > 0 ? ((p.sell_price - p.cost_price) / p.sell_price) * 100 : 0;

  modal({
    title: p.name,
    large: true,
    body: `
      <div class="grid grid-kpi" style="margin-bottom:18px">
        <div class="card kpi">
          <div class="kpi-label">In stock</div>
          <div class="kpi-value">${int(p.quantity)} <span class="small muted">${esc(p.unit)}</span></div>
          <div class="kpi-sub">${stockBadge(p)}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">Stock value</div>
          <div class="kpi-value">${money(p.stock_value)}</div>
          <div class="kpi-sub">at ${money(p.cost_price)} cost</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">Margin</div>
          <div class="kpi-value">${margin.toFixed(1)}%</div>
          <div class="kpi-sub">${money(p.sell_price - p.cost_price)} per ${esc(p.unit)}</div>
        </div>
      </div>

      <table style="margin-bottom:18px">
        <tbody>
          <tr><td class="muted">SKU</td><td class="mono">${esc(p.sku)}</td>
              <td class="muted">Barcode</td><td class="mono">${esc(p.barcode || '—')}</td></tr>
          <tr><td class="muted">Category</td><td>${esc(p.category_name || '—')}</td>
              <td class="muted">Supplier</td><td>${esc(p.supplier_name || '—')}</td></tr>
          <tr><td class="muted">Reorder at</td><td>${int(p.reorder_level)} ${esc(p.unit)}</td>
              <td class="muted">Location</td><td>${esc(p.location || '—')}</td></tr>
          <tr><td class="muted">Added</td><td>${esc(when(p.created_at, { withTime: false }))}</td>
              <td class="muted">Updated</td><td>${esc(when(p.updated_at, { withTime: false }))}</td></tr>
          ${p.description ? `<tr><td class="muted">Notes</td><td colspan="3">${esc(p.description)}</td></tr>` : ''}
        </tbody>
      </table>

      <h3 style="font-size:14px;margin-bottom:10px">Stock history</h3>
      ${p.movements.length ? `
        <div class="table-wrap" style="max-height:280px;overflow-y:auto">
          <table>
            <thead><tr><th>When</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Reference</th></tr></thead>
            <tbody>${p.movements.map((m) => `
              <tr>
                <td class="small nowrap">${esc(when(m.created_at))}</td>
                <td>${movementBadge(m.type)}</td>
                <td class="num ${m.quantity >= 0 ? 'text-ok' : 'text-danger'}">${m.quantity >= 0 ? '+' : ''}${int(m.quantity)}</td>
                <td class="num">${int(m.after_qty)}</td>
                <td class="small muted">${esc(m.reference || m.note || '—')}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : empty('No stock movements recorded', '⇅')}`,
    footer: `
      <button class="btn" data-close>Close</button>
      <button class="btn" id="d-stock">Adjust stock</button>
      ${canEdit() ? '<button class="btn btn-primary" id="d-edit">Edit product</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#d-edit')?.addEventListener('click', () => { close(); openForm(p, ctx, root); });
      el.querySelector('#d-stock')?.addEventListener('click', () => { close(); openStockDialog(p, () => ctx.refresh()); });
    },
  });
}

/* ------------------------------------------------------------ stock dialog */

export function openStockDialog(product, onDone) {
  modal({
    title: `Stock — ${product.name}`,
    body: `
      <div class="alert alert-info">
        Currently <strong>${int(product.quantity)} ${esc(product.unit)}</strong> in stock.
      </div>
      <form id="stock-form">
        <label class="field">
          <span>What are you recording?</span>
          <select name="mode">
            <option value="in">Stock in — received a delivery</option>
            <option value="out">Stock out — damage, loss or internal use</option>
            <option value="adjust">Stocktake — set the counted quantity</option>
          </select>
        </label>
        <div class="form-grid">
          <label class="field">
            <span id="qty-label">Quantity received</span>
            <input name="quantity" type="number" step="1" min="1" required value="1" />
          </label>
          <label class="field" id="cost-field">
            <span>Unit cost <span class="hint">optional, updates cost price</span></span>
            <input name="unit_cost" type="number" step="0.01" min="0" placeholder="${product.cost_price}" />
          </label>
          <label class="field span-2">
            <span>Reference <span class="hint">invoice or PO number</span></span>
            <input name="reference" maxlength="100" placeholder="e.g. PO-1043" />
          </label>
          <label class="field span-2">
            <span id="note-label">Note</span>
            <input name="note" maxlength="500" />
          </label>
        </div>
        <div id="stock-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="stock-save">Record</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#stock-form');
      const mode = form.elements.mode;
      const qty = form.elements.quantity;
      const errBox = el.querySelector('#stock-error');
      const btn = el.querySelector('#stock-save');

      const sync = () => {
        const m = mode.value;
        el.querySelector('#qty-label').textContent =
          m === 'in' ? 'Quantity received' : m === 'out' ? 'Quantity removed' : 'Counted quantity on shelf';
        el.querySelector('#note-label').textContent = m === 'adjust' ? 'Reason *' : 'Note';
        el.querySelector('#cost-field').hidden = m !== 'in';
        qty.min = m === 'adjust' ? '0' : '1';
        if (m === 'adjust') qty.value = product.quantity;
      };
      mode.addEventListener('change', sync);
      sync();

      const submit = async (e) => {
        e?.preventDefault();
        const data = formData(form);
        const payload = {
          product_id: product.id,
          quantity: data.quantity,
          reference: data.reference,
          note: data.note,
        };

        btn.disabled = true;
        btn.textContent = 'Saving…';
        errBox.innerHTML = '';
        try {
          if (data.mode === 'in') await api.stockIn({ ...payload, unit_cost: data.unit_cost });
          else if (data.mode === 'out') await api.stockOut(payload);
          else await api.stockAdjust(payload);

          toast('Stock updated');
          close();
          onDone?.();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'Record';
        }
      };

      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);
    },
  });
}
