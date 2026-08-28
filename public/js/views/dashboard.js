import { api } from '../api.js';
import { barChart, empty, esc, int, money, movementBadge, relative, seesCost, seesProfit } from '../ui.js';

export async function render(root, ctx) {
  const d = await api.dashboard();
  const t = d.totals;

  // setActions renders into the toolbar and hands it back; the buttons live
  // there, not under `root`, so the handlers below must query what it returns.
  const actions = ctx.setActions(`
    <button class="btn btn-primary" id="new-sale">＋ New Sale</button>
    <button class="btn" id="go-products">Manage Products</button>
  `);

  const alerts = t.out_of_stock + t.low_stock;

  root.innerHTML = `
    ${alerts ? `<div class="alert alert-warn">
      <strong>${int(alerts)} product${alerts === 1 ? '' : 's'} need attention</strong> —
      ${int(t.out_of_stock)} out of stock, ${int(t.low_stock)} at or below reorder level.
      <a href="#/products?status=low">Review them →</a>
    </div>` : ''}

    <div class="grid grid-kpi">
      <div class="card kpi">
        <div class="kpi-label">Stock value (cost)</div>
        <div class="kpi-value">${money(t.stock_value_cost)}</div>
        <div class="kpi-sub">${int(t.total_units)} units across ${int(t.product_count)} products</div>
      </div>
      <div class="card kpi accent-ok">
        <div class="kpi-label">Today's sales</div>
        <div class="kpi-value">${money(d.today.revenue)}</div>
        <div class="kpi-sub">${int(d.today.sale_count)} order${d.today.sale_count === 1 ? '' : 's'}${seesProfit() ? ` · ${money(d.today.profit)} profit` : ''}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">This month</div>
        <div class="kpi-value">${money(d.month.revenue)}</div>
        <div class="kpi-sub">${int(d.month.sale_count)} order${d.month.sale_count === 1 ? '' : 's'}${seesProfit() ? ` · ${money(d.month.profit)} profit` : ''}</div>
      </div>
      <div class="card kpi ${t.out_of_stock ? 'accent-danger' : t.low_stock ? 'accent-warn' : 'accent-ok'}">
        <div class="kpi-label">Needs restocking</div>
        <div class="kpi-value">${int(t.low_stock + t.out_of_stock)}</div>
        <div class="kpi-sub">${int(t.out_of_stock)} out of stock · retail value ${money(t.stock_value_retail)}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><h2>Revenue — last 14 days</h2></div>
        <div class="card-body">${barChart(d.trend)}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Top sellers</h2><span class="sub">last 30 days</span>
        </div>
        <div class="card-body">${topSellers(d.topProducts)}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head">
          <h2>Low stock</h2>
          <a class="btn btn-sm" href="#/reports">Reorder report</a>
        </div>
        <div class="card-body tight">${lowStockTable(d.lowStock)}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Recent activity</h2>
          <a class="btn btn-sm" href="#/stock">View all</a>
        </div>
        <div class="card-body tight">${activityTable(d.recentMovements)}</div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Stock value by category</h2></div>
      <div class="card-body tight">${categoryTable(d.byCategory, t.stock_value_cost)}</div>
    </div>
  `;

  actions.querySelector('#new-sale')?.addEventListener('click', () => ctx.navigate('pos'));
  actions.querySelector('#go-products')?.addEventListener('click', () => ctx.navigate('products'));
}

function topSellers(rows) {
  if (!rows.length) return empty('No sales in the last 30 days', '📈');
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return rows.map((r) => `
    <div class="bar-row">
      <div>
        <div class="bar-name">${esc(r.product_name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.revenue / max) * 100}%"></div></div>
      </div>
      <div class="num">
        <div style="font-weight:600">${money(r.revenue)}</div>
        <div class="small muted">${int(r.units_sold)} sold</div>
      </div>
    </div>`).join('');
}

function lowStockTable(rows) {
  if (!rows.length) return empty('Everything is above its reorder level', '✅');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Reorder at</th><th>Supplier</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td>
          <div class="cell-main">${esc(r.name)}</div>
          <div class="cell-sub mono">${esc(r.sku)}</div>
        </td>
        <td class="num ${r.quantity <= 0 ? 'text-danger' : 'text-warn'}">
          <strong>${int(r.quantity)}</strong> <span class="small muted">${esc(r.unit)}</span>
        </td>
        <td class="num muted">${int(r.reorder_level)}</td>
        <td class="small muted">${esc(r.supplier_name || '—')}</td>
      </tr>`).join('')}</tbody>
  </table></div>`;
}

function activityTable(rows) {
  if (!rows.length) return empty('No stock activity yet', '⇅');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Product</th><th>Type</th><th class="num">Change</th><th class="num">When</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td>
          <div class="cell-main">${esc(r.product_name)}</div>
          <div class="cell-sub mono">${esc(r.reference || r.sku)}</div>
        </td>
        <td>${movementBadge(r.type)}</td>
        <td class="num ${r.quantity >= 0 ? 'text-ok' : 'text-danger'}">
          ${r.quantity >= 0 ? '+' : ''}${int(r.quantity)}
          <span class="small muted">→ ${int(r.after_qty)}</span>
        </td>
        <td class="num small muted nowrap">${esc(relative(r.created_at))}</td>
      </tr>`).join('')}</tbody>
  </table></div>`;
}

function categoryTable(rows, grandTotal) {
  if (!rows.length) return empty('No products yet', '📦');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Category</th><th class="num">Products</th><th class="num">Units</th><th class="num">Stock value</th><th class="num">Share</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td class="cell-main">${esc(r.category)}</td>
        <td class="num">${int(r.products)}</td>
        <td class="num">${int(r.units)}</td>
        <td class="num">${money(r.value)}</td>
        <td class="num muted">${grandTotal > 0 ? ((r.value / grandTotal) * 100).toFixed(1) : '0.0'}%</td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td>Total</td>
      <td class="num">${int(rows.reduce((a, r) => a + r.products, 0))}</td>
      <td class="num">${int(rows.reduce((a, r) => a + r.units, 0))}</td>
      <td class="num">${money(grandTotal)}</td>
      <td class="num">100%</td>
    </tr></tfoot>
  </table></div>`;
}
