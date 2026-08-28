import { api } from '../api.js';
import { barChart, daysAgoISO, empty, esc, int, loading, money, todayISO } from '../ui.js';

const TABS = [
  { id: 'valuation', label: 'Stock valuation' },
  { id: 'reorder',   label: 'Reorder list' },
  { id: 'sales',     label: 'Sales & profit' },
];

let active = 'valuation';
const range = { from: daysAgoISO(29), to: todayISO() };

export async function render(root, ctx) {
  ctx.setActions(`
    <a class="btn" href="/api/reports/export/products">Products CSV</a>
    <a class="btn" href="/api/reports/export/sales">Sales CSV</a>
    <a class="btn" href="/api/reports/export/movements">Movements CSV</a>
  `);

  root.innerHTML = `
    <div class="toolbar">
      ${TABS.map((t) =>
        `<button class="btn ${active === t.id ? 'btn-primary' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="report-body">${loading()}</div>`;

  root.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { active = b.dataset.tab; render(root, ctx); }));

  const body = root.querySelector('#report-body');
  if (active === 'valuation') await valuation(body);
  else if (active === 'reorder') await reorder(body);
  else await salesReport(body, root, ctx);
}

async function valuation(box) {
  const { rows, totals } = await api.valuation();
  if (!rows.length) return void (box.innerHTML = empty('No active products to value', '📦'));

  box.innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:18px">
      <div class="card kpi">
        <div class="kpi-label">Cost value</div>
        <div class="kpi-value">${money(totals.cost_value)}</div>
        <div class="kpi-sub">what your stock cost you</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Retail value</div>
        <div class="kpi-value">${money(totals.retail_value)}</div>
        <div class="kpi-sub">if everything sells at list price</div>
      </div>
      <div class="card kpi accent-ok">
        <div class="kpi-label">Potential profit</div>
        <div class="kpi-value">${money(totals.potential_profit)}</div>
        <div class="kpi-sub">${int(totals.units)} units on hand</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Every product, most valuable first</h2></div>
      <div class="card-body tight"><div class="table-wrap"><table>
        <thead><tr>
          <th>Product</th><th>Category</th><th class="num">Qty</th>
          <th class="num">Cost</th><th class="num">Price</th>
          <th class="num">Cost value</th><th class="num">Retail value</th><th class="num">Potential profit</th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td><div class="cell-main">${esc(r.name)}</div><div class="cell-sub mono">${esc(r.sku)}</div></td>
            <td class="small muted">${esc(r.category)}</td>
            <td class="num">${int(r.quantity)} <span class="small muted">${esc(r.unit)}</span></td>
            <td class="num muted">${money(r.cost_price)}</td>
            <td class="num">${money(r.sell_price)}</td>
            <td class="num">${money(r.cost_value)}</td>
            <td class="num">${money(r.retail_value)}</td>
            <td class="num text-ok">${money(r.potential_profit)}</td>
          </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td colspan="2">Total</td>
          <td class="num">${int(totals.units)}</td>
          <td colspan="2"></td>
          <td class="num">${money(totals.cost_value)}</td>
          <td class="num">${money(totals.retail_value)}</td>
          <td class="num">${money(totals.potential_profit)}</td>
        </tr></tfoot>
      </table></div></div>
    </div>`;
}

async function reorder(box) {
  const { rows, estimated_total } = await api.reorder();
  if (!rows.length) {
    box.innerHTML = `<div class="card"><div class="card-body">
      ${empty('Nothing needs reordering — every product is above its reorder level', '✅')}
    </div></div>`;
    return;
  }

  box.innerHTML = `
    <div class="alert alert-warn">
      <strong>${rows.length} product${rows.length === 1 ? '' : 's'} to reorder.</strong>
      Estimated purchase cost: <strong>${money(estimated_total)}</strong>.
      Suggested quantities bring each item to twice its reorder level.
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Reorder list</h2>
        <button class="btn btn-sm" id="print-reorder">Print</button>
      </div>
      <div class="card-body tight"><div class="table-wrap"><table>
        <thead><tr>
          <th>Product</th><th>Supplier</th><th>Contact</th>
          <th class="num">In stock</th><th class="num">Reorder at</th>
          <th class="num">Suggested order</th><th class="num">Est. cost</th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td><div class="cell-main">${esc(r.name)}</div><div class="cell-sub mono">${esc(r.sku)}</div></td>
            <td class="small">${esc(r.supplier_name)}</td>
            <td class="small muted">${esc(r.supplier_phone || r.supplier_email || '—')}</td>
            <td class="num ${r.quantity <= 0 ? 'text-danger' : 'text-warn'}"><strong>${int(r.quantity)}</strong></td>
            <td class="num muted">${int(r.reorder_level)}</td>
            <td class="num"><strong>${int(r.suggested_qty)}</strong> <span class="small muted">${esc(r.unit)}</span></td>
            <td class="num">${money(r.estimated_cost)}</td>
          </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td colspan="6">Estimated total</td>
          <td class="num">${money(estimated_total)}</td>
        </tr></tfoot>
      </table></div></div>
    </div>`;

  box.querySelector('#print-reorder').addEventListener('click', () => window.print());
}

async function salesReport(box, root, ctx) {
  box.innerHTML = `
    <div class="toolbar">
      <label class="small muted">From <input id="r-from" type="date" value="${esc(range.from)}" /></label>
      <label class="small muted">To <input id="r-to" type="date" value="${esc(range.to)}" /></label>
      <button class="btn btn-sm" data-range="7">Last 7 days</button>
      <button class="btn btn-sm" data-range="30">Last 30 days</button>
      <button class="btn btn-sm" data-range="365">Last year</button>
    </div>
    <div id="sales-body">${loading()}</div>`;

  const rerun = () => salesReport(box, root, ctx);

  box.querySelector('#r-from').addEventListener('change', (e) => { range.from = e.target.value; rerun(); });
  box.querySelector('#r-to').addEventListener('change', (e) => { range.to = e.target.value; rerun(); });
  box.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      range.from = daysAgoISO(Number(b.dataset.range) - 1);
      range.to = todayISO();
      rerun();
    }));

  const { summary, daily, byProduct } = await api.salesReport(range);
  const inner = box.querySelector('#sales-body');
  const margin = summary.revenue > 0 ? (summary.profit / summary.revenue) * 100 : 0;

  inner.innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:18px">
      <div class="card kpi">
        <div class="kpi-label">Revenue</div>
        <div class="kpi-value">${money(summary.revenue)}</div>
        <div class="kpi-sub">${int(summary.orders)} order${summary.orders === 1 ? '' : 's'}</div>
      </div>
      <div class="card kpi accent-ok">
        <div class="kpi-label">Gross profit</div>
        <div class="kpi-value">${money(summary.profit)}</div>
        <div class="kpi-sub">${margin.toFixed(1)}% margin</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Cost of goods</div>
        <div class="kpi-value">${money(summary.cost)}</div>
        <div class="kpi-sub">${money(summary.discount)} given as discounts</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Average order</div>
        <div class="kpi-value">${money(summary.orders ? summary.revenue / summary.orders : 0)}</div>
        <div class="kpi-sub">${money(summary.tax)} tax collected</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Daily revenue</h2><span class="sub">${esc(range.from)} → ${esc(range.to)}</span></div>
      <div class="card-body">${barChart(daily)}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Best sellers in this period</h2></div>
      <div class="card-body tight">
        ${byProduct.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th class="num">Units sold</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
          <tbody>${byProduct.map((p) => `
            <tr>
              <td><div class="cell-main">${esc(p.product_name)}</div><div class="cell-sub mono">${esc(p.sku)}</div></td>
              <td class="num">${int(p.units_sold)}</td>
              <td class="num">${money(p.revenue)}</td>
              <td class="num ${p.profit >= 0 ? 'text-ok' : 'text-danger'}">${money(p.profit)}</td>
              <td class="num muted">${p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : '0.0'}%</td>
            </tr>`).join('')}</tbody>
        </table></div>` : empty('No sales in this period', '🧾')}
      </div>
    </div>`;
}
