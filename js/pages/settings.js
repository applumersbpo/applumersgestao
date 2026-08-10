async function renderSettings() {
  const content = document.getElementById('content');
  const user = pb.authStore.model;

  content.innerHTML = `
    <div style="display:grid;gap:20px;max-width:520px">

      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Perfil</div>
        <div class="form-group" style="text-align:center;margin-bottom:24px">
          <div id="settings-avatar-preview" style="
            width:80px;height:80px;border-radius:50%;background:var(--primary-light);
            color:var(--primary);display:flex;align-items:center;justify-content:center;
            font-size:2rem;font-weight:700;margin:0 auto 12px;overflow:hidden;cursor:pointer;
            border:2px solid var(--border)" onclick="document.getElementById('settings-avatar-input').click()">
          </div>
          <input type="file" id="settings-avatar-input" accept="image/*" style="display:none" onchange="_onAvatarFileChange(this)">
          <button class="btn btn-sm btn-outline" onclick="document.getElementById('settings-avatar-input').click()">
            ${icon('camera',14)} Alterar foto
          </button>
          <div id="settings-avatar-feedback" style="font-size:.78rem;margin-top:6px"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Nome</label>
          <input id="set-name" class="form-control" value="${user.name || ''}" placeholder="Seu nome">
        </div>
        <div class="form-group">
          <label class="form-label">E-mail</label>
          <input class="form-control" value="${user.email}" disabled style="opacity:.6;cursor:not-allowed">
        </div>
        <button class="btn btn-primary" onclick="saveProfileName()">Salvar nome</button>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:4px">WhatsApp</div>
        <p style="font-size:.83rem;color:var(--text-muted);margin-bottom:16px">
          Vincule seu número para registrar gastos e receitas direto pelo WhatsApp.
        </p>
        <div class="form-group">
          <label class="form-label">Número com DDI + DDD (só números)</label>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="display:flex;align-items:center;background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;font-weight:600;font-size:.9rem;white-space:nowrap;flex-shrink:0">
              🇧🇷 +55
            </div>
            <input id="set-phone" class="form-control" type="tel" inputmode="numeric"
              value="${_phoneDisplay(user.phone)}"
              placeholder="(61) 99999-0000"
              oninput="this.value=this.value.replace(/\\D/g,'')">
          </div>
          <p style="font-size:.78rem;color:var(--text-muted);margin:6px 0 0">
            DDI do Brasil (+55) aplicado automaticamente. Para outros países, inclua o DDI no início. Ex: <strong>5561999990000</strong>
          </p>
        </div>
        <button class="btn btn-primary" onclick="savePhone()">Salvar número</button>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:4px">Notificações no WhatsApp</div>
        <p style="font-size:.83rem;color:var(--text-muted);margin-bottom:16px">
          Escolha com que frequência você quer receber os avisos automáticos no WhatsApp.
        </p>
        <div id="wa-notify-body"></div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:4px">Notificações por e-mail</div>
        <p style="font-size:.83rem;color:var(--text-muted);margin-bottom:16px">
          Escolha quais e-mails você quer receber. Ative ou desative cada tipo de notificação.
        </p>
        <div id="notif-prefs-body"></div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Alterar senha</div>
        <div class="form-group">
          <label class="form-label">Senha atual</label>
          <input id="set-old-pw" class="form-control" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
          <label class="form-label">Nova senha</label>
          <input id="set-new-pw" class="form-control" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
          <label class="form-label">Confirmar nova senha</label>
          <input id="set-confirm-pw" class="form-control" type="password" placeholder="••••••••">
        </div>
        <button class="btn btn-primary" onclick="savePassword()">Alterar senha</button>
      </div>

      <div class="card" style="border-color:#C95A4740">
        <div class="card-title" style="margin-bottom:6px;color:var(--expense)">Zona de perigo</div>
        <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:16px">
          Ao excluir sua conta todos os seus dados serão removidos permanentemente.
        </p>
        <button class="btn" style="background:var(--expense-light);color:var(--expense-text);border:1px solid rgba(201,90,71,.25)" onclick="confirmDeleteAccount()">
          Excluir minha conta
        </button>
      </div>

    </div>
  `;

  _initAvatarPreview();
  _renderNotificationPrefs();
  _renderWaNotifyPref();
}

const WA_NOTIFY_OPTIONS = [
  { mode: 'daily',      label: 'Tudo (resumo diário + contas a pagar)' },
  { mode: 'weekly',     label: 'Somente resumo semanal (segunda-feira)' },
  { mode: 'biweekly',   label: 'Somente resumo quinzenal (a cada 15 dias)' },
  { mode: 'bills_only', label: 'Somente lembrete de contas a pagar' },
  { mode: 'off',        label: 'Não receber notificações' },
];

async function _renderWaNotifyPref() {
  const body = document.getElementById('wa-notify-body');
  if (!body) return;
  body.innerHTML = `<div style="font-size:.85rem;color:var(--text-muted);padding:6px 0">Carregando...</div>`;

  let mode = 'daily';
  try {
    const r = await _api('GET', '/user/wa-notify');
    mode = r?.mode || 'daily';
  } catch (e) {
    body.innerHTML = `
      <div style="font-size:.85rem;color:var(--text-muted);padding:2px 0 12px">
        Não foi possível carregar sua preferência.
      </div>
      <button class="btn btn-sm btn-outline" onclick="_renderWaNotifyPref()">Tentar novamente</button>`;
    return;
  }

  const opts = WA_NOTIFY_OPTIONS.map(o => {
    const checked = o.mode === mode;
    return `
      <label style="display:flex;align-items:center;gap:12px;padding:10px 0;cursor:pointer;border-bottom:1px solid var(--border)">
        <input type="radio" name="wa-notify-mode" value="${o.mode}" ${checked ? 'checked' : ''}
          style="width:18px;height:18px;accent-color:var(--primary);flex-shrink:0">
        <span style="font-size:.9rem">${_escHtml(o.label)}</span>
      </label>`;
  }).join('');

  body.innerHTML = `
    <div style="margin-bottom:16px">${opts}</div>
    <button id="wa-notify-save" class="btn btn-primary" onclick="saveWaNotifyMode()">Salvar preferência</button>`;
}

async function saveWaNotifyMode() {
  const sel = document.querySelector('input[name="wa-notify-mode"]:checked');
  const mode = sel ? sel.value : 'daily';
  const saveBtn = document.getElementById('wa-notify-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando...'; }
  try {
    await _api('POST', '/user/wa-notify', { mode });
    toast('Preferência salva!', 'success');
  } catch (e) {
    toast(e?.response?.message || 'Erro ao salvar preferência', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar preferência'; }
  }
}

async function _renderNotificationPrefs() {
  const body = document.getElementById('notif-prefs-body');
  if (!body) return;

  body.innerHTML = `<div style="font-size:.85rem;color:var(--text-muted);padding:6px 0">Carregando...</div>`;

  let notifs;
  try {
    notifs = await _api('GET', '/email/my-notifications');
  } catch (e) {
    body.innerHTML = `
      <div style="font-size:.85rem;color:var(--text-muted);padding:2px 0 12px">
        Não foi possível carregar suas preferências.
      </div>
      <button class="btn btn-sm btn-outline" onclick="_renderNotificationPrefs()">Tentar novamente</button>`;
    return;
  }

  if (!Array.isArray(notifs) || notifs.length === 0) {
    body.innerHTML = `
      <div style="font-size:.85rem;color:var(--text-muted);padding:6px 0">
        Nenhuma notificação disponível no momento.
      </div>`;
    return;
  }

  const rows = notifs.map((n, i) => {
    const enabled = !!n.enabled;
    const isLast  = i === notifs.length - 1;
    return `
      <div style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;${isLast ? '' : 'border-bottom:1px solid var(--border)'}">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.9rem">${_escHtml(n.name || n.key || '')}</div>
          ${n.description ? `<div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">${_escHtml(n.description)}</div>` : ''}
        </div>
        ${_notifSwitch(n.key, enabled)}
      </div>`;
  }).join('');

  body.innerHTML = `
    <div style="margin-bottom:16px">${rows}</div>
    <button id="notif-prefs-save" class="btn btn-primary" onclick="saveNotificationPrefs()">Salvar preferências</button>`;
}

function _notifSwitch(key, enabled) {
  return `
    <button type="button" role="switch" aria-checked="${enabled}"
      data-notif-key="${_escHtml(key)}" data-enabled="${enabled ? '1' : '0'}"
      onclick="_toggleNotifPref(this)"
      style="position:relative;flex-shrink:0;width:44px;height:24px;padding:0;border:none;border-radius:999px;
        cursor:pointer;transition:background .2s;background:${enabled ? 'var(--primary)' : 'var(--border)'}">
      <span style="position:absolute;top:2px;left:${enabled ? '22px' : '2px'};width:20px;height:20px;border-radius:50%;
        background:#fff;transition:left .2s;box-shadow:0 1px 2px rgba(0,0,0,.25)"></span>
    </button>`;
}

function _toggleNotifPref(btn) {
  const next = btn.dataset.enabled !== '1';
  btn.dataset.enabled = next ? '1' : '0';
  btn.setAttribute('aria-checked', String(next));
  btn.style.background = next ? 'var(--primary)' : 'var(--border)';
  const knob = btn.querySelector('span');
  if (knob) knob.style.left = next ? '22px' : '2px';
}

async function saveNotificationPrefs() {
  const btns  = document.querySelectorAll('#notif-prefs-body [data-notif-key]');
  const prefs = {};
  btns.forEach(b => { prefs[b.dataset.notifKey] = b.dataset.enabled === '1'; });

  const saveBtn = document.getElementById('notif-prefs-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando...'; }

  try {
    await _api('POST', '/email/my-notifications', { prefs });
    toast('Preferências salvas!', 'success');
  } catch (e) {
    toast(e?.response?.message || 'Erro ao salvar preferências', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar preferências'; }
  }
}

async function _initAvatarPreview() {
  const user    = pb.authStore.model;
  const preview = document.getElementById('settings-avatar-preview');
  if (!preview) return;
  if (user?.avatar) {
    preview.innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    preview.textContent = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  }
}

async function _onAvatarFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Imagem máxima: 2MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result;
    const preview = document.getElementById('settings-avatar-preview');
    if (preview) preview.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover">`;
    const fb = document.getElementById('settings-avatar-feedback');
    if (fb) { fb.textContent = 'Salvando...'; fb.style.color = 'var(--text-muted)'; }
    try {
      const user = pb.authStore.model;
      await _api('PUT', `/collections/users/records/${user.id}`, { avatar: base64 });
      const updated = { ...user, avatar: base64 };
      pb.authStore.model.avatar = base64;
      // Atualiza sidebar
      const sidebarAvatar = document.getElementById('sidebar-profile-avatar');
      if (sidebarAvatar) sidebarAvatar.innerHTML = `<img src="${base64}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      if (fb) { fb.textContent = 'Foto atualizada!'; fb.style.color = 'var(--income)'; }
      setTimeout(() => { if (fb) fb.textContent = ''; }, 3000);
    } catch (_) {
      if (fb) { fb.textContent = 'Erro ao salvar foto.'; fb.style.color = 'var(--expense)'; }
    }
  };
  reader.readAsDataURL(file);
}

/** Exibe o número sem o DDI 55 se o usuário for BR */
function _phoneDisplay(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  // Se começa com 55 e tem 13 dígitos (55 + 11), remove o DDI para exibição
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) {
    return digits.slice(2);
  }
  return digits;
}

/** Normaliza o número para o formato Evolution API: sempre começa com DDI */
function _normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Já tem DDI do Brasil
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Tem DDI de outro país (começa com dígitos != 55 e tem >11 dígitos)
  if (digits.length > 11) return digits;
  // Sem DDI — adiciona 55 Brasil
  return '55' + digits;
}

async function savePhone() {
  const raw = document.getElementById('set-phone').value;
  if (!raw.trim()) { toast('Informe o número', 'error'); return; }
  const phone = _normalizePhone(raw);
  if (phone.length < 12 || phone.length > 15) {
    toast('Número inválido. Use DDI + DDD + número. Ex: 5561999990000', 'error');
    return;
  }
  try {
    await pb.collection('users').update(pb.authStore.model.id, { phone });
    pb.authStore.model.phone = phone;
    toast('Número salvo! (' + phone + ')', 'success');
  } catch(e) {
    toast('Erro ao salvar número', 'error');
  }
}

async function saveProfileName() {
  const name = document.getElementById('set-name').value.trim();
  if (!name) { toast('Informe seu nome', 'error'); return; }

  try {
    await pb.collection('users').update(pb.authStore.model.id, { name });
    pb.authStore.model.name = name;
    const el = document.getElementById('user-name');
    if (el) el.textContent = name;
    // Update sidebar profile name too
    const profileName = document.getElementById('sidebar-profile-name');
    if (profileName) profileName.textContent = name;
    toast('Nome atualizado!', 'success');
  } catch(e) {
    toast('Erro ao salvar', 'error');
  }
}

async function savePassword() {
  const oldPassword     = document.getElementById('set-old-pw').value;
  const password        = document.getElementById('set-new-pw').value;
  const passwordConfirm = document.getElementById('set-confirm-pw').value;

  if (!oldPassword || !password) { toast('Preencha todos os campos', 'error'); return; }
  if (password.length < 8)       { toast('Senha mínima: 8 caracteres', 'error'); return; }
  if (password !== passwordConfirm) { toast('As senhas não coincidem', 'error'); return; }

  try {
    await pb.collection('users').update(pb.authStore.model.id, { oldPassword, password, passwordConfirm });
    document.getElementById('set-old-pw').value     = '';
    document.getElementById('set-new-pw').value     = '';
    document.getElementById('set-confirm-pw').value = '';
    toast('Senha alterada!', 'success');
  } catch(e) {
    const msg = e?.response?.data?.oldPassword?.message || 'Senha atual incorreta';
    toast(msg, 'error');
  }
}

async function confirmDeleteAccount() {
  showModal(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" style="color:var(--expense)">Excluir conta</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.9rem;color:var(--text-muted);margin-bottom:16px">
            Esta ação é irreversível. Todos os seus dados (transações, categorias, recorrências) serão excluídos.
          </p>
          <div class="form-group">
            <label class="form-label">Digite sua senha para confirmar</label>
            <input id="del-password" class="form-control" type="password" placeholder="••••••••">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn" style="background:var(--expense);color:#F8F4E4" onclick="deleteAccount()">Excluir permanentemente</button>
        </div>
      </div>
    </div>
  `);
}

async function deleteAccount() {
  const password = document.getElementById('del-password').value;
  if (!password) { toast('Digite sua senha', 'error'); return; }

  const email = pb.authStore.model.email;

  try {
    await pb.collection('users').authWithPassword(email, password);
  } catch(e) {
    toast('Senha incorreta', 'error');
    return;
  }

  try {
    const userId = pb.authStore.model.id;

    try {
      const plans = await pb.collection('user_plans').getFullList({ filter: `user_id = '${userId}'` });
      for (const p of plans) await pb.collection('user_plans').delete(p.id);
    } catch(_) {}

    await pb.collection('users').delete(userId);

    closeModal();
    pb.authStore.clear();
    _generatedMonths.clear();
    if (typeof clearCatsCache === 'function') clearCatsCache();
    showAuthScreen();
    toast('Conta excluída', 'success');
  } catch(e) {
    toast('Erro ao excluir conta', 'error');
  }
}
