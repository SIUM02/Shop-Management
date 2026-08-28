import { api } from '../api.js';
import { empty, esc, int, loading, money, movementBadge, toast, when } from '../ui.js';
import { openStockDialog } from './products.js';

const filters = { search: '', type: '', from: '', to: '', offset: 0 };
const PAGE = 60;

export async function render(root, ctx) {
  const actions = ctx.setActions(`
    <button class="btn" id="export-btn">Export CSV</button>
    <button class="btn btn-primary" id="record-btn">＋ Record Movement</button>
  `);

  actions.querySelector('#export-btn').addEventListener('click', () => {
    window.location.href = '/api/reports/export/movements';
  });
  actions.querySelector('#record-btn').addEventListener('click', () => pickProduct(ctx));

  root.innerHTML = `
    <div class="toolbar">
      <input class="search" id="f-search" type="search" placeholder="Search product, reference or note…" value="${esc(filters.search)}" />
      <select id="f-type">
        <option value="">All movement types</option>
        <option value="in"     ${filters.type === 'in' ? 'selected' : ''}>Stock in</option>
        <option value="out"    ${filters.type === 'out' ? 'selected' : ''}>Stock out</option>
        <option value="sale"   ${filters.type === 'sale' ? 'selected' : ''}>Sales</option>
        <option value="adjust" ${filters.type === 'adjust' ? 'selected' : ''}>Adjustments</option>
        <option value="return" ${filters.type === 'return' ? 'selected' : ''}>Returns</option>
      </select>
      <input id="f-from" type="date" value="${esc(filters.from)}" title="From date" />
      <input id="f-to"   type="date" value="${esc(filters.to)}" title="To date" />
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

  for (const [id, key] of [['#f-type', 'type'], ['#f-from', 'from'], ['#f-to', 'to']]) {
    root.querySelector(id).addEventListener('change', (e) => {
      filters[key] = e.target.value;
      filters.offset = 0;
      load(root, ctx);
    });
  }

  root.querySelector('#f-clear').addEventListener('click', () => {
    Object.assign(filters, { search: '', type: '', from: '', to: '', offset: 0 });
    render(root, ctx);
  });

  await load(root, ctx);
}

async function load(root, ctx) {
  const box = root.querySelector('#list');
  box.innerHTML = loading();

  const { items, total } = await api.movements({ ...filters, limit: PAGE });
  if (!items.length) return void (box.innerHTML = empty('No stock movements match these filters', '⇅'));

  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>When</th><th>Product</th><th>Type</th>
        <th class="num">Change</th><th class="num">Before</th><th class="num">After</th>
        <th>Reference</th><th>By</th>
      </tr></thead>
      <tbody>${items.map((m) => `
        <tr>
          <td class="small nowrap">${esc(when(m.created_at))}</td>
          <td>
            <div class="cell-main">${esc(m.product_name)}</div>
            <div class="cell-sub mono">${esc(m.sku)}</div>
          </td>
          <td>${movementBadge(m.type)}</td>
          <td class="num ${m.quantity >= 0 ? 'text-ok' : 'text-danger'}"><strong>${m.quantity >= 0 ? '+' : ''}${int(m.quantity)}</strong></td>
          <td class="num muted">${int(m.before_qty)}</td>
          <td class="num">${int(m.after_qty)}</td>
          <td class="small">
            ${m.reference ? `<span class="mono">${esc(m.reference)}</span>` : ''}
            ${m.note ? `<div class="cell-sub">${esc(m.note)}</div>` : ''}
            ${!m.reference && !m.note ? '<span class="muted">—</span>' : ''}
          </td>
          <td class="small muted">${esc(m.username || '—')}</td>
        </tr>`).join('')}</tbody>
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
}

/** Small picker so "Record Movement" can start from this page. */
async function pickProduct(ctx) {
  const { modal } = await import('../ui.js');

  modal({
    title: 'Record a stock movement',
    body: `
      <label class="field">
        <span>Which product?</span>
        <input id="pick-search" type="search" placeholder="Search by name, SKU or barcode…" autofocus />
      </label>
      <div class="pos-results" id="pick-results" style="max-height:340px"></div>`,
    onMount: (el, close) => {
      const input = el.querySelector('#pick-search');
      const results = el.querySelector('#pick-results');

      const run = async (term) => {
        const { items } = await api.products({ search: term, limit: 30 });
        if (!items.length) return void (results.innerHTML = empty('No products found', '🔍'));

        results.innerHTML = items.map((p) => `
          <div class="pos-pick" data-id="${p.id}">
            <div class="pos-pick-main">
              <div class="cell-main">${esc(p.name)}</div>
              <div class="cell-sub mono">${esc(p.sku)}</div>
            </div>
            <div class="num"><strong>${int(p.quantity)}</strong> <span class="small muted">${esc(p.unit)}</span></div>
          </div>`).join('');

        results.querySelectorAll('.pos-pick').forEach((row) =>
          row.addEventListener('click', () => {
            const product = items.find((p) => p.id === Number(row.dataset.id));
            close();
            openStockDialog(product, () => ctx.refresh());
          }));
      };

      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => run(input.value.trim()), 220);
      });
      run('');
    },
  });
}
