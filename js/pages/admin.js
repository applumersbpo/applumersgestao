// ── Estado temporário do editor de brand ──────────────────────────────────────
let _pendingLogoData     = ''; // base64 ou URL do logo (sessão atual)
let _pendingFaviconData  = ''; // base64 ou URL do favicon (sessão atual)
let _pendingLoginBgData  = ''; // base64 ou URL da imagem de fundo da tela de login

// ── Mídia fixada para mensagens em massa ──────────────────────────────────────
let _stickyMsgMedia = null; // { base64, type, name, size } — persiste entre aberturas do modal

// ── DDD → Coordenadas ────────────────────────────────────────────────────────
const DDD_COORDS = {
  '11': [-23.5505, -46.6333], '21': [-22.9068, -43.1729], '31': [-19.9167, -43.9345],
  '41': [-25.4284, -49.2733], '51': [-30.0346, -51.2177], '61': [-15.7801, -47.9292],
  '71': [-12.9714, -38.5014], '81': [-8.0476, -34.8770],  '85': [-3.7172, -38.5437],
  '91': [-1.4558, -48.4902],  '92': [-3.1190, -60.0217],  '62': [-16.6799, -49.2550],
  '27': [-20.3155, -40.3128], '47': [-26.9060, -49.0661], '48': [-27.5954, -48.5480],
  '63': [-10.1840, -48.3336], '65': [-15.5989, -56.0949], '67': [-20.4428, -54.6462],
  '68': [-9.9754, -67.8249],  '69': [-8.7612, -63.9004],  '73': [-14.8669, -40.8444],
  '74': [-9.4014, -40.4898],  '75': [-11.8608, -39.4488], '77': [-14.8669, -40.8444],
  '79': [-10.9472, -37.0731], '82': [-9.6658, -35.7350],  '83': [-7.1195, -34.8450],
  '84': [-5.7945, -35.2120],  '86': [-5.0892, -42.8019],  '87': [-8.3833, -36.9000],
  '88': [-7.2161, -39.3112],  '89': [-7.0748, -41.7008],  '93': [-3.7006, -52.2337],
  '94': [-5.3544, -49.1181],  '95': [2.8235,  -60.6758],  '96': [0.0389,  -51.0664],
  '97': [-3.3841, -64.7171],  '98': [-2.5297, -44.3028],  '99': [-4.9609, -44.3028],
};

function _extractDdd(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // Remove DDI 55 if present
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length >= 10) return local.slice(0, 2);
  return null;
}

function _renderAdminMap(users) {
  const mapEl = document.getElementById('admin-map-leaflet');
  if (!mapEl || typeof L === 'undefined') return;

  // Build DDD → count
  const dddCount = {};
  (users || []).forEach(u => {
    const ddd = _extractDdd(u.phone);
    if (ddd && DDD_COORDS[ddd]) dddCount[ddd] = (dddCount[ddd] || 0) + 1;
  });

  const map = L.map(mapEl, { scrollWheelZoom: false }).setView([-14.2350, -51.9253], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
  }).addTo(map);

  const markers = [];
  Object.entries(dddCount).forEach(([ddd, count]) => {
    const coords = DDD_COORDS[ddd];
    const m = L.circleMarker(coords, {
      radius: Math.min(6 + count * 3, 20),
      fillColor: '#3A5A40',
      color: '#2C4630',
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.7,
    }).addTo(map);
    m.bindPopup(`DDD ${ddd} — ${count} usuário${count !== 1 ? 's' : ''}`);
    markers.push(m);
  });

  if (markers.length > 1) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.3));
  }
}

// ── _timeAgo ─────────────────────────────────────────────────────────────────
function _timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'agora mesmo';
  if (mins < 60)  return `há ${mins} min`;
  if (hours < 24) return `há ${hours}h`;
  return `há ${days} dia${days !== 1 ? 's' : ''}`;
}

// ── Admin Nav Bar ─────────────────────────────────────────────────────────────

function _adminNavBar(active) {
  const _user = pb.authStore.model;
  const isSuperAdmin = _user?.role === 'super_admin' || _user?.email === 'applumergestao@gmail.com';
  const tabs = [
    { id: 'dashboard', href: '#/admin',        lucide: 'layout-dashboard', label: 'Dashboard' },
    { id: 'users',     href: '#/admin-users',  lucide: 'users',            label: 'Usuários'  },
    { id: 'plans',     href: '#/admin-plans',  lucide: 'credit-card',      label: 'Planos'    },
  ];
  if (isSuperAdmin) tabs.push({ id: 'system', href: '#/admin-system', lucide: 'settings', label: 'Sistema' });
  return `<nav class="admin-nav-tabs">${tabs.map(t => `
    <a href="${t.href}" class="admin-nav-tab${active === t.id ? ' active' : ''}" onclick="event.preventDefault();location.hash='${t.href.slice(1)}'">
      <i data-lucide="${t.lucide}" style="width:14px;height:14px"></i>
      <span>${t.label}</span>
    </a>`).join('')}
  </nav>`;
}

// ── Render Admin Dashboard ────────────────────────────────────────────────────

async function renderAdmin() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  try {
    const stats = await _api('GET', '/admin/users?stats=true');
    _renderAdminDashHtml(stats);

    if (typeof lucide !== 'undefined') lucide.createIcons();
    _loadAdminDashLayout();
    _initAdminDashDrag();
    _renderAdminMap(stats.users || []);

    // Auto-refresh every 30s
    if (window._adminDashInterval) clearInterval(window._adminDashInterval);
    window._adminDashInterval = setInterval(async () => {
      if (document.getElementById('admin-dash-grid')) {
        try {
          const fresh = await _api('GET', '/admin/users?stats=true');
          _updateAdminDashValues(fresh);
        } catch (_) {}
      } else {
        clearInterval(window._adminDashInterval);
      }
    }, 30000);
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

function _renderAdminDashHtml(stats) {
  const content  = document.getElementById('content');
  const lastUser = stats.last_active_user;
  const topCats  = stats.top_categories     || [];
  const topBanks = stats.top_banks          || [];
  const recentTx = stats.recent_transactions || [];
  const allUsers = stats.users              || [];

  const withPhone  = allUsers.filter(u => u.phone && _hasValidDDI(u.phone)).length;
  const totalMove  = (stats.total_income || 0) + (stats.total_expense || 0);
  const balance    = (stats.total_income || 0) - (stats.total_expense || 0);

  // ── KPI Row ──────────────────────────────────────────────────────────────
  const kpiRow = `
    <div class="admin-kpi-row" id="admin-kpi-row">
      <div class="admin-kpi-card">
        <div class="admin-kpi-label"><i data-lucide="users" style="width:12px;height:12px"></i> Usuários</div>
        <div class="admin-kpi-value" id="admin-stat-users">${stats.total_users || 0}</div>
        <div class="admin-kpi-sub" id="admin-stat-wpp">${withPhone} com WhatsApp</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-label"><i data-lucide="trending-up" style="width:12px;height:12px"></i> Receitas</div>
        <div class="admin-kpi-value" id="admin-stat-income" style="color:var(--income-text)">${fmt(stats.total_income || 0)}</div>
        <div class="admin-kpi-sub">total acumulado</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-label"><i data-lucide="trending-down" style="width:12px;height:12px"></i> Despesas</div>
        <div class="admin-kpi-value" id="admin-stat-expense" style="color:var(--expense)">${fmt(stats.total_expense || 0)}</div>
        <div class="admin-kpi-sub">total acumulado</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-label"><i data-lucide="activity" style="width:12px;height:12px"></i> Saldo geral</div>
        <div class="admin-kpi-value" id="admin-stat-balance" style="color:${balance >= 0 ? 'var(--income-text)' : 'var(--expense)'}">${balance >= 0 ? '+' : ''}${fmt(balance)}</div>
        <div class="admin-kpi-sub">receita − despesa</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-label"><i data-lucide="dollar-sign" style="width:12px;height:12px"></i> MRR</div>
        <div class="admin-kpi-value" id="admin-stat-mrr">${fmt(stats.mrr || 0)}</div>
        <div class="admin-kpi-sub">receita recorrente</div>
      </div>
      <div class="admin-kpi-card">
        <div class="admin-kpi-label"><i data-lucide="clock" style="width:12px;height:12px"></i> Último acesso</div>
        <div class="admin-kpi-value" id="admin-stat-last-active" style="font-size:1rem;word-break:break-word">
          ${lastUser ? _escHtml((lastUser.name || lastUser.email || '—').split(' ')[0]) : '—'}
        </div>
        <div class="admin-kpi-sub" id="admin-stat-last-active-time">${lastUser ? _timeAgo(lastUser.last_login) : '—'}</div>
      </div>
    </div>`;

  // ── Dashboard Blocks ──────────────────────────────────────────────────────
  const lockBtn = () => `<button class="admin-dash-lock-btn" data-locked="false" onclick="_toggleBlockLock(this)" title="Travar posição"><i data-lucide="lock-open" style="width:13px;height:13px"></i></button>`;

  const blockUsers = `
    <div class="admin-dash-block" data-block-id="users" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="users" style="width:12px;height:12px"></i> Total de Usuários</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body">
        <div class="admin-dash-block-value" id="admin-stat-users-block">${stats.total_users || 0}</div>
        <div class="admin-dash-block-sub" id="admin-stat-wpp-block">${withPhone} com WhatsApp</div>
      </div>
    </div>`;

  const blockValue = `
    <div class="admin-dash-block" data-block-id="value" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="activity" style="width:12px;height:12px"></i> Valor em Movimento</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body">
        <div class="admin-dash-block-value" id="admin-stat-value" style="font-size:1.5rem">${fmt(totalMove)}</div>
        <div class="admin-dash-block-sub">
          <span style="color:var(--income-text)">↑ ${fmt(stats.total_income || 0)}</span>
          &nbsp;·&nbsp;
          <span style="color:var(--expense)">↓ ${fmt(stats.total_expense || 0)}</span>
        </div>
      </div>
    </div>`;

  const blockLastActive = `
    <div class="admin-dash-block" data-block-id="last-active" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="clock" style="width:12px;height:12px"></i> Último Ativo</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body">
        <div class="admin-dash-block-value" id="admin-stat-last-active-block" style="font-size:1.1rem;word-break:break-word">
          ${lastUser ? _escHtml(lastUser.name || lastUser.email || '—') : '—'}
        </div>
        <div class="admin-dash-block-sub" id="admin-stat-last-active-time-block">${lastUser ? _timeAgo(lastUser.last_login) : '—'}</div>
      </div>
    </div>`;

  const blockMrr = `
    <div class="admin-dash-block" data-block-id="mrr" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="dollar-sign" style="width:12px;height:12px"></i> MRR</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body">
        <div class="admin-dash-block-value" id="admin-stat-mrr-block" style="font-size:1.5rem">${fmt(stats.mrr || 0)}</div>
        <div class="admin-dash-block-sub">receita mensal recorrente</div>
      </div>
    </div>`;

  const blockCats = `
    <div class="admin-dash-block" data-block-id="categories" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="tags" style="width:12px;height:12px"></i> Categorias mais usadas</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body" id="admin-stat-cats">
        ${topCats.length === 0
          ? '<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Sem dados ainda</p>'
          : topCats.map((c,i) => `
            <div class="admin-dash-list-row">
              <span style="display:flex;align-items:center;gap:6px">
                <span style="font-size:.7rem;font-weight:700;color:var(--text-muted);min-width:14px">${i+1}.</span>
                <span>${_escHtml(c.name)}</span>
              </span>
              <span style="font-size:.78rem;font-weight:700;background:var(--primary-light);color:var(--primary-600);
                padding:2px 8px;border-radius:10px">${c.count}×</span>
            </div>`).join('')}
      </div>
    </div>`;

  const blockBanks = `
    <div class="admin-dash-block" data-block-id="banks" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="landmark" style="width:12px;height:12px"></i> Bancos mais usados</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body" id="admin-stat-banks">
        ${topBanks.length === 0
          ? '<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Sem dados ainda</p>'
          : topBanks.map((b,i) => `
            <div class="admin-dash-list-row">
              <span style="display:flex;align-items:center;gap:6px">
                <span style="font-size:.7rem;font-weight:700;color:var(--text-muted);min-width:14px">${i+1}.</span>
                <span>${_escHtml(b.name)}</span>
              </span>
              <span style="font-size:.78rem;font-weight:700;background:var(--bg-subtle);color:var(--text-muted);
                padding:2px 8px;border-radius:10px">${b.count}×</span>
            </div>`).join('')}
      </div>
    </div>`;

  const blockRecent = `
    <div class="admin-dash-block admin-dash-wide" data-block-id="recent-tx" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="list" style="width:12px;height:12px"></i> Movimentações recentes</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body" id="admin-stat-recent-tx">
        ${recentTx.length === 0
          ? '<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Sem movimentações recentes</p>'
          : `<div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:.81rem;min-width:400px">
                <thead>
                  <tr style="border-bottom:2px solid var(--border)">
                    <th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Usuário</th>
                    <th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Descrição</th>
                    <th style="padding:5px 8px;text-align:right;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Valor</th>
                    <th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Data</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentTx.map(t => `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:6px 8px;font-weight:500">${_escHtml(t.user_name || t.user_email || '—')}</td>
                      <td style="padding:6px 8px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(t.description || '—')}</td>
                      <td style="padding:6px 8px;text-align:right;font-weight:700;color:${t.type === 'income' ? 'var(--income-text)' : 'var(--expense)'}">
                        ${t.type === 'income' ? '+' : '−'}${fmt(t.amount || 0)}
                      </td>
                      <td style="padding:6px 8px;color:var(--text-muted);font-size:.75rem;white-space:nowrap">${t.created_at ? fmtDate(t.created_at) : '—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
      </div>
    </div>`;

  const blockMap = `
    <div class="admin-dash-block admin-dash-block-map admin-dash-wide" data-block-id="map" draggable="true">
      <div class="admin-dash-block-header">
        <span class="admin-dash-block-title"><i data-lucide="map-pin" style="width:12px;height:12px"></i> Distribuição geográfica (por DDD)</span>
        ${lockBtn()}
      </div>
      <div class="admin-dash-block-body">
        <div id="admin-map-leaflet"></div>
      </div>
    </div>`;

  const now = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  content.innerHTML = `
    ${_adminNavBar('dashboard')}
    <div class="admin-refresh-badge" id="admin-refresh-badge">
      <i data-lucide="refresh-cw" style="width:11px;height:11px"></i>
      Atualizado às ${now} · auto-refresh 30s
    </div>
    ${kpiRow}
    <div class="admin-dash-grid" id="admin-dash-grid">
      ${blockUsers}
      ${blockValue}
      ${blockLastActive}
      ${blockMrr}
      ${blockCats}
      ${blockBanks}
      ${blockRecent}
      ${blockMap}
    </div>`;
}

function _updateAdminDashValues(stats) {
  const el = id => document.getElementById(id);
  const allUsers = stats.users || [];
  const withPhone = allUsers.filter(u => u.phone && _hasValidDDI(u.phone)).length;
  const balance   = (stats.total_income || 0) - (stats.total_expense || 0);

  // KPI row
  if (el('admin-stat-users'))           el('admin-stat-users').textContent  = stats.total_users || 0;
  if (el('admin-stat-wpp'))             el('admin-stat-wpp').textContent    = `${withPhone} com WhatsApp`;
  if (el('admin-stat-income'))          el('admin-stat-income').textContent = fmt(stats.total_income || 0);
  if (el('admin-stat-expense'))         el('admin-stat-expense').textContent= fmt(stats.total_expense || 0);
  if (el('admin-stat-balance')) {
    el('admin-stat-balance').textContent = (balance >= 0 ? '+' : '') + fmt(balance);
    el('admin-stat-balance').style.color = balance >= 0 ? 'var(--income-text)' : 'var(--expense)';
  }
  if (el('admin-stat-mrr'))             el('admin-stat-mrr').textContent   = fmt(stats.mrr || 0);

  // Draggable blocks
  const totalMove = (stats.total_income || 0) + (stats.total_expense || 0);
  if (el('admin-stat-users-block'))     el('admin-stat-users-block').textContent = stats.total_users || 0;
  if (el('admin-stat-wpp-block'))       el('admin-stat-wpp-block').textContent   = `${withPhone} com WhatsApp`;
  if (el('admin-stat-value'))           el('admin-stat-value').textContent        = fmt(totalMove);
  if (el('admin-stat-mrr-block'))       el('admin-stat-mrr-block').textContent    = fmt(stats.mrr || 0);

  const lastUser = stats.last_active_user;
  if (el('admin-stat-last-active'))           el('admin-stat-last-active').textContent           = lastUser ? ((lastUser.name || lastUser.email || '—').split(' ')[0]) : '—';
  if (el('admin-stat-last-active-time'))      el('admin-stat-last-active-time').textContent      = lastUser ? _timeAgo(lastUser.last_login) : '—';
  if (el('admin-stat-last-active-block'))     el('admin-stat-last-active-block').textContent     = lastUser ? (lastUser.name || lastUser.email || '—') : '—';
  if (el('admin-stat-last-active-time-block'))el('admin-stat-last-active-time-block').textContent= lastUser ? _timeAgo(lastUser.last_login) : '—';

  const topCats = stats.top_categories || [];
  if (el('admin-stat-cats')) {
    el('admin-stat-cats').innerHTML = topCats.length === 0
      ? '<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Sem dados ainda</p>'
      : topCats.map((c,i) => `<div class="admin-dash-list-row">
          <span style="display:flex;align-items:center;gap:6px">
            <span style="font-size:.7rem;font-weight:700;color:var(--text-muted);min-width:14px">${i+1}.</span>
            <span>${_escHtml(c.name)}</span>
          </span>
          <span style="font-size:.78rem;font-weight:700;background:var(--primary-light);color:var(--primary-600);padding:2px 8px;border-radius:10px">${c.count}×</span>
        </div>`).join('');
  }

  const topBanks = stats.top_banks || [];
  if (el('admin-stat-banks')) {
    el('admin-stat-banks').innerHTML = topBanks.length === 0
      ? '<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Sem dados ainda</p>'
      : topBanks.map((b,i) => `<div class="admin-dash-list-row">
          <span style="display:flex;align-items:center;gap:6px">
            <span style="font-size:.7rem;font-weight:700;color:var(--text-muted);min-width:14px">${i+1}.</span>
            <span>${_escHtml(b.name)}</span>
          </span>
          <span style="font-size:.78rem;font-weight:700;background:var(--bg-subtle);color:var(--text-muted);padding:2px 8px;border-radius:10px">${b.count}×</span>
        </div>`).join('');
  }

  const recentTx = stats.recent_transactions || [];
  if (el('admin-stat-recent-tx')) {
    el('admin-stat-recent-tx').innerHTML = recentTx.length === 0
      ? '<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Sem movimentações recentes</p>'
      : `<div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.81rem;min-width:400px">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Usuário</th>
                <th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Descrição</th>
                <th style="padding:5px 8px;text-align:right;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Valor</th>
                <th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase">Data</th>
              </tr>
            </thead>
            <tbody>
              ${recentTx.map(t => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:6px 8px;font-weight:500">${_escHtml(t.user_name || t.user_email || '—')}</td>
                  <td style="padding:6px 8px;color:var(--text-muted)">${_escHtml(t.description || '—')}</td>
                  <td style="padding:6px 8px;text-align:right;font-weight:700;color:${t.type === 'income' ? 'var(--income-text)' : 'var(--expense)'}">
                    ${t.type === 'income' ? '+' : '−'}${fmt(t.amount || 0)}
                  </td>
                  <td style="padding:6px 8px;color:var(--text-muted);font-size:.75rem;white-space:nowrap">${t.created_at ? fmtDate(t.created_at) : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
  }

  // Update refresh badge time
  const badge = document.getElementById('admin-refresh-badge');
  if (badge) {
    const now = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    badge.innerHTML = `<i data-lucide="refresh-cw" style="width:11px;height:11px"></i> Atualizado às ${now} · auto-refresh 30s`;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [badge] });
  }
}

function _initAdminDashDrag() {
  const grid = document.getElementById('admin-dash-grid');
  if (!grid) return;
  let dragSrc = null;
  grid.querySelectorAll('.admin-dash-block').forEach(block => {
    block.addEventListener('dragstart', e => {
      if (block.classList.contains('locked')) { e.preventDefault(); return; }
      dragSrc = block;
      block.classList.add('dragging');
    });
    block.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      _saveAdminDashLayout();
    });
    block.addEventListener('dragover', e => { e.preventDefault(); });
    block.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === block) return;
      const allBlocks = [...grid.querySelectorAll('.admin-dash-block')];
      const srcIdx  = allBlocks.indexOf(dragSrc);
      const destIdx = allBlocks.indexOf(block);
      if (srcIdx < destIdx) block.after(dragSrc);
      else block.before(dragSrc);
    });
  });
}

function _saveAdminDashLayout() {
  const userId = pb.authStore.model?.id || 'default';
  const grid   = document.getElementById('admin-dash-grid');
  if (!grid) return;
  const order = [...grid.querySelectorAll('.admin-dash-block')].map(b => b.dataset.blockId);
  const locks = {};
  grid.querySelectorAll('.admin-dash-block').forEach(b => {
    locks[b.dataset.blockId] = b.querySelector('.admin-dash-lock-btn')?.dataset.locked === 'true';
  });
  localStorage.setItem(`admin_dash_layout_${userId}`, JSON.stringify({ order, locks }));
}

function _loadAdminDashLayout() {
  const userId = pb.authStore.model?.id || 'default';
  const saved  = localStorage.getItem(`admin_dash_layout_${userId}`);
  if (!saved) return;
  try {
    const { order, locks } = JSON.parse(saved);
    const grid = document.getElementById('admin-dash-grid');
    if (!grid || !order?.length) return;
    order.forEach(id => {
      const block = grid.querySelector(`[data-block-id="${id}"]`);
      if (block) grid.appendChild(block);
    });
    Object.entries(locks || {}).forEach(([id, locked]) => {
      const btn = grid.querySelector(`[data-block-id="${id}"] .admin-dash-lock-btn`);
      if (btn) {
        btn.dataset.locked = locked ? 'true' : 'false';
        const ico = btn.querySelector('i[data-lucide]');
        if (ico) ico.setAttribute('data-lucide', locked ? 'lock' : 'lock-open');
        const block = btn.closest('.admin-dash-block');
        if (block) {
          block.setAttribute('draggable', locked ? 'false' : 'true');
          block.classList.toggle('locked', locked);
        }
      }
    });
  } catch (_) {}
}

function _toggleBlockLock(btn) {
  const locked = btn.dataset.locked === 'true';
  btn.dataset.locked = locked ? 'false' : 'true';
  const ico = btn.querySelector('i[data-lucide]');
  if (ico) ico.setAttribute('data-lucide', locked ? 'lock-open' : 'lock');
  const block = btn.closest('.admin-dash-block');
  if (block) {
    block.setAttribute('draggable', locked ? 'true' : 'false');
    block.classList.toggle('locked', !locked);
  }
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  _saveAdminDashLayout();
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
    ${_adminNavBar('users')}
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
        <button class="btn btn-sm btn-outline" onclick="openAdminCreateUserModal()">
          ${icon('user-plus',13)} Nova conta
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

function _adminRoleBadge(role) {
  const map = {
    super_admin: { label: 'Super Admin', color: '#dc2626', bg: '#fef2f2' },
    admin:       { label: 'Admin',       color: '#d97706', bg: '#fffbeb' },
    user:        { label: 'Usuário',     color: 'var(--text-muted)', bg: 'var(--bg-subtle)' },
  };
  const r = map[role] || map.user;
  return `<span style="font-size:.68rem;font-weight:700;padding:2px 7px;border-radius:10px;background:${r.bg};color:${r.color};white-space:nowrap">${r.label}</span>`;
}

function _adminUserRow(u) {
  const displayName  = u.name || u.email.split('@')[0];
  const initials     = displayName[0].toUpperCase();
  const phone        = u.phone || '';
  const phoneOk      = _hasValidDDI(phone);
  const balance      = (u.total_income || 0) - (u.total_expense || 0);
  const balanceColor = balance >= 0 ? 'var(--income-text)' : 'var(--expense)';
  const role         = u.role || (u.is_admin ? 'admin' : 'user');

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
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:.93rem;color:var(--text)">${_escHtml(displayName)}</span>
            ${_adminRoleBadge(role)}
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
          <button class="btn btn-sm btn-icon btn-ghost" style="color:var(--text-muted)"
            onclick="openAdminEditUserModal('${u.id}')" title="Editar usuário">
            ${icon('pencil',14)}
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
      ${_adminNavBar('users')}
      <!-- Voltar -->
      <button class="btn btn-ghost btn-sm" style="margin-bottom:16px;gap:6px" onclick="renderAdminUsers()">
        ${icon('arrow-left',14)} Voltar para Usuários
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
      ${_adminNavBar('users')}
      <button class="btn btn-ghost btn-sm" style="margin-bottom:16px" onclick="renderAdminUsers()">
        ${icon('arrow-left',14)} Voltar para Usuários
      </button>
      <div class="empty-state"><p style="color:var(--expense)">Erro ao carregar perfil: ${_escHtml(e.message)}</p></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

// ── Render Admin System ───────────────────────────────────────────────────────

async function renderAdminSystem() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  const _user = pb.authStore.model;
  const isSuperAdmin = _user?.role === 'super_admin' || _user?.email === 'applumergestao@gmail.com';
  if (!isSuperAdmin) {
    content.innerHTML = `
      ${_adminNavBar('system')}
      <div style="padding:48px;text-align:center;color:var(--text-muted)">
        <i data-lucide="shield-off" style="width:40px;height:40px;opacity:.3;display:block;margin:0 auto 12px"></i>
        <p>Acesso restrito a Super Admin.</p>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  try {
    const [brandCfg, sysCfg] = await Promise.all([
      fetch('/api/brand').then(r => r.json()).catch(() => ({})),
      _api('GET', '/admin/users?resource=system-settings').catch(() => ({})),
    ]);

    // Reseta pendentes ao entrar na página
    _pendingLogoData    = '';
    _pendingFaviconData = '';
    _pendingLoginBgData = '';

    const allowReg = sysCfg.allow_registration === '1';

    content.innerHTML = `
      ${_adminNavBar('system')}
      <div class="card" style="margin-bottom:20px">
        <div class="card-title" style="margin-bottom:16px">${icon('shield', 14)} Acesso e Cadastro</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-weight:600;font-size:.9rem">Permitir criação de novas contas</div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">
              Quando desabilitado, o link "Criar conta" some da tela de login e a API de registro retorna erro 403.
            </div>
          </div>
          <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0">
            <input type="checkbox" id="toggle-allow-reg" ${allowReg ? 'checked' : ''}
              style="width:0;height:0;opacity:0;position:absolute"
              onchange="_toggleAllowRegistration(this.checked)">
            <div id="toggle-allow-reg-track" style="
              width:46px;height:26px;border-radius:13px;transition:background .2s;
              background:${allowReg ? 'var(--primary-600)' : 'var(--border)'};position:relative">
              <div style="
                position:absolute;top:3px;left:${allowReg ? '23px' : '3px'};
                width:20px;height:20px;border-radius:50%;background:#fff;
                box-shadow:0 1px 3px rgba(0,0,0,.2);transition:left .2s" id="toggle-allow-reg-knob"></div>
            </div>
          </label>
        </div>
        <div id="toggle-reg-feedback" style="font-size:.8rem;margin-top:10px;display:none"></div>
      </div>
      ${_adminBrandSection(brandCfg)}`;

    if (typeof lucide !== 'undefined') lucide.createIcons();
    _initBrandEditor();
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

async function _toggleAllowRegistration(checked) {
  const track  = document.getElementById('toggle-allow-reg-track');
  const knob   = document.getElementById('toggle-allow-reg-knob');
  const fb     = document.getElementById('toggle-reg-feedback');
  if (track) track.style.background = checked ? 'var(--primary-600)' : 'var(--border)';
  if (knob)  knob.style.left        = checked ? '23px' : '3px';
  try {
    await _api('PUT', '/admin/users?resource=system-settings', { allow_registration: checked ? '1' : '0' });
    if (fb) {
      fb.style.display = '';
      fb.style.color   = 'var(--income-text)';
      fb.textContent   = checked ? '✓ Cadastro habilitado com sucesso.' : '✓ Cadastro desabilitado com sucesso.';
      setTimeout(() => { if (fb) fb.style.display = 'none'; }, 3000);
    }
  } catch(err) {
    if (fb) {
      fb.style.display = '';
      fb.style.color   = 'var(--expense)';
      fb.textContent   = 'Erro ao salvar configuração.';
    }
    // Reverte o toggle visualmente
    const chk = document.getElementById('toggle-allow-reg');
    if (chk) chk.checked = !checked;
    if (track) track.style.background = !checked ? 'var(--primary-600)' : 'var(--border)';
    if (knob)  knob.style.left        = !checked ? '23px' : '3px';
  }
}

// ── Edit User Modal ───────────────────────────────────────────────────────────

const _FEATURE_KEYS = ['transactions','accounts','categories','goals','installments','reports','annual_flow','whatsapp_bot'];
const _FEATURE_LABELS = {
  transactions: 'Transações',
  accounts:     'Carteiras/Contas',
  categories:   'Categorias',
  goals:        'Metas',
  installments: 'Parcelamentos',
  reports:      'Relatórios',
  annual_flow:  'Fluxo Anual',
  whatsapp_bot: 'Bot WhatsApp',
};

let _editUserData = null; // { user, plan, templates }

async function openAdminEditUserModal(userId) {
  showModal(`<div class="modal-backdrop"><div class="modal" style="max-width:540px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
    <div class="modal-header"><div class="modal-title">${icon('pencil',16)} Carregando...</div>
    <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button></div>
    <div class="modal-body"><div class="loading-screen" style="height:120px"><div class="spinner"></div></div></div>
  </div></div>`);

  try {
    const [userData, templates] = await Promise.all([
      _api('GET', '/admin/users/' + userId),
      _api('GET', '/admin/user-plans?resource=plan-templates').catch(() => []),
    ]);
    _planTemplatesCache = templates;
    _editUserData = { user: userData.user, plan: userData.plan, templates };
    _renderEditUserModal(userId);
  } catch(e) {
    const mb = document.querySelector('.modal-body');
    if (mb) mb.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

function _renderEditUserModal(userId) {
  const { user, plan, templates } = _editUserData;
  const role = user.role || (user.is_admin ? 'admin' : 'user');

  // Build features: start from template, then apply user overrides
  let templateFeatures = {};
  let userOverride = {};
  if (plan) {
    try { userOverride = JSON.parse(plan.features_override || '{}'); } catch(_) {}
    const tpl = templates.find(t => t.id === plan.plan_template_id);
    if (tpl) { try { templateFeatures = JSON.parse(tpl.features || '{}'); } catch(_) {} }
  }
  const effectiveFeatures = { ..._defaultFeatures(), ...templateFeatures, ...userOverride };

  const featuresHtml = _FEATURE_KEYS.map(k => {
    const fromTemplate = templateFeatures[k] !== undefined;
    const isOverridden = userOverride[k] !== undefined;
    const checked = effectiveFeatures[k] !== false;
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" id="ef-${k}" ${checked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
        <span style="flex:1;font-size:.87rem">${_FEATURE_LABELS[k]}</span>
        ${fromTemplate && !isOverridden
          ? `<span style="font-size:.7rem;color:var(--text-muted)">do plano</span>`
          : isOverridden
            ? `<span style="font-size:.7rem;color:var(--primary-600);font-weight:600">override</span>`
            : ''}
      </label>`;
  }).join('');

  const templateOptions = templates.map(t =>
    `<option value="${t.id}" ${plan?.plan_template_id === t.id ? 'selected' : ''}>${_escHtml(t.name)} — R$ ${(t.monthly_fee||0).toFixed(2)}</option>`
  ).join('');

  const modal = document.querySelector('.modal');
  if (!modal) return;
  modal.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${icon('pencil',16)} Editar — ${_escHtml(user.name || user.email)}</div>
      <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:0">

      <!-- DADOS PESSOAIS -->
      <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
        ${icon('user',13)} Dados Pessoais
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Nome</label>
          <input id="eu-name" class="form-control" value="${_escHtml(user.name||'')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">WhatsApp</label>
          <input id="eu-phone" class="form-control" type="tel" value="${_escHtml(user.phone||'')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">E-mail</label>
          <input id="eu-email" class="form-control" type="email" value="${_escHtml(user.email||'')}">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Nova senha <span style="color:var(--text-muted);font-weight:400">(opcional)</span></label>
          <input id="eu-password" class="form-control" type="password" placeholder="Deixe em branco para manter">
        </div>
      </div>

      <!-- PERFIL / ROLE -->
      <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
        ${icon('shield',13)} Perfil de Acesso
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Nível de acesso</label>
        <select id="eu-role" class="form-control">
          <option value="user"        ${role==='user'        ?'selected':''}>Usuário</option>
          <option value="admin"       ${role==='admin'       ?'selected':''}>Admin</option>
          <option value="super_admin" ${role==='super_admin' ?'selected':''}>Super Admin</option>
        </select>
      </div>

      ${plan ? `
      <!-- PLANO -->
      <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
        ${icon('credit-card',13)} Plano de Assinatura
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label">Modelo de plano</label>
          <select id="eu-plan-template" class="form-control" onchange="_onEditUserTemplateChange()">
            <option value="">— Sem plano —</option>
            ${templateOptions}
          </select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Mensalidade (R$)</label>
          <input id="eu-plan-fee" class="form-control" type="number" min="0" step="0.01" value="${plan.monthly_fee||0}">
        </div>
        <div class="form-group" style="margin:0;display:flex;align-items:flex-end;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:6px">
            <input type="checkbox" id="eu-plan-active" ${plan.active ? 'checked' : ''} style="width:16px;height:16px">
            <span style="font-size:.87rem">Plano ativo</span>
          </label>
        </div>
      </div>

      <!-- RECURSOS -->
      <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
        ${icon('toggle-left',13)} Recursos Habilitados
      </div>
      <div style="margin-bottom:16px">${featuresHtml}</div>
      ` : ''}

      <div id="eu-error" style="color:var(--expense);font-size:.83rem;display:none;margin-top:4px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button id="eu-submit" class="btn btn-primary" onclick="_adminSaveUserEdit('${userId}')">
        ${icon('save',14)} Salvar alterações
      </button>
    </div>`;
}

function _defaultFeatures() {
  return { transactions:true, accounts:true, categories:true, goals:true, installments:true, reports:true, annual_flow:true, whatsapp_bot:false };
}

function _onEditUserTemplateChange() {
  const sel = document.getElementById('eu-plan-template');
  if (!sel || !_editUserData) return;
  const tplId = sel.value;
  const tpl = _editUserData.templates.find(t => t.id === tplId);
  if (!tpl) return;
  // Update fee field from template
  const feeEl = document.getElementById('eu-plan-fee');
  if (feeEl) feeEl.value = tpl.monthly_fee || 0;
  // Update feature checkboxes from template
  try {
    const features = JSON.parse(tpl.features || '{}');
    _FEATURE_KEYS.forEach(k => {
      const el = document.getElementById('ef-' + k);
      if (el && features[k] !== undefined) el.checked = features[k] !== false;
    });
  } catch(_) {}
}

async function _adminSaveUserEdit(userId) {
  const btn  = document.getElementById('eu-submit');
  const errEl = document.getElementById('eu-error');
  errEl.style.display = 'none';

  const name     = document.getElementById('eu-name')?.value.trim();
  const email    = document.getElementById('eu-email')?.value.trim();
  const phone    = document.getElementById('eu-phone')?.value.trim();
  const password = document.getElementById('eu-password')?.value;
  const role     = document.getElementById('eu-role')?.value;

  if (!name)  { errEl.textContent = 'Nome é obrigatório.';  errEl.style.display = ''; return; }
  if (!email) { errEl.textContent = 'E-mail é obrigatório.'; errEl.style.display = ''; return; }

  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    // Save profile
    const profileData = { name, email, phone, role };
    if (password) profileData.password = password;
    await _api('PUT', '/admin/users/' + userId, profileData);

    // Save plan if exists
    const { plan } = _editUserData || {};
    if (plan?.id) {
      const templateId = document.getElementById('eu-plan-template')?.value || '';
      const fee        = parseFloat(document.getElementById('eu-plan-fee')?.value) || 0;
      const active     = document.getElementById('eu-plan-active')?.checked ?? true;

      // Build features override: only keys that differ from template
      const tpl = _editUserData.templates.find(t => t.id === templateId);
      let tplFeatures = {};
      if (tpl) { try { tplFeatures = JSON.parse(tpl.features || '{}'); } catch(_) {} }

      const override = {};
      _FEATURE_KEYS.forEach(k => {
        const el = document.getElementById('ef-' + k);
        if (!el) return;
        const checked = el.checked;
        const tplVal  = tplFeatures[k] !== undefined ? tplFeatures[k] !== false : _defaultFeatures()[k];
        if (checked !== tplVal) override[k] = checked;
      });

      await _api('PUT', '/admin/user-plans/' + plan.id, {
        plan_template_id: templateId,
        monthly_fee: fee,
        active,
        features_override: JSON.stringify(override),
      });
    }

    closeModal();
    await renderAdminUsers();
  } catch(err) {
    errEl.textContent = err?.response?.message || err?.message || 'Erro ao salvar.';
    errEl.style.display = '';
    btn.disabled = false;
    btn.innerHTML = `${icon('save',14)} Salvar alterações`;
  }
}

// ── Admin Plans Page ──────────────────────────────────────────────────────────

async function renderAdminPlans() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
  try {
    const templates = await _api('GET', '/admin/user-plans?resource=plan-templates');
    _planTemplatesCache = templates;
    _renderAdminPlansHtml(templates);
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

function _renderAdminPlansHtml(templates) {
  const content = document.getElementById('content');
  const rows = templates.map(t => {
    let features = {};
    try { features = JSON.parse(t.features || '{}'); } catch(_) {}
    const activeFeat = _FEATURE_KEYS.filter(k => features[k] !== false).length;
    return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div>
            <div style="font-weight:700;font-size:.97rem">${_escHtml(t.name)}</div>
            ${t.description ? `<div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">${_escHtml(t.description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-sm btn-icon btn-ghost" onclick="_openEditTemplateModal('${t.id}')" title="Editar">${icon('pencil',14)}</button>
            <button class="btn btn-sm btn-icon btn-danger" onclick="_deleteTemplate('${t.id}','${_escHtml(t.name)}')" title="Excluir">${icon('trash-2',14)}</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:1.1rem;font-weight:700;color:var(--primary-600)">R$ ${(t.monthly_fee||0).toFixed(2)}<span style="font-size:.75rem;font-weight:400;color:var(--text-muted)">/mês</span></span>
          <span style="font-size:.78rem;background:var(--bg-subtle);padding:3px 9px;border-radius:10px">${activeFeat}/${_FEATURE_KEYS.length} recursos</span>
          <span style="font-size:.78rem;padding:3px 9px;border-radius:10px;background:${t.active ? '#dcfce7' : 'var(--bg-subtle)'};color:${t.active ? '#166534' : 'var(--text-muted)'}">${t.active ? 'Ativo' : 'Inativo'}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${_FEATURE_KEYS.map(k => `
            <span style="font-size:.72rem;padding:2px 8px;border-radius:8px;background:${features[k]!==false ? 'var(--primary-light)' : 'var(--bg-subtle)'};color:${features[k]!==false ? 'var(--primary-600)' : 'var(--text-muted)'}">
              ${features[k]!==false ? '✓' : '—'} ${_FEATURE_LABELS[k]}
            </span>`).join('')}
        </div>
      </div>`;
  }).join('');

  content.innerHTML = `
    ${_adminNavBar('plans')}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-size:.82rem;color:var(--text-muted)">${icon('credit-card',13)} <strong>${templates.length}</strong> plano(s) cadastrado(s)</div>
      <button class="btn btn-sm btn-primary" onclick="_openEditTemplateModal(null)">
        ${icon('plus',13)} Novo plano
      </button>
    </div>
    ${templates.length === 0
      ? `<div class="empty-state">${icon('credit-card',36)}<p>Nenhum plano cadastrado ainda.</p><button class="btn btn-primary" onclick="_openEditTemplateModal(null)">${icon('plus',14)} Criar primeiro plano</button></div>`
      : `<div style="display:flex;flex-direction:column;gap:10px">${rows}</div>`}`;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

let _planTemplatesCache = [];

function _openEditTemplateModal(templateId) {
  const tpl = templateId ? (_planTemplatesCache.find(t => t.id === templateId) || {}) : {};
  let features = {};
  try { features = JSON.parse(tpl.features || '{}'); } catch(_) {}
  const eff = { ..._defaultFeatures(), ...features };
  const isNew = !templateId;

  const featHtml = _FEATURE_KEYS.map(k => `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0;border-bottom:1px solid var(--border)">
      <input type="checkbox" id="tf-${k}" ${eff[k]!==false ? 'checked' : ''} style="width:16px;height:16px">
      <span style="font-size:.87rem;flex:1">${_FEATURE_LABELS[k]}</span>
    </label>`).join('');

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:460px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('credit-card',16)} ${isNew ? 'Novo Plano' : 'Editar Plano'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome do plano *</label>
            <input id="tpl-name" class="form-control" value="${_escHtml(tpl.name||'')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Descrição <span style="color:var(--text-muted);font-weight:400">(opcional)</span></label>
            <input id="tpl-desc" class="form-control" value="${_escHtml(tpl.description||'')}">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Mensalidade (R$)</label>
              <input id="tpl-fee" class="form-control" type="number" min="0" step="0.01" value="${tpl.monthly_fee||0}">
            </div>
            <div class="form-group" style="margin:0;display:flex;align-items:flex-end;padding-bottom:6px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="tpl-active" ${tpl.active!==0 ? 'checked' : ''} style="width:16px;height:16px">
                <span style="font-size:.87rem">Plano ativo</span>
              </label>
            </div>
          </div>
          <div>
            <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">${icon('toggle-left',12)} Recursos</div>
            ${featHtml}
          </div>
          <div id="tpl-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button id="tpl-submit" class="btn btn-primary" onclick="_saveTemplate('${templateId||''}')">
            ${icon('save',14)} ${isNew ? 'Criar plano' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>`);
}

async function _saveTemplate(templateId) {
  const name   = document.getElementById('tpl-name')?.value.trim();
  const desc   = document.getElementById('tpl-desc')?.value.trim();
  const fee    = parseFloat(document.getElementById('tpl-fee')?.value) || 0;
  const active = document.getElementById('tpl-active')?.checked ?? true;
  const errEl  = document.getElementById('tpl-error');
  const btn    = document.getElementById('tpl-submit');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Nome é obrigatório.'; errEl.style.display = ''; return; }

  const features = {};
  _FEATURE_KEYS.forEach(k => { features[k] = !!document.getElementById('tf-' + k)?.checked; });

  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (templateId) {
      await _api('POST', '/admin/user-plans', { action: 'update-template', id: templateId, name, description: desc, monthly_fee: fee, features, active });
    } else {
      await _api('POST', '/admin/user-plans', { action: 'create-template', name, description: desc, monthly_fee: fee, features, active });
    }
    closeModal();
    await renderAdminPlans();
  } catch(err) {
    errEl.textContent = err?.message || 'Erro ao salvar.';
    errEl.style.display = '';
    btn.disabled = false;
    btn.innerHTML = `${icon('save',14)} Salvar`;
  }
}

async function _deleteTemplate(templateId, name) {
  if (!confirm(`Excluir o plano "${name}"? Usuários vinculados a este plano perderão a referência.`)) return;
  try {
    await _api('POST', '/admin/user-plans', { action: 'delete-template', id: templateId });
    await renderAdminPlans();
  } catch(err) {
    alert('Erro: ' + (err?.message || 'Falha ao excluir'));
  }
}

// ── Create User Modal ─────────────────────────────────────────────────────────

function openAdminCreateUserModal() {
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:420px;width:calc(100% - 32px)">
        <div class="modal-header">
          <div class="modal-title">${icon('user-plus', 16)} Nova conta</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome *</label>
            <input id="cu-name" class="form-control" type="text" placeholder="Nome completo" autocomplete="off">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">E-mail *</label>
            <input id="cu-email" class="form-control" type="email" placeholder="usuario@email.com" autocomplete="off">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">WhatsApp <span style="color:var(--text-muted);font-weight:400">(opcional)</span></label>
            <input id="cu-phone" class="form-control" type="tel" placeholder="5561999990000">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Senha *</label>
            <input id="cu-password" class="form-control" type="password" placeholder="Mínimo 8 caracteres" autocomplete="new-password">
          </div>
          <div id="cu-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button id="cu-submit" class="btn btn-primary" onclick="_adminSubmitCreateUser()">
            ${icon('user-plus', 14)} Criar conta
          </button>
        </div>
      </div>
    </div>
  `);
}

async function _adminSubmitCreateUser() {
  const name     = document.getElementById('cu-name').value.trim();
  const email    = document.getElementById('cu-email').value.trim();
  const phone    = document.getElementById('cu-phone').value.trim();
  const password = document.getElementById('cu-password').value;
  const errEl    = document.getElementById('cu-error');
  const btn      = document.getElementById('cu-submit');

  errEl.style.display = 'none';
  if (!name)              { errEl.textContent = 'Informe o nome.';              errEl.style.display = ''; return; }
  if (!email)             { errEl.textContent = 'Informe o e-mail.';            errEl.style.display = ''; return; }
  if (password.length < 8){ errEl.textContent = 'Senha mínima: 8 caracteres.'; errEl.style.display = ''; return; }

  btn.disabled = true;
  btn.textContent = 'Criando...';
  try {
    await _api('POST', '/admin/users', { action: 'create-user', name, email, phone, password });
    closeModal();
    await renderAdminUsers();
  } catch(err) {
    errEl.textContent = err?.response?.message || err?.message || 'Erro ao criar conta.';
    errEl.style.display = '';
    btn.disabled = false;
    btn.innerHTML = `${icon('user-plus', 14)} Criar conta`;
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
            <div id="msg-media-section"></div>
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
  _renderMsgMediaSection();
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

async function _adminMsgFileSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const base64 = await _fileToBase64(file);
    _stickyMsgMedia = { base64, type: _detectMediaType(file), name: file.name, size: file.size };
    _renderMsgMediaSection();
  } catch(e) {
    toast('Erro ao carregar arquivo', 'error');
  }
}

function _clearStickyMedia() {
  _stickyMsgMedia = null;
  _renderMsgMediaSection();
}

function _renderMsgMediaSection() {
  const sec = document.getElementById('msg-media-section');
  if (!sec) return;
  if (_stickyMsgMedia) {
    const isImage = _stickyMsgMedia.type === 'image';
    sec.innerHTML = `
      <div style="background:var(--bg-subtle);border-radius:var(--r-md);padding:10px 12px;
        display:flex;align-items:center;gap:10px;margin-bottom:6px">
        ${isImage
          ? `<img src="${_stickyMsgMedia.base64}" alt=""
              style="width:48px;height:48px;object-fit:cover;border-radius:var(--r-sm);
              border:1px solid var(--border);flex-shrink:0">`
          : `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;
              background:var(--primary-light,#DDE7D8);border-radius:var(--r-sm);flex-shrink:0;font-size:1.5rem">📎</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:.83rem;font-weight:600;color:var(--text);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${_escHtml(_stickyMsgMedia.name)}</div>
          <div style="font-size:.72rem;color:var(--income-text,#166534);margin-top:2px">
            ${(_stickyMsgMedia.size / 1024).toFixed(0)} KB &bull; <em>Fixada — será reutilizada automaticamente</em>
          </div>
        </div>
        <label style="cursor:pointer;flex-shrink:0" title="Substituir imagem">
          <span class="btn btn-sm btn-outline" style="pointer-events:none;font-size:.78rem">Substituir</span>
          <input type="file" style="display:none"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
            onchange="_adminMsgFileSelected(this)">
        </label>
        <button class="btn btn-icon btn-ghost" onclick="_clearStickyMedia()" title="Remover mídia"
          style="width:28px;height:28px;flex-shrink:0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;
  } else {
    sec.innerHTML = `
      <label class="btn btn-sm btn-outline" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
        ${icon('paperclip', 13)} Anexar arquivo
        <input type="file" style="display:none"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
          onchange="_adminMsgFileSelected(this)">
      </label>
      <div style="font-size:.72rem;color:var(--text-muted);margin-top:5px">
        Fotos, vídeos, áudios, PDF, Word, Excel… A imagem fica fixada para a próxima mensagem.
      </div>`;
  }
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
  const resultEl = document.getElementById('msg-result');
  const btn      = document.getElementById('msg-send-btn');

  if (!userIds.length) { toast('Selecione ao menos um destinatário', 'error'); return; }
  if (!text && !_stickyMsgMedia) { toast('Digite uma mensagem ou anexe um arquivo', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Enviando…';

  try {
    let media_base64 = null, media_type = null, media_name = null;
    if (_stickyMsgMedia) {
      media_base64 = _stickyMsgMedia.base64;
      media_type   = _stickyMsgMedia.type;
      media_name   = _stickyMsgMedia.name;
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

      ${sep('Tela de Login')}

      <!-- Seletor de layout -->
      <div style="margin-bottom:16px">
        <label style="font-size:.75rem;font-weight:600;color:var(--text-muted);letter-spacing:.01em;display:block;margin-bottom:8px">Layout</label>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${[
            { v: 'split',    emoji: '◧', title: 'Dividido',     desc: 'Painel + formulário' },
            { v: 'centered', emoji: '⊡', title: 'Centralizado', desc: 'Formulário no centro' },
            { v: 'fullbg',   emoji: '▣', title: 'Fundo total',  desc: 'Imagem de fundo' },
          ].map(({ v, emoji, title, desc }) => {
            const active = (c.loginLayout || 'split') === v;
            return `
              <label style="cursor:pointer">
                <input type="radio" name="login-layout" value="${v}" ${active ? 'checked' : ''}
                  style="display:none" onchange="_onLoginLayoutChange('${v}')">
                <div class="login-layout-card" data-layout="${v}"
                  style="border:2px solid ${active ? 'var(--primary)' : 'var(--border)'};
                  background:${active ? 'var(--primary-light,#DDE7D8)' : 'var(--surface)'};
                  border-radius:var(--r-md);padding:12px 8px;text-align:center;
                  cursor:pointer;transition:border-color .15s,background .15s">
                  <div style="font-size:1.4rem;margin-bottom:6px">${emoji}</div>
                  <div style="font-size:.8rem;font-weight:700;color:var(--text)">${title}</div>
                  <div style="font-size:.7rem;color:var(--text-muted);margin-top:3px;line-height:1.3">${desc}</div>
                </div>
              </label>`;
          }).join('')}
        </div>
      </div>

      <!-- Imagem de fundo (painel esq. no layout split, fundo total no fullbg) -->
      ${mediaField('b-login-bg', 'Imagem de fundo', 'Usada no painel esquerdo (layout Dividido) ou como fundo total (layout Fundo total). PNG, JPG, WEBP — Máx 4MB.', c.loginPanelBgImage)}

      <!-- Cores opcionais -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:8px">
        ${colorField('loginScreenBg', 'Fundo da tela',          c.loginScreenBg || '#d9d9d9', 'Cor ao redor do card de login')}
        ${colorField('loginPanelBg',  'Cor do painel esquerdo', c.loginPanelBg  || '#84c859', 'Substitui o gradiente verde')}
        ${colorField('loginPanelFrom','Cor clara do gradiente',  c.loginPanelFrom|| '#84c859', 'Verde claro no gradiente do painel')}
        ${colorField('loginPanelDark','Cor escura do gradiente', c.loginPanelDark|| '#07130f', 'Tom escuro do gradiente do painel')}
        ${colorField('loginFormBg',   'Fundo do formulário',    c.loginFormBg   || '#ffffff', 'Cor de fundo da área do formulário')}
        ${colorField('loginBtnFrom',  'Botão — cor inicial',    c.loginBtnFrom  || '#178f8f', 'Gradiente inicial do botão Entrar')}
        ${colorField('loginBtnTo',    'Botão — cor final',      c.loginBtnTo    || '#64d953', 'Gradiente final do botão Entrar')}
      </div>

      <!-- Textos do painel esquerdo (desktop) -->
      <div style="margin-bottom:14px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px">Painel Esquerdo — Desktop</div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:10px">Aparece somente no desktop (layout <em>Dividido</em>)</div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:.76rem">Eyebrow (texto acima do título, maiúsculas)</label>
          <input id="b-login-eyebrow" class="form-control" value="${_escHtml(c.loginBrandEyebrow || '')}" placeholder="ex: BPO Financeiro">
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:.76rem">Título principal</label>
          <input id="b-login-heading" class="form-control" value="${_escHtml(c.loginBrandHeading || '')}" placeholder="ex: Visão clara sobre seu fluxo financeiro">
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:.76rem">Descrição</label>
          <textarea id="b-login-desc" class="form-control" rows="2" placeholder="ex: Centralize receitas, despesas e metas em um só lugar.">${_escHtml(c.loginBrandDesc || '')}</textarea>
        </div>
        <div style="font-size:.72rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;margin-top:4px">Badges de recursos (3 pills)</div>
        <div style="display:grid;gap:8px">
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:.74rem">Pill 1</label>
            <input id="b-login-pill1" class="form-control" value="${_escHtml(c.loginPill1 || '')}" placeholder="ex: Dashboard em tempo real">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:.74rem">Pill 2</label>
            <input id="b-login-pill2" class="form-control" value="${_escHtml(c.loginPill2 || '')}" placeholder="ex: Metas e cobertura de despesas">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:.74rem">Pill 3</label>
            <input id="b-login-pill3" class="form-control" value="${_escHtml(c.loginPill3 || '')}" placeholder="ex: Recorrências automáticas">
          </div>
        </div>
        <div class="form-group" style="margin-top:10px;margin-bottom:0">
          <label class="form-label" style="font-size:.76rem">Rodapé / Copyright</label>
          <input id="b-login-copyright" class="form-control" value="${_escHtml(c.loginCopyright || '')}" placeholder="ex: © 2026 Lumers BPO Financeiro">
        </div>
      </div>

      <!-- Textos do formulário -->
      <div style="margin-bottom:14px">
        <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px">Textos do Formulário</div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:.76rem">Título do formulário</label>
          <input id="b-login-title" class="form-control" value="${_escHtml(c.loginTitle || '')}" placeholder="ex: Entrar">
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:.76rem">Subtítulo do formulário</label>
          <input id="b-login-subtitle" class="form-control" value="${_escHtml(c.loginSubtitle || '')}" placeholder="ex: Bem-vindo de volta ao Lumers Flow">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label" style="font-size:.76rem">Tagline (mobile — aparece no banner verde do topo)</label>
          <input id="b-login-tagline" class="form-control" value="${_escHtml(c.loginHeroTagline || '')}" placeholder="ex: BPO Financeiro — Gestão Inteligente">
        </div>
      </div>

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
    // Login screen
    'loginScreenBg', 'loginPanelBg', 'loginFormBg', 'loginBtnFrom', 'loginBtnTo', 'loginPanelFrom', 'loginPanelDark',
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

// ── Seletor de layout de login ────────────────────────────────────────────────

function _onLoginLayoutChange(value) {
  // Marca o radio correto
  const radio = document.querySelector(`input[name="login-layout"][value="${value}"]`);
  if (radio) radio.checked = true;
  // Atualiza estilo visual dos cards
  document.querySelectorAll('.login-layout-card').forEach(card => {
    const active = card.dataset.layout === value;
    card.style.borderColor = active ? 'var(--primary)' : 'var(--border)';
    card.style.background  = active ? 'var(--primary-light,#DDE7D8)' : 'var(--surface)';
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
    const isLogo     = fieldId === 'b-logo';
    const isLoginBg  = fieldId === 'b-login-bg';
    const maxW       = (isLogo || isLoginBg) ? 1920 : 64;
    const maxH       = (isLogo || isLoginBg) ? 1920 : 64;
    const data       = await _compressImage(file, maxW, maxH);

    if (isLogo) {
      _pendingLogoData = data;
    } else if (isLoginBg) {
      _pendingLoginBgData = data;
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
  if (fieldId === 'b-logo') {
    _pendingLogoData = '';
    const lbl = document.getElementById('b-logo-file-label');
    if (lbl) lbl.textContent = '';
  } else if (fieldId === 'b-login-bg') {
    _pendingLoginBgData = '';
    const lbl = document.getElementById('b-login-bg-file-label');
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
    // Login config
    loginLayout:       document.querySelector('input[name="login-layout"]:checked')?.value || 'split',
    loginPanelBg:      (document.getElementById('bt-loginPanelBg')?.value || '').trim(),
    loginFormBg:       (document.getElementById('bt-loginFormBg')?.value  || '').trim(),
    loginScreenBg:     (document.getElementById('bt-loginScreenBg')?.value || '').trim(),
    loginBtnFrom:      (document.getElementById('bt-loginBtnFrom')?.value  || '').trim(),
    loginBtnTo:        (document.getElementById('bt-loginBtnTo')?.value    || '').trim(),
    loginPanelFrom:    (document.getElementById('bt-loginPanelFrom')?.value || '').trim(),
    loginPanelDark:    (document.getElementById('bt-loginPanelDark')?.value || '').trim(),
    loginPanelBgImage: _pendingLoginBgData || document.getElementById('b-login-bg-url')?.value.trim() || '',
    loginBrandEyebrow: document.getElementById('b-login-eyebrow')?.value.trim() || '',
    loginBrandHeading: document.getElementById('b-login-heading')?.value.trim() || '',
    loginBrandDesc:    document.getElementById('b-login-desc')?.value.trim() || '',
    loginTitle:        document.getElementById('b-login-title')?.value.trim() || '',
    loginSubtitle:     document.getElementById('b-login-subtitle')?.value.trim() || '',
    loginHeroTagline:  document.getElementById('b-login-tagline')?.value.trim() || '',
    loginPill1:        document.getElementById('b-login-pill1')?.value.trim() || '',
    loginPill2:        document.getElementById('b-login-pill2')?.value.trim() || '',
    loginPill3:        document.getElementById('b-login-pill3')?.value.trim() || '',
    loginCopyright:    document.getElementById('b-login-copyright')?.value.trim() || '',
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

  // Login config
  _onLoginLayoutChange(c.loginLayout || 'split');
  if (c.loginPanelBg)  set('loginPanelBg',  c.loginPanelBg);
  if (c.loginFormBg)   set('loginFormBg',   c.loginFormBg);
  if (c.loginScreenBg) set('loginScreenBg', c.loginScreenBg);
  if (c.loginBtnFrom)  set('loginBtnFrom',  c.loginBtnFrom);
  if (c.loginBtnTo)    set('loginBtnTo',    c.loginBtnTo);
  if (c.loginPanelFrom)set('loginPanelFrom',c.loginPanelFrom);
  if (c.loginPanelDark)set('loginPanelDark',c.loginPanelDark);

  _pendingLoginBgData = c.loginPanelBgImage?.startsWith('data:') ? c.loginPanelBgImage : '';
  const loginBgUrlEl  = document.getElementById('b-login-bg-url');
  if (loginBgUrlEl) loginBgUrlEl.value = c.loginPanelBgImage?.startsWith('data:') ? '' : (c.loginPanelBgImage || '');
  _showMediaPreview('b-login-bg', c.loginPanelBgImage || '');

  const stv = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  stv('b-login-eyebrow',    c.loginBrandEyebrow);
  stv('b-login-heading',    c.loginBrandHeading);
  stv('b-login-desc',       c.loginBrandDesc);
  stv('b-login-title',      c.loginTitle);
  stv('b-login-subtitle',   c.loginSubtitle);
  stv('b-login-tagline',    c.loginHeroTagline);
  stv('b-login-pill1',      c.loginPill1);
  stv('b-login-pill2',      c.loginPill2);
  stv('b-login-pill3',      c.loginPill3);
  stv('b-login-copyright',  c.loginCopyright);
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
  _pendingLoginBgData = '';
  _populateBrandForm(getBrandDefaults());
  _applyBrand(getBrandDefaults());
  toast('Padrões restaurados (pré-visualizando). Clique em Salvar tudo para confirmar.', 'success');
}

async function saveBrandConfig() {
  const cfg = _collectBrandForm();

  // Valida hexadecimais obrigatórios
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
  // Valida hexadecimais opcionais (login)
  for (const f of ['loginPanelBg', 'loginFormBg', 'loginScreenBg', 'loginBtnFrom', 'loginBtnTo', 'loginPanelFrom', 'loginPanelDark']) {
    if (cfg[f] && !hexRe.test(cfg[f])) {
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
    _pendingLoginBgData = '';
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
