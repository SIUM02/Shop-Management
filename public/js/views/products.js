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
    <button class="btn" id="export-btn">CSV এক্সপোর্ট</button>
    ${canEdit() ? '<button class="btn btn-primary" id="add-btn">＋ পণ্য যোগ করুন</button>' : ''}
  `);

  actions.querySelector('#add-btn')?.addEventListener('click', () => openForm(null, ctx));
  actions.querySelector('#export-btn').addEventListener('click', () => {
    window.location.href = '/api/reports/export/products';
  });

  root.innerHTML = `
    <div class="toolbar">
      <input class="search" id="f-search" type="search" placeholder="নাম, SKU বা বারকোড দিয়ে খুঁজুন…" value="${esc(filters.search)}" />
      <select id="f-category">
        <option value="">সব ক্যাটাগরি</option>
        ${categories.map((c) => `<option value="${c.id}" ${filters.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select id="f-supplier">
        <option value="">সব সরবরাহকারী</option>
        ${suppliers.map((s) => `<option value="${s.id}" ${filters.supplier_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
      <select id="f-status">
        <option value="">যেকোনো স্টক অবস্থা</option>
        <option value="ok"   ${filters.status === 'ok' ? 'selected' : ''}>স্টকে আছে</option>
        <option value="low"  ${filters.status === 'low' ? 'selected' : ''}>স্টক কম</option>
        <option value="out"  ${filters.status === 'out' ? 'selected' : ''}>স্টক শেষ</option>
      </select>
      <button class="btn btn-sm" id="f-clear">মুছুন</button>
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
        ? 'এই ফিল্টারে কোনো পণ্য মেলেনি'
        : 'এখনও কোনো পণ্য নেই — প্রথমটি যোগ করুন',
      '📦'
    );
    return;
  }

  const editable = canEdit();
  const sortIcon = (key) => (filters.sort === key ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : '');

  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="sortable" data-sort="name">পণ্য${sortIcon('name')}</th>
        <th class="sortable" data-sort="category">ক্যাটাগরি${sortIcon('category')}</th>
        <th class="num sortable" data-sort="quantity">স্টকে${sortIcon('quantity')}</th>
        ${seesCost() ? `<th class="num sortable" data-sort="cost_price">ক্রয়মূল্য${sortIcon('cost_price')}</th>` : ''}
        <th class="num sortable" data-sort="sell_price">বিক্রয়মূল্য${sortIcon('sell_price')}</th>
        ${seesCost() ? `<th class="num sortable" data-sort="stock_value">মূল্যমান${sortIcon('stock_value')}</th>` : ''}
        <th>অবস্থা</th>
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
              <button class="btn btn-sm" data-act="stock" data-id="${p.id}">স্টক</button>
              ${editable ? `<button class="btn btn-sm" data-act="edit" data-id="${p.id}">সম্পাদনা</button>` : ''}
            </div>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="pager">
      <span>${int(total)}টির মধ্যে ${filters.offset + 1}–${filters.offset + items.length} দেখানো হচ্ছে</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="prev" ${filters.offset === 0 ? 'disabled' : ''}>← আগের</button>
      <button class="btn btn-sm" id="next" ${filters.offset + PAGE >= total ? 'disabled' : ''}>পরের →</button>
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
    title: isEdit ? `${p.name} সম্পাদনা` : 'পণ্য যোগ করুন',
    large: true,
    body: `
      <form id="product-form">
        <div class="form-grid">
          <label class="field span-2">
            <span>পণ্যের নাম *</span>
            <input name="name" required maxlength="200" value="${esc(p.name || '')}" />
          </label>
          <label class="field">
            <span>SKU * <span class="hint">অদ্বিতীয় কোড</span></span>
            <input name="sku" required maxlength="60" value="${esc(p.sku || '')}" />
          </label>
          <label class="field">
            <span>বারকোড</span>
            <input name="barcode" maxlength="60" value="${esc(p.barcode || '')}" />
          </label>
          <label class="field">
            <span>ক্যাটাগরি</span>
            <select name="category_id">
              <option value="">— কোনোটি নয় —</option>
              ${categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>সরবরাহকারী</span>
            <select name="supplier_id">
              <option value="">— কোনোটি নয় —</option>
              ${suppliers.map((s) => `<option value="${s.id}" ${p.supplier_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>ক্রয়মূল্য</span>
            <input name="cost_price" type="number" step="0.01" min="0" value="${p.cost_price ?? 0}" />
          </label>
          <label class="field">
            <span>বিক্রয়মূল্য</span>
            <input name="sell_price" type="number" step="0.01" min="0" value="${p.sell_price ?? 0}" />
          </label>
          ${isEdit ? `
            <div class="field">
              <span>বর্তমান স্টক <span class="hint">স্টক থেকে পরিবর্তন করুন</span></span>
              <input value="${int(p.quantity)} ${esc(p.unit)}" disabled />
            </div>` : `
            <label class="field">
              <span>প্রারম্ভিক পরিমাণ</span>
              <input name="quantity" type="number" step="1" min="0" value="0" />
            </label>`}
          <label class="field">
            <span>পুনঃক্রয় সীমা <span class="hint">এর নিচে নামলে সতর্ক করবে</span></span>
            <input name="reorder_level" type="number" step="1" min="0" value="${p.reorder_level ?? 0}" />
          </label>
          <label class="field">
            <span>একক</span>
            <input name="unit" maxlength="20" value="${esc(p.unit || 'পিস')}" placeholder="পিস, বক্স, কেজি…" />
          </label>
          <label class="field">
            <span>তাক / অবস্থান</span>
            <input name="location" maxlength="100" value="${esc(p.location || '')}" />
          </label>
          <label class="field span-2">
            <span>বিবরণ</span>
            <textarea name="description" maxlength="2000">${esc(p.description || '')}</textarea>
          </label>
        </div>
        ${isEdit ? `<label class="check">
          <input type="checkbox" name="active" ${p.active ? 'checked' : ''} />
          <span>সক্রিয় — টিক তুলে দিলে তালিকা ও বিক্রয় পর্দা থেকে লুকানো থাকবে</span>
        </label>` : ''}
        <div id="form-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      ${isEdit && canEdit() ? '<button class="btn btn-danger" id="delete-btn">মুছে ফেলুন</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'পরিবর্তন সংরক্ষণ' : 'পণ্য যোগ করুন'}</button>`,
    onMount: (el) => {
      const form = el.querySelector('#product-form');
      const errBox = el.querySelector('#form-error');
      const saveBtn = el.querySelector('#save-btn');

      const submit = async (e) => {
        e?.preventDefault();
        const data = formData(form);
        if (!isEdit) data.active = 1;

        saveBtn.disabled = true;
        saveBtn.textContent = 'সংরক্ষণ হচ্ছে…';
        errBox.innerHTML = '';
        try {
          if (isEdit) await api.updateProduct(p.id, data);
          else await api.createProduct(data);
          toast(isEdit ? 'পণ্য হালনাগাদ হয়েছে' : `"${data.name}" যোগ করা হয়েছে`);
          close();
          ctx.refresh();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'পরিবর্তন সংরক্ষণ' : 'পণ্য যোগ করুন';
        }
      };

      form.addEventListener('submit', submit);
      saveBtn.addEventListener('click', submit);

      el.querySelector('#delete-btn')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'পণ্যটি মুছে ফেলবেন?',
          message: `<strong>${esc(p.name)}</strong> মুছে ফেলবেন? পুরনো কোনো বিক্রয়ে থাকলে এটি মোছার বদলে সংরক্ষণাগারে রাখা হবে, যাতে চালানের ইতিহাস অক্ষত থাকে।`,
          confirmLabel: 'মুছে ফেলুন',
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await api.deleteProduct(p.id);
          toast(res.message || 'পণ্য মুছে ফেলা হয়েছে');
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
          <div class="kpi-label">স্টকে</div>
          <div class="kpi-value">${int(p.quantity)} <span class="small muted">${esc(p.unit)}</span></div>
          <div class="kpi-sub">${stockBadge(p)}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">স্টকের মূল্য</div>
          <div class="kpi-value">${money(p.stock_value)}</div>
          <div class="kpi-sub">${money(p.cost_price)} ক্রয়মূল্যে</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">মার্জিন</div>
          <div class="kpi-value">${margin.toFixed(1)}%</div>
          <div class="kpi-sub">প্রতি ${esc(p.unit)}-এ ${money(p.sell_price - p.cost_price)}</div>
        </div>
      </div>

      <table style="margin-bottom:18px">
        <tbody>
          <tr><td class="muted">SKU</td><td class="mono">${esc(p.sku)}</td>
              <td class="muted">বারকোড</td><td class="mono">${esc(p.barcode || '—')}</td></tr>
          <tr><td class="muted">ক্যাটাগরি</td><td>${esc(p.category_name || '—')}</td>
              <td class="muted">সরবরাহকারী</td><td>${esc(p.supplier_name || '—')}</td></tr>
          <tr><td class="muted">পুনঃক্রয় সীমা</td><td>${int(p.reorder_level)} ${esc(p.unit)}</td>
              <td class="muted">অবস্থান</td><td>${esc(p.location || '—')}</td></tr>
          <tr><td class="muted">যোগ হয়েছে</td><td>${esc(when(p.created_at, { withTime: false }))}</td>
              <td class="muted">হালনাগাদ</td><td>${esc(when(p.updated_at, { withTime: false }))}</td></tr>
          ${p.description ? `<tr><td class="muted">নোট</td><td colspan="3">${esc(p.description)}</td></tr>` : ''}
        </tbody>
      </table>

      <h3 style="font-size:14px;margin-bottom:10px">স্টকের ইতিহাস</h3>
      ${p.movements.length ? `
        <div class="table-wrap" style="max-height:280px;overflow-y:auto">
          <table>
            <thead><tr><th>কখন</th><th>ধরন</th><th class="num">পরিবর্তন</th><th class="num">অবশিষ্ট</th><th>রেফারেন্স</th></tr></thead>
            <tbody>${p.movements.map((m) => `
              <tr>
                <td class="small nowrap">${esc(when(m.created_at))}</td>
                <td>${movementBadge(m.type)}</td>
                <td class="num ${m.quantity >= 0 ? 'text-ok' : 'text-danger'}">${m.quantity >= 0 ? '+' : ''}${int(m.quantity)}</td>
                <td class="num">${int(m.after_qty)}</td>
                <td class="small muted">${esc(m.reference || m.note || '—')}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : empty('কোনো স্টক লেনদেন নথিভুক্ত হয়নি', '⇅')}`,
    footer: `
      <button class="btn" data-close>বন্ধ</button>
      <button class="btn" id="d-stock">স্টক সমন্বয়</button>
      ${canEdit() ? '<button class="btn btn-primary" id="d-edit">পণ্য সম্পাদনা</button>' : ''}`,
    onMount: (el, close) => {
      el.querySelector('#d-edit')?.addEventListener('click', () => { close(); openForm(p, ctx, root); });
      el.querySelector('#d-stock')?.addEventListener('click', () => { close(); openStockDialog(p, () => ctx.refresh()); });
    },
  });
}

/* ------------------------------------------------------------ stock dialog */

export function openStockDialog(product, onDone) {
  modal({
    title: `স্টক — ${product.name}`,
    body: `
      <div class="alert alert-info">
        বর্তমানে স্টকে আছে <strong>${int(product.quantity)} ${esc(product.unit)}</strong>।
      </div>
      <form id="stock-form">
        <label class="field">
          <span>আপনি কী নথিভুক্ত করছেন?</span>
          <select name="mode">
            <option value="in">স্টক গ্রহণ — মাল বুঝে পেয়েছেন</option>
            <option value="out">স্টক হ্রাস — নষ্ট, হারানো বা নিজস্ব ব্যবহার</option>
            <option value="adjust">স্টক গণনা — গোনা পরিমাণ বসান</option>
          </select>
        </label>
        <div class="form-grid">
          <label class="field">
            <span id="qty-label">গৃহীত পরিমাণ</span>
            <input name="quantity" type="number" step="1" min="1" required value="1" />
          </label>
          <label class="field" id="cost-field">
            <span>একক ক্রয়মূল্য <span class="hint">ঐচ্ছিক, ক্রয়মূল্য হালনাগাদ করবে</span></span>
            <input name="unit_cost" type="number" step="0.01" min="0" placeholder="${product.cost_price}" />
          </label>
          <label class="field span-2">
            <span>রেফারেন্স <span class="hint">চালান বা ক্রয়াদেশ নম্বর</span></span>
            <input name="reference" maxlength="100" placeholder="যেমন PO-1043" />
          </label>
          <label class="field span-2">
            <span id="note-label">নোট</span>
            <input name="note" maxlength="500" />
          </label>
        </div>
        <div id="stock-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      <button class="btn btn-primary" id="stock-save">নথিভুক্ত করুন</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#stock-form');
      const mode = form.elements.mode;
      const qty = form.elements.quantity;
      const errBox = el.querySelector('#stock-error');
      const btn = el.querySelector('#stock-save');

      const sync = () => {
        const m = mode.value;
        el.querySelector('#qty-label').textContent =
          m === 'in' ? 'গৃহীত পরিমাণ' : m === 'out' ? 'হ্রাসকৃত পরিমাণ' : 'তাকে গোনা পরিমাণ';
        el.querySelector('#note-label').textContent = m === 'adjust' ? 'কারণ *' : 'নোট';
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
        btn.textContent = 'সংরক্ষণ হচ্ছে…';
        errBox.innerHTML = '';
        try {
          if (data.mode === 'in') await api.stockIn({ ...payload, unit_cost: data.unit_cost });
          else if (data.mode === 'out') await api.stockOut(payload);
          else await api.stockAdjust(payload);

          toast('স্টক হালনাগাদ হয়েছে');
          close();
          onDone?.();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'নথিভুক্ত করুন';
        }
      };

      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);
    },
  });
}
