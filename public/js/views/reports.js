import { api } from '../api.js';
import { barChart, daysAgoISO, empty, esc, int, loading, money, seesCost, seesProfit, todayISO } from '../ui.js';

/*
 * Which reports a role is offered. The server refuses the data regardless
 * (see src/permissions.js); this just avoids showing tabs that would open on
 * an empty or forbidden report.
 */
const ALL_TABS = [
  { id: 'valuation', label: 'স্টকের মূল্যায়ন', needs: 'cost' },
  { id: 'reorder',   label: 'পুনঃক্রয় তালিকা',  needs: 'cost' },
  { id: 'sales',     label: 'বিক্রয় ও লাভ',    needs: 'profit' },
];

const tabs = () => ALL_TABS.filter((t) =>
  t.needs === 'profit' ? seesProfit() : t.needs === 'cost' ? seesCost() : true);

let active = 'valuation';
const range = { from: daysAgoISO(29), to: todayISO() };

export async function render(root, ctx) {
  ctx.setActions(`
    <a class="btn" href="/api/reports/export/products">পণ্য CSV</a>
    ${seesProfit() ? '<a class="btn" href="/api/reports/export/sales">বিক্রয় CSV</a>' : ''}
    <a class="btn" href="/api/reports/export/movements">লেনদেন CSV</a>
  `);

  const available = tabs();
  // A remembered tab may not be open to this role; fall back to the first one.
  if (!available.some((t) => t.id === active)) active = available[0]?.id;

  root.innerHTML = `
    <div class="toolbar">
      ${available.map((t) =>
        `<button class="btn ${active === t.id ? 'btn-primary' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="report-body">${loading()}</div>`;

  root.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { active = b.dataset.tab; render(root, ctx); }));

  const body = root.querySelector('#report-body');
  if (!available.length) {
    body.innerHTML = empty('আপনার ভূমিকার জন্য কোনো রিপোর্ট নেই', '🔒');
    return;
  }
  if (active === 'valuation') await valuation(body);
  else if (active === 'reorder') await reorder(body);
  else await salesReport(body, root, ctx);
}

async function valuation(box) {
  const { rows, totals } = await api.valuation();
  if (!rows.length) return void (box.innerHTML = empty('মূল্যায়নের মতো কোনো সক্রিয় পণ্য নেই', '📦'));

  box.innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:18px">
      <div class="card kpi">
        <div class="kpi-label">ক্রয়মূল্য</div>
        <div class="kpi-value">${money(totals.cost_value)}</div>
        <div class="kpi-sub">স্টক কিনতে যা খরচ হয়েছে</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">খুচরা মূল্য</div>
        <div class="kpi-value">${money(totals.retail_value)}</div>
        <div class="kpi-sub">সব পণ্য তালিকা দরে বিক্রি হলে</div>
      </div>
      <div class="card kpi accent-ok">
        <div class="kpi-label">সম্ভাব্য লাভ</div>
        <div class="kpi-value">${money(totals.potential_profit)}</div>
        <div class="kpi-sub">হাতে ${int(totals.units)} একক</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>সব পণ্য, সর্বোচ্চ মূল্যেরটি আগে</h2></div>
      <div class="card-body tight"><div class="table-wrap"><table>
        <thead><tr>
          <th>পণ্য</th><th>ক্যাটাগরি</th><th class="num">পরিমাণ</th>
          <th class="num">ক্রয়মূল্য</th><th class="num">বিক্রয়মূল্য</th>
          <th class="num">মোট ক্রয়মূল্য</th><th class="num">মোট খুচরা মূল্য</th><th class="num">সম্ভাব্য লাভ</th>
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
          <td colspan="2">মোট</td>
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
      ${empty('কিছুই পুনঃক্রয় করার দরকার নেই — সব পণ্যই পুনঃক্রয় সীমার উপরে', '✅')}
    </div></div>`;
    return;
  }

  box.innerHTML = `
    <div class="alert alert-warn">
      <strong>${rows.length}টি পণ্য পুনঃক্রয় করতে হবে।</strong>
      আনুমানিক ক্রয় খরচ: <strong>${money(estimated_total)}</strong>।
      প্রস্তাবিত পরিমাণ প্রতিটি পণ্যকে তার পুনঃক্রয় সীমার দ্বিগুণে নিয়ে যাবে।
    </div>

    <div class="card">
      <div class="card-head">
        <h2>পুনঃক্রয় তালিকা</h2>
        <button class="btn btn-sm" id="print-reorder">প্রিন্ট</button>
      </div>
      <div class="card-body tight"><div class="table-wrap"><table>
        <thead><tr>
          <th>পণ্য</th><th>সরবরাহকারী</th><th>যোগাযোগ</th>
          <th class="num">স্টকে</th><th class="num">পুনঃক্রয় সীমা</th>
          <th class="num">প্রস্তাবিত অর্ডার</th><th class="num">আনুমানিক খরচ</th>
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
          <td colspan="6">আনুমানিক মোট</td>
          <td class="num">${money(estimated_total)}</td>
        </tr></tfoot>
      </table></div></div>
    </div>`;

  box.querySelector('#print-reorder').addEventListener('click', () => window.print());
}

async function salesReport(box, root, ctx) {
  box.innerHTML = `
    <div class="toolbar">
      <label class="small muted">শুরু <input id="r-from" type="date" value="${esc(range.from)}" /></label>
      <label class="small muted">শেষ <input id="r-to" type="date" value="${esc(range.to)}" /></label>
      <button class="btn btn-sm" data-range="7">গত ৭ দিন</button>
      <button class="btn btn-sm" data-range="30">গত ৩০ দিন</button>
      <button class="btn btn-sm" data-range="365">গত এক বছর</button>
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
        <div class="kpi-label">আয়</div>
        <div class="kpi-value">${money(summary.revenue)}</div>
        <div class="kpi-sub">${int(summary.orders)}টি অর্ডার</div>
      </div>
      <div class="card kpi accent-ok">
        <div class="kpi-label">মোট লাভ</div>
        <div class="kpi-value">${money(summary.profit)}</div>
        <div class="kpi-sub">${margin.toFixed(1)}% মার্জিন</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">পণ্যের ক্রয়মূল্য</div>
        <div class="kpi-value">${money(summary.cost)}</div>
        <div class="kpi-sub">${money(summary.discount)} ছাড় দেওয়া হয়েছে</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">গড় অর্ডার</div>
        <div class="kpi-value">${money(summary.orders ? summary.revenue / summary.orders : 0)}</div>
        <div class="kpi-sub">${money(summary.tax)} কর আদায়</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>দৈনিক আয়</h2><span class="sub">${esc(range.from)} → ${esc(range.to)}</span></div>
      <div class="card-body">${barChart(daily)}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>এই সময়ের সর্বাধিক বিক্রীত</h2></div>
      <div class="card-body tight">
        ${byProduct.length ? `<div class="table-wrap"><table>
          <thead><tr><th>পণ্য</th><th class="num">বিক্রীত একক</th><th class="num">আয়</th><th class="num">লাভ</th><th class="num">মার্জিন</th></tr></thead>
          <tbody>${byProduct.map((p) => `
            <tr>
              <td><div class="cell-main">${esc(p.product_name)}</div><div class="cell-sub mono">${esc(p.sku)}</div></td>
              <td class="num">${int(p.units_sold)}</td>
              <td class="num">${money(p.revenue)}</td>
              <td class="num ${p.profit >= 0 ? 'text-ok' : 'text-danger'}">${money(p.profit)}</td>
              <td class="num muted">${p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : '0.0'}%</td>
            </tr>`).join('')}</tbody>
        </table></div>` : empty('এই সময়ে কোনো বিক্রয় হয়নি', '🧾')}
      </div>
    </div>`;
}
