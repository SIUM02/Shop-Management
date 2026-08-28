/** Thin fetch wrapper: JSON in, JSON out, server error messages surfaced. */
async function request(method, url, body) {
  const opts = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('Cannot reach the server. Is it still running?');
  }

  if (res.status === 401) {
    const err = new Error('Your session ended. Please sign in again.');
    err.unauthorized = true;
    throw err;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const qs = (params) => {
  const clean = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? '?' + new URLSearchParams(clean).toString() : '';
};

export const api = {
  // auth
  login:  (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  me:     () => request('GET', '/api/auth/me'),
  changePassword: (current_password, new_password) =>
    request('POST', '/api/auth/change-password', { current_password, new_password }),

  // products
  products:      (params) => request('GET', '/api/products' + qs(params)),
  product:       (id) => request('GET', `/api/products/${id}`),
  createProduct: (data) => request('POST', '/api/products', data),
  updateProduct: (id, data) => request('PUT', `/api/products/${id}`, data),
  deleteProduct: (id) => request('DELETE', `/api/products/${id}`),
  lookup:        (code) => request('GET', `/api/products/lookup/${encodeURIComponent(code)}`),

  // catalogue
  categories:      () => request('GET', '/api/categories'),
  createCategory:  (d) => request('POST', '/api/categories', d),
  updateCategory:  (id, d) => request('PUT', `/api/categories/${id}`, d),
  deleteCategory:  (id) => request('DELETE', `/api/categories/${id}`),

  suppliers:      () => request('GET', '/api/suppliers'),
  supplier:       (id) => request('GET', `/api/suppliers/${id}`),
  createSupplier: (d) => request('POST', '/api/suppliers', d),
  updateSupplier: (id, d) => request('PUT', `/api/suppliers/${id}`, d),
  deleteSupplier: (id) => request('DELETE', `/api/suppliers/${id}`),

  // stock
  movements:  (params) => request('GET', '/api/stock/movements' + qs(params)),
  stockIn:    (d) => request('POST', '/api/stock/in', d),
  stockOut:   (d) => request('POST', '/api/stock/out', d),
  stockAdjust:(d) => request('POST', '/api/stock/adjust', d),

  // sales
  sales:      (params) => request('GET', '/api/sales' + qs(params)),
  sale:       (id) => request('GET', `/api/sales/${id}`),
  createSale: (d) => request('POST', '/api/sales', d),
  voidSale:   (id, reason) => request('POST', `/api/sales/${id}/void`, { reason }),

  // reports
  dashboard:     () => request('GET', '/api/reports/dashboard'),
  valuation:     () => request('GET', '/api/reports/valuation'),
  reorder:       () => request('GET', '/api/reports/reorder'),
  salesReport:   (params) => request('GET', '/api/reports/sales' + qs(params)),

  // admin
  users:        () => request('GET', '/api/users'),
  createUser:   (d) => request('POST', '/api/users', d),
  updateUser:   (id, d) => request('PUT', `/api/users/${id}`, d),
  deleteUser:   (id) => request('DELETE', `/api/users/${id}`),
  settings:     () => request('GET', '/api/settings'),
  saveSettings: (d) => request('PUT', '/api/settings', d),
};
