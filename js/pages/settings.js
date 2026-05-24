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
          <label class="form-label">Número com DDD e DDI (só números)</label>
          <input id="set-phone" class="form-control" type="tel" inputmode="numeric"
            value="${user.phone || ''}" placeholder="Ex: 5561999990000">
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

      <div class="card" style="border-color:#ef444440">
        <div class="card-title" style="margin-bottom:6px;color:var(--expense)">Zona de perigo</div>
        <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:16px">
          Ao excluir sua conta todos os seus dados serão removidos permanentemente.
        </p>
        <button class="btn" style="background:#ef444415;color:#ef4444;border:1px solid #ef444430" onclick="confirmDeleteAccount()">
          Excluir minha conta
        </button>
      </div>

    </div>
  `;
}

async function savePhone() {
  const phone = document.getElementById('set-phone').value.replace(/\D/g, '');
  if (!phone) { toast('Informe o número', 'error'); return; }
  try {
    await pb.collection('users').update(pb.authStore.model.id, { phone });
    pb.authStore.model.phone = phone;
    toast('Número salvo!', 'success');
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
          <button class="btn" style="background:#ef4444;color:#fff" onclick="deleteAccount()">Excluir permanentemente</button>
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
