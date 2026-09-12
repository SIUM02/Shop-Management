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
          <h2>দোকানের তথ্য</h2>
          <span class="sub">${isAdmin ? 'রসিদে দেখানো হয়' : 'শুধু অ্যাডমিনের জন্য'}</span>
        </div>
        <div class="card-body">
          <form id="shop-form">
            <label class="field">
              <span>দোকানের নাম</span>
              <input name="shop_name" maxlength="120" value="${esc(s.shop_name)}" ${isAdmin ? '' : 'disabled'} />
            </label>
            <div class="form-grid">
              <label class="field">
                <span>মুদ্রার চিহ্ন</span>
                <input name="currency_symbol" id="cur-symbol" maxlength="5"
                       value="${esc(s.currency_symbol)}" ${isAdmin ? '' : 'disabled'} />
              </label>
              <label class="field">
                <span>ডিফল্ট কর % <span class="hint">নতুন বিক্রয়ে</span></span>
                <input name="tax_percent" type="number" step="0.01" min="0" max="100"
                       value="${esc(s.tax_percent)}" ${isAdmin ? '' : 'disabled'} />
              </label>
              <label class="field span-2">
                <span>সংখ্যার বিন্যাস</span>
                <select name="number_locale" id="cur-locale" ${isAdmin ? '' : 'disabled'}>
                  ${NUMBER_LOCALES.map(([code, label]) =>
                    `<option value="${code}" ${s.number_locale === code ? 'selected' : ''}>${esc(label)}</option>`).join('')}
                </select>
              </label>
            </div>
            <div class="alert alert-info" id="cur-preview"></div>
            <div id="shop-msg"></div>
            ${isAdmin ? '<button class="btn btn-primary" id="save-shop">সেটিংস সংরক্ষণ</button>' : ''}
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>আপনার পাসওয়ার্ড</h2></div>
        <div class="card-body">
          <form id="pw-form">
            <label class="field">
              <span>বর্তমান পাসওয়ার্ড</span>
              <input name="current_password" type="password" required autocomplete="current-password" />
            </label>
            <label class="field">
              <span>নতুন পাসওয়ার্ড <span class="hint">কমপক্ষে ৮ অক্ষর</span></span>
              <input name="new_password" type="password" required minlength="8" autocomplete="new-password" />
            </label>
            <label class="field">
              <span>নতুন পাসওয়ার্ড নিশ্চিত করুন</span>
              <input name="confirm_password" type="password" required minlength="8" autocomplete="new-password" />
            </label>
            <div id="pw-msg"></div>
            <button class="btn btn-primary" id="save-pw">পাসওয়ার্ড পরিবর্তন</button>
          </form>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>তথ্য ও ব্যাকআপ</h2></div>
      <div class="card-body">
        <p class="muted small" style="margin-top:0">
          সব তথ্য একটি Postgres ডেটাবেসে সংরক্ষিত থাকে, তাই কম্পিউটার বদলালেও তথ্য থেকে যায়।
          নিজের কাছে একটি কপি রাখতে নিচের CSV ফাইলগুলো ডাউনলোড করে নিরাপদ জায়গায় রাখুন।
        </p>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <a class="btn" href="/api/reports/export/products">পণ্যের CSV ডাউনলোড</a>
          <a class="btn" href="/api/reports/export/sales">বিক্রয়ের CSV ডাউনলোড</a>
          <a class="btn" href="/api/reports/export/movements">লেনদেনের CSV ডাউনলোড</a>
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
    preview.innerHTML = `দাম এভাবে দেখাবে: <strong>${esc(money(1250.5))}</strong>
      এবং <strong>${esc(money(123456.78))}</strong>।`;
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
      toast('সেটিংস সংরক্ষিত হয়েছে');
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
      pwMsg.innerHTML = '<div class="alert alert-error">নতুন দুটি পাসওয়ার্ড মিলছে না</div>';
      return;
    }

    const btn = root.querySelector('#save-pw');
    btn.disabled = true;
    try {
      await api.changePassword(data.current_password, data.new_password);
      pwForm.reset();
      toast('পাসওয়ার্ড পরিবর্তন হয়েছে');
    } catch (err) {
      pwMsg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  pwForm.addEventListener('submit', savePw);
}
