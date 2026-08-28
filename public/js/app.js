import { api } from './api.js';
import { closeModal, esc, loading, state, toast } from './ui.js';

import * as dashboard  from './views/dashboard.js';
import * as products   from './views/products.js';
import * as pos        from './views/pos.js';
import * as stock      from './views/stock.js';
import * as sales      from './views/sales.js';
import * as categories from './views/categories.js';
import * as suppliers  from './views/suppliers.js';
import * as reports    from './views/reports.js';
import * as users      from './views/users.js';
import * as settings   from './views/settings.js';

const ROUTES = {
  dashboard:  { title: 'Dashboard',       view: dashboard },
  pos:        { title: 'New Sale',        view: pos },
  products:   { title: 'Products',        view: products },
  stock:      { title: 'Stock Movements', view: stock },
  sales:      { title: 'Sales',           view: sales },
  categories: { title: 'Categories',      view: categories },
  suppliers:  { title: 'Suppliers',       view: suppliers },
  reports:    { title: 'Reports',         view: reports },
  users:      { title: 'Users',           view: users, roles: ['admin'] },
  settings:   { title: 'Settings',        view: settings },
};

const el = {
  login:   document.getElementById('login-screen'),
  app:     document.getElementById('app-screen'),
  form:    document.getElementById('login-form'),
  error:   document.getElementById('login-error'),
  view:    document.getElementById('view'),
  title:   document.getElementById('page-title'),
  actions: document.getElementById('page-actions'),
  nav:     document.getElementById('nav'),
  sidebar: document.getElementById('sidebar'),
  scrim:   document.getElementById('sidebar-scrim'),
};

/* ------------------------------------------------------------------ routing */

const currentRoute = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');

export function navigate(route) {
  location.hash = `#/${route}`;
}

/** Views call these to own the header while they are mounted. */
const ctx = {
  navigate,
  refresh: () => renderRoute(),
  setActions(html = '') {
    el.actions.innerHTML = html;
    return el.actions;
  },
  setTitle(text) {
    el.title.textContent = text;
  },
};

let renderToken = 0;

async function renderRoute() {
  const name = currentRoute();
  const route = ROUTES[name];

  if (!route) return navigate('dashboard');
  if (route.roles && !route.roles.includes(state.user.role)) {
    toast('You do not have access to that page', 'error');
    return navigate('dashboard');
  }

  closeModal();
  el.title.textContent = route.title;
  el.actions.innerHTML = '';
  el.view.innerHTML = loading();

  for (const link of el.nav.querySelectorAll('.nav-item')) {
    link.classList.toggle('active', link.getAttribute('href') === `#/${name}`);
  }
  closeSidebar();

  // Guard against a slow view painting over a newer one.
  const token = ++renderToken;
  try {
    await route.view.render(el.view, ctx);
  } catch (err) {
    if (token !== renderToken) return;
    if (err.unauthorized) return showLogin('Your session ended. Please sign in again.');
    el.view.innerHTML = `<div class="card"><div class="card-body">
      <div class="alert alert-error">${esc(err.message)}</div>
      <button class="btn" id="reload-btn">Reload</button>
    </div></div>`;
    el.view.querySelector('#reload-btn').addEventListener('click', () => location.reload());
  }
}

/* ------------------------------------------------------------------ session */

function showLogin(message = '') {
  state.user = null;
  el.app.hidden = true;
  el.login.hidden = false;
  closeModal();
  el.error.hidden = !message;
  el.error.textContent = message;
  el.form.querySelector('[name=password]').value = '';
  el.form.querySelector('[name=username]')?.focus();
}

async function showApp() {
  el.login.hidden = true;
  el.app.hidden = false;

  document.getElementById('user-name').textContent = state.user.full_name || state.user.username;
  document.getElementById('user-role').textContent = state.user.role;
  document.getElementById('user-avatar').textContent =
    (state.user.full_name || state.user.username).charAt(0).toUpperCase();

  for (const link of el.nav.querySelectorAll('[data-admin]')) {
    link.hidden = state.user.role !== 'admin';
  }

  try {
    state.settings = await api.settings();
  } catch { /* fall back to the defaults already in state */ }

  applySettings();
  await renderRoute();
}

export function applySettings() {
  const name = state.settings.shop_name || 'Shop Inventory';
  document.getElementById('brand-name').textContent = name;
  document.title = `${name} · Inventory`;
}

/* ------------------------------------------------------------------ events */

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = el.form.querySelector('button[type=submit]');
  const data = new FormData(el.form);

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  el.error.hidden = true;

  try {
    const { user } = await api.login(data.get('username').trim(), data.get('password'));
    state.user = user;
    if (!location.hash) location.hash = '#/dashboard';
    await showApp();
  } catch (err) {
    el.error.textContent = err.message;
    el.error.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await api.logout(); } catch { /* signing out locally is enough */ }
  showLogin('You have been signed out.');
});

const openSidebar  = () => { el.sidebar.classList.add('open'); el.scrim.classList.add('show'); };
const closeSidebar = () => { el.sidebar.classList.remove('open'); el.scrim.classList.remove('show'); };

document.getElementById('menu-btn').addEventListener('click', openSidebar);
el.scrim.addEventListener('click', closeSidebar);

window.addEventListener('hashchange', () => { if (state.user) renderRoute(); });

// Global shortcut: "n" starts a new sale unless the user is typing.
document.addEventListener('keydown', (e) => {
  if (!state.user || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (document.querySelector('.modal-backdrop')) return;
  if (e.key === 'n') { e.preventDefault(); navigate('pos'); }
});

/* ------------------------------------------------------------------ boot */

(async function boot() {
  try {
    const { user } = await api.me();
    state.user = user;
    if (!location.hash) location.hash = '#/dashboard';
    await showApp();
  } catch {
    showLogin();
  }
})();
