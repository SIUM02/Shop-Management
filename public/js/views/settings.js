import { api } from '../api.js';
import { NUMBER_LOCALES, can, esc, formData, money, state, toast } from '../ui.js';

export async function render(root, ctx) {
  const s = await api.settings();
  state.settings = s;

  const isAdmin = can('admin');

  root.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <h2>Shop details</h2>
          <span class="sub">${isAdmin ? 'Shown on receipts' : 'Admins only'}</span>
        </div>
        <div class="card-body">
          <form id="shop-form">
            <label class="field">
              <span>Shop name</span>
              <input name="shop_name" maxlength="120" value="${esc(s.shop_name)}" ${isAdmin ? '' : 'disabled'} />
            </label>
            <div class="form-grid">
              <label class="field">
                <span>Currency symbol</span>
                <input name="currency_symbol" id="cur-symbol" maxlength="5"
                       value="${esc(s.currency_symbol)}" ${isAdmin ? '' : 'disabled'} />
              </label>
              <label class="field">
                <span>Default tax % <span class="hint">on new sales</span></span>
                <input name="tax_percent" type="number" step="0.01" min="0" max="100"
                       value="${esc(s.tax_percent)}" ${isAdmin ? '' : 'disabled'} />
              </label>
              <label class="field span-2">
                <span>Number format</span>
                <select name="number_locale" id="cur-locale" ${isAdmin ? '' : 'disabled'}>
                  ${NUMBER_LOCALES.map(([code, label]) =>
                    `<option value="${code}" ${s.number_locale === code ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="alert alert-info" id="cur-preview"></div>
            <div id="shop-msg"></div>
            ${isAdmin ? '<button class="btn btn-primary" id="save-shop">Save settings</button>' : ''}
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Your password</h2></div>
        <div class="card-body">
          <form id="pw-form">
            <label class="field">
              <span>Current password</span>
              <input name="current_password" type="password" required autocomplete="current-password" />
            </label>
            <label class="field">
              <span>New password <span class="hint">at least 8 characters</span></span>
              <input name="new_password" type="password" required minlength="8" autocomplete="new-password" />
            </label>
            <label class="field">
              <span>Confirm new password</span>
              <input name="confirm_password" type="password" required minlength="8" autocomplete="new-password" />
            </label>
            <div id="pw-msg"></div>
            <button class="btn btn-primary" id="save-pw">Change password</button>
          </form>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Data & backup</h2></div>
      <div class="card-body">
        <p class="muted small" style="margin-top:0">
          Everything lives in one SQLite file (<span class="mono">data/shop.db</span>).
          To back up, stop the server and copy that file — or download the CSV exports below.
        </p>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <a class="btn" href="/api/reports/export/products">Download products CSV</a>
          <a class="btn" href="/api/reports/export/sales">Download sales CSV</a>
          <a class="btn" href="/api/reports/export/movements">Download movements CSV</a>
        </div>
      </div>
    </div>`;

  const shopForm = root.querySelector('#shop-form');
  const shopMsg = root.querySelector('#shop-msg');

  // Live preview so the effect of symbol + grouping is visible before saving.
  const preview = root.querySelector('#cur-preview');
  const paintPreview = () => {
    const saved = state.settings;
    state.settings = {
      ...saved,
      currency_symbol: root.querySelector('#cur-symbol').value || saved.currency_symbol,
      number_locale: root.querySelector('#cur-locale').value,
    };
    preview.innerHTML = `Prices will look like <strong>${esc(money(1250.5))}</strong>
      and <strong>${esc(money(123456.78))}</strong>.`;
    state.settings = saved;
  };
  root.querySelector('#cur-symbol').addEventListener('input', paintPreview);
  root.querySelector('#cur-locale').addEventListener('change', paintPreview);
  paintPreview();

  const saveShop = async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#save-shop');
    btn.disabled = true;
    shopMsg.innerHTML = '';
    try {
      state.settings = await api.saveSettings(formData(shopForm));
      const { applySettings } = await import('../app.js');
      applySettings();
      toast('Settings saved');
    } catch (err) {
      shopMsg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  if (isAdmin) {
    shopForm.addEventListener('submit', saveShop);
    root.querySelector('#save-shop').addEventListener('click', saveShop);
  }

  const pwForm = root.querySelector('#pw-form');
  const pwMsg = root.querySelector('#pw-msg');

  const savePw = async (e) => {
    e.preventDefault();
    const data = formData(pwForm);
    pwMsg.innerHTML = '';

    if (data.new_password !== data.confirm_password) {
      pwMsg.innerHTML = '<div class="alert alert-error">The two new passwords do not match</div>';
      return;
    }

    const btn = root.querySelector('#save-pw');
    btn.disabled = true;
    try {
      await api.changePassword(data.current_password, data.new_password);
      pwForm.reset();
      toast('Password changed');
    } catch (err) {
      pwMsg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  pwForm.addEventListener('submit', savePw);
}
