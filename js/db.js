// js/db.js — Lumers Gestão Financeira
// Backend: Vercel API + Turso

const _API = '/api';

// ── Auth Store ────────────────────────────────────────────────────────────────
const _store = {
  get token()  { return localStorage.getItem('lg_token'); },
  setToken(v)  { v ? localStorage.setItem('lg_token', v) : localStorage.removeItem('lg_token'); },
  get model()  {
    try { return JSON.parse(localStorage.getItem('lg_user') || 'null'); }
    catch { return null; }
  },
  setModel(v)  { v ? localStorage.setItem('lg_user', JSON.stringify(v)) : localStorage.removeItem('lg_user'); },
  get isValid(){ return !!this.token && !!this.model; },
  clear()      { localStorage.removeItem('lg_token'); localStorage.removeItem('lg_user'); }
};

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
  if (res.status === 401) {
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
  categories:   makeCollection('categories'),
  templates:    makeCollection('templates'),
  transactions: makeCollection('transactions'),
  settings:     makeCollection('settings'),
  installments: makeCollection('installments'),
  goals:        makeCollection('goals'),
};

// ── Auth UI ───────────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function hideAuthScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
}

let _authMode = 'login';
function toggleAuthMode(e) {
  e.preventDefault();
  if (_authMode === 'forgot') { _restoreLoginMode(); return; }
  _authMode = _authMode === 'login' ? 'signup' : 'login';
  const s = _authMode === 'signup';
  document.getElementById('auth-title').textContent       = s ? 'Criar conta'  : 'Entrar';
  document.getElementById('auth-submit').textContent      = s ? 'Criar conta'  : 'Entrar';
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
    const card = document.querySelector('#auth-screen .card');
    card.innerHTML = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:2.8rem;margin-bottom:16px">📧</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:10px">E-mail enviado!</div>
        <p style="color:var(--text-muted);font-size:.88rem;line-height:1.6;margin-bottom:24px">
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
  const card = document.querySelector('#auth-screen .card');
  card.innerHTML = `
    <div id="auth-title" style="font-size:1.15rem;font-weight:600;margin-bottom:20px;color:var(--text)">Entrar</div>
    <div id="auth-name-group" class="form-group" style="display:none">
      <label class="form-label">Nome</label>
      <input id="auth-name" class="form-control" type="text" placeholder="Seu nome" autocomplete="name">
    </div>
    <div id="auth-phone-group" class="form-group" style="display:none">
      <label class="form-label">WhatsApp (DDI + DDD + número)</label>
      <input id="auth-phone" class="form-control" type="tel" inputmode="numeric" placeholder="Ex: 5561999990000">
    </div>
    <div class="form-group">
      <label class="form-label">E-mail</label>
      <input id="auth-email" class="form-control" type="email" placeholder="seu@email.com" autocomplete="email">
    </div>
    <div id="auth-password-group" class="form-group">
      <label class="form-label">Senha</label>
      <input id="auth-password" class="form-control" type="password" placeholder="••••••••" autocomplete="current-password">
    </div>
    <div id="auth-forgot-link" style="text-align:right;margin-top:-4px;margin-bottom:8px">
      <a href="#" onclick="toggleForgotMode(event)" style="font-size:.82rem;color:var(--primary)">Esqueci minha senha</a>
    </div>
    <div id="auth-confirm-group" class="form-group" style="display:none">
      <label class="form-label">Confirmar senha</label>
      <input id="auth-confirm" class="form-control" type="password" placeholder="••••••••" autocomplete="new-password">
    </div>
    <button id="auth-submit" class="btn btn-primary" style="width:100%;margin-top:8px;padding:12px" onclick="submitAuth()">Entrar</button>
    <p style="text-align:center;margin-top:16px;font-size:.88rem;color:var(--text-muted)">
      <span id="auth-toggle-text">Não tem conta?</span>
      <a href="#" id="auth-toggle" onclick="toggleAuthMode(event)" style="color:var(--primary);margin-left:4px">Criar conta</a>
    </p>`;
  _authMode = 'login';
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
  const card = document.querySelector('#auth-screen .card');
  card.innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:2rem;margin-bottom:8px">🔐</div>
      <div style="font-size:1.15rem;font-weight:700;color:var(--text)">Criar nova senha</div>
    </div>
    <div class="form-group">
      <label class="form-label">Nova senha</label>
      <input id="reset-pwd" class="form-control" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password">
    </div>
    <div class="form-group">
      <label class="form-label">Confirmar senha</label>
      <input id="reset-confirm" class="form-control" type="password" placeholder="Repita a nova senha" autocomplete="new-password">
    </div>
    <button id="reset-submit" class="btn btn-primary" style="width:100%;margin-top:8px;padding:12px" onclick="submitResetPassword('${token}')">Salvar nova senha</button>
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
      el.style.cssText = 'color:var(--income);font-size:.83rem;margin-top:10px;text-align:center;margin-bottom:0';
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
    el.style.cssText = 'color:var(--expense);font-size:.83rem;margin-top:10px;text-align:center;margin-bottom:0';
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
  { name: 'Moradia',               type: 'expense', color: '#6366f1', icon: '🏠' },
  { name: 'Condomínio',            type: 'expense', color: '#8b5cf6', icon: '🏢' },
  { name: 'Cartão de Crédito',     type: 'expense', color: '#ef4444', icon: '💳' },
  { name: 'Banco / Financeiro',    type: 'expense', color: '#f97316', icon: '🏦' },
  { name: 'Conta de Luz',          type: 'expense', color: '#f59e0b', icon: '💡' },
  { name: 'Conta de Água',         type: 'expense', color: '#3b82f6', icon: '💧' },
  { name: 'Internet',              type: 'expense', color: '#06b6d4', icon: '🌐' },
  { name: 'Telefone / Celular',    type: 'expense', color: '#14b8a6', icon: '📱' },
  { name: 'Educação',              type: 'expense', color: '#8b5cf6', icon: '📚' },
  { name: 'Transporte',            type: 'expense', color: '#3b82f6', icon: '🚗' },
  { name: 'Alimentação',           type: 'expense', color: '#f59e0b', icon: '🍽️' },
  { name: 'Saúde',                 type: 'expense', color: '#ef4444', icon: '❤️' },
  { name: 'Assinaturas',           type: 'expense', color: '#64748b', icon: '🔄' },
  { name: 'Hospedagem / Infra',    type: 'expense', color: '#6366f1', icon: '🖥️' },
  { name: 'Lazer',                 type: 'expense', color: '#ec4899', icon: '🎉' },
  { name: 'Manutenção',            type: 'expense', color: '#78716c', icon: '🔧' },
  { name: 'Impostos / MEI',        type: 'expense', color: '#64748b', icon: '📋' },
  { name: 'Outros',                type: 'expense', color: '#94a3b8', icon: '📦' },
  { name: 'Salário Fixo',          type: 'income',  color: '#10b981', icon: '💼' },
  { name: 'Freelance / Projeto',   type: 'income',  color: '#06b6d4', icon: '💻' },
  { name: 'Assessoria / Retainer', type: 'income',  color: '#6366f1', icon: '🤝' },
  { name: 'Comissão / Bônus',      type: 'income',  color: '#f59e0b', icon: '🎯' },
  { name: 'Venda',                 type: 'income',  color: '#14b8a6', icon: '🛍️' },
  { name: 'Investimentos',         type: 'income',  color: '#f59e0b', icon: '📈' },
  { name: 'Ajuda de Custos',       type: 'income',  color: '#8b5cf6', icon: '🤲' },
  { name: 'Outros',                type: 'income',  color: '#94a3b8', icon: '💰' },
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
  const active     = allInst.filter(i => (i.paid_installments || 0) < (i.installments || 1));
  const existingIds = new Set(existingTx.map(t => t.template_id));
  for (const inst of active) {
    if (existingIds.has(inst.id)) continue;
    const monthly = inst.total_amount / (inst.installments || 1);
    const day = Math.min(inst.due_day || 1, new Date(year, month, 0).getDate());
    const due = new Date(year, month - 1, day);
    await db.transactions.add({
      template_id:      inst.id,
      name:             inst.name,
      category_id:      inst.category_id || '',
      transaction_type: 'installment',
      kind:             'variable',
      amount:           monthly,
      due_date:         due.toISOString().split('T')[0],
      paid_date:        '',
      status:           'pending',
      month, year, notes: inst.notes || '',
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
