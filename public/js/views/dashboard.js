import { api } from '../api.js';
import { barChart, empty, esc, int, money, movementBadge, relative, seesCost, seesProfit } from '../ui.js';

const ICON_WALLET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`;
const ICON_TREND  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;
const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const ICON_ALERT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/></svg>`;

export async function render(root, ctx) {
  const d = await api.dashboard();
  const t = d.totals;

  // setActions renders into the toolbar and hands it back; the buttons live
  // there, not under `root`, so the handlers below must query what it returns.
  const actions = ctx.setActions(`
    <button class="btn btn-primary" id="new-sale">＋ নতুন বিক্রয়</button>
    <button class="btn" id="go-products">পণ্য পরিচালনা</button>
  `);

  const alerts = t.out_of_stock + t.low_stock;

  root.innerHTML = `
    ${alerts ? `<div class="alert alert-warn">
      <strong>${int(alerts)}টি পণ্যের দিকে নজর দেওয়া দরকার</strong> —
      ${int(t.out_of_stock)}টি স্টকে নেই, ${int(t.low_stock)}টি পুনঃক্রয় সীমায় বা তার নিচে।
      <a href="#/products?status=low">দেখে নিন →</a>
    </div>` : ''}

    <div class="grid grid-kpi">
      <div class="card kpi kpi-soft kpi-tint-1">
        <div class="kpi-head">
          <div class="kpi-label">স্টকের মূল্য (ক্রয়মূল্যে)</div>
          <div class="kpi-icon">${ICON_WALLET}</div>
        </div>
        <div class="kpi-value">${money(t.stock_value_cost)}</div>
        <div class="kpi-sub">${int(t.product_count)}টি পণ্যে মোট ${int(t.total_units)} একক</div>
      </div>
      <div class="card kpi kpi-soft kpi-tint-4">
        <div class="kpi-head">
          <div class="kpi-label">আজকের বিক্রয়</div>
          <div class="kpi-icon">${ICON_TREND}</div>
        </div>
        <div class="kpi-value">${money(d.today.revenue)}</div>
        <div class="kpi-sub">${int(d.today.sale_count)}টি অর্ডার${seesProfit() ? ` · ${money(d.today.profit)} লাভ` : ''}</div>
      </div>
      <div class="card kpi kpi-soft kpi-tint-2">
        <div class="kpi-head">
          <div class="kpi-label">চলতি মাস</div>
          <div class="kpi-icon">${ICON_CALENDAR}</div>
        </div>
        <div class="kpi-value">${money(d.month.revenue)}</div>
        <div class="kpi-sub">${int(d.month.sale_count)}টি অর্ডার${seesProfit() ? ` · ${money(d.month.profit)} লাভ` : ''}</div>
      </div>
      <div class="card kpi kpi-soft ${t.out_of_stock ? 'kpi-tint-danger' : t.low_stock ? 'kpi-tint-warn' : 'kpi-tint-ok'}">
        <div class="kpi-head">
          <div class="kpi-label">পুনঃমজুদ প্রয়োজন</div>
          <div class="kpi-icon">${ICON_ALERT}</div>
        </div>
        <div class="kpi-value">${int(t.low_stock + t.out_of_stock)}</div>
        <div class="kpi-sub">${int(t.out_of_stock)}টি স্টকে নেই · খুচরা মূল্য ${money(t.stock_value_retail)}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><h2>আয় — গত ১৪ দিন</h2></div>
        <div class="card-body">${barChart(d.trend)}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>সর্বাধিক বিক্রীত</h2><span class="sub">গত ৩০ দিন</span>
        </div>
        <div class="card-body">${topSellers(d.topProducts)}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head">
          <h2>স্টক কম</h2>
          <a class="btn btn-sm" href="#/reports">পুনঃক্রয় রিপোর্ট</a>
        </div>
        <div class="card-body tight">${lowStockTable(d.lowStock)}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>সাম্প্রতিক কার্যক্রম</h2>
          <a class="btn btn-sm" href="#/stock">সব দেখুন</a>
        </div>
        <div class="card-body tight">${activityTable(d.recentMovements)}</div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>ক্যাটাগরি অনুযায়ী স্টকের মূল্য</h2></div>
      <div class="card-body tight">${categoryTable(d.byCategory, t.stock_value_cost)}</div>
    </div>
  `;

  actions.querySelector('#new-sale')?.addEventListener('click', () => ctx.navigate('pos'));
  actions.querySelector('#go-products')?.addEventListener('click', () => ctx.navigate('products'));
}

function topSellers(rows) {
  if (!rows.length) return empty('গত ৩০ দিনে কোনো বিক্রয় হয়নি', '📈');
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  const TINTS = ['kpi-tint-1', 'kpi-tint-2', 'kpi-tint-3', 'kpi-tint-4'];
  return rows.map((r, i) => `
    <div class="bar-row">
      <div class="bar-avatar ${TINTS[i % TINTS.length]}">${esc(r.product_name.charAt(0).toUpperCase())}</div>
      <div>
        <div class="bar-name">${esc(r.product_name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.revenue / max) * 100}%"></div></div>
      </div>
      <div class="num">
        <div style="font-weight:600">${money(r.revenue)}</div>
        <div class="small muted">${int(r.units_sold)}টি বিক্রি</div>
      </div>
    </div>`).join('');
}

function lowStockTable(rows) {
  if (!rows.length) return empty('সব পণ্যই পুনঃক্রয় সীমার উপরে আছে', '✅');
  return `<div class="table-wrap"><table>
    <thead><tr><th>পণ্য</th><th class="num">স্টকে</th><th class="num">পুনঃক্রয় সীমা</th><th>সরবরাহকারী</th></tr></thead>
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
  if (!rows.length) return empty('এখনও কোনো স্টক কার্যক্রম নেই', '⇅');
  return `<div class="table-wrap"><table>
    <thead><tr><th>পণ্য</th><th>ধরন</th><th class="num">পরিবর্তন</th><th class="num">কখন</th></tr></thead>
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
  if (!rows.length) return empty('এখনও কোনো পণ্য নেই', '📦');
  return `<div class="table-wrap"><table>
    <thead><tr><th>ক্যাটাগরি</th><th class="num">পণ্য</th><th class="num">একক</th><th class="num">স্টকের মূল্য</th><th class="num">অংশ</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td class="cell-main">${esc(r.category)}</td>
        <td class="num">${int(r.products)}</td>
        <td class="num">${int(r.units)}</td>
        <td class="num">${money(r.value)}</td>
        <td class="num muted">${grandTotal > 0 ? ((r.value / grandTotal) * 100).toFixed(1) : '0.0'}%</td>
      </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td>মোট</td>
      <td class="num">${int(rows.reduce((a, r) => a + r.products, 0))}</td>
      <td class="num">${int(rows.reduce((a, r) => a + r.units, 0))}</td>
      <td class="num">${money(grandTotal)}</td>
      <td class="num">100%</td>
    </tr></tfoot>
  </table></div>`;
}
