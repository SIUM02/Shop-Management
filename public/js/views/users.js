import { api } from '../api.js';
import { confirmDialog, empty, esc, formData, modal, state, toast, when } from '../ui.js';

const ROLE_HELP = {
  admin:   'Full access, including users and settings',
  manager: 'Everything except user management',
  staff:   'Sales and stock movements only',
};

export async function render(root, ctx) {
  const rows = await api.users();

  ctx.setActions('<button class="btn btn-primary" id="add-btn">＋ Add User</button>')
    .querySelector('#add-btn')
    .addEventListener('click', () => openForm(null, ctx));

  root.innerHTML = `
    <div class="alert alert-info">
      <strong>Roles:</strong>
      Admin — ${ROLE_HELP.admin}. ·
      Manager — ${ROLE_HELP.manager}. ·
      Staff — ${ROLE_HELP.staff}.
    </div>

    <div class="card">
      <div class="card-head"><h2>Users</h2><span class="sub">${rows.length} total</span></div>
      <div class="card-body tight"><div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows.map((u) => `
          <tr>
            <td>
              <div class="cell-main">${esc(u.full_name || u.username)}</div>
              <div class="cell-sub mono">${esc(u.username)}${u.id === state.user.id ? ' · you' : ''}</div>
            </td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-muted'}">${esc(u.role)}</span></td>
            <td>${u.active
              ? '<span class="badge badge-ok">Active</span>'
              : '<span class="badge badge-danger">Disabled</span>'}</td>
            <td class="small muted">${esc(when(u.created_at, { withTime: false }))}</td>
            <td><div class="row-actions"><button class="btn btn-sm" data-edit="${u.id}">Edit</button></div></td>
          </tr>`).join('')}</tbody>
      </table></div></div>
    </div>`;

  root.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openForm(rows.find((u) => u.id === Number(b.dataset.edit)), ctx)));
}

function openForm(user, ctx) {
  const u = user || {};
  const isEdit = Boolean(user);
  const isSelf = isEdit && u.id === state.user.id;

  modal({
    title: isEdit ? `Edit ${u.username}` : 'Add User',
    body: `
      <form id="user-form">
        <div class="form-grid">
          <label class="field">
            <span>Username *</span>
            <input name="username" required maxlength="60" value="${esc(u.username || '')}"
                   ${isEdit ? 'disabled' : ''} pattern="[a-zA-Z0-9._-]+" />
          </label>
          <label class="field">
            <span>Full name</span>
            <input name="full_name" maxlength="120" value="${esc(u.full_name || '')}" />
          </label>
          <label class="field span-2">
            <span>Role *</span>
            <select name="role" ${isSelf ? 'disabled' : ''}>
              ${Object.entries(ROLE_HELP).map(([r, help]) =>
                `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)} — ${help}</option>`).join('')}
            </select>
          </label>
          <label class="field span-2">
            <span>${isEdit ? 'New password <span class="hint">leave blank to keep the current one</span>' : 'Password * <span class="hint">at least 8 characters</span>'}</span>
            <input name="${isEdit ? 'new_password' : 'password'}" type="password"
                   ${isEdit ? '' : 'required'} minlength="8" maxlength="200" autocomplete="new-password" />
          </label>
        </div>
        ${isEdit && !isSelf ? `<label class="check">
          <input type="checkbox" name="active" ${u.active ? 'checked' : ''} />
          <span>Active — uncheck to block this user from signing in</span>
        </label>` : ''}
        ${isSelf ? '<div class="alert alert-info">You cannot change your own role or disable your own account.</div>' : ''}
        <div id="user-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>Cancel</button>
      ${isEdit && !isSelf ? '<button class="btn btn-danger" id="del-btn">Delete</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'Save' : 'Add user'}</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#user-form');
      const errBox = el.querySelector('#user-error');
      const btn = el.querySelector('#save-btn');

      const submit = async (e) => {
        e?.preventDefault();
        btn.disabled = true;
        errBox.innerHTML = '';
        try {
          const data = formData(form);
          if (isEdit) {
            // Disabled inputs are omitted from the payload, so restore them.
            if (isSelf) { data.role = u.role; data.active = true; }
            if (!data.new_password) delete data.new_password;
            await api.updateUser(u.id, data);
          } else {
            await api.createUser(data);
          }
          toast(isEdit ? 'User updated' : `User "${data.username}" created`);
          close();
          ctx.refresh();
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
          btn.disabled = false;
        }
      };

      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);

      el.querySelector('#del-btn')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Delete user?',
          message: `Delete <strong>${esc(u.username)}</strong>? Their past sales and stock records stay, but stop showing a user name.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteUser(u.id);
          toast('User deleted');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
