// ── Estado temporário do editor de brand ──────────────────────────────────────
let _pendingLogoData    = ''; // base64 ou URL do logo (sessão atual)
let _pendingFaviconData = ''; // base64 ou URL do favicon (sessão atual)

// ── Render Admin Dashboard ────────────────────────────────────────────────────

async function renderAdmin() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const stats = await _api('GET', '/admin/users?stats=true');

    const topUsers = (stats.users || []).slice(0, 5);

    content.innerHTML = `
      <div class="summary-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:20px">
        <div class="summary-card">
          <div class="label">${icon('users', 13)} Total de usuários</div>
          <div class="value">${stats.total_users || 0}</div>
        </div>
        <div class="summary-card">
          <div class="label">${icon('dollar-sign', 13)} MRR</div>
          <div class="value">${fmt(stats.mrr || 0)}</div>
        </div>
        <div class="summary-card">
          <div class="label">${icon('trending-up', 13)} Receita gerenciada</div>
          <div class="value" style="color:var(--income)">${fmt(stats.total_income || 0)}</div>
        </div>
        <div class="summary-card">
          <div class="label">${icon('trending-down', 13)} Despesa gerenciada</div>
          <div class="value" style="color:var(--expense)">${fmt(stats.total_expense || 0)}</div>
        </div>
      </div>

      <!-- Quick links -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
        <a href="#/admin-users" class="btn btn-primary btn-sm">
          ${icon('users', 14)} Gerenciar Usuários
        </a>
        <a href="#/admin-system" class="btn btn-secondary btn-sm">
          ${icon('settings', 14)} Configurações do Sistema
        </a>
        <a href="#/banks" class="btn btn-outline btn-sm">
          ${icon('landmark', 14)} Bancos (Admin)
        </a>
      </div>

      <!-- Usuários mais ativos -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-title" style="margin-bottom:12px">${icon('zap', 14)} Usuários mais ativos</div>
        ${topUsers.length === 0
          ? '<p style="color:var(--text-muted);font-size:.9rem">Nenhum dado disponível.</p>'
          : `<div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:.85rem">
                <thead>
                  <tr style="border-bottom:1px solid var(--border);color:var(--text-muted);font-size:.78rem;text-align:left">
                    <th style="padding:6px 8px;font-weight:600">Nome</th>
                    <th style="padding:6px 8px;font-weight:600">E-mail</th>
                    <th style="padding:6px 8px;font-weight:600;text-align:right">Transações</th>
                    <th style="padding:6px 8px;font-weight:600">Último acesso</th>
                  </tr>
                </thead>
                <tbody>
                  ${topUsers.map(u => `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:8px;font-weight:500">${_escHtml(u.name || u.email.split('@')[0])}</td>
                      <td style="padding:8px;color:var(--text-muted)">${_escHtml(u.email)}</td>
                      <td style="padding:8px;text-align:right;font-weight:600">${u.tx_count || 0}</td>
                      <td style="padding:8px;color:var(--text-muted);font-size:.8rem">${u.last_login ? fmtDate(u.last_login) : '—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
             </div>`}
      </div>

      <!-- Bancos mais utilizados -->
      ${stats.banks && stats.banks.length ? `
      <div class="card">
        <div class="card-title" style="margin-bottom:12px">${icon('landmark', 14)} Bancos mais utilizados</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${stats.banks.map(b => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-subtle);border-radius:var(--r-md)">
              <div style="font-weight:600;font-size:.9rem">${_escHtml(b.bank_name)}</div>
              <div style="display:flex;gap:16px;align-items:center">
                <span style="font-size:.8rem;color:var(--text-muted)">${b.user_count} usuário${b.user_count !== 1 ? 's' : ''}</span>
                <span style="font-size:.8rem;color:var(--text-muted)">${b.account_count} conta${b.account_count !== 1 ? 's' : ''}</span>
                <span style="font-size:.85rem;font-weight:600;color:var(--income)">${fmt(b.total_balance || 0)}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

// ── Render Admin Users ────────────────────────────────────────────────────────

let _adminUsersCache = [];

async function renderAdminUsers() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
  try {
    const stats = await _api('GET', '/admin/users?stats=true');
    _adminUsersCache = stats.users || [];
    _renderAdminUsersHtml('');
  } catch(e) {
    content.innerHTML = `<div class="empty-state"><p style="color:var(--expense)">Erro ao carregar: ${e.message}</p></div>`;
  }
}

function _renderAdminUsersHtml(searchTerm) {
  const content = document.getElementById('content');
  const users   = _adminUsersCache;
  const comWpp  = users.filter(u => u.phone).length;
  const filtered = searchTerm
    ? users.filter(u =>
        (u.name  || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.phone || '').includes(searchTerm))
    : users;

  content.innerHTML = `
    <!-- Barra de ações -->
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:16px">
      <div style="flex:1;min-width:180px">
        <input id="admin-user-search" class="form-control" type="search"
          placeholder="Buscar por nome, e-mail ou telefone..."
          value="${_escHtml(searchTerm)}"
          oninput="_adminUsersFilterInput(this.value)">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0">
        <button class="btn btn-sm btn-outline" onclick="adminNormalizePhones()">
          ${icon('phone',13)} Normalizar telefones
        </button>
        <button class="btn btn-sm btn-primary" onclick="openAdminMessageModal()">
          ${icon('send',13)} Mensagem em massa
          ${comWpp > 0 ? `<span style="background:rgba(255,255,255,.25);border-radius:10px;padding:1px 7px;font-size:.72rem;margin-left:4px">${comWpp}</span>` : ''}
        </button>
      </div>
    </div>

    <!-- Contadores -->
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <span style="font-size:.82rem;color:var(--text-muted)">${icon('users',13)} <strong>${users.length}</strong> usuários</span>
      <span style="font-size:.82rem;color:var(--income-text)">${icon('message-circle',13)} <strong>${comWpp}</strong> com WhatsApp</span>
      ${filtered.length !== users.length ? `<span style="font-size:.82rem;color:var(--warning)">${icon('filter',12)} ${filtered.length} resultado(s)</span>` : ''}
    </div>

    <!-- Lista -->
    ${filtered.length === 0
      ? `<div class="empty-state">${icon('search-x',36)}<p>Nenhum usuário encontrado</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${filtered.map(u => _adminUserRow(u)).join('')}
         </div>`}
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _adminUsersFilterInput(term) {
  _renderAdminUsersHtml(term);
}

function _adminUserRow(u) {
  const displayName  = u.name || u.email.split('@')[0];
  const initials     = displayName[0].toUpperCase();
  const phone        = u.phone || '';
  const phoneOk      = _hasValidDDI(phone);
  const balance      = (u.total_income || 0) - (u.total_expense || 0);
  const balanceColor = balance >= 0 ? 'var(--income-text)' : 'var(--expense)';

  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;transition:box-shadow .15s"
         onmouseover="this.style.boxShadow='0 2px 12px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">

      <!-- Linha principal -->
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px">

        <!-- Avatar -->
        <div style="width:42px;height:42px;border-radius:12px;background:var(--primary-light);color:var(--primary);
          display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;flex-shrink:0">
          ${initials}
        </div>

        <!-- Info principal -->
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.93rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${_escHtml(displayName)}
          </div>
          <div style="font-size:.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">
            ${_escHtml(u.email)}
          </div>
        </div>

        <!-- Stats desktop (oculto em mobile) -->
        <div class="admin-user-stats">
          <div style="text-align:center;padding:0 12px;border-right:1px solid var(--border)">
            <div style="font-size:.72rem;color:var(--text-muted)">Transações</div>
            <div style="font-size:.95rem;font-weight:700;color:var(--text)">${u.tx_count || 0}</div>
          </div>
          <div style="text-align:center;padding:0 12px;border-right:1px solid var(--border)">
            <div style="font-size:.72rem;color:var(--text-muted)">Saldo</div>
            <div style="font-size:.88rem;font-weight:700;color:${balanceColor}">${balance >= 0 ? '+' : ''}${fmt(balance)}</div>
          </div>
          <div style="text-align:center;padding:0 12px;border-right:1px solid var(--border)">
            <div style="font-size:.72rem;color:var(--text-muted)">WhatsApp</div>
            <div style="font-size:.8rem;font-weight:600;color:${phoneOk ? 'var(--income-text)' : phone ? 'var(--warning)' : 'var(--text-muted)'}">
              ${phone ? (phoneOk ? '✓ OK' : '⚠ sem DDI') : '—'}
            </div>
          </div>
          <div style="text-align:center;padding:0 12px">
            <div style="font-size:.72rem;color:var(--text-muted)">Último acesso</div>
            <div style="font-size:.78rem;color:var(--text-muted)">${u.last_login ? fmtDate(u.last_login) : '—'}</div>
          </div>
        </div>

        <!-- Ações -->
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:4px">
          <button class="btn btn-sm" style="background:var(--primary-light);color:var(--primary);font-weight:600;gap:4px"
            onclick="renderAdminUserProfile('${u.id}')" title="Ver perfil completo">
            ${icon('bar-chart-2',13)} Perfil
          </button>
          ${phone ? `<button class="btn btn-sm btn-icon btn-ghost" style="color:var(--primary)"
            onclick="_adminMsgOpenFor('${u.id}')"
            title="Enviar mensagem">${icon('send',14)}</button>` : ''}
          <button class="btn btn-sm btn-icon btn-danger"
            onclick="deleteAdminUser('${u.id}','${_escHtml(u.email)}')"
            title="Excluir usuário">${icon('trash-2',14)}</button>
        </div>
      </div>

      <!-- Badge mobile stats -->
      <div class="admin-user-stats-mobile" style="padding:8px 16px 10px;display:flex;gap:12px;border-top:1px solid var(--border);background:var(--bg-subtle)">
        <span style="font-size:.78rem;color:var(--text-muted)">${icon('repeat',11)} ${u.tx_count || 0} tx</span>
        <span style="font-size:.78rem;font-weight:600;color:${balanceColor}">${balance >= 0 ? '+' : ''}${fmt(balance)}</span>
        <span style="font-size:.78rem;color:${phoneOk ? 'var(--income-text)' : phone ? 'var(--warning)' : 'var(--text-muted)'}">
          ${phone ? (phoneOk ? '✓ WhatsApp' : '⚠ sem DDI') : 'Sem WhatsApp'}
        </span>
        <span style="font-size:.78rem;color:var(--text-muted);margin-left:auto">${u.last_login ? fmtDate(u.last_login) : 'Nunca logou'}</span>
      </div>
    </div>`;
}

// ── Perfil Completo do Usuário ─────────────────────────────────────────────────

async function renderAdminUserProfile(userId) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const data = await _api('GET', `/admin/users/${userId}`);
    const { user, monthly, topCategories } = data;

    const displayName  = user.name || user.email.split('@')[0];
    const initials     = displayName[0].toUpperCase();
    const phone        = user.phone || '';
    const phoneOk      = _hasValidDDI(phone);

    // Stats totais a partir do monthly
    const totalIncome  = (monthly || []).reduce((s, m) => s + (m.income  || 0), 0);
    const totalExpense = (monthly || []).reduce((s, m) => s + (m.expense || 0), 0);
    const txTotal      = (monthly || []).reduce((s, m) => s + (m.tx_count || 0), 0);
    const balance      = totalIncome - totalExpense;

    // Gráfico mensal (últimos 12, ordem cronológica)
    const last12 = (monthly || []).slice(0, 12).reverse();
    const maxVal  = Math.max(...last12.map(m => Math.max(m.income || 0, m.expense || 0)), 1);
    const MN = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    // Top categorias
    const maxCat = topCategories && topCategories.length ? (topCategories[0].total || 1) : 1;

    content.innerHTML = `
      <!-- Voltar -->
      <button class="btn btn-ghost btn-sm" style="margin-bottom:16px;gap:6px" onclick="renderAdminUsers()">
        ${icon('arrow-left',14)} Usuários
      </button>

      <!-- Header do usuário -->
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div style="width:56px;height:56px;border-radius:16px;background:var(--primary-light);color:var(--primary);
            display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;flex-shrink:0">
            ${initials}
          </div>
          <div style="flex:1;min-width:160px">
            <div style="font-size:1.15rem;font-weight:700;color:var(--text);margin-bottom:2px">${_escHtml(displayName)}</div>
            <div style="font-size:.83rem;color:var(--text-muted);margin-bottom:6px">${_escHtml(user.email)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <span style="font-size:.78rem;padding:3px 9px;border-radius:20px;font-weight:600;
                background:${phoneOk ? 'var(--income-light,#dcfce7)' : phone ? 'var(--warning-light,#fef9c3)' : 'var(--bg-subtle)'};
                color:${phoneOk ? 'var(--income-text)' : phone ? '#92400e' : 'var(--text-muted)'}">
                ${phone ? `${icon('phone',11)} ${_fmtPhone(phone)}` : 'Sem WhatsApp'}
              </span>
              <span style="font-size:.78rem;padding:3px 9px;border-radius:20px;background:var(--bg-subtle);color:var(--text-muted)">
                ${icon('calendar',11)} Desde ${fmtDate((user.created_at || '').split('T')[0])}
              </span>
              <span style="font-size:.78rem;padding:3px 9px;border-radius:20px;background:var(--bg-subtle);color:var(--text-muted)">
                ${icon('clock',11)} Acesso: ${user.last_login ? fmtDate(user.last_login) : 'Nunca'}
              </span>
            </div>
          </div>
          <!-- Ações rápidas -->
          <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
            ${phone ? `<button class="btn btn-primary btn-sm" onclick="_adminMsgOpenFor('${user.id}')">
              ${icon('send',13)} Mensagem
            </button>` : ''}
            ${phone ? `<button class="btn btn-sm btn-outline" id="wpp-test-${user.id}" onclick="testWhatsApp('${user.id}',this)">
              ${icon('message-circle',13)} Testar WhatsApp
            </button>` : ''}
            <button class="btn btn-sm" style="background:var(--expense-light,#fee2e2);color:var(--expense)"
              onclick="deleteAdminUser('${user.id}','${_escHtml(user.email)}')">
              ${icon('trash-2',13)} Excluir
            </button>
          </div>
        </div>
      </div>

      <!-- KPIs financeiros -->
      <div class="summary-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
        <div class="summary-card income-card">
          <div class="label">${icon('trending-up',12)} Receita total</div>
          <div class="value">${fmt(totalIncome)}</div>
        </div>
        <div class="summary-card expense-card">
          <div class="label">${icon('trending-down',12)} Despesa total</div>
          <div class="value">${fmt(totalExpense)}</div>
        </div>
        <div class="summary-card ${balance >= 0 ? 'balance-positive' : 'balance-negative'}">
          <div class="label">${icon('calculator',12)} Saldo acumulado</div>
          <div class="value">${balance >= 0 ? '+' : ''}${fmt(balance)}</div>
        </div>
        <div class="summary-card">
          <div class="label">${icon('repeat',12)} Transações</div>
          <div class="value">${last12.reduce((s, m) => s + (parseInt(m.tx_count) || 0), 0) || '—'}</div>
        </div>
      </div>

      <!-- Gráfico mês a mês -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="margin-bottom:16px">${icon('bar-chart-2',14)} Movimentação mensal</div>
        ${last12.length === 0
          ? `<div class="empty-state" style="padding:24px"><p>Sem movimentação registrada</p></div>`
          : `<div style="display:flex;gap:6px;align-items:flex-end;height:120px;overflow-x:auto;padding-bottom:4px">
              ${last12.map(m => {
                const incH = Math.max(Math.round(((m.income  || 0) / maxVal) * 100), m.income  > 0 ? 3 : 0);
                const expH = Math.max(Math.round(((m.expense || 0) / maxVal) * 100), m.expense > 0 ? 3 : 0);
                return `
                  <div style="flex:1;min-width:28px;display:flex;flex-direction:column;align-items:center;gap:3px">
                    <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:100px">
                      <div style="flex:1;background:var(--income);border-radius:3px 3px 0 0;height:${incH}px"
                           title="Receita: ${fmt(m.income||0)}"></div>
                      <div style="flex:1;background:var(--expense);border-radius:3px 3px 0 0;height:${expH}px"
                           title="Despesa: ${fmt(m.expense||0)}"></div>
                    </div>
                    <span style="font-size:.6rem;color:var(--text-muted);text-align:center;line-height:1.2">
                      ${MN[(m.month-1)]}<br><span style="opacity:.7">${String(m.year).slice(2)}</span>
                    </span>
                  </div>`;
              }).join('')}
            </div>
            <div style="display:flex;gap:16px;margin-top:10px">
              <span style="font-size:.75rem;color:var(--income-text);display:flex;align-items:center;gap:4px">
                <span style="width:10px;height:10px;border-radius:2px;background:var(--income);display:inline-block"></span> Receita
              </span>
              <span style="font-size:.75rem;color:var(--expense);display:flex;align-items:center;gap:4px">
                <span style="width:10px;height:10px;border-radius:2px;background:var(--expense);display:inline-block"></span> Despesa
              </span>
            </div>`}
      </div>

      <!-- Detalhamento mensal -->
      ${last12.length > 0 ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="margin-bottom:12px">${icon('calendar',14)} Detalhamento por mês</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.82rem;min-width:320px">
            <thead>
              <tr style="border-bottom:2px solid var(--border);color:var(--text-muted);font-size:.75rem;text-align:right">
                <th style="padding:6px 10px;text-align:left;font-weight:600">Mês</th>
                <th style="padding:6px 10px;font-weight:600">Receita</th>
                <th style="padding:6px 10px;font-weight:600">Despesa</th>
                <th style="padding:6px 10px;font-weight:600">Saldo</th>
              </tr>
            </thead>
            <tbody>
              ${last12.map(m => {
                const sal = (m.income || 0) - (m.expense || 0);
                return `<tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px 10px;font-weight:600">${MN[m.month-1]}/${m.year}</td>
                  <td style="padding:8px 10px;text-align:right;color:var(--income-text);font-weight:600">${fmt(m.income||0)}</td>
                  <td style="padding:8px 10px;text-align:right;color:var(--expense);font-weight:600">${fmt(m.expense||0)}</td>
                  <td style="padding:8px 10px;text-align:right;font-weight:700;color:${sal>=0?'var(--income-text)':'var(--expense)'}">${sal>=0?'+':''}${fmt(sal)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      <!-- Top categorias -->
      ${topCategories && topCategories.length ? `
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">${icon('tag',14)} Top categorias de despesa</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${topCategories.map(c => {
            const pct   = Math.round(((c.total || 0) / maxCat) * 100);
            const color = c.color || '#ADA897';
            return `
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                  <span style="font-size:.88rem;font-weight:600">
                    ${c.icon || '📦'} ${_escHtml(c.name || 'Sem categoria')}
                  </span>
                  <span style="font-size:.88rem;font-weight:700;color:var(--expense)">${fmt(c.total || 0)}</span>
                </div>
                <div class="progress-bar" style="margin:0">
                  <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch(e) {
    content.innerHTML = `
      <button class="btn btn-ghost btn-sm" style="margin-bottom:16px" onclick="renderAdminUsers()">
        ${icon('arrow-left',14)} Voltar
      </button>
      <div class="empty-state"><p style="color:var(--expense)">Erro ao carregar perfil: ${_escHtml(e.message)}</p></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

// ── Render Admin System ───────────────────────────────────────────────────────

async function renderAdminSystem() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const brandCfg = await fetch('/api/brand').then(r => r.json()).catch(() => ({}));

    // Reseta pendentes ao entrar na página
    _pendingLogoData    = '';
    _pendingFaviconData = '';

    content.innerHTML = _adminBrandSection(brandCfg);

    if (typeof lucide !== 'undefined') lucide.createIcons();
    _initBrandEditor();
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

// ── Message Modal ─────────────────────────────────────────────────────────────

const _ADMIN_MSG_TEMPLATES = [
  {
    icon: 'wrench',
    label: 'Manutenção',
    text: '⚙️ *Aviso importante:* o Lumers Flow passará por uma manutenção programada. Em breve estará de volta, ainda melhor do que antes. Agradecemos a sua compreensão! 🙏',
  },
  {
    icon: 'sparkles',
    label: 'Atualização',
    text: '🚀 *Novidade no Lumers Flow!* Acabamos de lançar melhorias que vão transformar a sua gestão financeira. Acesse agora e confira tudo o que preparamos para você!\n\n👉 https://app.lumersbpo.com.br/ ✨',
  },
  {
    icon: 'share-2',
    label: 'Indique um amigo',
    text: '💡 *Você conhece alguém que merece ter as finanças no controle?* Compartilhe o Lumers Flow com um amigo e ajude-o a tomar decisões financeiras mais inteligentes. Juntos, crescemos mais! 🤝\n\n👉 https://app.lumersbpo.com.br/',
  },
];

// Open modal pre-selecting specific user IDs (pass [] for mass / no pre-selection)
function openAdminMessageModal(preSelectedIds = []) {
  const usersWithPhone = (_adminUsersCache || []).filter(u => u.phone);

  // Pre-select only users that have phone
  window._adminMsgSelected = new Set(
    preSelectedIds.filter(id => usersWithPhone.some(u => u.id === id))
  );

  const tplButtons = _ADMIN_MSG_TEMPLATES.map((t, i) => `
    <button class="btn btn-sm btn-outline" style="font-size:.78rem" onclick="_adminMsgTemplate(${i})">
      ${icon(t.icon, 12)} ${t.label}
    </button>`).join('');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:540px;width:calc(100% - 32px);max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header" style="flex-shrink:0">
          <div class="modal-title">${icon('send', 16)} Enviar mensagem via WhatsApp</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;padding-bottom:4px">

          <!-- Destinatários -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase">
                Destinatários &mdash; <span id="msg-sel-count">0</span> selecionado(s)
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-outline" style="padding:3px 10px;font-size:.75rem" onclick="_msgSelectAll()">Todos</button>
                <button class="btn btn-sm btn-ghost"   style="padding:3px 10px;font-size:.75rem" onclick="_msgClearAll()">Limpar</button>
              </div>
            </div>
            <!-- Search -->
            <div style="position:relative;margin-bottom:8px">
              <div style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-muted);display:flex">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </div>
              <input id="msg-recipients-search" class="form-control" type="search"
                placeholder="Buscar por nome, e-mail ou telefone…"
                oninput="_renderMsgRecipients(this.value)"
                style="padding-left:32px">
            </div>
            <!-- List -->
            <div id="msg-recipients-list"
              style="max-height:190px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface)">
            </div>
          </div>

          <!-- Templates -->
          <div>
            <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Mensagens prontas</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${tplButtons}</div>
          </div>

          <!-- Texto -->
          <div class="form-group" style="margin:0">
            <label class="form-label">Mensagem</label>
            <textarea id="msg-text" class="form-control" rows="4"
              placeholder="Digite a mensagem aqui…" style="resize:vertical"></textarea>
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:3px">
              Formatação WhatsApp: *negrito*, _itálico_, ~tachado~
            </div>
          </div>

          <!-- Mídia -->
          <div class="form-group" style="margin:0">
            <label class="form-label">Mídia (opcional)</label>
            <div id="msg-media-preview" style="display:none;background:var(--bg-subtle);border-radius:var(--r-md);padding:9px 12px;margin-bottom:8px;align-items:center;gap:8px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
              <span id="msg-media-name" style="font-size:.82rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
              <button class="btn btn-icon btn-ghost" style="width:24px;height:24px" onclick="_adminMsgClearMedia()">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <label class="btn btn-sm btn-outline" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
              ${icon('paperclip', 13)} Anexar arquivo
              <input type="file" id="msg-file" style="display:none"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                onchange="_adminMsgFileSelected(this)">
            </label>
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:5px">Fotos, vídeos, áudios, PDF, Word, Excel…</div>
          </div>

          <div id="msg-result"></div>
        </div>
        <div class="modal-footer" style="flex-shrink:0">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="msg-send-btn" onclick="_sendAdminMessage()" disabled>
            ${icon('send', 14)} Enviar para 0
          </button>
        </div>
      </div>
    </div>
  `);

  _renderMsgRecipients('');
}

// Helper to open for a single user (avoids JSON-in-onclick)
function _adminMsgOpenFor(userId) {
  openAdminMessageModal([userId]);
}

function _renderMsgRecipients(search) {
  const all = _adminUsersCache || [];
  const sel = window._adminMsgSelected || new Set();
  const q   = (search || '').toLowerCase().trim();

  const filtered = q
    ? all.filter(u =>
        (u.name  || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.phone || '').includes(q))
    : all;

  // Sort: selected first → has phone → alphabetical
  const sorted = [...filtered].sort((a, b) => {
    const aS = sel.has(a.id), bS = sel.has(b.id);
    if (aS !== bS) return aS ? -1 : 1;
    const aP = !!a.phone, bP = !!b.phone;
    if (aP !== bP) return aP ? -1 : 1;
    return (a.name || a.email).localeCompare(b.name || b.email, 'pt');
  });

  const listEl  = document.getElementById('msg-recipients-list');
  const countEl = document.getElementById('msg-sel-count');
  const btnEl   = document.getElementById('msg-send-btn');

  if (listEl) {
    if (sorted.length === 0) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:.85rem">Nenhum usuário encontrado</div>`;
    } else {
      listEl.innerHTML = sorted.map(u => {
        const hasPhone = !!u.phone;
        const checked  = sel.has(u.id);
        return `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 14px;
            border-bottom:1px solid var(--border);
            cursor:${hasPhone ? 'pointer' : 'default'};
            background:${checked ? 'var(--primary-light,#e8f5e9)' : 'transparent'};
            user-select:none">
            <input type="checkbox" ${checked ? 'checked' : ''} ${!hasPhone ? 'disabled' : ''}
              onchange="_msgToggleUser('${_escHtml(u.id)}',this.checked)"
              style="width:15px;height:15px;flex-shrink:0;accent-color:var(--primary);cursor:pointer">
            <div style="flex:1;min-width:0">
              <div style="font-size:.84rem;font-weight:${checked ? '700' : '500'};color:var(--text);
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${_escHtml(u.name || u.email)}
              </div>
              <div style="font-size:.73rem;color:${hasPhone ? 'var(--income-text,#166534)' : 'var(--text-muted)'}">
                ${hasPhone ? '📱 ' + u.phone : 'Sem WhatsApp cadastrado'}
              </div>
            </div>
            ${checked ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="3"><polyline points="20,6 9,17 4,12"/></svg>` : ''}
          </label>`;
      }).join('');
    }
  }

  if (countEl) countEl.textContent = sel.size;
  if (btnEl) {
    btnEl.disabled = sel.size === 0;
    btnEl.innerHTML = `${icon('send', 14)} Enviar para ${sel.size}`;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btnEl] });
  }
}

function _msgToggleUser(id, checked) {
  const sel = window._adminMsgSelected || new Set();
  if (checked) sel.add(id); else sel.delete(id);
  window._adminMsgSelected = sel;
  _renderMsgRecipients(document.getElementById('msg-recipients-search')?.value || '');
}

function _msgSelectAll() {
  window._adminMsgSelected = new Set(
    (_adminUsersCache || []).filter(u => u.phone).map(u => u.id)
  );
  _renderMsgRecipients(document.getElementById('msg-recipients-search')?.value || '');
}

function _msgClearAll() {
  window._adminMsgSelected = new Set();
  _renderMsgRecipients(document.getElementById('msg-recipients-search')?.value || '');
}

function _adminMsgTemplate(idx) {
  const t = _ADMIN_MSG_TEMPLATES[idx];
  if (t) document.getElementById('msg-text').value = t.text;
}

function _adminMsgFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const preview = document.getElementById('msg-media-preview');
  const nameEl  = document.getElementById('msg-media-name');
  if (preview) preview.style.display = 'flex';
  if (nameEl)  nameEl.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
}

function _adminMsgClearMedia() {
  const input = document.getElementById('msg-file');
  if (input) input.value = '';
  const preview = document.getElementById('msg-media-preview');
  if (preview) preview.style.display = 'none';
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _detectMediaType(file) {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'document';
}

async function _sendAdminMessage() {
  const userIds  = [...(window._adminMsgSelected || new Set())];
  const text     = document.getElementById('msg-text')?.value?.trim() || '';
  const fileInput = document.getElementById('msg-file');
  const file     = fileInput?.files?.[0] || null;
  const resultEl = document.getElementById('msg-result');
  const btn      = document.getElementById('msg-send-btn');

  if (!userIds.length) { toast('Selecione ao menos um destinatário', 'error'); return; }
  if (!text && !file)  { toast('Digite uma mensagem ou anexe um arquivo', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Enviando…';

  try {
    let media_base64 = null, media_type = null, media_name = null;
    if (file) {
      media_base64 = await _fileToBase64(file);
      media_type   = _detectMediaType(file);
      media_name   = file.name;
    }

    const res = await _api('POST', '/admin/users', {
      action: 'send-message',
      user_ids: userIds,
      text: text || ' ',
      ...(media_base64 ? { media_base64, media_type, media_name } : {}),
    });

    if (resultEl) {
      const ok = res.sent > 0;
      resultEl.innerHTML = `
        <div style="background:${ok ? 'var(--income-light,#dcfce7)' : '#fee2e2'};border-radius:var(--r-md);
          padding:10px 12px;font-size:.85rem;display:flex;gap:8px;align-items:flex-start;margin-top:4px">
          ${icon(ok ? 'check-circle' : 'alert-circle', 14)}
          <div>
            <strong>${res.sent}</strong> de <strong>${res.total}</strong> mensagens enviadas com sucesso.
            ${res.results?.filter(r => !r.ok).length
              ? `<div style="margin-top:4px;color:#dc2626;font-size:.78rem">
                   Falhas: ${res.results.filter(r => !r.ok).map(r => _escHtml(r.error || 'erro')).join(' | ')}
                 </div>` : ''}
          </div>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [resultEl] });
    }

    toast(`${res.sent}/${res.total} enviadas`, res.sent === res.total ? 'success' : 'warning');
    if (res.sent > 0 && res.sent === res.total) setTimeout(() => closeModal(), 2500);
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao enviar'), 'error');
  } finally {
    const b = document.getElementById('msg-send-btn');
    if (b) { b.disabled = false; b.innerHTML = icon('send', 14) + ' Enviar para ' + userIds.length; }
  }
}

// ── HTML da seção de brand ────────────────────────────────────────────────────

function _adminBrandSection(cfg) {
  const c = _normalizeBrand(cfg);

  // Helper: campo de cor com swatch visual
  const colorField = (id, label, val, hint = '') => `
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:.75rem;font-weight:600;color:var(--text-muted);letter-spacing:.01em">${label}</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" id="bp-${id}" value="${_escHtml(val)}"
          style="width:34px;height:34px;border:1.5px solid var(--border);border-radius:var(--r-md);
                 padding:2px;cursor:pointer;background:var(--surface);flex-shrink:0">
        <input id="bt-${id}" class="form-control" value="${_escHtml(val)}"
          style="font-family:'JetBrains Mono',monospace;font-size:.82rem;padding:7px 10px;
                 text-transform:uppercase;letter-spacing:.04em;min-width:0">
      </div>
      ${hint ? `<span style="font-size:.72rem;color:var(--text-soft)">${hint}</span>` : ''}
    </div>`;

  // Helper: campo de mídia
  const mediaField = (id, label, hint, currentData) => {
    const isBase64 = currentData && currentData.startsWith('data:');
    const urlVal   = isBase64 ? '' : _escHtml(currentData || '');
    const hasMedia = !!currentData;
    return `
    <div class="form-group">
      <label class="form-label">${label}</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;
          padding:8px 14px;border:1.5px dashed var(--border);border-radius:var(--r-md);
          font-size:.83rem;color:var(--primary-600);font-weight:500;transition:border-color .15s,background .15s"
          onmouseover="this.style.borderColor='var(--primary-600)';this.style.background='var(--primary-50)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='transparent'">
          <i data-lucide="upload" style="width:14px;height:14px"></i>
          Enviar arquivo
          <input type="file" accept="image/*" style="display:none" onchange="_onMediaFile(this, '${id}')">
        </label>
        ${hasMedia && isBase64
          ? `<span id="${id}-file-label" style="font-size:.78rem;color:var(--income-text);font-weight:600">✓ Arquivo carregado</span>`
          : `<span id="${id}-file-label" style="font-size:.78rem;color:var(--text-soft)"></span>`}
      </div>
      <p style="font-size:.75rem;color:var(--text-soft);margin:5px 0 8px;line-height:1.5">${hint}</p>
      <label class="form-label" style="font-size:.76rem">Ou cole uma URL</label>
      <input id="${id}-url" class="form-control" value="${urlVal}" placeholder="https://..." oninput="_onMediaUrl(this, '${id}')">
      <div id="${id}-preview" style="margin-top:10px;${hasMedia ? '' : 'display:none'}">
        ${hasMedia ? `<img src="${_escHtml(currentData)}" alt=""
          style="height:48px;border-radius:var(--r-md);border:1px solid var(--border);padding:4px;background:var(--bg-subtle)"
          onerror="this.style.display='none'">` : ''}
      </div>
    </div>`;
  };

  // Separator
  const sep = title => `
    <div style="display:flex;align-items:center;gap:10px;margin:24px 0 14px">
      <span style="font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
        color:var(--text-muted);white-space:nowrap">${title}</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>`;

  // Mini sidebar preview
  const sidebarPreview = `
    <div style="background:${_escHtml(c.sidebarBg)};border-radius:var(--r-lg);padding:12px;
      display:flex;flex-direction:column;gap:4px;min-width:170px">
      <div style="font-family:'Spectral',Georgia,serif;font-size:.85rem;font-weight:500;
        color:${_escHtml(c.sidebarActive)};padding:4px 6px;margin-bottom:2px;border-bottom:1px solid rgba(248,244,228,.1);
        padding-bottom:8px">Lumers Flow</div>
      <div style="font-size:.6rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
        color:${_escHtml(c.sidebarTextMuted || c.sidebarText)};opacity:.7;padding:4px 8px 2px">Operação</div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;
        background:rgba(248,244,228,.16);position:relative;">
        <span style="position:absolute;left:0;top:20%;bottom:20%;width:3px;
          background:${_escHtml(c.sidebarAccent || c.warning)};border-radius:0 2px 2px 0;
          box-shadow:0 0 5px ${_escHtml(c.sidebarAccent || c.warning)}77"></span>
        <div style="width:6px;height:6px;border-radius:50%;background:${_escHtml(c.primary)}"></div>
        <span style="font-size:.78rem;color:${_escHtml(c.sidebarActive)};font-weight:600">Dashboard</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;
        background:rgba(248,244,228,.11)">
        <div style="width:6px;height:6px;border-radius:50%;background:${_escHtml(c.sidebarHoverText || c.sidebarText)};opacity:.7"></div>
        <span style="font-size:.78rem;color:${_escHtml(c.sidebarHoverText || c.sidebarText)}">Receitas <span style="font-size:.65rem;opacity:.6">(hover)</span></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px">
        <div style="width:6px;height:6px;border-radius:50%;background:${_escHtml(c.sidebarText)};opacity:.5"></div>
        <span style="font-size:.78rem;color:${_escHtml(c.sidebarText)};opacity:.8">Despesas</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;
        margin-top:4px;border-top:1px solid rgba(248,244,228,.1)">
        <span style="font-size:.72rem;color:${_escHtml(c.sidebarLogout || '#F4DCD4')};opacity:.7">Sair</span>
      </div>
    </div>`;

  // Paleta de swatches rápidos
  const palette = [
    { label: 'Primária',       color: c.primary },
    { label: 'Primária dark',  color: c.primaryDark },
    { label: 'Acento',         color: c.warning },
    { label: 'Receita',        color: c.income },
    { label: 'Despesa',        color: c.expense },
    { label: 'Fundo',          color: c.bg },
    { label: 'Sidebar bg',     color: c.sidebarBg },
    { label: 'Sidebar texto',  color: c.sidebarText },
    { label: 'Sidebar muted',  color: c.sidebarTextMuted || c.sidebarText },
    { label: 'Hover texto',    color: c.sidebarHoverText || c.sidebarActive },
    { label: 'Acento sidebar', color: c.sidebarAccent || c.warning },
    { label: 'Logout',         color: c.sidebarLogout || '#F4DCD4' },
  ];
  const paletteStrip = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
      ${palette.map(p => `
        <div title="${p.label}" style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="width:32px;height:32px;border-radius:var(--r-md);background:${_escHtml(p.color)};
            border:1.5px solid rgba(0,0,0,.08)"></div>
          <span style="font-size:.6rem;color:var(--text-soft);text-align:center;line-height:1.2;max-width:40px">${p.label}</span>
        </div>`).join('')}
    </div>`;

  return `
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <div class="card-title">Identidade Visual</div>
          <p style="font-size:.85rem;color:var(--text-muted);margin:4px 0 0;line-height:1.5">
            Personalize cores, logotipo e favicon. Aplicado para todos os usuários ao salvar.
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn btn-sm btn-secondary" onclick="_previewBrandConfig()">
            <i data-lucide="eye" style="width:14px;height:14px"></i>
            Pré-visualizar
          </button>
          <button class="btn btn-sm btn-ghost" style="color:var(--expense)" onclick="_resetBrandConfig()">Restaurar padrões</button>
        </div>
      </div>

      <!-- Paleta atual + preview sidebar -->
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;
        background:var(--bg-subtle);border-radius:var(--r-lg);padding:16px;margin-bottom:8px">
        <div style="flex:1;min-width:180px">
          <div style="font-size:.75rem;font-weight:600;color:var(--text-muted);
            letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">Paleta atual</div>
          ${paletteStrip}
        </div>
        <div>
          <div style="font-size:.75rem;font-weight:600;color:var(--text-muted);
            letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">Preview sidebar</div>
          ${sidebarPreview}
        </div>
      </div>

      ${sep('Aplicativo')}
      <div class="form-group">
        <label class="form-label">Nome do aplicativo</label>
        <input id="b-appName" class="form-control" value="${_escHtml(c.appName)}" placeholder="Lumers Flow">
      </div>

      ${sep('Logotipo & Favicon')}
      ${mediaField('b-logo', 'Logotipo', 'PNG, SVG, JPEG, WEBP — recomendado fundo transparente. Máx 4MB.', c.logoData)}
      ${mediaField('b-favicon', 'Favicon', 'PNG 32×32 ou ICO — ícone da aba do navegador. Máx 4MB.', c.faviconData)}

      ${sep('Cores da Marca')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:8px">
        ${colorField('primary',      'Cor primária',    c.primary,      'Base do sistema — botões, links, ativo')}
        ${colorField('primaryDark',  'Primária escura', c.primaryDark,  'Hover / sombra de botão')}
        ${colorField('primaryLight', 'Primária clara',  c.primaryLight, 'Fundo de badges e destaques')}
      </div>

      ${sep('Semânticas')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${colorField('income',       'Receita',         c.income,       'Positivo / entrada')}
        ${colorField('incomeLight',  'Receita clara',   c.incomeLight,  'Fundo de badge de receita')}
        ${colorField('expense',      'Despesa',         c.expense,      'Negativo / saída')}
        ${colorField('expenseLight', 'Despesa clara',   c.expenseLight, 'Fundo de badge de despesa')}
        ${colorField('warning',      'Alerta / Acento', c.warning,      'Alertas, pendentes e accent CTA')}
        ${colorField('warningLight', 'Alerta claro',    c.warningLight, 'Fundo de badge de alerta')}
      </div>

      ${sep('Interface')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        ${colorField('bg',        'Fundo geral', c.bg,        'Background do app')}
        ${colorField('surface',   'Cartões',     c.surface,   'Cards, modais, inputs')}
        ${colorField('border',    'Bordas',      c.border,    'Linhas divisórias')}
        ${colorField('text',      'Texto',       c.text,      'Texto principal — alto contraste')}
        ${colorField('textMuted', 'Texto suave', c.textMuted, 'Labels, meta, legendas')}
      </div>

      ${sep('Barra Lateral')}
      <p style="font-size:.78rem;color:var(--text-soft);margin:-6px 0 12px;line-height:1.5">
        Fundos hover/ativo são derivados automaticamente de "Texto ativo" com 11%/16% de opacidade. O glow usa o Acento com 45%.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${colorField('sidebarBg',        'Fundo',              c.sidebarBg,        'Background da sidebar')}
        ${colorField('sidebarText',      'Texto dos itens',    c.sidebarText,      'Itens de menu não ativos')}
        ${colorField('sidebarTextMuted', 'Labels de seção',    c.sidebarTextMuted, '"Operação", "Administração"')}
        ${colorField('sidebarHoverText', 'Texto hover',        c.sidebarHoverText, 'Texto ao passar o cursor')}
        ${colorField('sidebarActive',    'Texto item ativo',   c.sidebarActive,    'Item selecionado (define fundo hover/ativo)')}
        ${colorField('sidebarAccent',    'Acento / indicador', c.sidebarAccent,    'Barra lateral ativa e glow')}
      </div>

      ${sep('Botão Sair (Sidebar)')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${colorField('sidebarLogout',   'Texto',       c.sidebarLogout,   'Cor do texto do botão Sair')}
        ${colorField('logoutBg',        'Fundo',       c.logoutBg,        'Background do botão (padrão = sidebar bg)')}
        ${colorField('logoutHoverBg',   'Fundo hover', c.logoutHoverBg,   'Background ao passar o cursor')}
        ${colorField('logoutHoverText', 'Texto hover', c.logoutHoverText, 'Texto ao passar o cursor')}
      </div>

      ${sep('Topbar')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${colorField('topbarBg',   'Fundo',  c.topbarBg,   'Cor base (aplicada com 94% opacidade + blur)')}
        ${colorField('topbarText', 'Texto',  c.topbarText, 'Título da página na barra superior')}
      </div>

      ${sep('Bottom Navigation (mobile)')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${colorField('bottomNavBg',     'Fundo',         c.bottomNavBg,     'Cor base (95% opacidade + blur)')}
        ${colorField('bottomNavText',   'Ícone inativo', c.bottomNavText,   'Itens não selecionados')}
        ${colorField('bottomNavActive', 'Ativo',         c.bottomNavActive, 'Item selecionado')}
        ${colorField('bottomNavHover',  'Hover',         c.bottomNavHover,  'Cor ao passar o cursor')}
      </div>

      ${sep('Fluxo Anual — Cores')}
      <p style="font-size:.78rem;color:var(--text-soft);margin:-6px 0 12px;line-height:1.5">
        Cores do dashboard <strong>Fluxo Anual</strong> (Contas a Pagar e a Receber mês a mês).
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        ${colorField('annualCardHeader',    'Cabeçalho card',     c.annualCardHeader,    'Header dos cards mensais')}
        ${colorField('annualReceiver',      'Área A Receber',     c.annualReceiver,      'Fundo das células de recebimentos')}
        ${colorField('annualPayer',         'Área A Pagar',       c.annualPayer,         'Fundo das células de pagamentos')}
        ${colorField('annualOverdue',       'Área Atrasados',     c.annualOverdue,       'Fundo das células com atraso')}
        ${colorField('annualSaldoPos',      'Saldo positivo',     c.annualSaldoPos,      'Cor quando saldo > 0')}
        ${colorField('annualSaldoNeg',      'Saldo negativo',     c.annualSaldoNeg,      'Cor quando saldo < 0')}
        ${colorField('annualSaldoZero',     'Saldo zerado',       c.annualSaldoZero,     'Cor quando saldo = 0')}
        ${colorField('annualBorder',        'Bordas',             c.annualBorder,        'Linhas divisórias dos cards')}
        ${colorField('annualSummaryAccent', 'Acento resumo',      c.annualSummaryAccent, 'Destaque dos cards de resumo anual')}
      </div>

      <div style="display:flex;gap:10px;padding-top:20px;border-top:1px solid var(--border);
        margin-top:24px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="saveBrandConfig()">
          <i data-lucide="save" style="width:14px;height:14px"></i>
          Salvar tudo
        </button>
        <button class="btn btn-secondary" onclick="_previewBrandConfig()">Pré-visualizar</button>
        <button class="btn btn-ghost" style="color:var(--expense)" onclick="_resetBrandConfig()">Restaurar padrões</button>
      </div>
    </div>`;
}

// ── Inicialização do editor ───────────────────────────────────────────────────

function _initBrandEditor() {
  const colorIds = [
    'primary', 'primaryDark', 'primaryLight',
    'income', 'incomeLight', 'expense', 'expenseLight',
    'warning', 'warningLight',
    'bg', 'surface', 'border', 'text', 'textMuted',
    'sidebarBg', 'sidebarText', 'sidebarTextMuted',
    'sidebarActive', 'sidebarHoverText', 'sidebarAccent', 'sidebarLogout',
    'logoutBg', 'logoutHoverBg', 'logoutHoverText',
    'topbarBg', 'topbarText',
    'bottomNavBg', 'bottomNavText', 'bottomNavActive', 'bottomNavHover',
    'annualCardHeader', 'annualReceiver', 'annualPayer', 'annualOverdue',
    'annualSaldoPos', 'annualSaldoNeg', 'annualSaldoZero',
    'annualBorder', 'annualSummaryAccent',
  ];

  colorIds.forEach(id => {
    const picker = document.getElementById(`bp-${id}`);
    const text   = document.getElementById(`bt-${id}`);
    if (!picker || !text) return;
    picker.addEventListener('input', () => { text.value = picker.value; });
    text.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
    });
  });

  // Auto-computa variantes ao mudar a cor principal
  const autoDerive = [
    ['primary',  'primaryDark',  _darken,  null],
    ['primary',  'primaryLight', _lighten, null],
    ['income',   'incomeLight',  _lighten, null],
    ['expense',  'expenseLight', _lighten, null],
    ['warning',  'warningLight', _lighten, null],
  ];
  autoDerive.forEach(([srcId, dstId, fn]) => {
    const srcPicker = document.getElementById(`bp-${srcId}`);
    if (!srcPicker) return;
    srcPicker.addEventListener('input', () => {
      const v = fn(srcPicker.value);
      const dp = document.getElementById(`bp-${dstId}`);
      const dt = document.getElementById(`bt-${dstId}`);
      if (dp) dp.value = v;
      if (dt) dt.value = v;
    });
  });
}

// ── Upload de mídia (logo / favicon) ─────────────────────────────────────────

async function _compressImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) { reject(new Error('Arquivo muito grande (máx 4MB)')); return; }
    const reader = new FileReader();
    reader.onload = e => {
      if (file.type === 'image/svg+xml') { resolve(e.target.result); return; }
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png', 0.88));
      };
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

async function _onMediaFile(input, fieldId) {
  const file = input.files[0];
  if (!file) return;

  const label = document.getElementById(`${fieldId}-file-label`);
  if (label) { label.textContent = 'Processando...'; label.style.color = 'var(--text-muted)'; }

  try {
    const isLogo   = fieldId === 'b-logo';
    const maxW     = isLogo ? 512 : 64;
    const maxH     = isLogo ? 512 : 64;
    const data     = await _compressImage(file, maxW, maxH);

    if (isLogo) {
      _pendingLogoData = data;
    } else {
      _pendingFaviconData = data;
    }

    // Limpa URL field (arquivo tem prioridade)
    const urlInput = document.getElementById(`${fieldId}-url`);
    if (urlInput) urlInput.value = '';

    // Preview
    _showMediaPreview(fieldId, data);
    if (label) { label.textContent = `✓ ${file.name}`; label.style.color = 'var(--income)'; }
  } catch(e) {
    if (label) { label.textContent = ''; }
    toast(e.message, 'error');
  }
}

function _onMediaUrl(input, fieldId) {
  const url = input.value.trim();
  // Arquivo previamente carregado é descartado se o user digitar URL
  if (fieldId === 'b-logo') {
    _pendingLogoData = '';
    const lbl = document.getElementById('b-logo-file-label');
    if (lbl) lbl.textContent = '';
  } else {
    _pendingFaviconData = '';
    const lbl = document.getElementById('b-favicon-file-label');
    if (lbl) lbl.textContent = '';
  }
  _showMediaPreview(fieldId, url);
}

function _showMediaPreview(fieldId, src) {
  const preview = document.getElementById(`${fieldId}-preview`);
  if (!preview) return;
  if (src) {
    preview.style.display = '';
    preview.innerHTML = `<img src="${_escHtml(src)}" alt="" style="height:48px;border-radius:8px;border:1px solid var(--border);padding:4px;background:#f8fafc" onerror="this.style.display='none'">`;
  } else {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
}

// ── Coleta o formulário ───────────────────────────────────────────────────────

function _collectBrandForm() {
  const gp = id => document.getElementById(`bp-${id}`)?.value || '';
  const gt = id => document.getElementById(`bt-${id}`)?.value || gp(id);

  const logoUrl    = document.getElementById('b-logo-url')?.value.trim()    || '';
  const faviconUrl = document.getElementById('b-favicon-url')?.value.trim() || '';

  return {
    appName:       document.getElementById('b-appName')?.value.trim() || 'Lumers Flow',
    primary:       gt('primary'),
    primaryDark:   gt('primaryDark'),
    primaryLight:  gt('primaryLight'),
    income:        gt('income'),
    incomeLight:   gt('incomeLight'),
    expense:       gt('expense'),
    expenseLight:  gt('expenseLight'),
    warning:       gt('warning'),
    warningLight:  gt('warningLight'),
    bg:            gt('bg'),
    surface:       gt('surface'),
    border:        gt('border'),
    text:          gt('text'),
    textMuted:     gt('textMuted'),
    sidebarBg:        gt('sidebarBg'),
    sidebarText:      gt('sidebarText'),
    sidebarTextMuted: gt('sidebarTextMuted'),
    sidebarActive:    gt('sidebarActive'),
    sidebarHoverText: gt('sidebarHoverText'),
    sidebarAccent:    gt('sidebarAccent'),
    sidebarLogout:    gt('sidebarLogout'),
    logoutBg:         gt('logoutBg'),
    logoutHoverBg:    gt('logoutHoverBg'),
    logoutHoverText:  gt('logoutHoverText'),
    topbarBg:         gt('topbarBg'),
    topbarText:       gt('topbarText'),
    bottomNavBg:      gt('bottomNavBg'),
    bottomNavText:    gt('bottomNavText'),
    bottomNavActive:  gt('bottomNavActive'),
    bottomNavHover:   gt('bottomNavHover'),
    annualCardHeader:    gt('annualCardHeader'),
    annualReceiver:      gt('annualReceiver'),
    annualPayer:         gt('annualPayer'),
    annualOverdue:       gt('annualOverdue'),
    annualSaldoPos:      gt('annualSaldoPos'),
    annualSaldoNeg:      gt('annualSaldoNeg'),
    annualSaldoZero:     gt('annualSaldoZero'),
    annualBorder:        gt('annualBorder'),
    annualSummaryAccent: gt('annualSummaryAccent'),
    logoData:      _pendingLogoData    || logoUrl,
    faviconData:   _pendingFaviconData || faviconUrl,
  };
}

// ── Popula o formulário ───────────────────────────────────────────────────────

function _populateBrandForm(cfg) {
  const c = _normalizeBrand(cfg);
  const set = (id, val) => {
    const p = document.getElementById(`bp-${id}`);
    const t = document.getElementById(`bt-${id}`);
    if (p) p.value = val;
    if (t) t.value = val;
  };

  document.getElementById('b-appName').value = c.appName;
  set('primary',       c.primary);
  set('primaryDark',   c.primaryDark);
  set('primaryLight',  c.primaryLight);
  set('income',        c.income);
  set('incomeLight',   c.incomeLight);
  set('expense',       c.expense);
  set('expenseLight',  c.expenseLight);
  set('warning',       c.warning);
  set('warningLight',  c.warningLight);
  set('bg',            c.bg);
  set('surface',       c.surface);
  set('border',        c.border);
  set('text',          c.text);
  set('textMuted',     c.textMuted);
  set('sidebarBg',        c.sidebarBg);
  set('sidebarText',      c.sidebarText);
  set('sidebarTextMuted', c.sidebarTextMuted);
  set('sidebarActive',    c.sidebarActive);
  set('sidebarHoverText', c.sidebarHoverText);
  set('sidebarAccent',    c.sidebarAccent);
  set('sidebarLogout',    c.sidebarLogout);
  set('logoutBg',         c.logoutBg);
  set('logoutHoverBg',    c.logoutHoverBg);
  set('logoutHoverText',  c.logoutHoverText);
  set('topbarBg',         c.topbarBg);
  set('topbarText',       c.topbarText);
  set('bottomNavBg',      c.bottomNavBg);
  set('bottomNavText',    c.bottomNavText);
  set('bottomNavActive',  c.bottomNavActive);
  set('bottomNavHover',   c.bottomNavHover);
  set('annualCardHeader',    c.annualCardHeader);
  set('annualReceiver',      c.annualReceiver);
  set('annualPayer',         c.annualPayer);
  set('annualOverdue',       c.annualOverdue);
  set('annualSaldoPos',      c.annualSaldoPos);
  set('annualSaldoNeg',      c.annualSaldoNeg);
  set('annualSaldoZero',     c.annualSaldoZero);
  set('annualBorder',        c.annualBorder);
  set('annualSummaryAccent', c.annualSummaryAccent);

  // Logo
  _pendingLogoData = c.logoData?.startsWith('data:') ? c.logoData : '';
  const logoUrlEl  = document.getElementById('b-logo-url');
  if (logoUrlEl)  logoUrlEl.value = c.logoData?.startsWith('data:') ? '' : (c.logoData || '');
  _showMediaPreview('b-logo', c.logoData || '');

  // Favicon
  _pendingFaviconData = c.faviconData?.startsWith('data:') ? c.faviconData : '';
  const favUrlEl      = document.getElementById('b-favicon-url');
  if (favUrlEl) favUrlEl.value = c.faviconData?.startsWith('data:') ? '' : (c.faviconData || '');
  _showMediaPreview('b-favicon', c.faviconData || '');
}

// ── Ações ─────────────────────────────────────────────────────────────────────

function _previewBrandConfig() {
  _applyBrand(_collectBrandForm());
  toast('Pré-visualização aplicada (não salvo)', 'success');
}

function _resetBrandConfig() {
  if (!confirm('Restaurar todos os padrões visuais? A pré-visualização será aplicada mas não salva até você clicar em "Salvar tudo".')) return;
  _pendingLogoData    = '';
  _pendingFaviconData = '';
  _populateBrandForm(getBrandDefaults());
  _applyBrand(getBrandDefaults());
  toast('Padrões restaurados (pré-visualizando). Clique em Salvar tudo para confirmar.', 'success');
}

async function saveBrandConfig() {
  const cfg = _collectBrandForm();

  // Valida hexadecimais
  const hexFields = ['primary','primaryDark','primaryLight','income','incomeLight',
    'expense','expenseLight','warning','warningLight','bg','surface','border',
    'text','textMuted','sidebarBg','sidebarText','sidebarActive',
    'logoutBg','logoutHoverBg','logoutHoverText',
    'topbarBg','topbarText',
    'bottomNavBg','bottomNavText','bottomNavActive','bottomNavHover',
    'annualCardHeader','annualReceiver','annualPayer','annualOverdue',
    'annualSaldoPos','annualSaldoNeg','annualSaldoZero',
    'annualBorder','annualSummaryAccent'];
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  for (const f of hexFields) {
    if (!hexRe.test(cfg[f])) {
      toast(`Cor inválida em "${f}". Use o formato #rrggbb`, 'error');
      return;
    }
  }

  const btn = document.querySelector('[onclick="saveBrandConfig()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    await saveBrand(cfg);
    _pendingLogoData    = '';
    _pendingFaviconData = '';
    toast('Identidade visual salva com sucesso!', 'success');
  } catch(e) {
    toast('Erro ao salvar: ' + (e.message || 'falha'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar tudo'; }
  }
}

// ── Normalizar telefones ──────────────────────────────────────────────────────
async function adminNormalizePhones() {
  const btn = document.querySelector('[onclick="adminNormalizePhones()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Normalizando...'; }
  try {
    const res = await _api('POST', '/admin/users', { action: 'normalize-phones' });
    toast(`✅ ${res.checked} verificados, ${res.updated} atualizados`, 'success');
    _adminUsersCache = [];
    renderAdminUsers();
  } catch(e) {
    toast('Erro: ' + (e.message || 'falha'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = icon('phone',13) + ' Normalizar telefones'; }
  }
}

// ── Usuários ──────────────────────────────────────────────────────────────────

/** Formata número com DDI para exibição legível */
function _fmtPhone(raw) {
  if (!raw) return '—';
  const d = raw.replace(/\D/g, '');
  // DDI 55 (Brasil): 55 DD 9NNNN-NNNN (13) ou 55 DD NNNN-NNNN (12)
  if (d.startsWith('55') && d.length === 13) return `+55 (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.startsWith('55') && d.length === 12) return `+55 (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length >= 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4)}`;
  return d;
}

/** Verifica se o número já está normalizado com DDI */
function _hasValidDDI(raw) {
  if (!raw) return false;
  const d = raw.replace(/\D/g, '');
  return d.length >= 12;
}

async function deleteAdminUser(userId, email) {
  if (!confirm(`Deletar usuário ${email}?\n\nEsta ação é irreversível e remove todas as transações, categorias, contas e metas do usuário.`)) return;
  try {
    await _api('DELETE', `/admin/users/${userId}`);
    toast('Usuário deletado!', 'success');
    _adminUsersCache = [];
    renderAdminUsers();
  } catch(e) {
    toast('Erro ao deletar: ' + e.message, 'error');
  }
}

async function testWhatsApp(userId, btn) {
  const original = btn.innerHTML;
  btn.innerHTML = icon('loader', 14);
  btn.disabled = true;
  try {
    const res = await _api('POST', `/admin/users/${userId}`, { action: 'test-whatsapp' });
    toast(`✅ Mensagem de teste enviada para ${res.phone}`, 'success');
    btn.innerHTML = icon('check', 14);
    setTimeout(() => { btn.innerHTML = original; }, 3000);
  } catch(e) {
    toast('Erro ao enviar teste: ' + (e.message || 'falha'), 'error');
    btn.innerHTML = original;
  } finally {
    btn.disabled = false;
  }
}

async function updateUserFee(email, value) {
  const fee = parseFloat(value) || 0;
  try {
    await _api('POST', '/admin/user-plans', { email, monthly_fee: fee });
    toast('Valor atualizado!', 'success');
  } catch(e) {
    toast('Erro ao salvar', 'error');
  }
}
