async function renderSettings() {
  const content = document.getElementById('content');
  const user = pb.authStore.model;

  content.innerHTML = `
    <div style="display:grid;gap:20px;max-width:520px">

      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Perfil</div>
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
              oninput="this.value=this.value.replace(/\D/g,'')">
          </div>
          <p style="font-size:.78rem;color:var(--text-muted);margin:6px 0 0">
            DDI do Brasil (+55) aplicado automaticamente. Para outros países, inclua o DDI no início. Ex: <strong>5561999990000</strong>
          </p>
        </div>
        <button class="btn btn-primary" onclick="savePhone()">Salvar número</button>
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
