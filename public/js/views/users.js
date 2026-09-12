import { api } from '../api.js';
import { ROLE_LABELS, confirmDialog, empty, esc, formData, modal, roleLabel, state, toast, when } from '../ui.js';

const ROLE_HELP = {
  admin:   'সবকিছুতে প্রবেশাধিকার, ব্যবহারকারী ও সেটিংসসহ',
  manager: 'ব্যবহারকারী ব্যবস্থাপনা ছাড়া সবকিছু',
  staff:   'শুধু বিক্রয় ও স্টক লেনদেন',
};

export async function render(root, ctx) {
  const rows = await api.users();

  ctx.setActions('<button class="btn btn-primary" id="add-btn">＋ ব্যবহারকারী যোগ করুন</button>')
    .querySelector('#add-btn')
    .addEventListener('click', () => openForm(null, ctx));

  root.innerHTML = `
    <div class="alert alert-info">
      <strong>ভূমিকা:</strong>
      ${ROLE_LABELS.admin} — ${ROLE_HELP.admin}। ·
      ${ROLE_LABELS.manager} — ${ROLE_HELP.manager}। ·
      ${ROLE_LABELS.staff} — ${ROLE_HELP.staff}।
    </div>

    <div class="card">
      <div class="card-head"><h2>ব্যবহারকারী</h2><span class="sub">মোট ${rows.length} জন</span></div>
      <div class="card-body tight"><div class="table-wrap"><table>
        <thead><tr><th>ব্যবহারকারী</th><th>ভূমিকা</th><th>অবস্থা</th><th>তৈরি</th><th></th></tr></thead>
        <tbody>${rows.map((u) => `
          <tr>
            <td>
              <div class="cell-main">${esc(u.full_name || u.username)}</div>
              <div class="cell-sub mono">${esc(u.username)}${u.id === state.user.id ? ' · আপনি' : ''}</div>
            </td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-muted'}">${esc(roleLabel(u.role))}</span></td>
            <td>${u.active
              ? '<span class="badge badge-ok">সক্রিয়</span>'
              : '<span class="badge badge-danger">নিষ্ক্রিয়</span>'}</td>
            <td class="small muted">${esc(when(u.created_at, { withTime: false }))}</td>
            <td><div class="row-actions"><button class="btn btn-sm" data-edit="${u.id}">সম্পাদনা</button></div></td>
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
    title: isEdit ? `${u.username} সম্পাদনা` : 'ব্যবহারকারী যোগ করুন',
    body: `
      <form id="user-form">
        <div class="form-grid">
          <label class="field">
            <span>ইউজারনেম *</span>
            <input name="username" required maxlength="60" value="${esc(u.username || '')}"
                   ${isEdit ? 'disabled' : ''} pattern="[a-zA-Z0-9._-]+" />
          </label>
          <label class="field">
            <span>পুরো নাম</span>
            <input name="full_name" maxlength="120" value="${esc(u.full_name || '')}" />
          </label>
          <label class="field span-2">
            <span>ভূমিকা *</span>
            <select name="role" ${isSelf ? 'disabled' : ''}>
              ${Object.entries(ROLE_HELP).map(([r, help]) =>
                `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel(r)} — ${help}</option>`).join('')}
            </select>
          </label>
          <label class="field span-2">
            <span>${isEdit ? 'নতুন পাসওয়ার্ড <span class="hint">বর্তমানটি রাখতে ফাঁকা রাখুন</span>' : 'পাসওয়ার্ড * <span class="hint">কমপক্ষে ৮ অক্ষর</span>'}</span>
            <input name="${isEdit ? 'new_password' : 'password'}" type="password"
                   ${isEdit ? '' : 'required'} minlength="8" maxlength="200" autocomplete="new-password" />
          </label>
        </div>
        ${isEdit && !isSelf ? `<label class="check">
          <input type="checkbox" name="active" ${u.active ? 'checked' : ''} />
          <span>সক্রিয় — টিক তুলে দিলে এই ব্যবহারকারী সাইন ইন করতে পারবেন না</span>
        </label>` : ''}
        ${isSelf ? '<div class="alert alert-info">আপনি নিজের ভূমিকা বদলাতে বা নিজের অ্যাকাউন্ট নিষ্ক্রিয় করতে পারবেন না।</div>' : ''}
        <div id="user-error"></div>
      </form>`,
    footer: `
      <button class="btn" data-close>বাতিল</button>
      ${isEdit && !isSelf ? '<button class="btn btn-danger" id="del-btn">মুছে ফেলুন</button>' : ''}
      <button class="btn btn-primary" id="save-btn">${isEdit ? 'সংরক্ষণ' : 'ব্যবহারকারী যোগ করুন'}</button>`,
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
          toast(isEdit ? 'ব্যবহারকারী হালনাগাদ হয়েছে' : `"${data.username}" ব্যবহারকারী তৈরি হয়েছে`);
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
          title: 'ব্যবহারকারী মুছে ফেলবেন?',
          message: `<strong>${esc(u.username)}</strong> মুছে ফেলবেন? তাদের পুরনো বিক্রয় ও স্টকের নথি থেকে যাবে, তবে ব্যবহারকারীর নাম আর দেখাবে না।`,
          confirmLabel: 'মুছে ফেলুন',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.deleteUser(u.id);
          toast('ব্যবহারকারী মুছে ফেলা হয়েছে');
          close();
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  });
}
