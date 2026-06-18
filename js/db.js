// js/db.js — Lumers Gestão Financeira
// Backend: Vercel API + Turso

const _API = '/api';

// ── Auth Store ────────────────────────────────────────────────────────────────
// Impersonação ("ver como usuário"): quando lg_imp_token existe, ele é usado no
// Bearer e o model reflete o usuário-ALVO. O token/usuário do admin (lg_token /
// lg_user) permanecem intactos para o admin poder voltar (exitImpersonation).
const _store = {
  get isImpersonating() { return !!localStorage.getItem('lg_imp_token'); },
  get token()  { return localStorage.getItem('lg_imp_token') || localStorage.getItem('lg_token'); },
  setToken(v)  { v ? localStorage.setItem('lg_token', v) : localStorage.removeItem('lg_token'); },
  get model()  {
    const key = this.isImpersonating ? 'lg_imp_user' : 'lg_user';
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  },
  setModel(v)  { v ? localStorage.setItem('lg_user', JSON.stringify(v)) : localStorage.removeItem('lg_user'); },
  get isValid(){ return !!this.token && !!this.model; },
  clear()      {
    localStorage.removeItem('lg_token'); localStorage.removeItem('lg_user');
    localStorage.removeItem('lg_imp_token'); localStorage.removeItem('lg_imp_user');
  }
};

// Entra no modo "ver como usuário": grava token+alvo e recarrega no dashboard do alvo.
function enterImpersonation(token, targetUser) {
  localStorage.setItem('lg_imp_token', token);
  localStorage.setItem('lg_imp_user', JSON.stringify(targetUser || {}));
  location.hash = '#/';
  location.reload();
}

// Sai do modo impersonação: limpa apenas os dados de impersonação e volta ao
// painel admin com o token normal. `notice` (opcional) é exibido após o reload.
function exitImpersonation(notice) {
  localStorage.removeItem('lg_imp_token');
  localStorage.removeItem('lg_imp_user');
  if (notice) sessionStorage.setItem('_lg_imp_notice', notice);
  location.hash = '#/admin-users';
  location.reload();
}

// ── API Request ───────────────────────────────────────────────────────────────
async function _api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (_store.token) headers['Authorization'] = 'Bearer ' + _store.token;
  const res = await fetch(_API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (_store.isImpersonating) {
      // Token de impersonação expirou (2h): volta ao painel admin com o token normal.
      exitImpersonation('Sessão de visualização expirada. Você voltou ao painel admin.');
      throw Object.assign(new Error('Unauthorized'), { response: { message: 'Sessão de visualização expirada' } });
    }
    _store.clear();
    showAuthScreen();
    throw Object.assign(new Error('Unauthorized'), { response: { message: 'Sessão expirada' } });
  }
  if (!res.ok) {
    throw Object.assign(new Error(data.error || 'Erro'), {
      response: { message: data.error || 'Erro', data: data.fields || {} }
    });
  }
  return data;
}

// ── PocketBase Compatibility Shim ─────────────────────────────────────────────
const pb = {
  authStore: {
    get model()   { return _store.model; },
    get record()  { return _store.model; },
    get isValid() { return _store.isValid; },
    clear()       { _store.clear(); }
  },

  collection(name) {
    return {
      async getFullList(opts = {}) {
        if (name === 'users') return _api('GET', '/admin/users');
        if (name === 'user_plans') {
          const all = await _api('GET', '/admin/user-plans');
          if (opts.filter) {
            const em = opts.filter.match(/email\s*=\s*"([^"]*)"/);
            if (em) return all.filter(p => p.email === em[1]);
            const ui = opts.filter.match(/user_id\s*=\s*'([^']*)'/);
            if (ui) return all.filter(p => p.user_id === ui[1]);
          }
          return all;
        }
        return _api('GET', `/data/${name}`);
      },

      async getOne(id) {
        return _api('GET', `/data/${name}/${id}`);
      },

      async create(data) {
        if (name === 'users') {
          const res = await _api('POST', '/auth/register', data);
          return res.user;
        }
        if (name === 'user_plans') {
          const res = await _api('POST', '/admin/user-plans', data);
          return res;
        }
        const res = await _api('POST', `/data/${name}`, data);
        return { id: res.id };
      },

      async update(id, data) {
        if (name === 'users') {
          if (data.oldPassword !== undefined) {
            return _api('POST', '/user/password', data);
          }
          const res = await _api('PUT', '/user/profile', data);
          const user = _store.model;
          if (user) { Object.assign(user, data); _store.setModel(user); }
          return res;
        }
        if (name === 'user_plans') return _api('PUT', `/admin/user-plans/${id}`, data);
        return _api('PUT', `/data/${name}/${id}`, data);
      },

      async delete(id) {
        if (name === 'users')      return _api('DELETE', `/admin/users/${id}`);
        if (name === 'user_plans') return _api('DELETE', `/admin/user-plans/${id}`);
        return _api('DELETE', `/data/${name}/${id}`);
      },

      async authWithPassword(email, password) {
        const res = await _api('POST', '/auth/login', { email, password });
        _store.setToken(res.token);
        _store.setModel(res.user);
        return res;
      },

      async requestPasswordReset(email) {
        return _api('POST', '/auth/forgot', { email });
      },

      async confirmPasswordReset(token, password, passwordConfirm) {
        return _api('POST', '/auth/reset', { token, password, passwordConfirm });
      },
    };
  }
};

// ── Filter Parser ─────────────────────────────────────────────────────────────
function _parseFilter(filterStr, record) {
  try {
    const js = filterStr
      .replace(/(\w+)\s*!=\s*""/g,         (_, f) => `(record["${f}"] !== '' && record["${f}"] != null)`)
      .replace(/(\w+)\s*=\s*'([^']*)'/g,   (_, f, v) => `record["${f}"] === '${v}'`)
      .replace(/(\w+)\s*!=\s*'([^']*)'/g,  (_, f, v) => `record["${f}"] !== '${v}'`)
      .replace(/(\w+)\s*=\s*true\b/g,      (_, f) => `(record["${f}"] === true || record["${f}"] === 1)`)
      .replace(/(\w+)\s*=\s*false\b/g,     (_, f) => `(record["${f}"] === false || record["${f}"] === 0)`)
      .replace(/(\w+)\s*!=\s*(-?\d+\.?\d*)/g,(_, f, v) => `record["${f}"] != ${v}`)
      .replace(/(\w+)\s*=\s*(-?\d+\.?\d*)/g, (_, f, v) => `record["${f}"] == ${v}`);
    return new Function('record', `return !!(${js})`)(record);
  } catch { return true; }
}

// ── Collection Factory ────────────────────────────────────────────────────────
function makeCollection(name) {
  return {
    async toArray() {
      return _api('GET', `/data/${name}`);
    },
    async get(id) {
      try { return await _api('GET', `/data/${name}/${id}`); }
      catch { return undefined; }
    },
    async add(record) {
      const { id: _id, ...data } = record;
      const res = await _api('POST', `/data/${name}`, data);
      return res.id;
    },
    async update(id, changes) {
      const { id: _i, user: _u, created: _c, updated: _up,
              collectionId: _ci, collectionName: _cn, expand: _e, ...data } = changes;
      await _api('PUT', `/data/${name}/${id}`, data);
    },
    async delete(id) {
      await _api('DELETE', `/data/${name}/${id}`);
    },
    filter(predicate) {
      const isStr = typeof predicate === 'string';
      return {
        async toArray() {
          const all = await _api('GET', `/data/${name}`);
          return isStr ? all.filter(r => _parseFilter(predicate, r)) : all.filter(predicate);
        },
        async count() {
          const arr = await this.toArray();
          return arr.length;
        }
      };
    },
    where(field) {
      return {
        equals(value) {
          return {
            async toArray() {
              const all = await _api('GET', `/data/${name}`);
              return all.filter(r => r[field] === value);
            }
          };
        }
      };
    },
    async bulkAdd(records) {
      for (const record of records) {
        const { id: _id, ...data } = record;
        await _api('POST', `/data/${name}`, data);
      }
    },
    async count() {
      const all = await _api('GET', `/data/${name}`);
      return all.length;
    }
  };
}

const db = {
  categories:            makeCollection('categories'),
  templates:             makeCollection('templates'),
  transactions:          makeCollection('transactions'),
  accounts:              makeCollection('accounts'),
  banks:                 makeCollection('banks'),
  settings:              makeCollection('settings'),
  installments:          makeCollection('installments'),
  goals:                 makeCollection('goals'),
  investments:           makeCollection('investments'),
  investmentTransactions: makeCollection('investment_transactions'),
  assets:                makeCollection('assets'),
  assetValuations:       makeCollection('asset_valuations'),
};

// ── Auth UI ───────────────────────────────────────────────────────────────────
let _registerAllowed = false;

async function _loadRegisterStatus() {
  try {
    const data = await fetch('/api/auth/register-status').then(r => r.json());
    _registerAllowed = !!data.allow_registration;
  } catch (_) {
    _registerAllowed = false;
  }
  const toggleRow = document.getElementById('auth-toggle-row');
  if (toggleRow) toggleRow.style.display = _registerAllowed ? '' : 'none';
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  _loadRegisterStatus();
}
function hideAuthScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
}

let _authMode = 'login';
function toggleAuthMode(e) {
  e.preventDefault();
  if (_authMode === 'forgot') { _restoreLoginMode(); return; }
  if (!_registerAllowed && _authMode === 'login') return;
  _authMode = _authMode === 'login' ? 'signup' : 'login';
  const s = _authMode === 'signup';
  document.getElementById('auth-title').textContent       = s ? 'Criar conta'  : 'Entrar';
  document.getElementById('auth-submit').textContent      = s ? 'Criar conta'  : 'Entrar no Lumers Flow';
  document.getElementById('auth-submit').onclick          = submitAuth;
  document.getElementById('auth-toggle-text').textContent = s ? 'Já tem conta?' : 'Não tem conta?';
  document.getElementById('auth-toggle').textContent      = s ? 'Entrar'       : 'Criar conta';
  document.getElementById('auth-name-group').style.display     = s ? '' : 'none';
  document.getElementById('auth-phone-group').style.display    = s ? '' : 'none';
  document.getElementById('auth-confirm-group').style.display  = s ? '' : 'none';
  document.getElementById('auth-password-group').style.display = '';
  document.getElementById('auth-forgot-link').style.display    = s ? 'none' : '';
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';
}

function toggleForgotMode(e) {
  e.preventDefault();
  _authMode = 'forgot';
  document.getElementById('auth-title').textContent       = 'Redefinir senha';
  document.getElementById('auth-submit').textContent      = 'Enviar link de redefinição';
  // subtitle removido no novo design
  document.getElementById('auth-submit').onclick          = submitForgotPassword;
  document.getElementById('auth-toggle-text').textContent = 'Lembrou a senha?';
  document.getElementById('auth-toggle').textContent      = 'Fazer login';
  document.getElementById('auth-name-group').style.display     = 'none';
  document.getElementById('auth-phone-group').style.display    = 'none';
  document.getElementById('auth-confirm-group').style.display  = 'none';
  document.getElementById('auth-password-group').style.display = 'none';
  document.getElementById('auth-forgot-link').style.display    = 'none';
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';
}

function _restoreLoginMode() {
  _authMode = 'login';
  document.getElementById('auth-title').textContent       = 'Entrar';
  document.getElementById('auth-submit').textContent      = 'Entrar';
  document.getElementById('auth-submit').onclick          = submitAuth;
  document.getElementById('auth-toggle-text').textContent = 'Não tem conta?';
  document.getElementById('auth-toggle').textContent      = 'Criar conta';
  document.getElementById('auth-name-group').style.display     = 'none';
  document.getElementById('auth-phone-group').style.display    = 'none';
  document.getElementById('auth-confirm-group').style.display  = 'none';
  document.getElementById('auth-password-group').style.display = '';
  document.getElementById('auth-forgot-link').style.display    = '';
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';
}

async function submitForgotPassword() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) { _authError('Informe seu e-mail'); return; }
  const btn = document.getElementById('auth-submit');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await pb.collection('users').requestPasswordReset(email);
    const card = document.querySelector('#auth-screen .form-card');
    card.innerHTML = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:2.8rem;margin-bottom:16px">📧</div>
        <div class="auth-form-title" style="margin-bottom:10px">E-mail enviado!</div>
        <p style="color:#666;font-size:.88rem;line-height:1.6;margin-bottom:24px">
          Enviamos um link de redefinição para <strong>${email}</strong>.<br>
          Verifique sua caixa de entrada (e o spam).
        </p>
        <button class="btn btn-ghost" style="width:100%" onclick="_rebuildAuthCard()">← Voltar ao login</button>
      </div>`;
  } catch(err) {
    btn.disabled = false; btn.textContent = 'Enviar link de redefinição';
    _authError('E-mail não encontrado');
  }
}

function _rebuildAuthCard() {
  const card = document.querySelector('#auth-screen .form-card');
  card.innerHTML = `
    <div class="auth-logo-mark">
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="8" fill="var(--primary-600)"/>
        <rect x="7" y="13" width="14" height="2" rx="1" fill="#fff"/>
        <rect x="7" y="9" width="9" height="2" rx="1" fill="rgba(255,255,255,.6)"/>
        <rect x="7" y="17" width="11" height="2" rx="1" fill="rgba(255,255,255,.4)"/>
      </svg>
    </div>
    <h2 id="auth-title" class="auth-form-title">Bem-vindo de volta</h2>
    <div id="auth-error" style="display:none;color:#c95a47;font-size:.875rem;margin-bottom:14px;text-align:left"></div>
    <div id="auth-name-group" class="form-group" style="display:none">
      <label class="form-label">Nome</label>
      <div class="input-box">
        <i data-lucide="user" style="width:16px;height:16px"></i>
        <input id="auth-name" type="text" placeholder="Seu nome" autocomplete="name"
          onkeydown="if(event.key==='Enter')document.getElementById('auth-submit').click()">
      </div>
    </div>
    <div id="auth-phone-group" class="form-group" style="display:none">
      <label class="form-label">WhatsApp (DDI + DDD + número)</label>
      <div class="input-box">
        <i data-lucide="phone" style="width:16px;height:16px"></i>
        <input id="auth-phone" type="tel" inputmode="numeric" placeholder="Ex: 5561999990000">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">E-mail</label>
      <div class="input-box">
        <i data-lucide="mail" style="width:16px;height:16px"></i>
        <input id="auth-email" type="email" placeholder="seu@email.com" autocomplete="email"
          onkeydown="if(event.key==='Enter')document.getElementById('auth-submit').click()">
      </div>
    </div>
    <div id="auth-password-group" class="form-group">
      <label class="form-label">Senha</label>
      <div class="input-box">
        <i data-lucide="lock" style="width:16px;height:16px"></i>
        <input id="auth-password" type="password" placeholder="••••••••" autocomplete="current-password"
          onkeydown="if(event.key==='Enter')document.getElementById('auth-submit').click()">
      </div>
    </div>
    <div id="auth-confirm-group" class="form-group" style="display:none">
      <label class="form-label">Confirmar senha</label>
      <div class="input-box">
        <i data-lucide="lock" style="width:16px;height:16px"></i>
        <input id="auth-confirm" type="password" placeholder="••••••••" autocomplete="new-password">
      </div>
    </div>
    <button id="auth-submit" class="auth-submit-btn" onclick="submitAuth()">Entrar no Lumers Flow</button>
    <div id="auth-forgot-link" style="margin-top:20px">
      <a href="#" onclick="toggleForgotMode(event)">Problemas ao acessar?</a>
    </div>
    <p id="auth-toggle-row" style="text-align:center;margin-top:16px;font-size:.875rem;color:var(--text-muted);display:${_registerAllowed ? '' : 'none'}">
      <span id="auth-toggle-text">Não tem conta?</span>
      <a href="#" id="auth-toggle" onclick="toggleAuthMode(event)" style="color:var(--primary-600);margin-left:4px;font-weight:600">Criar conta</a>
    </p>`;
  _authMode = 'login';
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [card] });
}

function _checkResetToken() {
  const hashMatch = location.hash.match(/^#\/reset\/(.+)$/);
  const params = new URLSearchParams(window.location.search);
  const token = (hashMatch ? decodeURIComponent(hashMatch[1]) : null)
    || params.get('token')
    || sessionStorage.getItem('_lg_reset_token');
  if (!token) return false;
  sessionStorage.setItem('_lg_reset_token', token);
  window.history.replaceState({}, '', window.location.pathname);
  _showResetForm(token);
  return true;
}

function _showResetForm(token) {
  showAuthScreen();
  const card = document.querySelector('#auth-screen .form-card');
  card.innerHTML = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:2rem;margin-bottom:10px">🔐</div>
      <div class="auth-form-title">Criar nova senha</div>
      <p style="font-size:14px;color:#666;margin-top:8px">Digite e confirme sua nova senha</p>
    </div>
    <div class="form-group">
      <label class="form-label">Nova senha</label>
      <input id="reset-pwd" class="form-control" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password">
    </div>
    <div class="form-group">
      <label class="form-label">Confirmar senha</label>
      <input id="reset-confirm" class="form-control" type="password" placeholder="Repita a nova senha" autocomplete="new-password">
    </div>
    <button id="reset-submit" class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:4px" onclick="submitResetPassword('${token}')">Salvar nova senha</button>
    <div id="reset-error" style="color:var(--expense);font-size:.83rem;margin-top:10px;text-align:center"></div>`;
}

async function submitResetPassword(token) {
  const pwd     = document.getElementById('reset-pwd').value;
  const confirm = document.getElementById('reset-confirm').value;
  const errEl   = document.getElementById('reset-error');
  errEl.textContent = '';
  if (pwd.length < 8)  { errEl.textContent = 'Senha mínima: 8 caracteres'; return; }
  if (pwd !== confirm) { errEl.textContent = 'As senhas não coincidem'; return; }
  const btn = document.getElementById('reset-submit');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    await pb.collection('users').confirmPasswordReset(token, pwd, confirm);
    sessionStorage.removeItem('_lg_reset_token');
    _rebuildAuthCard();
    const errDiv = document.getElementById('auth-error') || (() => {
      const el = document.createElement('p');
      el.id = 'auth-error';
      document.getElementById('auth-submit').after(el); return el;
    })();
    errDiv.style.color = 'var(--income)';
    errDiv.textContent = '✓ Senha atualizada! Faça login com a nova senha.';
  } catch(err) {
    btn.disabled = false; btn.textContent = 'Salvar nova senha';
    errEl.textContent = err?.response?.message || 'Link inválido ou expirado. Solicite um novo.';
  }
}

async function submitAuth() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn      = document.getElementById('auth-submit');
  if (!email || !password) { _authError('Preencha todos os campos'); return; }
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'Aguarde...';
  try {
    if (_authMode === 'signup') {
      const name    = document.getElementById('auth-name').value.trim();
      const phone   = document.getElementById('auth-phone').value.replace(/\D/g, '');
      const confirm = document.getElementById('auth-confirm').value;
      if (!name)                { _authError('Informe seu nome'); return; }
      if (!phone)               { _authError('Informe seu número de WhatsApp'); return; }
      if (password !== confirm) { _authError('As senhas não coincidem'); return; }
      if (password.length < 8)  { _authError('Senha mínima: 8 caracteres'); return; }
      await pb.collection('users').create({ email, password, passwordConfirm: confirm, name, phone });
    }
    const wasSignup = _authMode === 'signup';
    await pb.collection('users').authWithPassword(email, password);
    if (wasSignup) {
      const user = pb.authStore.model;
      _enviarBoasVindasWhatsApp(user);
    }
    hideAuthScreen();
    await app._start();
  } catch (err) {
    const raw  = err?.response?.message || err?.message || '';
    const data = err?.response?.data || {};
    let msg = 'Erro ao autenticar';
    if (raw.toLowerCase().includes('failed to create')) {
      if (data.email) msg = 'Este e-mail já está cadastrado';
      else if (data.phone) msg = 'Este número já está em uso';
      else msg = 'E-mail já cadastrado. Tente fazer login.';
    } else if (raw) { msg = raw; }
    _authError(msg);
  } finally {
    btn.disabled = false; btn.textContent = origText;
  }
}

function _authError(msg) {
  let el = document.getElementById('auth-error');
  if (!el) {
    el = document.createElement('p');
    el.id = 'auth-error';
    document.getElementById('auth-submit').after(el);
  }
  el.textContent = msg;
}

async function _enviarBoasVindasWhatsApp(user) {
  if (!user || !user.phone) return;
  const nome = (user.name || '').split(' ')[0] || 'você';
  const msg = `Olá, ${nome}! 👋 Aqui é a assistente da *Lumers Gestão Financeira*!\n\n` +
    `Estou aqui para facilitar o seu controle financeiro direto pelo WhatsApp. ` +
    `É simples assim:\n\n` +
    `💸 *Despesa:* "gastei 35 no almoço"\n` +
    `💳 *Parcelamento:* "comprei tênis 300 em 3x"\n` +
    `💚 *Receita:* "recebi 2000 de salário"\n` +
    `🔔 *Conta:* "conta de luz 150 vence dia 20"\n\n` +
    `Eu entendo do jeito que você escrever e registro tudo no app automaticamente. Pode testar agora! 🚀`;
  try {
    const _cfg = window.LUMERS_CONFIG || {};
    if (!_cfg.EVOLUTION_URL) return;
    await fetch(_cfg.EVOLUTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': _cfg.EVOLUTION_APIKEY || '' },
      body: JSON.stringify({ number: user.phone, text: msg })
    });
  } catch(_) {}
}

function logout() {
  _store.clear();
  _generatedMonths.clear();
  if (typeof clearCatsCache === 'function') clearCatsCache();
  location.hash = '#/';
  showAuthScreen();
}

// ── Seed & Generate ───────────────────────────────────────────────────────────
const SUGGESTED_CATEGORIES = [
  { name: 'Moradia',               type: 'expense', color: '#2C4630', icon: '🏠' },
  { name: 'Condomínio',            type: 'expense', color: '#3A5A40', icon: '🏢' },
  { name: 'Cartão de Crédito',     type: 'expense', color: '#C95A47', icon: '💳' },
  { name: 'Banco / Financeiro',    type: 'expense', color: '#8E3A30', icon: '🏦' },
  { name: 'Conta de Luz',          type: 'expense', color: '#D4A24C', icon: '💡' },
  { name: 'Conta de Água',         type: 'expense', color: '#2A7C82', icon: '💧' },
  { name: 'Internet',              type: 'expense', color: '#165D62', icon: '🌐' },
  { name: 'Telefone / Celular',    type: 'expense', color: '#669A8C', icon: '📱' },
  { name: 'Educação',              type: 'expense', color: '#4D7549', icon: '📚' },
  { name: 'Transporte',            type: 'expense', color: '#2A7C82', icon: '🚗' },
  { name: 'Alimentação',           type: 'expense', color: '#D4A24C', icon: '🍽️' },
  { name: 'Saúde',                 type: 'expense', color: '#B14939', icon: '❤️' },
  { name: 'Assinaturas',           type: 'expense', color: '#5D594E', icon: '🔄' },
  { name: 'Hospedagem / Infra',    type: 'expense', color: '#3A5A40', icon: '🖥️' },
  { name: 'Lazer',                 type: 'expense', color: '#669A8C', icon: '🎉' },
  { name: 'Manutenção',            type: 'expense', color: '#807B6C', icon: '🔧' },
  { name: 'Impostos / MEI',        type: 'expense', color: '#5D594E', icon: '📋' },
  { name: 'Outros',                type: 'expense', color: '#ADA897', icon: '📦' },
  { name: 'Salário Fixo',          type: 'income',  color: '#3A5A40', icon: '💼' },
  { name: 'Freelance / Projeto',   type: 'income',  color: '#2A7C82', icon: '💻' },
  { name: 'Assessoria / Retainer', type: 'income',  color: '#4D7549', icon: '🤝' },
  { name: 'Comissão / Bônus',      type: 'income',  color: '#D4A24C', icon: '🎯' },
  { name: 'Venda',                 type: 'income',  color: '#669A8C', icon: '🛍️' },
  { name: 'Investimentos',         type: 'income',  color: '#C28A2A', icon: '📈' },
  { name: 'Ajuda de Custos',       type: 'income',  color: '#2C4630', icon: '🤲' },
  { name: 'Outros',                type: 'income',  color: '#ADA897', icon: '💰' },
];

async function seedDefaultCategories() {
  const count = await db.categories.count();
  if (count > 0) return;
  await db.categories.bulkAdd(SUGGESTED_CATEGORIES);
}

async function generateMonthTransactions(month, year) {
  const templates = await db.templates.filter('active = true').toArray();
  if (templates.length === 0) return;
  const existingTplTx = await db.transactions.filter(
    `month = ${month} && year = ${year} && template_id != "" && transaction_type != 'installment'`
  ).toArray();
  const existingTplIds = new Set(existingTplTx.map(t => t.template_id));
  for (const tpl of templates) {
    if (existingTplIds.has(tpl.id)) continue;
    const day = Math.min(tpl.due_day || 1, new Date(year, month, 0).getDate());
    const due = new Date(year, month - 1, day);
    await db.transactions.add({
      template_id:      tpl.id,
      name:             tpl.name,
      category_id:      tpl.category_id || '',
      transaction_type: tpl.transaction_type,
      kind:             tpl.kind,
      amount:           tpl.kind === 'fixed' ? tpl.amount : 0,
      due_date:         due.toISOString().split('T')[0],
      paid_date:        '',
      status:           'pending',
      month, year, notes: ''
    });
  }
}

async function generateInstallmentTransactions(month, year) {
  const [allInst, existingTx] = await Promise.all([
    db.installments.toArray(),
    db.transactions.filter(`transaction_type = 'installment' && month = ${month} && year = ${year}`).toArray()
  ]);

  const existingById = {};
  existingTx.forEach(t => { existingById[t.template_id] = t; });

  for (const inst of allInst) {
    const total = inst.installments || 1;
    const paid  = inst.paid_installments || 0;
    let inRange = false;
    let asPaid  = false;

    if (inst.start_month && inst.start_year) {
      // Index-aware mode: calculate which parcel index this month represents
      const idx = (year - inst.start_year) * 12 + (month - inst.start_month) + 1;
      if (idx < 1 || idx > total) continue; // outside the installment's lifespan
      inRange = true;
      asPaid  = idx <= paid; // parcel already pre-paid → generate as paid, not pending
    } else {
      // Legacy fallback (no start date): only generate for active installments
      if (paid >= total) continue;
      inRange = true;
      asPaid  = false;
    }

    if (!inRange) continue;

    if (existingById[inst.id]) {
      // Transaction already exists — upgrade to paid if it should be
      const existing = existingById[inst.id];
      if (asPaid && existing.status !== 'paid') {
        await db.transactions.update(existing.id, {
          status:    'paid',
          paid_date: existing.paid_date || today(),
          cash_date: existing.cash_date || today(),
        });
      }
      continue;
    }

    const monthly = inst.total_amount / total;
    const day = Math.min(inst.due_day || 1, new Date(year, month, 0).getDate());
    const due = new Date(year, month - 1, day);
    // NB-02: paid_date/cash_date use today() as best-available fallback when a pre-paid
    // parcel is generated late (e.g. user navigates to a future month without passing
    // through payInstallmentN). The real payment date is only known at pay time.
    await db.transactions.add({
      template_id:      inst.id,
      // NB-04: include parcel index in name for index-aware installments
      name:             (inst.start_month && inst.start_year)
                          ? `${inst.name} (${(year - inst.start_year) * 12 + (month - inst.start_month) + 1}/${total})`
                          : inst.name,
      category_id:      inst.category_id || '',
      account_id:       inst.account_id  || '',
      transaction_type: 'installment',
      kind:             'variable',
      amount:           monthly,
      due_date:         due.toISOString().split('T')[0],
      paid_date:        asPaid ? today() : '',
      cash_date:        asPaid ? today() : '',
      status:           asPaid ? 'paid' : 'pending',
      month, year,
      notes:            inst.notes || '',
    });
  }
}

const _generatedMonths = new Set();
async function getOrGenerateMonth(month, year) {
  const key = `${year}-${month}`;
  if (_generatedMonths.has(key)) return;
  await generateMonthTransactions(month, year);
  await generateInstallmentTransactions(month, year);
  _generatedMonths.add(key);
}
