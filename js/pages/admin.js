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
    { id: 'dashboard', href: '#/admin',        lucide: 'layout-dashboard', label: 'Visão Geral' },
    { id: 'users',     href: '#/admin-users',  lucide: 'users',            label: 'Usuários'    },
    { id: 'plans',     href: '#/admin-plans',  lucide: 'credit-card',      label: 'Planos'      },
    { id: 'banks',     href: '#/banks',        lucide: 'landmark',         label: 'Bancos'      },
  ];
  if (isSuperAdmin) {
    tabs.push({ id: 'email',  href: '#/admin-email',  lucide: 'megaphone',  label: 'Comunicação' });
    tabs.push({ id: 'theme',  href: '#/admin-theme',  lucide: 'palette',    label: 'Tema'    });
    tabs.push({ id: 'system', href: '#/admin-system', lucide: 'settings',   label: 'Sistema' });
    tabs.push({ id: 'logs',   href: '#/admin-logs',   lucide: 'scroll-text',label: 'Logs'    });
  }
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
        <div class="admin-dash-block-sub" id="admin-stat-last-active-time-block">${lastUser ? _timeAgo(lastUser.last_active || lastUser.last_login) : '—'}</div>
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
                      <td style="padding:6px 8px;color:var(--text-muted);font-size:.75rem;white-space:nowrap">${t.created_at ? fmtDateTime(t.created_at) : '—'}</td>
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
  if (el('admin-stat-last-active-time'))      el('admin-stat-last-active-time').textContent      = lastUser ? _timeAgo(lastUser.last_active || lastUser.last_login) : '—';
  if (el('admin-stat-last-active-block'))     el('admin-stat-last-active-block').textContent     = lastUser ? (lastUser.name || lastUser.email || '—') : '—';
  if (el('admin-stat-last-active-time-block'))el('admin-stat-last-active-time-block').textContent= lastUser ? _timeAgo(lastUser.last_active || lastUser.last_login) : '—';

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
                  <td style="padding:6px 8px;color:var(--text-muted);font-size:.75rem;white-space:nowrap">${t.created_at ? fmtDateTime(t.created_at) : '—'}</td>
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
let _adminUsersF = { search: '', role: '', status: '', saldo: '', cadastro: '', acesso: '', sort: 'name' };

async function renderAdminUsers() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
  try {
    const stats = await _api('GET', '/admin/users?stats=true');
    _adminUsersCache = stats.users || [];
    _adminUsersF = { search: '', role: '', status: '', saldo: '', cadastro: '', acesso: '', sort: 'name' };
    _renderAdminUsersPage();
  } catch(e) {
    content.innerHTML = `<div class="empty-state"><p style="color:var(--expense)">Erro ao carregar: ${e.message}</p></div>`;
  }
}

function _renderAdminUsersPage() {
  const content = document.getElementById('content');
  const users   = _adminUsersCache;
  const comWpp  = users.filter(u => u.phone).length;

  content.innerHTML = `
    ${_adminNavBar('users')}

    <!-- Busca + Ações -->
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px">
      <div style="flex:1;min-width:180px">
        <input id="admin-user-search" class="form-control" type="search"
          placeholder="Buscar por nome, e-mail ou telefone..."
          value="${_escHtml(_adminUsersF.search)}"
          oninput="_adminUsersSet('search',this.value)">
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

    <!-- Filtros -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;padding:12px 14px;background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--r-md)">
      <select class="form-control" style="flex:1;min-width:130px;max-width:180px;height:40px;padding:10px;font-size:.83rem"
        onchange="_adminUsersSet('role',this.value)">
        <option value="" ${_adminUsersF.role===''?'selected':''}>Todos os perfis</option>
        <option value="user"        ${_adminUsersF.role==='user'?'selected':''}>Usuário</option>
        <option value="admin"       ${_adminUsersF.role==='admin'?'selected':''}>Admin</option>
        <option value="super_admin" ${_adminUsersF.role==='super_admin'?'selected':''}>Super Admin</option>
      </select>

      <select class="form-control" style="flex:1;min-width:130px;max-width:180px;height:40px;padding:10px;font-size:.83rem"
        onchange="_adminUsersSet('status',this.value)">
        <option value="" ${_adminUsersF.status===''?'selected':''}>Qualquer status</option>
        <option value="active"   ${_adminUsersF.status==='active'?'selected':''}>Ativo (já logou)</option>
        <option value="inactive" ${_adminUsersF.status==='inactive'?'selected':''}>Inativo (nunca logou)</option>
      </select>

      <select class="form-control" style="flex:1;min-width:130px;max-width:180px;height:40px;padding:10px;font-size:.83rem"
        onchange="_adminUsersSet('saldo',this.value)">
        <option value="" ${_adminUsersF.saldo===''?'selected':''}>Qualquer saldo</option>
        <option value="positive" ${_adminUsersF.saldo==='positive'?'selected':''}>Saldo positivo</option>
        <option value="negative" ${_adminUsersF.saldo==='negative'?'selected':''}>Saldo negativo</option>
        <option value="zero"     ${_adminUsersF.saldo==='zero'?'selected':''}>Sem movimentação</option>
      </select>

      <select class="form-control" style="flex:1;min-width:140px;max-width:190px;height:40px;padding:10px;font-size:.83rem"
        onchange="_adminUsersSet('cadastro',this.value)">
        <option value="" ${_adminUsersF.cadastro===''?'selected':''}>Qualquer cadastro</option>
        <option value="7d"  ${_adminUsersF.cadastro==='7d'?'selected':''}>Últimos 7 dias</option>
        <option value="30d" ${_adminUsersF.cadastro==='30d'?'selected':''}>Últimos 30 dias</option>
        <option value="90d" ${_adminUsersF.cadastro==='90d'?'selected':''}>Últimos 90 dias</option>
        <option value="old" ${_adminUsersF.cadastro==='old'?'selected':''}>Mais de 90 dias</option>
      </select>

      <select class="form-control" style="flex:1;min-width:140px;max-width:190px;height:40px;padding:10px;font-size:.83rem"
        onchange="_adminUsersSet('acesso',this.value)">
        <option value="" ${_adminUsersF.acesso===''?'selected':''}>Qualquer acesso</option>
        <option value="7d"   ${_adminUsersF.acesso==='7d'?'selected':''}>Acessou em 7 dias</option>
        <option value="30d"  ${_adminUsersF.acesso==='30d'?'selected':''}>Acessou em 30 dias</option>
        <option value="old"  ${_adminUsersF.acesso==='old'?'selected':''}>Mais de 30 dias</option>
        <option value="never"${_adminUsersF.acesso==='never'?'selected':''}>Nunca acessou</option>
      </select>

      <select class="form-control" style="flex:1;min-width:130px;max-width:170px;height:40px;padding:10px;font-size:.83rem"
        onchange="_adminUsersSet('sort',this.value)">
        <option value="name"    ${_adminUsersF.sort==='name'?'selected':''}>Ordenar: Nome</option>
        <option value="recent"  ${_adminUsersF.sort==='recent'?'selected':''}>Ordenar: Mais recente</option>
        <option value="oldest"  ${_adminUsersF.sort==='oldest'?'selected':''}>Ordenar: Mais antigo</option>
        <option value="balance" ${_adminUsersF.sort==='balance'?'selected':''}>Ordenar: Saldo</option>
        <option value="login"   ${_adminUsersF.sort==='login'?'selected':''}>Ordenar: Último acesso</option>
        <option value="tx"      ${_adminUsersF.sort==='tx'?'selected':''}>Ordenar: Transações</option>
      </select>

      <button class="btn btn-sm btn-ghost" style="height:40px;padding:10px;white-space:nowrap" onclick="_adminUsersClearFilters()">
        ${icon('x',13)} Limpar filtros
      </button>
    </div>

    <!-- Contadores + lista -->
    <div id="admin-users-list"></div>
  `;

  _adminUsersRefreshList();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _adminUsersSet(key, value) {
  _adminUsersF[key] = value;
  _adminUsersRefreshList();
}

function _adminUsersClearFilters() {
  _adminUsersF = { search: '', role: '', status: '', saldo: '', cadastro: '', acesso: '', sort: 'name' };
  _renderAdminUsersPage();
}

function _adminUsersRefreshList() {
  const listEl = document.getElementById('admin-users-list');
  if (!listEl) return;

  const now    = new Date();
  const daysAgo = d => new Date(now.getTime() - d * 86400000);
  const f = _adminUsersF;

  let filtered = _adminUsersCache.filter(u => {
    const balance = (u.total_income || 0) - (u.total_expense || 0);
    const role    = u.role || (u.is_admin ? 'admin' : 'user');

    // Busca texto
    if (f.search) {
      const term = f.search.toLowerCase();
      if (!(u.name || '').toLowerCase().includes(term) &&
          !(u.email || '').toLowerCase().includes(term) &&
          !(u.phone || '').includes(f.search)) return false;
    }
    // Perfil
    if (f.role && role !== f.role) return false;
    // Status — usa last_active (login ou última transação)
    const _lastActive = u.last_active || u.last_login;
    if (f.status === 'active'   && !_lastActive) return false;
    if (f.status === 'inactive' &&  _lastActive) return false;
    // Saldo
    if (f.saldo === 'positive' && balance <= 0) return false;
    if (f.saldo === 'negative' && balance >= 0) return false;
    if (f.saldo === 'zero'     && (u.tx_count || 0) > 0) return false;
    // Data de cadastro
    if (f.cadastro) {
      const created = u.created_at ? new Date(u.created_at) : null;
      if (!created) return false;
      if (f.cadastro === '7d'  && created < daysAgo(7))   return false;
      if (f.cadastro === '30d' && created < daysAgo(30))  return false;
      if (f.cadastro === '90d' && created < daysAgo(90))  return false;
      if (f.cadastro === 'old' && created >= daysAgo(90)) return false;
    }
    // Último acesso
    if (f.acesso) {
      const login = (u.last_active || u.last_login) ? new Date(u.last_active || u.last_login) : null;
      if (f.acesso === 'never' && login)                  return false;
      if (f.acesso !== 'never' && !login)                 return false;
      if (f.acesso === '7d'  && login < daysAgo(7))       return false;
      if (f.acesso === '30d' && login < daysAgo(30))      return false;
      if (f.acesso === 'old' && login >= daysAgo(30))     return false;
    }
    return true;
  });

  // Ordenação — critério primário: perfil (super_admin → admin → user), depois critério selecionado
  const _roleOrder = r => r === 'super_admin' ? 0 : r === 'admin' ? 1 : 2;
  filtered = [...filtered].sort((a, b) => {
    const roleDiff = _roleOrder(a.role) - _roleOrder(b.role);
    if (roleDiff !== 0) return roleDiff;
    const balA = (a.total_income||0)-(a.total_expense||0);
    const balB = (b.total_income||0)-(b.total_expense||0);
    if (f.sort === 'name')    return (a.name||a.email).localeCompare(b.name||b.email, 'pt');
    if (f.sort === 'recent')  return new Date(b.created_at||0) - new Date(a.created_at||0);
    if (f.sort === 'oldest')  return new Date(a.created_at||0) - new Date(b.created_at||0);
    if (f.sort === 'balance') return balB - balA;
    if (f.sort === 'login')   return new Date(b.last_active||b.last_login||0) - new Date(a.last_active||a.last_login||0);
    if (f.sort === 'tx')      return (b.tx_count||0) - (a.tx_count||0);
    return (a.name||a.email).localeCompare(b.name||b.email, 'pt');
  });

  const users  = _adminUsersCache;
  const comWpp = users.filter(u => u.phone).length;
  const hasFilters = f.search || f.role || f.status || f.saldo || f.cadastro || f.acesso;

  listEl.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <span style="font-size:.82rem;color:var(--text-muted)">${icon('users',13)} <strong>${users.length}</strong> total</span>
      <span style="font-size:.82rem;color:var(--income-text)">${icon('message-circle',13)} <strong>${comWpp}</strong> com WhatsApp</span>
      ${hasFilters ? `<span style="font-size:.82rem;color:var(--warning-text);background:var(--warning-light);padding:2px 8px;border-radius:10px">${icon('filter',12)} ${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}</span>` : ''}
    </div>
    ${filtered.length === 0
      ? `<div class="empty-state">${icon('search-x',36)}<p>Nenhum usuário encontrado com esses filtros</p><button class="btn btn-sm btn-ghost" onclick="_adminUsersClearFilters()">Limpar filtros</button></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${filtered.map(u => _adminUserRow(u)).join('')}
         </div>`}
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _adminUsersFilterInput(term) {
  _adminUsersSet('search', term);
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
            <div style="font-size:.78rem;color:var(--text-muted)">${(u.last_active||u.last_login) ? fmtDateTime(u.last_active||u.last_login) : '—'}</div>
          </div>
        </div>

        <!-- Ações -->
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:4px">
          <button class="btn btn-sm btn-icon btn-ghost" style="color:var(--primary)"
            onclick="impersonateUser('${u.id}',this)" title="Acessar conta (somente leitura)">
            ${icon('eye',14)}
          </button>
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
        <span style="font-size:.78rem;color:var(--text-muted);margin-left:auto">${(u.last_active||u.last_login) ? fmtDateTime(u.last_active||u.last_login) : 'Nunca logou'}</span>
      </div>
    </div>`;
}

// ── Impersonação: "Acessar conta" (somente leitura) ────────────────────────────
async function impersonateUser(userId, btn) {
  if (btn) { btn.disabled = true; }
  try {
    const res = await _api('POST', '/admin/users', { action: 'impersonate', targetUserId: userId });
    enterImpersonation(res.token, res.target);
  } catch (err) {
    if (btn) btn.disabled = false;
    const msg = err?.response?.message || err?.message || 'Erro ao acessar a conta';
    toast(msg, 'error');
  }
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
                ${icon('clock',11)} Acesso: ${(user.last_active||user.last_login) ? fmtDateTime(user.last_active||user.last_login) : 'Nunca'}
              </span>
            </div>
          </div>
          <!-- Ações rápidas -->
          <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
            <button class="btn btn-sm btn-outline" style="color:var(--primary)" onclick="impersonateUser('${user.id}',this)">
              ${icon('eye',13)} Acessar conta
            </button>
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
    const sysCfg = await _api('GET', '/admin/users?resource=system-settings').catch(() => ({}));

    const allowReg     = sysCfg.allow_registration === '1';
    const evoGlobalKey = sysCfg.evolution_global_key || '';
    const cronSecret   = sysCfg.cron_secret || '';
    const n8nUrl       = sysCfg.n8n_webhook_url || '';
    const n8nSecret    = sysCfg.n8n_secret || '';
    const aiCfg        = {
      enabled:      sysCfg.ai_enabled === '1',
      groqKey:      sysCfg.ai_groq_key || '',
      groqModel:    sysCfg.ai_groq_model || 'llama-3.3-70b-versatile',
      geminiKey:    sysCfg.ai_gemini_key || '',
      geminiModel:  sysCfg.ai_gemini_model || 'gemini-2.0-flash',
    };

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
      ${await _renderEvolutionSection(evoGlobalKey, cronSecret, n8nUrl, n8nSecret)}
      ${_renderAiSection(aiCfg)}`;

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

// ── Render Admin Theme ────────────────────────────────────────────────────────

async function renderAdminTheme() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  const _user = pb.authStore.model;
  const isSuperAdmin = _user?.role === 'super_admin' || _user?.email === 'applumergestao@gmail.com';
  if (!isSuperAdmin) {
    content.innerHTML = `
      ${_adminNavBar('theme')}
      <div style="padding:48px;text-align:center;color:var(--text-muted)">
        <i data-lucide="shield-off" style="width:40px;height:40px;opacity:.3;display:block;margin:0 auto 12px"></i>
        <p>Acesso restrito a Super Admin.</p>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  try {
    const brandCfg = await fetch('/api/brand').then(r => r.json()).catch(() => ({}));

    // Reseta pendentes ao entrar na página
    _pendingLogoData    = '';
    _pendingFaviconData = '';
    _pendingLoginBgData = '';

    content.innerHTML = `
      ${_adminNavBar('theme')}
      ${_adminBrandSection(brandCfg)}`;

    if (typeof lucide !== 'undefined') lucide.createIcons();
    _initBrandEditor();
  } catch(e) {
    content.innerHTML = `<p style="color:var(--expense);padding:16px">Erro: ${e.message}</p>`;
  }
}

// ── Evolution API Instance Management ────────────────────────────────────────

async function _renderEvolutionSection(evoGlobalKey = '', cronSecret = '', n8nUrl = '', n8nSecret = '') {
  let instances = [];
  try { instances = await _api('GET', '/admin/users?resource=evolution-instances'); } catch {}
  const statusColor  = s => (s === 'connected' || s === 'open') ? 'var(--income-text,#16a34a)' : s === 'connecting' ? 'var(--warning,#d97706)' : 'var(--expense,#dc2626)';
  const statusLabel  = s => (s === 'connected' || s === 'open') ? 'Conectada' : s === 'connecting' ? 'Conectando…' : 'Desconectada';
  const hasDefault   = instances.some(i => i.is_default);
  const rows = instances.map(inst => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:.9rem">${_escHtml(inst.name)}</span>
          ${inst.is_default ? `<span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:20px;
            background:var(--income-light,#dcfce7);color:var(--income-text,#16a34a);letter-spacing:.02em">
            PADRÃO</span>` : ''}
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
          ${inst.number ? _escHtml(inst.number) : 'Sem número'} &nbsp;·&nbsp;
          <span style="color:${statusColor(inst.connectionStatus)};font-weight:600">
            ${statusLabel(inst.connectionStatus)}
          </span>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        ${!inst.is_default ? `
          <button class="btn btn-sm" onclick="_evoSetDefault('${_escHtml(inst.name)}')"
            style="font-size:.75rem;padding:4px 10px;background:var(--primary-light,#DDE7D8);color:var(--primary-600);border:none"
            title="Usar esta instância como padrão para envio de mensagens">
            ${icon('star', 12)} Padrão
          </button>` : ''}
        ${(inst.connectionStatus !== 'connected' && inst.connectionStatus !== 'open') ? `
          <button class="btn btn-sm" onclick="_evoConnectInstance('${_escHtml(inst.name)}')"
            style="font-size:.75rem;padding:4px 10px">
            ${icon('qr-code', 12)} QR Code
          </button>` : ''}
        <button class="btn btn-sm" onclick="_evoTestConnection('${_escHtml(inst.name)}', this)"
          style="font-size:.75rem;padding:4px 10px"
          title="Verifica o status ao vivo na Evolution e reaplica o webhook">
          ${icon('activity', 12)} Testar
        </button>
        <button class="btn btn-sm" onclick="_evoEditKey('${_escHtml(inst.name)}')"
          style="font-size:.78rem" title="Atualizar a API key desta instância">
          ${icon('key', 12)} Chave
        </button>
        <button class="btn btn-sm" onclick="_evoUnlinkInstance('${_escHtml(inst.name)}')"
          style="font-size:.75rem;padding:4px 10px;background:var(--bg-subtle);color:var(--text-muted);border:none"
          title="Remove do sistema sem deletar na Evolution">
          ${icon('unlink', 12)} Desvincular
        </button>
        <button class="btn btn-sm" onclick="_evoDeleteInstance('${_escHtml(inst.name)}')"
          style="font-size:.75rem;padding:4px 10px;background:var(--expense-light,#fee2e2);color:var(--expense,#dc2626);border:none"
          title="Exclui a instância da Evolution e remove do sistema">
          ${icon('trash-2', 12)} Excluir
        </button>
      </div>
    </div>`).join('');

  return `
    <div class="card" style="margin-bottom:20px" id="evolution-section">
      <div class="card-title" style="margin-bottom:4px">${icon('message-circle', 14)} WhatsApp — Instâncias Evolution</div>
      <p style="font-size:.78rem;color:var(--text-muted);margin:0 0 16px;line-height:1.5">
        Exibe apenas instâncias cadastradas neste sistema. Para adicionar uma instância já existente, use <strong>Vincular instância</strong> abaixo.
      </p>
      <div id="evo-instances-list">
        ${rows || '<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0">Nenhuma instância cadastrada neste sistema.</div>'}
      </div>

      <!-- Chave global -->
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">Chave global (para criar/excluir instâncias)</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px">
          Chave <code>AUTHENTICATION_API_KEY</code> do servidor Evolution — necessária para criar e excluir instâncias.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input id="evo-global-key" type="password" class="form-input"
            placeholder="Cole aqui a chave global…"
            value="${_escHtml(evoGlobalKey)}"
            style="flex:1;font-size:.85rem;font-family:monospace">
          <button class="btn btn-outline" onclick="_evoTestGlobalKey()" id="evo-key-test-btn"
            style="font-size:.85rem;white-space:nowrap">
            ${icon('zap', 14)} Testar
          </button>
          <button class="btn btn-primary" onclick="_evoSaveGlobalKey()" id="evo-key-btn"
            style="font-size:.85rem;white-space:nowrap">
            ${icon('save', 14)} Salvar
          </button>
        </div>
        <div id="evo-key-feedback" style="margin-bottom:4px"></div>
      </div>

      <!-- Vincular instância existente -->
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${icon('link', 13)} Vincular instância existente</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
          Registra uma instância já existente na Evolution neste sistema. Informe o nome exato da instância e, se necessário, a chave da instância.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <input id="evo-link-name" type="text" class="form-input" placeholder="Nome da instância"
            style="flex:2;min-width:140px;font-size:.85rem">
          <input id="evo-link-key" type="password" class="form-input" placeholder="Chave da instância (opcional)"
            style="flex:2;min-width:140px;font-size:.85rem;font-family:monospace">
          <button class="btn btn-outline" onclick="_evoLinkInstance()" id="evo-link-btn"
            style="font-size:.85rem;white-space:nowrap;flex-shrink:0">
            ${icon('link', 14)} Vincular
          </button>
        </div>
        <div id="evo-link-feedback" style="margin-bottom:4px"></div>
      </div>

      <!-- Criar nova instância -->
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${icon('plus-circle', 13)} Criar nova instância</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px">
          Cria uma nova instância na Evolution e registra automaticamente neste sistema.
        </div>
        <div style="display:flex;gap:8px">
          <input id="evo-new-name" type="text" class="form-input" placeholder="Nome da instância (ex: app-lumers2)"
            style="flex:1;font-size:.85rem" onkeydown="if(event.key==='Enter')_evoCreateInstance()">
          <button class="btn btn-primary" onclick="_evoCreateInstance()" id="evo-create-btn"
            style="font-size:.85rem;white-space:nowrap">
            ${icon('plus', 14)} Criar
          </button>
        </div>
        <div id="evo-create-feedback" style="margin-top:10px"></div>
      </div>

      ${!hasDefault && instances.length > 0 ? `
      <div style="margin-top:16px;background:#fef9c3;border:1px solid #fde047;border-radius:var(--r-md);padding:10px 14px;
        display:flex;align-items:center;gap:10px;font-size:.82rem;color:#713f12">
        ${icon('alert-triangle', 14)}
        <span>Nenhuma instância padrão definida. Clique em <strong>Padrão</strong> em uma das instâncias acima para habilitar o envio de mensagens.</span>
      </div>` : ''}

      <div id="evo-qr-panel" style="display:none;margin-top:16px;text-align:center"></div>

      <!-- Disparo automático (cron externo) -->
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${icon('clock', 13)} Disparo automático (cron externo)</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
          Cole esta URL no <strong>cron-job.org</strong> (ou similar) com intervalo de <strong>1 minuto</strong> para processar a fila de mensagens.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <input id="cron-url-input" type="text" class="form-input" readonly
            value="${cronSecret ? `${location.origin}/api/cron/dispatcher?secret=${cronSecret}` : ''}"
            placeholder="${cronSecret ? '' : 'Gere um secret primeiro…'}"
            style="flex:1;font-size:.8rem;font-family:monospace;background:var(--bg-subtle);color:var(--text-primary)">
          <button class="btn btn-outline" id="cron-copy-btn" onclick="_cronCopyUrl()"
            ${cronSecret ? '' : 'disabled'}
            style="font-size:.83rem;white-space:nowrap;flex-shrink:0">
            ${icon('copy', 14)} Copiar URL
          </button>
        </div>
        <button class="btn btn-outline" onclick="_cronGenerateSecret()"
          style="font-size:.82rem;white-space:nowrap">
          ${icon('refresh-cw', 13)} Gerar/Regenerar secret
        </button>
        <div id="cron-secret-feedback" style="font-size:.78rem;margin-top:8px;display:none"></div>
      </div>

      <!-- Integração n8n (registro automático via WhatsApp) -->
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${icon('workflow', 13)} Integração n8n — registro automático via WhatsApp</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:12px;line-height:1.5">
          Quando o usuário envia uma mensagem no WhatsApp, o sistema repassa a mensagem para o <strong>webhook do n8n</strong>.
          O fluxo do n8n interpreta e chama de volta o endpoint abaixo para registrar o lançamento.
          Deixe a URL em branco para desativar o repasse.
        </div>

        <label class="form-label" style="font-size:.78rem">URL do webhook do n8n</label>
        <input id="n8n-url-input" type="text" class="form-input"
          placeholder="https://seu-n8n.com/webhook/lumers-whatsapp"
          value="${_escHtml(n8nUrl)}"
          style="width:100%;font-size:.85rem;font-family:monospace;margin-bottom:10px">

        <label class="form-label" style="font-size:.78rem">Secret (header <code>x-n8n-secret</code>)</label>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input id="n8n-secret-input" type="password" class="form-input"
            placeholder="Secret compartilhado com o n8n"
            value="${_escHtml(n8nSecret)}"
            style="flex:1;font-size:.85rem;font-family:monospace">
          <button class="btn btn-outline" onclick="_n8nGenSecret()" style="font-size:.83rem;white-space:nowrap;flex-shrink:0">
            ${icon('refresh-cw', 13)} Gerar
          </button>
          <button class="btn btn-primary" onclick="_n8nSaveConfig()" id="n8n-save-btn" style="font-size:.83rem;white-space:nowrap;flex-shrink:0">
            ${icon('save', 14)} Salvar
          </button>
        </div>
        <div id="n8n-feedback" style="font-size:.78rem;margin-bottom:12px"></div>

        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">
          Endpoint de callback (cole no nó HTTP do n8n para registrar transações):
        </div>
        <div style="display:flex;gap:8px">
          <input id="n8n-callback-input" type="text" class="form-input" readonly
            value="${location.origin}/api/n8n"
            style="flex:1;font-size:.8rem;font-family:monospace;background:var(--bg-subtle);color:var(--text-primary)">
          <button class="btn btn-outline" onclick="_n8nCopyCallback()" style="font-size:.83rem;white-space:nowrap;flex-shrink:0">
            ${icon('copy', 14)} Copiar
          </button>
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:8px;line-height:1.5">
          Operações aceitas (POST com header <code>x-n8n-secret</code>):
          <code>userByPhone</code>, <code>addTransaction</code>, <code>addInstallment</code>.
        </div>
      </div>
    </div>`;
}

// ── Render seção do Assistente de IA no WhatsApp ──────────────────────────────
// Quando ligado, o "cérebro" roda no próprio app: entende nível de acesso, nome do
// usuário (pelo número), registra lançamentos por texto/áudio/print, pergunta quando
// não sabe se é receita ou despesa. Groq = texto/raciocínio, Gemini = áudio + imagem.
function _renderAiSection(cfg = {}) {
  const enabled = !!cfg.enabled;
  return `
    <div class="card" style="margin-bottom:20px" id="ai-section">
      <div class="card-title" style="margin-bottom:4px">${icon('sparkles', 14)} Assistente de IA no WhatsApp</div>
      <p style="font-size:.78rem;color:var(--text-muted);margin:0 0 16px;line-height:1.5">
        Quando ligado, o assistente responde no WhatsApp entendendo o <strong>nível de acesso</strong> e o <strong>nome</strong>
        do usuário (pelo número cadastrado), registra lançamentos por <strong>texto, áudio e print</strong>, e pergunta quando
        estiver em dúvida se é receita ou despesa. Usuário comum acessa só a própria conta; administrador acessa todos.
        Com a IA ligada, o repasse ao n8n é ignorado.
      </p>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-weight:600;font-size:.9rem">Ativar assistente de IA</div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">
            Exige as chaves configuradas abaixo. Groq para texto/raciocínio, Gemini para áudio e imagens.
          </div>
        </div>
        <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0">
          <input type="checkbox" id="ai-enabled-toggle" ${enabled ? 'checked' : ''}
            style="width:0;height:0;opacity:0;position:absolute"
            onchange="(function(c){var t=document.getElementById('ai-enabled-track'),k=document.getElementById('ai-enabled-knob');if(t)t.style.background=c?'var(--primary-600)':'var(--border)';if(k)k.style.left=c?'23px':'3px';})(this.checked)">
          <div id="ai-enabled-track" style="
            width:46px;height:26px;border-radius:13px;transition:background .2s;
            background:${enabled ? 'var(--primary-600)' : 'var(--border)'};position:relative">
            <div style="position:absolute;top:3px;left:${enabled ? '23px' : '3px'};
              width:20px;height:20px;border-radius:50%;background:#fff;
              box-shadow:0 1px 3px rgba(0,0,0,.2);transition:left .2s" id="ai-enabled-knob"></div>
          </div>
        </label>
      </div>

      <!-- Groq (texto/raciocínio) -->
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${icon('brain', 13)} Groq — texto e raciocínio</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px">
          Chave da API Groq (console.groq.com). Usada para entender pedidos e classificar receita/despesa.
        </div>
        <label class="form-label" style="font-size:.78rem">Chave da API Groq</label>
        <input id="ai-groq-key" type="password" class="form-input"
          placeholder="gsk_…" value="${_escHtml(cfg.groqKey || '')}"
          style="width:100%;font-size:.85rem;font-family:monospace;margin-bottom:10px">
        <label class="form-label" style="font-size:.78rem">Modelo Groq</label>
        <input id="ai-groq-model" type="text" class="form-input"
          placeholder="llama-3.3-70b-versatile" value="${_escHtml(cfg.groqModel || '')}"
          style="width:100%;font-size:.85rem;font-family:monospace;margin-bottom:6px">
      </div>

      <!-- Gemini (áudio + imagem) -->
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px">
        <div style="font-weight:600;font-size:.85rem;margin-bottom:4px">${icon('image', 13)} Gemini — áudio e imagens/prints</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:8px">
          Chave da API Gemini (aistudio.google.com). Usada para transcrever áudios e interpretar prints.
        </div>
        <label class="form-label" style="font-size:.78rem">Chave da API Gemini</label>
        <input id="ai-gemini-key" type="password" class="form-input"
          placeholder="AIza…" value="${_escHtml(cfg.geminiKey || '')}"
          style="width:100%;font-size:.85rem;font-family:monospace;margin-bottom:10px">
        <label class="form-label" style="font-size:.78rem">Modelo Gemini</label>
        <input id="ai-gemini-model" type="text" class="form-input"
          placeholder="gemini-2.0-flash" value="${_escHtml(cfg.geminiModel || '')}"
          style="width:100%;font-size:.85rem;font-family:monospace;margin-bottom:6px">
      </div>

      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="_aiSaveConfig()" id="ai-save-btn" style="font-size:.85rem;white-space:nowrap">
          ${icon('save', 14)} Salvar configuração de IA
        </button>
        <button class="btn btn-secondary" onclick="_aiTestConnection()" id="ai-test-btn" style="font-size:.85rem;white-space:nowrap">
          ${icon('plug', 14)} Testar conexão
        </button>
        <button class="btn btn-secondary" onclick="_aiLoadQuota()" id="ai-quota-btn" style="font-size:.85rem;white-space:nowrap">
          ${icon('gauge', 14)} Ver cota de uso
        </button>
      </div>
      <div id="ai-feedback" style="font-size:.78rem;margin-top:10px"></div>
      <div id="ai-quota-box" style="margin-top:14px"></div>
    </div>`;
}

// Barra de progresso de cota (uso = limite - restante).
function _quotaBar(label, used, limit, resetTxt) {
  const has = Number.isFinite(used) && Number.isFinite(limit) && limit > 0;
  const pct = has ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : 'var(--primary,#6366f1)';
  const right = has ? `${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')}` : '—';
  return `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:.75rem;margin-bottom:3px">
        <span style="color:var(--text-muted)">${label}</span>
        <span style="font-weight:600">${right}${has ? ` · ${pct}%` : ''}</span>
      </div>
      <div style="height:8px;background:var(--border,#e5e7eb);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:6px;transition:width .4s"></div>
      </div>
      ${resetTxt ? `<div style="font-size:.68rem;color:var(--text-muted);margin-top:2px">renova em ${_escHtml(resetTxt)}</div>` : ''}
    </div>`;
}

function _quotaProvider(title, p) {
  if (!p || !p.configured) {
    return `<div style="flex:1;min-width:240px;background:var(--surface-2,#f8fafc);border-radius:var(--r-md);padding:12px 14px">
      <div style="font-weight:600;font-size:.85rem;margin-bottom:8px">${title}</div>
      <div style="font-size:.78rem;color:var(--text-muted)">Chave não configurada.</div>
    </div>`;
  }
  const statusMap = {
    ok:        { txt: 'Operacional', bg: '#dcfce7', fg: '#16a34a' },
    exhausted: { txt: 'Cota esgotada', bg: '#fee2e2', fg: '#dc2626' },
    error:     { txt: 'Erro', bg: '#fef3c7', fg: '#b45309' },
  };
  const s = statusMap[p.status] || statusMap.error;
  const pill = `<span style="background:${s.bg};color:${s.fg};font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:999px">${s.txt}</span>`;
  let body = '';
  if (p.requests || p.tokens) {
    if (p.requests && Number.isFinite(p.requests.limit)) {
      body += _quotaBar('Requisições (por dia)', p.requests.limit - p.requests.remaining, p.requests.limit, p.requests.reset);
    }
    if (p.tokens && Number.isFinite(p.tokens.limit)) {
      body += _quotaBar('Tokens (por minuto)', p.tokens.limit - p.tokens.remaining, p.tokens.limit, p.tokens.reset);
    }
  }
  if (!body) {
    body = `<div style="font-size:.78rem;color:var(--text-muted)">${
      p.status === 'ok'
        ? 'A API não expõe a cota restante. Status verificado: operacional.'
        : _escHtml(p.error || 'Sem dados de cota disponíveis.')
    }${p.retryAfter ? ` · tente novamente em ${_escHtml(String(p.retryAfter))}` : ''}</div>`;
  }
  return `<div style="flex:1;min-width:240px;background:var(--surface-2,#f8fafc);border-radius:var(--r-md);padding:12px 14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-weight:600;font-size:.85rem">${title}</span>${pill}
    </div>
    ${body}
  </div>`;
}

async function _aiLoadQuota() {
  const box = document.getElementById('ai-quota-box');
  const btn = document.getElementById('ai-quota-btn');
  if (!box) return;
  if (btn) { btn.disabled = true; btn.innerHTML = icon('loader', 14) + ' Consultando…'; }
  box.innerHTML = `<div style="font-size:.78rem;color:var(--text-muted)">Consultando cota dos provedores…</div>`;
  try {
    const res = await _api('POST', '/admin/users', { action: 'ai-quota' });
    box.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap">
      ${_quotaProvider(icon('brain', 13) + ' Groq — texto/raciocínio', res.groq)}
      ${_quotaProvider(icon('image', 13) + ' Gemini — áudio/imagem', res.gemini)}
    </div>`;
  } catch (e) {
    box.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);padding:6px 10px;color:#dc2626;font-size:.78rem">Erro ao consultar cota: ${_escHtml(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = icon('gauge', 14) + ' Ver cota de uso'; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

async function _aiSaveConfig() {
  const btn = document.getElementById('ai-save-btn');
  const fb  = document.getElementById('ai-feedback');
  const enabled     = document.getElementById('ai-enabled-toggle')?.checked ? '1' : '0';
  const groqKey     = (document.getElementById('ai-groq-key')?.value || '').trim();
  const groqModel   = (document.getElementById('ai-groq-model')?.value || '').trim() || 'llama-3.3-70b-versatile';
  const geminiKey   = (document.getElementById('ai-gemini-key')?.value || '').trim();
  const geminiModel = (document.getElementById('ai-gemini-model')?.value || '').trim() || 'gemini-2.0-flash';

  if (enabled === '1' && !groqKey) {
    toast('Para ativar a IA, informe ao menos a chave da Groq (texto).', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Salvando…';
  try {
    await _api('PUT', '/admin/users?resource=system-settings', {
      ai_enabled: enabled,
      ai_groq_key: groqKey,
      ai_groq_model: groqModel,
      ai_gemini_key: geminiKey,
      ai_gemini_model: geminiModel,
    });
    if (fb) {
      fb.innerHTML = `<div style="background:var(--income-light,#dcfce7);border-radius:var(--r-md);
        padding:6px 10px;color:var(--income-text,#16a34a)">
        ✓ Configuração de IA salva.${enabled === '1' ? ' Assistente ATIVO no WhatsApp.' : ' Assistente desativado.'}
      </div>`;
      setTimeout(() => { if (fb) fb.innerHTML = ''; }, 3500);
    }
    toast('Configuração de IA salva', 'success');
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:6px 10px;color:#dc2626">Erro: ${_escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('save', 14) + ' Salvar configuração de IA';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

async function _aiTestConnection() {
  const btn = document.getElementById('ai-test-btn');
  const fb  = document.getElementById('ai-feedback');
  const groqKey     = (document.getElementById('ai-groq-key')?.value || '').trim();
  const groqModel   = (document.getElementById('ai-groq-model')?.value || '').trim() || 'llama-3.3-70b-versatile';
  const geminiKey   = (document.getElementById('ai-gemini-key')?.value || '').trim();
  const geminiModel = (document.getElementById('ai-gemini-model')?.value || '').trim() || 'gemini-2.0-flash';

  if (!groqKey && !geminiKey) {
    toast('Informe ao menos uma chave (Groq ou Gemini) para testar.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Testando…';
  if (fb) fb.innerHTML = '';
  try {
    const res = await _api('POST', '/admin/users', {
      action: 'test-ai-connection',
      groq_key: groqKey,
      groq_model: groqModel,
      gemini_key: geminiKey,
      gemini_model: geminiModel,
    });
    const rows = [];
    const line = (label, r) => {
      if (!r) return `<div style="color:var(--text-muted)">• ${label}: não testado (sem chave)</div>`;
      if (r.ok) return `<div style="color:var(--income-text,#16a34a)">✓ ${label}: conectado${r.sample ? ` — resposta: "${_escHtml(r.sample)}"` : ''}</div>`;
      return `<div style="color:#dc2626">✗ ${label}: falhou — ${_escHtml(r.error || 'erro desconhecido')}</div>`;
    };
    rows.push(line('Groq (texto)', res.groq));
    rows.push(line('Gemini (áudio/imagem)', res.gemini));
    const allTestedOk = [res.groq, res.gemini].filter(Boolean).every(r => r.ok);
    if (fb) {
      fb.innerHTML = `<div style="background:${allTestedOk ? 'var(--income-light,#dcfce7)' : '#fef2f2'};
        border-radius:var(--r-md);padding:8px 12px;line-height:1.7">${rows.join('')}</div>`;
    }
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:6px 10px;color:#dc2626">Erro ao testar: ${_escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('plug', 14) + ' Testar conexão';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

// ── Render Admin Logs ─────────────────────────────────────────────────────────
// Consolida os visualizadores de log num só lugar (aba "Logs" do painel):
//   • Histórico de disparos (mensagens WhatsApp/e-mail enviadas)
//   • Logs do sistema (auditoria administrativa)

async function renderAdminLogs() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  const _user = pb.authStore.model;
  const isSuperAdmin = _user?.role === 'super_admin' || _user?.email === 'applumergestao@gmail.com';
  if (!isSuperAdmin) {
    content.innerHTML = `
      ${_adminNavBar('logs')}
      <div style="padding:48px;text-align:center;color:var(--text-muted)">
        <i data-lucide="shield-off" style="width:40px;height:40px;opacity:.3;display:block;margin:0 auto 12px"></i>
        <p>Acesso restrito a Super Admin.</p>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  content.innerHTML = `
    ${_adminNavBar('logs')}
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="card-title" style="margin-bottom:2px">${icon('history', 14)} Histórico de disparos</div>
        <div style="font-size:.8rem;color:var(--text-muted)">Registro completo de todas as mensagens (WhatsApp/e-mail) enviadas pelo sistema.</div>
      </div>
      <button class="btn btn-outline" onclick="openMsgHistoryModal()" style="font-size:.83rem;white-space:nowrap">
        ${icon('clock', 14)} Ver histórico
      </button>
    </div>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="card-title" style="margin-bottom:2px">${icon('message-circle', 14)} Interações do assistente (WhatsApp)</div>
        <div style="font-size:.8rem;color:var(--text-muted)">Registro das conversas com a IA: quem falou, o que enviou (texto/áudio/print), a resposta e a ação (lançamento, consulta, etc.).</div>
      </div>
      <button class="btn btn-outline" onclick="openWaInteractionsModal()" style="font-size:.83rem;white-space:nowrap">
        ${icon('messages-square', 14)} Ver interações
      </button>
    </div>
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div class="card-title" style="margin-bottom:2px">${icon('shield', 14)} Logs do sistema</div>
        <div style="font-size:.8rem;color:var(--text-muted)">Auditoria completa das ações de administradores: usuários criados, alterados, excluídos, instâncias, configurações e mais.</div>
      </div>
      <button class="btn btn-outline" onclick="openSystemLogModal()" style="font-size:.83rem;white-space:nowrap">
        ${icon('scroll-text', 14)} Ver logs
      </button>
    </div>`;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Cron externo — copiar URL / gerar secret ─────────────────────────────────

async function _cronCopyUrl() {
  const input = document.getElementById('cron-url-input');
  const url = input?.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('URL copiada!', 'success');
  } catch {
    input.select();
    document.execCommand('copy');
    toast('URL copiada!', 'success');
  }
}

async function _cronGenerateSecret() {
  const fb = document.getElementById('cron-secret-feedback');
  fb.style.display = 'none';
  try {
    const data = await _api('POST', '/admin/users', { action: 'generate-cron-secret' });
    if (!data.ok) throw new Error(data.error || 'Erro ao gerar secret');
    const input = document.getElementById('cron-url-input');
    const copyBtn = document.getElementById('cron-copy-btn');
    if (input) {
      input.value = `${location.origin}/api/cron/dispatcher?secret=${data.secret}`;
      input.removeAttribute('placeholder');
    }
    if (copyBtn) copyBtn.removeAttribute('disabled');
    fb.style.display = 'block';
    fb.style.color = 'var(--expense,#dc2626)';
    fb.textContent = 'Secret regenerado. Atualize a URL no cron-job.org — a URL anterior não funciona mais.';
    toast('Secret gerado com sucesso', 'success');
  } catch (e) {
    fb.style.display = 'block';
    fb.style.color = 'var(--expense,#dc2626)';
    fb.textContent = e.message;
  }
}

// ── Histórico de mensagens ────────────────────────────────────────────────────

async function openMsgHistoryModal(page = 1) {
  if (page === 1) {
    showModal(`
      <div class="modal-backdrop">
        <div class="modal" style="max-width:960px;width:calc(100% - 32px);max-height:92vh;display:flex;flex-direction:column">
          <div class="modal-header" style="flex-shrink:0">
            <div class="modal-title">${icon('history', 16)} Histórico de disparos WhatsApp</div>
            <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
          </div>
          <div class="modal-body" style="overflow-y:auto;flex:1" id="msg-history-body">
            <div style="text-align:center;padding:32px;color:var(--text-muted)">
              <div class="spinner" style="margin:0 auto 12px"></div>
              Carregando histórico…
            </div>
          </div>
        </div>
      </div>`);
  }

  try {
    const data = await _api('GET', `/admin/users?resource=message-logs&page=${page}&limit=50`);
    const logs  = data.logs  || [];
    const total = data.total || 0;
    const pages = Math.ceil(total / 50);
    const bodyEl = document.getElementById('msg-history-body');
    if (!bodyEl) return;

    if (!logs.length && page === 1) {
      bodyEl.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted)">
        ${icon('inbox', 32)}<p style="margin-top:12px">Nenhuma mensagem registrada ainda.</p></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
      return;
    }

    const fmtDate = d => {
      if (!d) return '—';
      const dt = new Date(d);
      return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };
    const statusBadge = s => s === 'ok'
      ? `<span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--income-light,#dcfce7);color:var(--income-text,#16a34a)">OK</span>`
      : `<span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--expense-light,#fee2e2);color:var(--expense,#dc2626)">FALHA</span>`;

    bodyEl.innerHTML = `
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">
        ${total} disparo${total !== 1 ? 's' : ''} registrado${total !== 1 ? 's' : ''}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left">
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">Data/Hora</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Enviado por</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Instância</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Destinatário</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Mensagem</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">Mídia</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((l, idx) => `
              <tr style="border-bottom:1px solid var(--border);${idx % 2 === 1 ? 'background:var(--bg-subtle)' : ''}">
                <td style="padding:8px 10px;white-space:nowrap;color:var(--text-muted);font-size:.78rem">${fmtDate(l.sent_at)}</td>
                <td style="padding:8px 10px">
                  <div style="font-weight:600;font-size:.82rem">${_escHtml(l.sent_by_name || '—')}</div>
                  <div style="font-size:.72rem;color:var(--text-muted)">${_escHtml(l.sent_by_email || '')}</div>
                </td>
                <td style="padding:8px 10px">
                  <span style="font-size:.78rem;font-family:monospace;background:var(--bg-subtle);
                    padding:2px 6px;border-radius:4px;border:1px solid var(--border)">
                    ${_escHtml(l.instance_name || '—')}
                  </span>
                </td>
                <td style="padding:8px 10px">
                  <div style="font-weight:600;font-size:.82rem">${_escHtml(l.recipient_name || '—')}</div>
                  <div style="font-size:.72rem;color:var(--text-muted)">${_escHtml(l.recipient_phone || '')}</div>
                </td>
                <td style="padding:8px 10px;max-width:280px">
                  <div style="font-size:.8rem;line-height:1.4;overflow:hidden;display:-webkit-box;
                    -webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word"
                    title="${_escHtml(l.message_text || '')}">
                    ${_escHtml(l.message_text || '—')}
                  </div>
                </td>
                <td style="padding:8px 10px;white-space:nowrap">
                  ${l.has_media
                    ? `<span style="font-size:.75rem;display:flex;align-items:center;gap:4px;color:var(--primary-600)">
                        ${icon('paperclip', 12)} ${_escHtml(l.media_name || l.media_type || 'mídia')}
                      </span>`
                    : `<span style="color:var(--text-muted);font-size:.75rem">—</span>`}
                </td>
                <td style="padding:8px 10px">
                  ${statusBadge(l.status)}
                  ${l.error ? `<div style="font-size:.7rem;color:var(--expense);margin-top:3px;max-width:160px;word-break:break-word">${_escHtml(l.error)}</div>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap">
        ${page > 1 ? `<button class="btn btn-sm btn-outline" onclick="openMsgHistoryModal(${page-1})">← Anterior</button>` : ''}
        <span style="font-size:.82rem;color:var(--text-muted)">Página ${page} de ${pages}</span>
        ${page < pages ? `<button class="btn btn-sm btn-outline" onclick="openMsgHistoryModal(${page+1})">Próxima →</button>` : ''}
      </div>` : ''}`;

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
  } catch(e) {
    const bodyEl = document.getElementById('msg-history-body');
    if (bodyEl) bodyEl.innerHTML = `<div style="padding:24px;color:var(--expense)">Erro: ${_escHtml(e.message)}</div>`;
  }
}

// ── Interações do assistente de IA (WhatsApp) ────────────────────────────────

const _WA_ACTION_LABELS = {
  register:          { txt: 'Lançamento',   color: '#16a34a', bg: '#dcfce7' },
  clarify:           { txt: 'Pergunta',     color: '#d97706', bg: '#fef3c7' },
  query:             { txt: 'Consulta',     color: '#0891b2', bg: '#cffafe' },
  answer:            { txt: 'Resposta',     color: '#7c3aed', bg: '#ede9fe' },
  unknown_user:      { txt: 'Não cadastrado', color: '#dc2626', bg: '#fee2e2' },
  video_unsupported: { txt: 'Vídeo (não suportado)', color: '#dc2626', bg: '#fee2e2' },
};
const _WA_TYPE_ICON = { text: 'type', audio: 'mic', image: 'image', video: 'video' };

function _waActionBadge(a) {
  const m = _WA_ACTION_LABELS[a] || { txt: a || '—', color: 'var(--text-muted)', bg: 'var(--bg-subtle)' };
  return `<span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;background:${m.bg};color:${m.color};white-space:nowrap">${_escHtml(m.txt)}</span>`;
}

async function openWaInteractionsModal(page = 1) {
  if (page === 1) {
    showModal(`
      <div class="modal-backdrop">
        <div class="modal" style="max-width:1000px;width:calc(100% - 32px);max-height:92vh;display:flex;flex-direction:column">
          <div class="modal-header" style="flex-shrink:0">
            <div class="modal-title">${icon('messages-square', 16)} Interações do assistente (WhatsApp)</div>
            <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
          </div>
          <div class="modal-body" style="overflow-y:auto;flex:1" id="wa-int-body">
            <div style="text-align:center;padding:32px;color:var(--text-muted)">
              <div class="spinner" style="margin:0 auto 12px"></div>
              Carregando interações…
            </div>
          </div>
        </div>
      </div>`);
  }

  try {
    const data = await _api('GET', `/admin/users?resource=wa-interactions&page=${page}&limit=50`);
    const logs  = data.logs  || [];
    const total = data.total || 0;
    const pages = Math.ceil(total / 50);
    const bodyEl = document.getElementById('wa-int-body');
    if (!bodyEl) return;

    if (!logs.length && page === 1) {
      bodyEl.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted)">
        ${icon('inbox', 32)}<p style="margin-top:12px">Nenhuma interação registrada ainda.</p></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
      return;
    }

    const fmtDate = d => {
      if (!d) return '—';
      const dt = new Date(d);
      return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    bodyEl.innerHTML = `
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">
        ${total} interaç${total !== 1 ? 'ões' : 'ão'} registrada${total !== 1 ? 's' : ''}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left">
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;white-space:nowrap">Data/Hora</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase">Usuário</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;white-space:nowrap">Tipo</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase">Mensagem</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase">Resposta</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase">Ação</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((l, idx) => `
              <tr style="border-bottom:1px solid var(--border);${idx % 2 === 1 ? 'background:var(--bg-subtle)' : ''}">
                <td style="padding:8px 10px;white-space:nowrap;color:var(--text-muted);font-size:.78rem">${fmtDate(l.created_at)}</td>
                <td style="padding:8px 10px">
                  <div style="font-weight:600;font-size:.82rem">${_escHtml(l.user_name || '—')}</div>
                  <div style="font-size:.72rem;color:var(--text-muted)">${_escHtml(l.phone || '')}</div>
                </td>
                <td style="padding:8px 10px;white-space:nowrap">
                  <span style="font-size:.75rem;display:inline-flex;align-items:center;gap:4px;color:var(--primary-600)">
                    ${icon(_WA_TYPE_ICON[l.in_type] || 'type', 12)} ${_escHtml(l.in_type || 'text')}
                  </span>
                </td>
                <td style="padding:8px 10px;max-width:260px">
                  <div style="font-size:.8rem;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word" title="${_escHtml(l.in_text || '')}">${_escHtml(l.in_text || '—')}</div>
                </td>
                <td style="padding:8px 10px;max-width:260px">
                  <div style="font-size:.8rem;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word" title="${_escHtml(l.out_text || '')}">${_escHtml(l.out_text || '—')}</div>
                </td>
                <td style="padding:8px 10px">${_waActionBadge(l.action)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap">
        ${page > 1 ? `<button class="btn btn-sm btn-outline" onclick="openWaInteractionsModal(${page-1})">← Anterior</button>` : ''}
        <span style="font-size:.82rem;color:var(--text-muted)">Página ${page} de ${pages}</span>
        ${page < pages ? `<button class="btn btn-sm btn-outline" onclick="openWaInteractionsModal(${page+1})">Próxima →</button>` : ''}
      </div>` : ''}`;

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
  } catch(e) {
    const bodyEl = document.getElementById('wa-int-body');
    if (bodyEl) bodyEl.innerHTML = `<div style="padding:24px;color:var(--expense)">Erro: ${_escHtml(e.message)}</div>`;
  }
}

// ── Logs do sistema (auditoria administrativa) ────────────────────────────────

const _SYSLOG_LABELS = {
  'user.create':               { txt: 'Usuário criado',        color: '#16a34a', bg: '#dcfce7' },
  'user.update':               { txt: 'Usuário alterado',      color: '#d97706', bg: '#fef3c7' },
  'user.delete':               { txt: 'Usuário excluído',      color: '#dc2626', bg: '#fee2e2' },
  'user.impersonate':          { txt: 'Impersonação',          color: '#7c3aed', bg: '#ede9fe' },
  'user.test_whatsapp':        { txt: 'Teste WhatsApp',        color: '#0891b2', bg: '#cffafe' },
  'settings.update':           { txt: 'Config. alterada',      color: '#d97706', bg: '#fef3c7' },
  'settings.cron_secret_generate': { txt: 'Secret do cron',    color: '#d97706', bg: '#fef3c7' },
  'evolution.instance_create': { txt: 'Instância criada',      color: '#16a34a', bg: '#dcfce7' },
  'evolution.instance_delete': { txt: 'Instância excluída',    color: '#dc2626', bg: '#fee2e2' },
  'evolution.instance_link':   { txt: 'Instância vinculada',   color: '#0891b2', bg: '#cffafe' },
  'evolution.instance_unlink': { txt: 'Instância desvinculada',color: '#dc2626', bg: '#fee2e2' },
  'evolution.set_default':     { txt: 'Instância padrão',      color: '#0891b2', bg: '#cffafe' },
  'evolution.update_key':      { txt: 'Chave atualizada',      color: '#d97706', bg: '#fef3c7' },
  'message.campaign_send':     { txt: 'Campanha enviada',      color: '#0891b2', bg: '#cffafe' },
};

function _syslogBadge(action) {
  const m = _SYSLOG_LABELS[action] || { txt: action || '—', color: 'var(--text-muted)', bg: 'var(--bg-subtle)' };
  return `<span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;background:${m.bg};color:${m.color};white-space:nowrap">${_escHtml(m.txt)}</span>`;
}

function openSystemLogModal() {
  const actOptions = Object.entries(_SYSLOG_LABELS).map(([v, m]) => `<option value="${v}">${_escHtml(m.txt)}</option>`).join('');
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:1040px;width:calc(100% - 32px);max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header" style="flex-shrink:0">
          <div class="modal-title">${icon('shield', 16)} Logs do sistema</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>
        <div style="flex-shrink:0;padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Ação</label>
            <select id="syslog-f-action" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
              <option value="">Todas</option>${actOptions}
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Admin</label>
            <input id="syslog-f-actor" type="text" placeholder="e-mail do admin" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
          </div>
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Alvo</label>
            <input id="syslog-f-target" type="text" placeholder="e-mail/nome do alvo" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
          </div>
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">De</label>
            <input id="syslog-f-from" type="date" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
          </div>
          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Até</label>
            <input id="syslog-f-to" type="date" style="font-size:.8rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
          </div>
          <button class="btn btn-primary btn-sm" onclick="_syslogLoad(1)" style="font-size:.8rem">${icon('search', 13)} Filtrar</button>
          <button class="btn btn-outline btn-sm" onclick="_syslogClear()" style="font-size:.8rem">Limpar</button>
        </div>
        <div class="modal-body" style="overflow-y:auto;flex:1" id="syslog-body">
          <div style="text-align:center;padding:32px;color:var(--text-muted)">
            <div class="spinner" style="margin:0 auto 12px"></div>Carregando logs…
          </div>
        </div>
      </div>
    </div>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  _syslogLoad(1);
}

function _syslogClear() {
  ['syslog-f-actor', 'syslog-f-target', 'syslog-f-from', 'syslog-f-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const sel = document.getElementById('syslog-f-action'); if (sel) sel.value = '';
  _syslogLoad(1);
}

async function _syslogLoad(page = 1) {
  const bodyEl = document.getElementById('syslog-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 12px"></div>Carregando logs…</div>`;

  const params = new URLSearchParams({ resource: 'system-log', page: String(page), limit: '50' });
  const action = document.getElementById('syslog-f-action')?.value;
  const actor  = document.getElementById('syslog-f-actor')?.value?.trim();
  const target = document.getElementById('syslog-f-target')?.value?.trim();
  const from   = document.getElementById('syslog-f-from')?.value;
  const to     = document.getElementById('syslog-f-to')?.value;
  if (action) params.set('action', action);
  if (actor)  params.set('actor', actor);
  if (target) params.set('target', target);
  if (from)   params.set('date_from', from);
  if (to)     params.set('date_to', to);

  try {
    const data = await _api('GET', `/admin/users?${params.toString()}`);
    const logs  = data.logs  || [];
    const total = data.total || 0;
    const pages = Math.ceil(total / 50);

    if (!logs.length) {
      bodyEl.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted)">
        ${icon('inbox', 32)}<p style="margin-top:12px">Nenhum registro encontrado para os filtros aplicados.</p></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
      return;
    }

    const fmtDate = d => {
      if (!d) return '—';
      const dt = new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z');
      return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };
    const fmtDetails = s => {
      if (!s) return '';
      let obj; try { obj = JSON.parse(s); } catch { return _escHtml(String(s)); }
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).filter(([, v]) => v !== undefined && v !== '' && v !== null)
          .map(([k, v]) => `<span style="font-size:.7rem;color:var(--text-muted)">${_escHtml(k)}: <b style="color:var(--text)">${_escHtml(Array.isArray(v) ? v.join(', ') : String(v))}</b></span>`)
          .join('<br>');
      }
      return _escHtml(String(s));
    };

    bodyEl.innerHTML = `
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px">
        ${total} registro${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.82rem">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left">
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">Data/Hora</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Ação</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Administrador</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Alvo</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase">Detalhes</th>
              <th style="padding:8px 10px;font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">IP</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((l, idx) => `
              <tr style="border-bottom:1px solid var(--border);${idx % 2 === 1 ? 'background:var(--bg-subtle)' : ''}">
                <td style="padding:8px 10px;white-space:nowrap;color:var(--text-muted);font-size:.78rem">${fmtDate(l.created_at)}</td>
                <td style="padding:8px 10px">${_syslogBadge(l.action)}</td>
                <td style="padding:8px 10px">
                  <div style="font-weight:600;font-size:.82rem">${_escHtml(l.actor_email || '—')}</div>
                  ${l.actor_role ? `<div style="font-size:.72rem;color:var(--text-muted)">${_escHtml(l.actor_role)}</div>` : ''}
                </td>
                <td style="padding:8px 10px">
                  <div style="font-size:.82rem">${_escHtml(l.target_label || '—')}</div>
                  ${l.target_type ? `<div style="font-size:.72rem;color:var(--text-muted)">${_escHtml(l.target_type)}</div>` : ''}
                </td>
                <td style="padding:8px 10px;max-width:260px;word-break:break-word">${fmtDetails(l.details)}</td>
                <td style="padding:8px 10px;white-space:nowrap;font-size:.75rem;color:var(--text-muted);font-family:monospace">${_escHtml(l.ip || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pages > 1 ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap">
        ${page > 1 ? `<button class="btn btn-sm btn-outline" onclick="_syslogLoad(${page-1})">← Anterior</button>` : ''}
        <span style="font-size:.82rem;color:var(--text-muted)">Página ${page} de ${pages}</span>
        ${page < pages ? `<button class="btn btn-sm btn-outline" onclick="_syslogLoad(${page+1})">Próxima →</button>` : ''}
      </div>` : ''}`;

    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [bodyEl] });
  } catch (e) {
    bodyEl.innerHTML = `<div style="padding:24px;color:var(--expense)">Erro: ${_escHtml(e.message)}</div>`;
  }
}

async function _evoTestGlobalKey() {
  const keyEl  = document.getElementById('evo-global-key');
  const testBtn = document.getElementById('evo-key-test-btn');
  const fb      = document.getElementById('evo-key-feedback');
  const key     = keyEl?.value?.trim();
  if (!key) { toast('Informe a chave antes de testar', 'error'); return; }

  // Salva temporariamente para o backend usar na verificação
  testBtn.disabled = true;
  testBtn.innerHTML = icon('loader', 14) + ' Testando…';
  try {
    // Salva a chave antes de testar para que o backend a use
    await _api('PUT', '/admin/users?resource=system-settings', { evolution_global_key: key });
    const res = await _api('POST', '/admin/users', { action: 'test-evolution-key' });
    if (res.ok) {
      if (fb) fb.innerHTML = `<div style="background:var(--income-light,#dcfce7);border-radius:var(--r-md);
        padding:6px 10px;font-size:.8rem;color:var(--income-text,#16a34a)">
        ✓ Chave válida! (${_escHtml(res.key_preview)}) Agora você pode criar instâncias.
      </div>`;
      toast('Chave global válida!', 'success');
    } else {
      if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
        padding:6px 10px;font-size:.8rem;color:#dc2626">
        ✗ ${_escHtml(res.error || 'Chave inválida')}
      </div>`;
    }
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:6px 10px;font-size:.8rem;color:#dc2626">Erro: ${_escHtml(e.message)}</div>`;
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = icon('zap', 14) + ' Testar';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [testBtn] });
  }
}

async function _evoSaveGlobalKey() {
  const keyEl = document.getElementById('evo-global-key');
  const btn   = document.getElementById('evo-key-btn');
  const fb    = document.getElementById('evo-key-feedback');
  const key   = keyEl?.value?.trim();
  if (!key) { toast('Informe a chave global', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Salvando…';
  try {
    await _api('PUT', '/admin/users?resource=system-settings', { evolution_global_key: key });
    if (fb) {
      fb.innerHTML = `<div style="background:var(--income-light,#dcfce7);border-radius:var(--r-md);
        padding:6px 10px;font-size:.8rem;color:var(--income-text,#16a34a)">
        ✓ Chave global salva com sucesso.
      </div>`;
      setTimeout(() => { if (fb) fb.innerHTML = ''; }, 3000);
    }
    toast('Chave global salva', 'success');
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:6px 10px;font-size:.8rem;color:#dc2626">Erro: ${_escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('save', 14) + ' Salvar';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

// ── Integração n8n ────────────────────────────────────────────────────────────

function _n8nGenSecret() {
  const el = document.getElementById('n8n-secret-input');
  if (!el) return;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  el.value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  el.type = 'text';
}

async function _n8nCopyCallback() {
  const input = document.getElementById('n8n-callback-input');
  if (!input?.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    toast('URL de callback copiada', 'success');
  } catch {
    input.select();
    document.execCommand('copy');
    toast('URL de callback copiada', 'success');
  }
}

async function _n8nSaveConfig() {
  const urlEl    = document.getElementById('n8n-url-input');
  const secretEl = document.getElementById('n8n-secret-input');
  const btn      = document.getElementById('n8n-save-btn');
  const fb        = document.getElementById('n8n-feedback');
  const url    = (urlEl?.value || '').trim();
  const secret = (secretEl?.value || '').trim();

  if (url && !/^https?:\/\//i.test(url)) {
    toast('A URL do webhook deve começar com http:// ou https://', 'error');
    return;
  }
  if (url && !secret) {
    toast('Defina um secret para proteger o repasse ao n8n', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Salvando…';
  try {
    await _api('PUT', '/admin/users?resource=system-settings', {
      n8n_webhook_url: url,
      n8n_secret: secret,
    });
    if (fb) {
      fb.innerHTML = `<div style="background:var(--income-light,#dcfce7);border-radius:var(--r-md);
        padding:6px 10px;color:var(--income-text,#16a34a)">
        ✓ Integração n8n salva.${url ? '' : ' Repasse desativado (URL vazia).'}
      </div>`;
      setTimeout(() => { if (fb) fb.innerHTML = ''; }, 3500);
    }
    toast('Integração n8n salva', 'success');
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:6px 10px;color:#dc2626">Erro: ${_escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('save', 14) + ' Salvar';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

async function _evoCreateInstance() {
  const nameEl = document.getElementById('evo-new-name');
  const btn    = document.getElementById('evo-create-btn');
  const fb     = document.getElementById('evo-create-feedback');
  const name   = nameEl?.value?.trim();
  if (!name) { toast('Informe o nome da instância', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Criando…';
  try {
    const res = await _api('POST', '/admin/users', { action: 'create-evolution-instance', instanceName: name });
    if (fb) {
      fb.innerHTML = `<div style="background:var(--income-light,#dcfce7);border-radius:var(--r-md);
        padding:8px 12px;font-size:.82rem;color:var(--income-text,#16a34a)">
        ✓ Instância <strong>${_escHtml(name)}</strong> criada. Aguarde o QR Code…
      </div>`;
    }
    if (nameEl) nameEl.value = '';
    // Aguarda a instância inicializar antes de buscar o QR Code
    await new Promise(r => setTimeout(r, 2000));
    await _evoConnectInstance(name);
    // Reload instance list
    setTimeout(() => renderAdminSystem(), 4000);
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:8px 12px;font-size:.82rem;color:#dc2626">Erro: ${_escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('plus', 14) + ' Criar';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

async function _evoConnectInstance(name) {
  const panel = document.getElementById('evo-qr-panel');
  if (!panel) return;
  panel.style.display = '';
  panel.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem">${icon('loader', 14)} Gerando QR Code…</div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [panel] });
  try {
    const res = await _api('GET', `/admin/users?resource=evolution-qr&instance=${encodeURIComponent(name)}`);
    const base64 = res?.base64 || res?.qrcode?.base64 || res?.code;
    if (base64) {
      const src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
      panel.innerHTML = `
        <div style="font-size:.85rem;font-weight:600;margin-bottom:8px">
          Escaneie com o WhatsApp → <em>${_escHtml(name)}</em>
        </div>
        <img src="${src}" style="width:220px;height:220px;border:2px solid var(--border);border-radius:var(--r-md)">
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:6px">
          O QR Code expira em ~60 segundos. Recarregue a página se precisar de um novo.
        </div>`;
    } else {
      panel.innerHTML = `<div style="font-size:.82rem;color:var(--text-muted)">
        Instância pode já estar conectada, ou aguarde e recarregue a página.
      </div>`;
    }
  } catch(e) {
    panel.innerHTML = `<div style="font-size:.82rem;color:#dc2626">Erro ao gerar QR: ${_escHtml(e.message)}</div>`;
  }
}

async function _evoDeleteInstance(name) {
  if (!confirm(`Excluir a instância "${name}" da Evolution e remover deste sistema? Esta ação não pode ser desfeita.`)) return;
  try {
    await _api('POST', '/admin/users', { action: 'delete-evolution-instance', instanceName: name });
    toast(`Instância ${name} excluída`, 'success');
    renderAdminSystem();
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
  }
}

async function _evoSetDefault(name) {
  try {
    await _api('POST', '/admin/users', { action: 'set-default-evolution-instance', instanceName: name });
    toast(`Instância "${name}" definida como padrão`, 'success');
    renderAdminSystem();
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
  }
}

async function _evoTestConnection(name, btn) {
  if (!btn) btn = (typeof event !== 'undefined' && event) ? event.currentTarget : null;
  if (!btn) return;
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = icon('loader', 12) + ' …';
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  try {
    const res = await _api('POST', '/admin/users', { action: 'test-evolution-connection', instanceName: name });
    const label = (res.connectionStatus === 'connected' || res.connectionStatus === 'open')
      ? 'Conectada'
      : res.connectionStatus === 'connecting'
        ? 'Conectando…'
        : 'Desconectada';
    toast(`${name}: ${label}`, 'success');
    renderAdminSystem();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

async function _evoUnlinkInstance(name) {
  if (!confirm(`Desvincular "${name}" deste sistema? A instância continuará existindo na Evolution.`)) return;
  try {
    await _api('POST', '/admin/users', { action: 'unlink-evolution-instance', instanceName: name });
    toast(`Instância ${name} desvinculada`, 'success');
    renderAdminSystem();
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
  }
}

async function _evoLinkInstance() {
  const nameEl = document.getElementById('evo-link-name');
  const keyEl  = document.getElementById('evo-link-key');
  const btn    = document.getElementById('evo-link-btn');
  const fb     = document.getElementById('evo-link-feedback');
  const name   = nameEl?.value?.trim();
  const key    = keyEl?.value?.trim();
  if (!name) { toast('Informe o nome da instância', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Vinculando…';
  try {
    await _api('POST', '/admin/users', { action: 'link-evolution-instance', instanceName: name, instanceKey: key || undefined });
    if (fb) fb.innerHTML = `<div style="background:var(--income-light,#dcfce7);border-radius:var(--r-md);
      padding:6px 10px;font-size:.8rem;color:var(--income-text,#16a34a)">
      ✓ Instância <strong>${_escHtml(name)}</strong> vinculada com sucesso.
    </div>`;
    if (nameEl) nameEl.value = '';
    if (keyEl)  keyEl.value  = '';
    setTimeout(() => renderAdminSystem(), 1500);
  } catch(e) {
    if (fb) fb.innerHTML = `<div style="background:#fee2e2;border-radius:var(--r-md);
      padding:6px 10px;font-size:.8rem;color:#dc2626">Erro: ${_escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = icon('link', 14) + ' Vincular';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

async function _evoEditKey(name) {
  const key = prompt(`Nova API key para a instância "${name}":`);
  if (!key || !key.trim()) return;
  try {
    await _api('POST', '/admin/users', { action: 'update-instance-key', instanceName: name, instanceKey: key.trim() });
    toast('Chave atualizada com sucesso', 'success');
    await renderAdminSystem();
  } catch(e) {
    toast('Erro ao atualizar chave: ' + (e.message || e), 'error');
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

      ${(role==='admin' || role==='super_admin') ? `
      <!-- NOTIFICAÇÕES -->
      <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
        ${icon('bell',13)} Notificações
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="eu-email-notif" ${user.email_notifications_enabled === 0 || user.email_notifications_enabled === '0' ? '' : 'checked'} style="width:16px;height:16px;cursor:pointer">
          <span style="flex:1;font-size:.87rem">Receber e-mails automáticos</span>
        </label>
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:6px">
          Desmarque para bloquear todo e-mail automático (boas-vindas, lembretes, campanhas). E-mails transacionais como recuperação de senha continuam sendo enviados.
        </div>
      </div>
      ` : ''}

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
    // Opt-out de e-mails: só existe no DOM para admin/super_admin.
    const emailNotifEl = document.getElementById('eu-email-notif');
    if (emailNotifEl) profileData.email_notifications_enabled = emailNotifEl.checked;
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
    media: 'lumers-atualizacao.png',
    text: '🚀 *Novidade no Lumers Flow!*\n\nAcabamos de lançar melhorias que vão deixar a sua gestão financeira ainda mais simples, completa e inteligente. Já está tudo disponível para você aproveitar!\n\n👉 Acesse agora e confira: https://app.lumersbpo.com.br/ ✨',
  },
  {
    icon: 'log-in',
    label: 'Primeiro acesso pendente',
    text: 'Olá, {nome}! 👋\n\nNotamos que a sua conta no *Lumers Flow* já está pronta, mas você ainda *não realizou o seu primeiro acesso*.\n\nPara não perder o acesso, é importante entrar o quanto antes. ⚠️ *Atenção:* caso o primeiro acesso não aconteça nas próximas *48 horas*, a sua conta será removida automaticamente.\n\nÉ rápido e simples — comece agora mesmo:\n👉 https://app.lumersbpo.com.br/\n\nEstamos à disposição para ajudar no que precisar. 💚',
  },
  {
    icon: 'heart-handshake',
    label: 'Sentimos sua falta',
    text: '{Olá|Oi|Ei}, {nome}! {Sentimos a sua falta|Notamos a sua ausência|Faz um tempinho que não te vemos} por aqui 💚\n\nPercebemos que você não acessa o *Lumers Flow* há alguns dias. {Encontrou alguma dificuldade?|Aconteceu alguma coisa?|Ficou com alguma dúvida?}\n\n{Estamos aqui para te ajudar|Conte com a gente|Pode contar conosco}! {Nos conte|Nos diga|Compartilhe} o que aconteceu que vamos trabalhar juntos para resolver o quanto antes. 🤝\n\n👉 https://app.lumersbpo.com.br/',
  },
  {
    icon: 'share-2',
    label: 'Indique um amigo',
    text: '💡 *Você conhece alguém que merece ter as finanças no controle?* Compartilhe o Lumers Flow com um amigo e ajude-o a tomar decisões financeiras mais inteligentes. Juntos, crescemos mais! 🤝\n\n👉 https://app.lumersbpo.com.br/',
  },
];

// Open modal pre-selecting specific user IDs (pass [] for mass / no pre-selection)
async function openAdminMessageModal(preSelectedIds = []) {
  const usersWithPhone = (_adminUsersCache || []).filter(u => u.phone);

  // Pre-select only users that have phone
  window._adminMsgSelected = new Set(
    preSelectedIds.filter(id => usersWithPhone.some(u => u.id === id))
  );

  // Verifica instância padrão
  let defaultInst = null;
  try { defaultInst = await _api('GET', '/admin/users?resource=evolution-default-instance'); } catch {}
  const noDefault = !defaultInst?.found;

  const tplButtons = _ADMIN_MSG_TEMPLATES.map((t, i) => `
    <button class="btn btn-sm btn-outline" style="font-size:.78rem" onclick="_adminMsgTemplate(${i})">
      ${icon(t.icon, 12)} ${t.label}
    </button>`).join('');

  const isDesktop = window.innerWidth >= 768;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:${isDesktop ? '1040px' : '540px'};width:calc(100% - 32px);max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header" style="flex-shrink:0">
          <div class="modal-title">${icon('send', 16)} Enviar mensagem via WhatsApp
            ${defaultInst?.name ? `<span style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-left:8px">via <strong>${_escHtml(defaultInst.name)}</strong></span>` : ''}
          </div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x', 16)}</button>
        </div>

        ${noDefault ? `
        <div style="flex-shrink:0;padding:10px 20px;background:#fef9c3;border-bottom:1px solid #fde047;
          display:flex;align-items:center;gap:10px;font-size:.82rem;color:#713f12">
          ${icon('alert-triangle', 14)}
          <span>Nenhuma instância WhatsApp padrão definida.
            <a href="#" onclick="closeModal();location.hash='/admin-system';return false"
              style="color:#713f12;font-weight:700;text-decoration:underline">
              Acesse Sistema → WhatsApp
            </a>
            e defina uma instância como padrão antes de enviar.
          </span>
        </div>` : ''}

        <div class="modal-body" style="overflow-y:auto;flex:1;padding-bottom:4px">
          <div style="${isDesktop ? 'display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start' : 'display:flex;flex-direction:column;gap:14px'}">

            <!-- COLUNA ESQUERDA: Destinatários -->
            <div style="display:flex;flex-direction:column;gap:14px">
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
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
                  <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap;display:flex;align-items:center;gap:4px">${icon('filter', 12)} Filtrar por acesso</span>
                  <select id="msg-filter" class="form-control" onchange="_msgApplyFilter(this.value)"
                    style="flex:1;font-size:.8rem;padding:5px 8px;height:auto">
                    <option value="">Selecionar automaticamente…</option>
                    <option value="all">Todos com WhatsApp</option>
                    <option value="never">Nunca acessaram</option>
                    <option value="inactive7">Inativos há +7 dias</option>
                    <option value="inactive15">Inativos há +15 dias</option>
                    <option value="inactive30">Inativos há +30 dias</option>
                  </select>
                </div>
                <div style="position:relative;margin-bottom:8px">
                  <div style="position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-muted);display:flex">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  </div>
                  <input id="msg-recipients-search" class="form-control" type="search"
                    placeholder="Buscar por nome, e-mail ou telefone…"
                    oninput="_renderMsgRecipients(this.value)"
                    style="padding-left:32px">
                </div>
                <div id="msg-recipients-list"
                  style="max-height:${isDesktop ? '380px' : '190px'};overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface)">
                </div>
              </div>

              <!-- Templates (desktop: na coluna esquerda abaixo dos destinatários) -->
              <div>
                <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Mensagens prontas</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px">${tplButtons}</div>
              </div>
            </div>

            <!-- COLUNA DIREITA: Mensagem + opções -->
            <div style="display:flex;flex-direction:column;gap:16px">

              <!-- Texto -->
              <div class="form-group" style="margin:0">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
                  <label class="form-label" style="margin:0">Mensagem</label>
                  <div style="display:flex;gap:6px;align-items:center">
                    <span id="msg-ai-status" style="font-size:.72rem;color:var(--text-muted)"></span>
                    <button type="button" class="btn btn-sm btn-primary" id="msg-ai-create" onclick="_msgAiCompose('create')"
                      title="Descreva o assunto no campo e gere a mensagem" style="font-size:.74rem;padding:4px 10px">
                      ${icon('sparkles', 12)} Criar</button>
                    <button type="button" class="btn btn-sm btn-outline" id="msg-ai-improve" onclick="_msgAiCompose('improve')"
                      title="Melhorar o rascunho atual" style="font-size:.74rem;padding:4px 10px">
                      ${icon('wand-2', 12)} Melhorar</button>
                  </div>
                </div>
                <textarea id="msg-text" class="form-control" rows="${isDesktop ? 6 : 4}"
                  placeholder="Digite a mensagem…  (dica: descreva o assunto e clique em Criar)"
                  style="resize:vertical" oninput="_msgUpdatePreview()"></textarea>

                <!-- Barra: variáveis + formatação -->
                <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:8px">
                  <span style="font-size:.72rem;color:var(--text-muted);margin-right:2px">Inserir:</span>
                  ${['{nome}','{email}','{telefone}','{status}','{plano}','{saldo}','{ultimo_acesso}'].map(v => `
                    <button type="button" onclick="_msgInsertVar('${v}')" title="Inserir variável"
                      style="font-size:.72rem;padding:2px 9px;font-family:monospace;background:var(--surface-alt,#f1f5f9);border:1px solid var(--border);border-radius:999px;cursor:pointer;color:var(--text)">${v}</button>`).join('')}
                </div>
                <div style="font-size:.71rem;color:var(--text-muted);margin-top:6px">
                  Formatação:
                  <code style="background:var(--surface-alt,#f1f5f9);padding:0 4px;border-radius:3px">*negrito*</code>
                  <code style="background:var(--surface-alt,#f1f5f9);padding:0 4px;border-radius:3px">_itálico_</code>
                  <code style="background:var(--surface-alt,#f1f5f9);padding:0 4px;border-radius:3px">~tachado~</code>
                </div>
              </div>

              <!-- Pré-visualização estilo WhatsApp -->
              <div>
                <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:5px">
                  ${icon('eye', 12)} Pré-visualização
                </div>
                <div style="background:#e5ddd5;border:1px solid var(--border);border-radius:12px;padding:12px 10px;min-height:56px">
                  <div id="msg-preview"></div>
                </div>
              </div>

              <!-- Botões de ação (opcional) -->
              <div class="form-group" style="margin:0">
                <label class="form-label" style="display:flex;align-items:center;gap:6px">
                  ${icon('mouse-pointer-click', 13)} Botões de ação
                  <span style="font-weight:400;color:var(--text-muted);font-size:.76rem">(opcional · máx. 3)</span>
                </label>
                <div id="msg-buttons-list"></div>
                <button type="button" id="msg-add-btn" class="btn btn-outline btn-sm" onclick="_msgAddButton()"
                  style="margin-top:4px;width:100%;justify-content:center;border-style:dashed;color:var(--primary)">
                  ${icon('plus', 14)} Adicionar botão</button>
                <div style="font-size:.71rem;color:var(--text-muted);margin-top:5px;line-height:1.5">
                  <strong>Resposta</strong> = resposta rápida · <strong>Link</strong> = abre uma URL. Substituem o envio de mídia.
                  <br>⚠️ O WhatsApp não exibe botões interativos em conexões não-oficiais (Baileys). Nesse caso eles são
                  enviados automaticamente como texto no fim da mensagem — os <strong>links</strong> ficam clicáveis; as
                  <strong>respostas</strong> aparecem como opções listadas.
                </div>
              </div>

              <!-- Opções avançadas (recolhível) -->
              <div style="border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden">
                <button type="button" onclick="_msgToggleAdvanced()"
                  style="width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--surface-alt,#f8fafc);border:none;cursor:pointer;font-size:.8rem;font-weight:600;color:var(--text);text-align:left">
                  <span id="msg-adv-caret" style="display:inline-flex;transition:transform .2s">${icon('chevron-right', 14)}</span>
                  ${icon('sliders-horizontal', 13)} Opções avançadas
                  <span style="margin-left:auto;font-weight:400;font-size:.71rem;color:var(--text-muted)">cadência · agendar · mídia · variações</span>
                </button>
                <div id="msg-adv-wrap" style="display:none;flex-direction:column;gap:16px;padding:14px 12px;border-top:1px solid var(--border)">

                  <!-- Cadência -->
                  <div class="form-group" style="margin:0">
                    <label class="form-label" style="display:flex;align-items:center;gap:6px">
                      ${icon('timer', 13)} Cadência (delay entre mensagens)
                    </label>
                    <div style="display:flex;align-items:center;gap:10px">
                      <input id="msg-delay-range" type="range" min="0" max="30" step="1" value="2"
                        style="flex:1;accent-color:var(--primary)"
                        oninput="document.getElementById('msg-delay-val').textContent=this.value">
                      <span style="font-size:.85rem;font-weight:600;min-width:52px;text-align:right">
                        <span id="msg-delay-val">2</span> s
                      </span>
                    </div>
                    <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">
                      0 = sem delay · recomendado 2–5 s para evitar bloqueios do WhatsApp
                    </div>
                  </div>

                  <!-- Mídia -->
                  <div class="form-group" style="margin:0">
                    <label class="form-label" style="display:flex;align-items:center;gap:6px">
                      ${icon('paperclip', 13)} Mídia (opcional)
                    </label>
                    <div id="msg-media-section"></div>
                  </div>

                  <!-- Variações / Spin Syntax -->
                  <div style="background:var(--surface,#fff);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px">
                    <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:5px;display:flex;align-items:center;gap:5px">
                      ${icon('shuffle', 11)} Variações de texto (spin)
                    </div>
                    <div style="font-size:.76rem;color:var(--text-muted);line-height:1.5">
                      Use <code style="background:var(--border);padding:1px 5px;border-radius:3px">{opção1|opção2|opção3}</code>
                      — cada destinatário recebe uma variação aleatória.
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">
                      ${['{Oi|Olá|Ei}','{Tudo bem?|Como vai?|Tudo certo?}','{Aproveite|Não perca|Confira}'].map(v => `
                        <button type="button" class="btn btn-sm" onclick="_msgInsertVar('${v}')"
                          style="font-size:.73rem;padding:2px 8px;font-family:monospace;background:var(--surface-alt,#f8fafc);border:1px dashed var(--border)">
                          ${v}
                        </button>`).join('')}
                    </div>
                  </div>
                </div>
              </div>

              <div id="msg-result"></div>
            </div>

          </div>
        </div>
        <div class="modal-footer" style="flex-shrink:0;flex-wrap:wrap;gap:10px">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end">
            <label style="display:flex;align-items:center;gap:5px;font-size:.8rem;cursor:pointer;white-space:nowrap;color:var(--text)">
              <input type="checkbox" id="msg-schedule-toggle" onchange="_msgToggleSchedule(this.checked)"
                style="accent-color:var(--primary)">
              ${icon('calendar-clock', 14)} Agendar
            </label>
            <input id="msg-schedule-at" type="datetime-local"
              class="form-control" title="Data e hora do envio agendado"
              style="display:none;width:200px;padding:6px 8px;font-size:.82rem;height:auto">
            <button class="btn btn-primary" id="msg-send-btn" onclick="_sendAdminMessage()"
              ${noDefault ? 'disabled title="Defina uma instância padrão antes de enviar"' : 'disabled'}>
              ${icon('send', 14)} Enviar para 0
            </button>
          </div>
        </div>
      </div>
    </div>
  `);

  _renderMsgRecipients('');
  _renderMsgMediaSection();
  window._msgButtons = [];
  _msgRenderButtons();
  _msgUpdatePreview();
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
                <span style="color:var(--text-muted)"> · ${_msgLastAccessLabel(u)}</span>
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
    _msgRefreshSendBtn();
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

// Dias desde o último acesso (login OU última transação). Infinity se nunca acessou.
function _msgDaysSinceAccess(u) {
  const ref = u.last_active || u.last_login;
  if (!ref) return Infinity;
  const t = new Date(ref).getTime();
  return isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
}

// Rótulo curto do último acesso p/ exibir na lista de destinatários.
function _msgLastAccessLabel(u) {
  if (!u.last_login && !u.last_active) return 'Nunca acessou';
  const days = _msgDaysSinceAccess(u);
  if (days === Infinity) return 'Nunca acessou';
  if (days < 1) return 'Acesso hoje';
  const d = Math.floor(days);
  return `Último acesso há ${d} dia${d > 1 ? 's' : ''}`;
}

// Aplica um filtro por acesso e JÁ seleciona os destinatários correspondentes
// (apenas os que têm WhatsApp cadastrado), disponibilizando-os para o disparo.
function _msgApplyFilter(kind) {
  if (!kind) return;
  const all = (_adminUsersCache || []).filter(u => u.phone);
  let matched;
  switch (kind) {
    case 'all':        matched = all; break;
    case 'never':      matched = all.filter(u => !u.last_login && !u.last_active); break;
    case 'inactive7':  matched = all.filter(u => _msgDaysSinceAccess(u) >= 7); break;
    case 'inactive15': matched = all.filter(u => _msgDaysSinceAccess(u) >= 15); break;
    case 'inactive30': matched = all.filter(u => _msgDaysSinceAccess(u) >= 30); break;
    default:           matched = [];
  }
  window._adminMsgSelected = new Set(matched.map(u => u.id));
  _renderMsgRecipients(document.getElementById('msg-recipients-search')?.value || '');
  toast(
    matched.length
      ? `${matched.length} destinatário(s) selecionado(s) pelo filtro`
      : 'Nenhum usuário com WhatsApp corresponde a esse filtro',
    matched.length ? 'success' : 'error'
  );
}

function _msgClearAll() {
  window._adminMsgSelected = new Set();
  _renderMsgRecipients(document.getElementById('msg-recipients-search')?.value || '');
}

async function _adminMsgTemplate(idx) {
  const t = _ADMIN_MSG_TEMPLATES[idx];
  if (!t) return;
  const ta = document.getElementById('msg-text');
  if (ta) ta.value = t.text;
  _msgUpdatePreview();

  // Templates com imagem (ex.: banner de atualização) anexam a mídia automaticamente,
  // que segue como imagem + legenda (o texto acima) no envio pelo WhatsApp.
  if (t.media) {
    try {
      const resp = await fetch(t.media, { cache: 'reload' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      _stickyMsgMedia = {
        base64,
        type: (blob.type || '').startsWith('image/') ? 'image' : 'document',
        name: t.media.split('/').pop() || 'imagem.png',
        size: blob.size,
      };
      _renderMsgMediaSection();
      toast('Imagem anexada à mensagem', 'success');
    } catch (e) {
      toast('Não consegui anexar a imagem do template', 'error');
    }
  }
}

// Redige (create) ou aprimora (improve) a mensagem com IA, usando o próprio texto
// do campo como briefing/rascunho. O resultado substitui o conteúdo do textarea.
async function _msgAiCompose(mode) {
  const ta = document.getElementById('msg-text');
  const status = document.getElementById('msg-ai-status');
  const btnC = document.getElementById('msg-ai-create');
  const btnI = document.getElementById('msg-ai-improve');
  const brief = (ta?.value || '').trim();
  if (!brief) {
    toast(mode === 'improve' ? 'Escreva um rascunho para a IA melhorar' : 'Descreva o assunto da mensagem para a IA criar', 'error');
    ta?.focus();
    return;
  }
  if (btnC) btnC.disabled = true;
  if (btnI) btnI.disabled = true;
  if (status) status.textContent = mode === 'improve' ? 'Melhorando…' : 'Criando…';
  try {
    const r = await _api('POST', '/admin/users', { action: 'ai-compose-message', mode, brief });
    if (r?.ok && r.text) {
      ta.value = r.text;
      _msgUpdatePreview();
      if (status) status.textContent = '✓ Pronto';
      setTimeout(() => { if (status) status.textContent = ''; }, 2500);
    } else {
      if (status) status.textContent = '';
      toast(r?.error || 'A IA não conseguiu gerar o texto', 'error');
    }
  } catch (e) {
    if (status) status.textContent = '';
    toast('Erro ao chamar a IA', 'error');
  } finally {
    if (btnC) btnC.disabled = false;
    if (btnI) btnI.disabled = false;
  }
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
  _msgUpdatePreview();
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

function _msgToggleSchedule(on) {
  const inp = document.getElementById('msg-schedule-at');
  if (!inp) return;
  inp.style.display = on ? '' : 'none';
  if (on) {
    const d = new Date(Date.now() + 60 * 60 * 1000); // sugere daqui a 1h
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    const iso = d.toISOString().slice(0, 16);
    inp.min = iso;
    if (!inp.value) inp.value = iso;
    inp.focus();
  }
  _msgRefreshSendBtn();
}

// Reflete no botão de envio se é envio imediato ("Enviar para N") ou agendado ("Agendar para N").
function _msgRefreshSendBtn() {
  const btn = document.getElementById('msg-send-btn');
  if (!btn) return;
  const n = (window._adminMsgSelected || new Set()).size;
  const sch = document.getElementById('msg-schedule-toggle')?.checked;
  btn.innerHTML = `${icon(sch ? 'calendar-clock' : 'send', 14)} ${sch ? 'Agendar para' : 'Enviar para'} ${n}`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

function _msgAddButton() {
  window._msgButtons = window._msgButtons || [];
  if (window._msgButtons.length >= 3) { toast('Máximo de 3 botões', 'error'); return; }
  window._msgButtons.push({ type: 'reply', label: '', url: '' });
  _msgRenderButtons();
  _msgUpdatePreview();
}

function _msgRemoveButton(i) {
  if (!window._msgButtons) return;
  window._msgButtons.splice(i, 1);
  _msgRenderButtons();
  _msgUpdatePreview();
}

function _msgBtnChange(i, field, val) {
  if (!window._msgButtons || !window._msgButtons[i]) return;
  window._msgButtons[i][field] = val;
  if (field === 'type') _msgRenderButtons();
  _msgUpdatePreview();
}

function _msgToggleAdvanced() {
  const w = document.getElementById('msg-adv-wrap');
  const c = document.getElementById('msg-adv-caret');
  if (!w) return;
  const open = w.style.display === 'none' || !w.style.display;
  w.style.display = open ? 'flex' : 'none';
  if (c) c.style.transform = open ? 'rotate(90deg)' : '';
}

// Renderiza texto no estilo do WhatsApp (negrito/itálico/tachado/mono) para o preview.
function _waFormat(t) {
  let s = _escHtml(t || '');
  s = s.replace(/```([\s\S]+?)```/g, '<code style="background:rgba(0,0,0,.06);padding:0 3px;border-radius:3px;font-size:.9em">$1</code>');
  s = s.replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=[\s).,!?]|$)/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])~(\S(?:.*?\S)?)~(?=[\s).,!?]|$)/g, '$1<del>$2</del>');
  s = s.replace(/\{[^{}]+\}/g, m => `<span style="background:#fde68a;border-radius:3px;padding:0 2px;color:#78350f">${m}</span>`);
  s = s.replace(/\n/g, '<br>');
  return s;
}

// Atualiza a bolha de pré-visualização com o texto atual e os botões configurados.
function _msgUpdatePreview() {
  const el = document.getElementById('msg-preview');
  if (!el) return;
  const raw = document.getElementById('msg-text')?.value || '';
  const hasMedia = !!_stickyMsgMedia;
  const btns = (window._msgButtons || []).filter(b => (b.label || '').trim());
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const body = raw.trim()
    ? _waFormat(raw)
    : '<span style="color:#8696a0">Sua mensagem aparece aqui…</span>';

  const mediaChip = (hasMedia && !btns.length) ? `
    <div style="display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.05);border-radius:6px;padding:6px 8px;margin-bottom:6px;font-size:.78rem;color:#3b4a54">
      ${_stickyMsgMedia.type === 'image' ? icon('image', 13) : icon('paperclip', 13)}
      ${_escHtml(_stickyMsgMedia.name || 'anexo')}
    </div>` : '';

  const btnHtml = btns.map(b => `
    <div style="display:flex;align-items:center;justify-content:center;gap:6px;background:#fff;color:#00a5f4;
      font-weight:500;font-size:.82rem;padding:8px;border-radius:8px;box-shadow:0 1px 1px rgba(0,0,0,.1)">
      ${b.type === 'url' ? icon('external-link', 14) : icon('reply', 14)} ${_escHtml((b.label || '').trim())}
    </div>`).join('');

  el.innerHTML = `
    <div style="max-width:85%;margin-left:auto">
      <div style="background:#d9fdd3;border-radius:8px 0 8px 8px;padding:6px 9px 4px;font-size:.85rem;
        color:#111b21;line-height:1.4;word-break:break-word;box-shadow:0 1px 1px rgba(0,0,0,.1)">
        ${mediaChip}
        <span>${body}</span>
        <span style="float:right;font-size:.65rem;color:#667781;margin:6px 0 0 8px">${now} ✓✓</span>
        <div style="clear:both"></div>
      </div>
      ${btnHtml ? `<div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">${btnHtml}</div>` : ''}
    </div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
}

function _msgRenderButtons() {
  const list = document.getElementById('msg-buttons-list');
  const addBtn = document.getElementById('msg-add-btn');
  if (!list) return;
  const btns = window._msgButtons || [];
  list.innerHTML = btns.map((b, i) => `
    <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap">
      <select class="form-control" style="width:110px;flex:0 0 auto"
        onchange="_msgBtnChange(${i}, 'type', this.value)">
        <option value="reply" ${b.type !== 'url' ? 'selected' : ''}>Resposta</option>
        <option value="url" ${b.type === 'url' ? 'selected' : ''}>Link</option>
      </select>
      <input class="form-control" style="flex:1;min-width:120px" maxlength="25"
        placeholder="Texto do botão" value="${(b.label || '').replace(/"/g, '&quot;')}"
        oninput="_msgBtnChange(${i}, 'label', this.value)">
      ${b.type === 'url' ? `
      <input class="form-control" style="flex:1;min-width:140px" type="url"
        placeholder="https://exemplo.com" value="${(b.url || '').replace(/"/g, '&quot;')}"
        oninput="_msgBtnChange(${i}, 'url', this.value)">` : ''}
      <button type="button" class="btn btn-ghost btn-sm" onclick="_msgRemoveButton(${i})"
        style="flex:0 0 auto" title="Remover">${icon('trash-2', 13)}</button>
    </div>
  `).join('');
  if (addBtn) {
    addBtn.disabled = btns.length >= 3;
    addBtn.style.opacity = btns.length >= 3 ? '.5' : '';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [list] });
}

function _msgInsertVar(varText) {
  const el = document.getElementById('msg-text');
  if (!el) return;
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = el.value.slice(0, s) + varText + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + varText.length;
  el.focus();
  _msgUpdatePreview();
}

async function _sendAdminMessage() {
  const userIds  = [...(window._adminMsgSelected || new Set())];
  const text     = document.getElementById('msg-text')?.value?.trim() || '';
  const resultEl = document.getElementById('msg-result');
  const btn      = document.getElementById('msg-send-btn');
  const delayS   = parseInt(document.getElementById('msg-delay-range')?.value || '2', 10);
  const delay_ms = delayS * 1000;

  if (!userIds.length) { toast('Selecione ao menos um destinatário', 'error'); return; }
  if (!text && !_stickyMsgMedia) { toast('Digite uma mensagem ou anexe um arquivo', 'error'); return; }

  // Agendamento (opcional)
  let scheduled_at = null;
  if (document.getElementById('msg-schedule-toggle')?.checked) {
    const v = document.getElementById('msg-schedule-at')?.value;
    if (!v) { toast('Escolha a data e hora do agendamento', 'error'); return; }
    const d = new Date(v);
    if (isNaN(d.getTime()) || d.getTime() < Date.now() - 60000) {
      toast('Escolha uma data/hora futura para o agendamento', 'error'); return;
    }
    scheduled_at = d.toISOString();
  }

  // Botões (opcional, máx. 3) — resposta rápida ou link
  const buttons = [];
  for (const b of (window._msgButtons || [])) {
    const label = (b.label || '').trim();
    if (!label) continue;
    if (b.type === 'url') {
      const url = (b.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        toast('Botão de link precisa de uma URL válida (http/https)', 'error'); return;
      }
      buttons.push({ type: 'url', label, url });
    } else {
      buttons.push({ type: 'reply', label });
    }
  }
  if (buttons.length && _stickyMsgMedia) {
    toast('Botões substituem o envio de mídia — a mídia não será enviada', 'info');
  }

  btn.disabled = true;
  btn.innerHTML = icon('loader', 14) + ' Enfileirando…';

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
      text: text || '',
      delay_ms,
      ...(scheduled_at ? { scheduled_at } : {}),
      ...(buttons.length ? { buttons } : {}),
      ...(media_base64 ? { media_base64, media_type, media_name } : {}),
    });

    if (!res.ok || !res.campaign_id) {
      toast('Erro ao criar campanha de disparo', 'error');
      btn.disabled = false;
      btn.innerHTML = icon('send', 14) + ' Enviar para ' + userIds.length;
      return;
    }

    // Envio agendado: nada é disparado agora — confirma e encerra sem polling.
    if (scheduled_at) {
      const when = new Date(scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      toast(`Campanha agendada para ${when} — ${res.total} destinatário(s)`, 'success');
      if (resultEl) {
        resultEl.innerHTML = `
          <div style="background:var(--surface-alt,#f8fafc);border:1px solid var(--border);border-radius:var(--r-md);
            padding:10px 12px;font-size:.85rem;display:flex;gap:8px;align-items:flex-start;margin-top:4px">
            ${icon('calendar-clock', 14)}
            <div>Envio agendado para <strong>${when}</strong> · <strong>${res.total}</strong> destinatário(s).
            <div style="margin-top:4px;font-size:.78rem;color:var(--text-muted)">As mensagens serão disparadas automaticamente na data/hora escolhida.</div></div>
          </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [resultEl] });
      }
      btn.disabled = false;
      btn.innerHTML = icon('send', 14) + ' Enviar para ' + userIds.length;
      setTimeout(() => closeModal(), 3000);
      return;
    }

    toast(`Campanha criada — ${res.total} destinatários enfileirados`, 'success');

    // Progresso visual enquanto o dispatcher processa em background
    if (resultEl) {
      resultEl.innerHTML = `
        <div id="msg-progress" style="background:var(--surface-alt,#f8fafc);border:1px solid var(--border);
          border-radius:var(--r-md);padding:10px 12px;margin-top:4px">
          <div style="font-size:.83rem;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px">
            ${icon('loader', 13)} Disparo em andamento…
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;margin-bottom:6px;overflow:hidden">
            <div id="msg-progress-bar" style="height:100%;width:0%;background:var(--primary);border-radius:3px;transition:width .4s"></div>
          </div>
          <div id="msg-progress-text" style="font-size:.78rem;color:var(--text-muted)">Aguardando processamento pelo cron…</div>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [resultEl] });
    }

    // Polling de status a cada 2s
    const campaignId = res.campaign_id;
    const total      = res.total;
    let pollTimer    = null;
    let failCount    = 0;
    const MAX_FAILS  = 10;
    const startedAt  = Date.now();
    const MAX_POLL_MS = 5 * 60 * 1000;

    const poll = async () => {
      try {
        const stats = await _api('GET', `/admin/users?resource=campaign-status&id=${campaignId}`);
        failCount = 0; // reset on success
        const sent       = stats.sent       || 0;
        const failed     = stats.failed     || 0;
        const skipped    = stats.skipped    || 0;
        const pending    = stats.pending    || 0;
        const processing = stats.processing || 0;
        const pct        = total > 0 ? Math.round((sent + failed + skipped) / total * 100) : 0;

        const barEl  = document.getElementById('msg-progress-bar');
        const textEl = document.getElementById('msg-progress-text');
        if (barEl)  barEl.style.width = pct + '%';
        if (textEl) textEl.innerHTML =
          `<strong>${sent}</strong> enviadas · <strong style="color:#dc2626">${failed}</strong> falhas · <strong>${pending + processing}</strong> na fila`;

        if (stats.done) {
          clearTimeout(pollTimer);
          const ok = sent > 0;
          if (resultEl) {
            resultEl.innerHTML = `
              <div style="background:${ok ? 'var(--income-light,#dcfce7)' : '#fee2e2'};border-radius:var(--r-md);
                padding:10px 12px;font-size:.85rem;display:flex;gap:8px;align-items:flex-start;margin-top:4px">
                ${icon(ok ? 'check-circle' : 'alert-circle', 14)}
                <div>
                  <strong>${sent}</strong> de <strong>${total}</strong> mensagens enviadas com sucesso.
                  ${failed > 0
                    ? `<div style="margin-top:4px;color:#dc2626;font-size:.78rem">${failed} falha(s) — verifique o histórico de mensagens.</div>`
                    : ''}
                </div>
              </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [resultEl] });
          }
          toast(`${sent}/${total} enviadas`, sent === total ? 'success' : 'warning');
          btn.disabled = false;
          btn.innerHTML = icon('send', 14) + ' Enviar para ' + userIds.length;
          if (sent > 0 && sent === total) setTimeout(() => closeModal(), 2500);
        } else {
          pollTimer = setTimeout(poll, 2000);
        }
      } catch (e) {
        console.warn('[poll campaign]', e);
        failCount++;
        if (failCount >= MAX_FAILS || Date.now() - startedAt > MAX_POLL_MS) {
          clearTimeout(pollTimer);
          if (resultEl) {
            resultEl.innerHTML = `
              <div style="background:#fee2e2;border-radius:var(--r-md);padding:10px 12px;font-size:.85rem">
                Não foi possível acompanhar o progresso — o disparo continua em segundo plano.
              </div>`;
          }
          btn.disabled = false;
          btn.innerHTML = icon('send', 14) + ' Enviar para ' + userIds.length;
        } else {
          pollTimer = setTimeout(poll, 2000);
        }
      }
    };

    pollTimer = setTimeout(poll, 2000);

  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao enfileirar'), 'error');
    btn.disabled = false;
    btn.innerHTML = icon('send', 14) + ' Enviar para ' + userIds.length;
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
          <input id="b-login-copyright" class="form-control" value="${_escHtml(c.loginCopyright || '')}" placeholder="ex: © 2026 Lumers Flow Financeiro">
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

// ══════════════════════════════════════════════════════════════════════════════
// Painel Admin — E-mail & Notificações
// ══════════════════════════════════════════════════════════════════════════════

let _adminEmailSub  = 'config';
let _adminEmailData = { templates: [], lists: [] };

// Editor WYSIWYG de template: modo ativo ('visual' = iframe editável, 'code' = HTML cru)
let _etMode = 'visual';

// Variáveis disponíveis nos templates (contrato do backend /email/preview)
const _ET_VARS = ['name','app_name','app_url','logo_url','primary_color','year','reset_link','plan_name','expiry_date'];

// Snippet do cabeçalho com logo — compartilhado entre o editor de código e o builder visual.
const _EM_HEADER_SNIPPET = '<tr><td style="background:{{primary_color}};padding:24px;text-align:center;"><img src="{{logo_url}}" alt="{{app_name}}" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;"></td></tr>';
// Versão auto-contida do cabeçalho (bloco standalone) para inserir no editor WYSIWYG.
const _EM_HEADER_VISUAL = '<div style="background:{{primary_color}};padding:24px;text-align:center;"><img src="{{logo_url}}" alt="{{app_name}}" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;"></div>';

// HTML inicial para um template NOVO no editor WYSIWYG (documento de e-mail completo,
// com tabela responsiva + cabeçalho de marca + saudação editável).
const _ET_STARTER_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:{{primary_color}};padding:24px;text-align:center;">
        <img src="{{logo_url}}" alt="{{app_name}}" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;">
      </td></tr>
      <tr><td style="padding:28px 28px 8px;">
        <h1 style="margin:0 0 12px;font-size:20px;color:#1f2937;">Olá, {{name}}!</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">Escreva aqui a mensagem do seu e-mail. Selecione o texto para formatar ou clique em <strong>{{ }}</strong> para inserir variáveis dinâmicas.</p>
      </td></tr>
      <tr><td style="padding:8px 28px 28px;">
        <a href="{{app_url}}" style="display:inline-block;background:{{primary_color}};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;">Acessar {{app_name}}</a>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8;text-align:center;">© {{year}} {{app_name}}. Todos os direitos reservados.</td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;

async function renderAdminEmail() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  const _user = pb.authStore.model;
  const isSuperAdmin = _user?.role === 'super_admin' || _user?.email === 'applumergestao@gmail.com';
  if (!isSuperAdmin) {
    content.innerHTML = `
      ${_adminNavBar('email')}
      <div style="padding:48px;text-align:center;color:var(--text-muted)">
        <i data-lucide="shield-off" style="width:40px;height:40px;opacity:.3;display:block;margin:0 auto 12px"></i>
        <p>Acesso restrito a Super Admin.</p>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const subtabs = [
    { id: 'config',        icon: 'settings',    label: 'Configuração'  },
    { id: 'templates',     icon: 'file-text',   label: 'Templates'     },
    { id: 'lists',         icon: 'users',       label: 'Listas'        },
    { id: 'campaigns',     icon: 'send',        label: 'Campanhas'     },
    { id: 'notifications', icon: 'bell',        label: 'Notificações'  },
    { id: 'rules',         icon: 'zap',         label: 'Regras'        },
    { id: 'log',           icon: 'scroll-text', label: 'Log de envios' },
  ];

  content.innerHTML = `
    ${_adminNavBar('email')}
    <nav class="admin-nav-tabs" style="margin-bottom:16px">
      ${subtabs.map(t => `
        <a href="#" class="admin-nav-tab${_adminEmailSub === t.id ? ' active' : ''}"
          onclick="event.preventDefault();_adminEmailTab('${t.id}')">
          ${icon(t.icon, 14)}<span>${t.label}</span>
        </a>`).join('')}
    </nav>
    <div id="admin-email-body"><div class="loading-screen"><div class="spinner"></div></div></div>`;

  if (typeof lucide !== 'undefined') lucide.createIcons();
  await _adminEmailRenderSub();
}

function _adminEmailTab(id) {
  // Guard: se o builder visual está ativo com alterações não salvas, confirma o
  // descarte antes de trocar de sub-aba (evita perda silenciosa) e destrói a
  // instância GrapesJS ao sair (evita vazamento da _emBuilder órfã).
  if (!_adminEmailBuilderConfirmDiscard()) return;
  _adminEmailBuilderDestroy();
  _adminEmailSub = id;
  renderAdminEmail();
}

async function _adminEmailRenderSub() {
  const body = document.getElementById('admin-email-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
  try {
    switch (_adminEmailSub) {
      case 'config':        await _adminEmailConfig(body);        break;
      case 'templates':     await _adminEmailTemplates(body);     break;
      case 'lists':         await _adminEmailLists(body);         break;
      case 'campaigns':     await _adminEmailCampaigns(body);     break;
      case 'notifications': await _adminEmailNotifications(body); break;
      case 'rules':         await _adminEmailRules(body);         break;
      case 'log':           await _adminEmailLog(body);           break;
    }
  } catch (e) {
    body.innerHTML = `<div class="card"><p style="color:var(--expense)">${icon('alert-triangle',14)} Erro: ${_escHtml(e.message || 'falha ao carregar')}</p></div>`;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _adminEmailIsSystem(v) { return v === 1 || v === '1'; }

// ── A) Configuração ───────────────────────────────────────────────────────────

async function _adminEmailConfig(body) {
  const cfg = await _api('GET', '/email/config');
  body.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title" style="margin-bottom:16px">${icon('settings',14)} Configuração de E-mail</div>
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:16px;cursor:pointer">
        <input type="checkbox" id="em-enabled" ${cfg.enabled ? 'checked' : ''} style="width:16px;height:16px">
        <span style="font-size:.9rem;font-weight:600">E-mail habilitado</span>
      </label>
      <div class="form-group">
        <label class="form-label">Remetente (From)</label>
        <input id="em-from" class="form-control" value="${_escHtml(cfg.from || '')}" placeholder="Lumers Flow &lt;no-reply@app.lumersbpo.com.br&gt;">
      </div>
      <div class="form-group">
        <label class="form-label">Chave da API Resend</label>
        <input id="em-key" class="form-control" type="password" autocomplete="new-password"
          placeholder="${cfg.hasKey ? '•••• (configurada)' : 're_...'}">
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">
          ${cfg.hasKey ? 'Deixe em branco para manter a chave atual.' : 'Nenhuma chave configurada ainda.'}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button id="em-save" class="btn btn-primary" onclick="_adminEmailSaveConfig()">${icon('save',14)} Salvar</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">${icon('send',14)} Enviar e-mail de teste</div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Destinatário</label>
        <input id="em-test-to" class="form-control" type="email" placeholder="voce@email.com">
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button id="em-test-btn" class="btn btn-ghost" onclick="_adminEmailTestSend()">${icon('mail',14)} Enviar teste</button>
      </div>
      <div id="em-test-result" style="font-size:.83rem;margin-top:10px;display:none"></div>
    </div>`;
}

async function _adminEmailSaveConfig() {
  const btn     = document.getElementById('em-save');
  const enabled = document.getElementById('em-enabled')?.checked;
  const from    = document.getElementById('em-from')?.value.trim();
  const apiKey  = document.getElementById('em-key')?.value;
  const orig    = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const payload = { enabled, from };
    if (typeof apiKey === 'string' && apiKey.trim() !== '') payload.apiKey = apiKey.trim();
    await _api('POST', '/email/config', payload);
    toast('Configuração salva!', 'success');
    const keyEl = document.getElementById('em-key');
    if (keyEl && payload.apiKey) { keyEl.value = ''; keyEl.placeholder = '•••• (configurada)'; }
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao salvar'), 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function _adminEmailTestSend() {
  const to  = document.getElementById('em-test-to')?.value.trim();
  const res = document.getElementById('em-test-result');
  if (!to) { toast('Informe um destinatário.', 'error'); return; }
  const btn  = document.getElementById('em-test-btn');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `${icon('loader',14)} Enviando...`;
  res.style.display = 'none';
  try {
    const r = await _api('POST', '/email/test-send', { to, system_key: 'welcome' });
    if (r && r.ok === false) {
      res.style.display = ''; res.style.color = 'var(--expense)';
      res.textContent = `❌ ${r.error || 'Falha no envio'}`;
    } else {
      res.style.display = ''; res.style.color = 'var(--income-text)';
      res.textContent = `✅ E-mail de teste enviado para ${to}.`;
    }
  } catch (e) {
    res.style.display = ''; res.style.color = 'var(--expense)';
    res.textContent = `❌ ${e.message || 'Falha no envio'}`;
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

// ── B) Templates ──────────────────────────────────────────────────────────────

async function _adminEmailTemplates(body) {
  const templates = await _api('GET', '/email/templates');
  _adminEmailData.templates = templates;
  const rows = templates.length ? templates.map(t => {
    const sys = _adminEmailIsSystem(t.is_system);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:.9rem">${_escHtml(t.name)}</span>
            ${sys ? `<span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--primary-light,#DDE7D8);color:var(--primary-600)">SISTEMA</span>` : ''}
            <span style="font-size:.72rem;color:var(--text-muted)">${_escHtml(t.category || 'geral')}</span>
          </div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${_escHtml(t.subject || '(sem assunto)')}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm" onclick="_adminEmailChooseEditor('${t.id}')" style="font-size:.75rem;padding:4px 10px">${icon('pencil',12)} Editar</button>
          ${sys ? '' : `<button class="btn btn-sm" onclick="_adminEmailDeleteTemplate('${t.id}')" style="font-size:.75rem;padding:4px 10px;color:var(--expense)">${icon('trash-2',12)}</button>`}
        </div>
      </div>`;
  }).join('') : '<p style="color:var(--text-muted);font-size:.85rem;padding:12px 0">Nenhum template ainda.</p>';

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px">
        <div class="card-title">${icon('file-text',14)} Templates de E-mail</div>
        <button class="btn btn-primary btn-sm" onclick="_adminEmailChooseEditor('')" style="font-size:.8rem">${icon('plus',14)} Novo</button>
      </div>
      ${rows}
    </div>`;
}

/** Seletor de editor: o usuário escolhe entre os 2 modelos (visual/blocos ou
 *  WYSIWYG). Chamado pelos botões "Editar"/"Novo" da lista de templates. */
function _adminEmailChooseEditor(id) {
  const isNew = !id;
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:540px;width:calc(100% - 32px)">
        <div class="modal-header">
          <div class="modal-title">${icon('layout-template',16)} ${isNew ? 'Novo template' : 'Editar template'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.85rem;color:var(--text-muted);margin:0 0 14px">Escolha como quer montar este e-mail. Você pode usar o modelo que preferir.</p>
          <div class="et-editor-choice">
            <button type="button" class="et-choice-card" onclick="closeModal();_adminEmailEditTemplate('${id}')">
              <span class="et-choice-ic">${icon('pen-line',22)}</span>
              <span class="et-choice-tt">Editor WYSIWYG</span>
              <span class="et-choice-ds">Edite o texto e o HTML do e-mail direto, como num documento. Ideal para ajustar templates existentes.</span>
            </button>
            <button type="button" class="et-choice-card" onclick="closeModal();_adminEmailOpenBuilder('${id}')">
              <span class="et-choice-ic">${icon('blocks',22)}</span>
              <span class="et-choice-tt">Editor visual (blocos)</span>
              <span class="et-choice-ds">Monte o e-mail arrastando blocos prontos (imagem, título, botão). Ideal para criar do zero.</span>
            </button>
          </div>
        </div>
      </div>
    </div>`);
}

/** Editor WYSIWYG de template (modelo 2): iframe editável (designMode) que
 *  renderiza o e-mail e permite formatar o corpo direto, com toggle para o
 *  HTML cru. Sem dependência de CDN — sempre disponível. */
function _adminEmailEditTemplate(id) {
  // Se veio como fallback do builder visual, desmonta o overlay full-viewport
  // (.em-builder) e re-renderiza a lista antes de abrir o modal, senão o overlay
  // opaco cobriria o modal.
  _adminEmailBuilderDestroy();
  _adminEmailRenderSub();
  const isNew = !id;
  const t = isNew
    ? { name: '', category: 'geral', subject: '', html: '', text: '', is_system: 0 }
    : (_adminEmailData.templates.find(x => x.id === id) || {});
  const sys = _adminEmailIsSystem(t.is_system);
  _etMode = 'visual';

  const chips = _ET_VARS.map(v =>
    `<button type="button" class="btn btn-sm" onclick="_adminEmailInsertVar('${v}')" title="Inserir ${'{{'}${v}${'}}'} no cursor" style="font-family:monospace;font-size:.72rem;padding:3px 8px;border-radius:20px">{{${v}}}</button>`
  ).join('');

  const tb = (cmd, ic, title, arg) =>
    `<button type="button" class="et-tbtn" title="${title}" onclick="_etExec('${cmd}'${arg !== undefined ? ",'" + arg + "'" : ''})">${icon(ic,15)}</button>`;

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:900px;width:calc(100% - 32px);max-height:94vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('pen-line',16)} ${isNew ? 'Novo template' : 'Editar template'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body">
          ${sys ? `<div style="font-size:.8rem;color:var(--text-muted);background:var(--primary-light,#DDE7D8);padding:8px 10px;border-radius:8px;margin-bottom:14px">
            ${icon('lock',12)} Template de sistema — nome e categoria travados. Apenas assunto e conteúdo são editáveis.</div>` : ''}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Nome *</label>
              <input id="et-name" class="form-control" value="${_escHtml(t.name || '')}" ${sys ? 'disabled' : ''}>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Categoria</label>
              <input id="et-category" class="form-control" value="${_escHtml(t.category || 'geral')}" ${sys ? 'disabled' : ''}>
            </div>
          </div>
          <div class="form-group" style="margin:0 0 12px">
            <label class="form-label">Assunto</label>
            <input id="et-subject" class="form-control" value="${_escHtml(t.subject || '')}">
          </div>

          <div class="form-group" style="margin:0">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
              <label class="form-label" style="margin:0">Corpo do e-mail</label>
              <div class="et-mode-toggle">
                <button type="button" class="et-mbtn active" data-mode="visual" onclick="_adminEmailToggleMode('visual')">${icon('eye',13)} Visual</button>
                <button type="button" class="et-mbtn" data-mode="code" onclick="_adminEmailToggleMode('code')">${icon('code',13)} HTML</button>
              </div>
            </div>

            <div id="et-toolbar" class="et-toolbar">
              ${tb('bold','bold','Negrito')}
              ${tb('italic','italic','Itálico')}
              ${tb('underline','underline','Sublinhado')}
              <span class="et-tsep"></span>
              ${tb('formatBlock','heading-1','Título','h1')}
              ${tb('formatBlock','heading-2','Subtítulo','h2')}
              ${tb('formatBlock','pilcrow','Parágrafo','p')}
              <span class="et-tsep"></span>
              ${tb('insertUnorderedList','list','Lista')}
              ${tb('insertOrderedList','list-ordered','Lista numerada')}
              <span class="et-tsep"></span>
              ${tb('justifyLeft','align-left','Alinhar à esquerda')}
              ${tb('justifyCenter','align-center','Centralizar')}
              <span class="et-tsep"></span>
              <button type="button" class="et-tbtn" title="Inserir link" onclick="_etLink()">${icon('link',15)}</button>
              <label class="et-tbtn" title="Cor do texto" style="position:relative;cursor:pointer">
                ${icon('palette',15)}
                <input type="color" onchange="_etExec('foreColor', this.value)" style="position:absolute;inset:0;opacity:0;cursor:pointer">
              </label>
              ${tb('removeFormat','eraser','Limpar formatação')}
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">
              <button type="button" class="btn btn-sm" onclick="_adminEmailInsertHeader()" style="font-size:.75rem;padding:4px 10px">${icon('image',12)} Cabeçalho com logo</button>
              ${chips}
            </div>
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:8px;line-height:1.4">
              Selecione o texto e use os botões para formatar. Os chips <code>{{ }}</code> inserem variáveis na posição do cursor. Alterne para <strong>HTML</strong> para editar o código diretamente.
            </div>

            <iframe id="et-wys" class="et-wys-frame"></iframe>
            <textarea id="et-html" class="form-control" rows="16" style="font-family:monospace;font-size:.82rem;display:none">${_escHtml(t.html || '')}</textarea>
          </div>

          <details class="em-builder-textwrap" style="margin-top:12px">
            <summary>${icon('type',13)} Texto (plain, opcional)</summary>
            <textarea id="et-text" class="form-control" rows="3" style="margin-top:8px">${_escHtml(t.text || '')}</textarea>
          </details>
          <div id="et-error" style="color:var(--expense);font-size:.83rem;display:none;margin-top:10px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button class="btn" onclick="_adminEmailWysPreview()">${icon('eye',14)} Preview com marca</button>
          <button id="et-submit" class="btn btn-primary" onclick="_adminEmailSaveTemplate('${id}')">${icon('save',14)} Salvar</button>
        </div>
      </div>
    </div>`);

  // Carrega o conteúdo no iframe editável. NOVO → HTML inicial de marca.
  _etLoadWys((t.html && t.html.trim()) ? t.html : _ET_STARTER_HTML);
}

/** (Re)carrega o HTML no iframe WYSIWYG e liga o designMode para edição. */
function _etLoadWys(html) {
  const f = document.getElementById('et-wys');
  if (!f) return;
  const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
  if (!doc) return;
  doc.open();
  doc.write(html && html.trim() ? html : '<p></p>');
  doc.close();
  try { doc.designMode = 'on'; } catch (_) {}
  try { doc.execCommand('styleWithCSS', false, true); } catch (_) {}
}

/** Lê o HTML atual do iframe WYSIWYG como documento completo. */
function _etGetWysHtml() {
  const f = document.getElementById('et-wys');
  const doc = f && (f.contentDocument || (f.contentWindow && f.contentWindow.document));
  if (!doc || !doc.documentElement) return '';
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

/** HTML canônico do editor: lê do modo ativo (visual = iframe, code = textarea). */
function _etGetHtml() {
  if (_etMode === 'code') {
    const ta = document.getElementById('et-html');
    return ta ? ta.value : '';
  }
  return _etGetWysHtml();
}

/** Alterna entre o modo Visual (iframe editável) e HTML (textarea de código),
 *  sincronizando o conteúdo entre os dois. */
function _adminEmailToggleMode(mode) {
  if (mode === _etMode) return;
  const frame = document.getElementById('et-wys');
  const ta    = document.getElementById('et-html');
  const bar   = document.getElementById('et-toolbar');
  if (!frame || !ta) return;

  if (mode === 'code') {
    ta.value = _etGetWysHtml();          // visual → código
    frame.style.display = 'none';
    ta.style.display = '';
    if (bar) bar.style.display = 'none';
  } else {
    _etLoadWys(ta.value);                // código → visual
    ta.style.display = 'none';
    frame.style.display = '';
    if (bar) bar.style.display = '';
  }
  _etMode = mode;
  document.querySelectorAll('.et-mbtn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

/** Executa um comando de formatação no documento do iframe WYSIWYG. */
function _etExec(cmd, arg) {
  const f = document.getElementById('et-wys');
  const doc = f && (f.contentDocument || (f.contentWindow && f.contentWindow.document));
  if (!doc) return;
  if (f.contentWindow) f.contentWindow.focus();
  try { doc.execCommand(cmd, false, arg); } catch (_) {}
}

/** Insere um link no WYSIWYG a partir da seleção atual. */
function _etLink() {
  const url = prompt('URL do link:', 'https://');
  if (url) _etExec('createLink', url);
}

/** Insere HTML/texto no ponto de edição do modo ativo. */
function _etInsert(payload, kind, prependIfNoFocus) {
  if (_etMode === 'visual') {
    const f = document.getElementById('et-wys');
    const doc = f && (f.contentDocument || (f.contentWindow && f.contentWindow.document));
    if (!doc) return;
    if (f.contentWindow) f.contentWindow.focus();
    try { doc.execCommand(kind === 'html' ? 'insertHTML' : 'insertText', false, payload); } catch (_) {}
    return;
  }
  // Modo código: insere no textarea na posição do cursor.
  const ta = document.getElementById('et-html');
  if (!ta) return;
  const focused = document.activeElement === ta && typeof ta.selectionStart === 'number';
  if (focused) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + payload + ta.value.slice(end);
    const pos = start + payload.length;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.focus();
  } else if (prependIfNoFocus) {
    ta.value = payload + ta.value;
  } else {
    ta.value += payload;
  }
}

/** Insere um token de variável (ex.: {{logo_url}}) no ponto de edição. */
function _adminEmailInsertVar(varName) {
  _etInsert('{{' + varName + '}}', 'text', false);
}

/** Insere um cabeçalho com logo: bloco standalone no WYSIWYG, ou linha <tr> no código. */
function _adminEmailInsertHeader() {
  if (_etMode === 'visual') _etInsert(_EM_HEADER_VISUAL, 'html', true);
  else                      _etInsert(_EM_HEADER_SNIPPET, 'html', true);
}

/** Preview com marca: envia o HTML atual do editor para /email/preview e mostra
 *  o resultado renderizado (logo + variáveis de exemplo) num modal isolado. */
async function _adminEmailWysPreview() {
  const subject = (document.getElementById('et-subject') || {}).value || '';
  const html = _etGetHtml();
  if (!html.trim()) { toast('O corpo do e-mail está vazio.', 'error'); return; }
  try {
    const res = await _api('POST', '/email/preview', { html, subject });
    _adminEmailBuilderShowPreview((res && res.subject) || subject, (res && res.html) || '');
  } catch (e) {
    toast('Não foi possível gerar o preview.', 'error');
  }
}

async function _adminEmailSaveTemplate(id) {
  const errEl = document.getElementById('et-error');
  const btn   = document.getElementById('et-submit');
  errEl.style.display = 'none';
  const t = id ? (_adminEmailData.templates.find(x => x.id === id) || {}) : {};
  const sys = _adminEmailIsSystem(t.is_system);

  const html = _etGetHtml();
  if (!html.trim()) { errEl.textContent = 'O corpo do e-mail está vazio.'; errEl.style.display = ''; return; }

  const payload = {
    subject: document.getElementById('et-subject').value,
    html:    html,
    text:    document.getElementById('et-text').value,
  };
  if (id) payload.id = id;
  if (!sys) {
    payload.name     = document.getElementById('et-name').value.trim();
    payload.category = document.getElementById('et-category').value.trim() || 'geral';
    if (!payload.name) { errEl.textContent = 'Nome é obrigatório.'; errEl.style.display = ''; return; }
  }

  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    await _api('POST', '/email/template', payload);
    closeModal();
    toast('Template salvo!', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    errEl.textContent = e.message || 'Erro ao salvar.'; errEl.style.display = '';
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function _adminEmailDeleteTemplate(id) {
  const t = _adminEmailData.templates.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Excluir o template "${t.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await _api('DELETE', '/email/template?id=' + encodeURIComponent(id));
    toast('Template excluído.', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao excluir'), 'error');
  }
}

// ── B2) Builder visual de templates (Templatical SDK — Vue3 + Tiptap) ─────────
//
// Área dedicada de edição arrastar-soltar que substitui o conteúdo do sub-painel
// de templates. O modal antigo (_adminEmailEditTemplate) permanece como fallback
// básico (editor de código) para offline/CDN fora e telas estreitas.
//
// Módulos carregados LAZY (só na 1ª vez que o builder abre) via CDN, como ESM
// puro (import() dinâmico — o app é vanilla, sem bundler). Um guard
// (_emTplLoadPromise) evita carga dupla. O editor (build /dist/cdn) é
// autocontido: já embute o Vue e injeta o próprio CSS no shadow DOM.
//
// Pipeline de export (o backend consome HTML): o editor exporta um JSON
// (TemplateContent). No save/preview: renderToMjml(content) → MJML → mjml2html
// → HTML com CSS inline (email-safe). As merge tags {{var}} (sintaxe handlebars)
// sobrevivem intactas do editor até o HTML final para o backend substituir.

const _EM_TPL_EDITOR   = 'https://cdn.jsdelivr.net/npm/@templatical/editor@0.13.0/dist/cdn/editor.js';
const _EM_TPL_RENDERER = 'https://esm.sh/@templatical/renderer@0.13.0';
const _EM_TPL_TYPES    = 'https://esm.sh/@templatical/types@0.13.0';
const _EM_MJML         = 'https://esm.sh/mjml-browser@4.15.3';

let _emBuilder        = null;   // instância Templatical ativa (unmount ao voltar/salvar)
let _emTplMods        = null;   // { init, renderToMjml, mjml2html, create*Block... }
let _emTplLoadPromise = null;   // promessa única de carregamento (anti carga dupla)
let _emBuilderCtx     = null;   // { id, sys, t } do template em edição
let _emBuilderSaving  = false;  // trava reentrância do save
let _emBuilderOpening = false;  // trava duplo-init enquanto um load está em andamento
let _emBuilderReady   = false;  // true após o load inicial de conteúdo (para dirty check)
let _emBuilderDirty   = false;  // alterações não salvas (via onChange, pós-ready)

/** Ponto de entrada do builder visual (substitui o modal antigo como entrada). */
function _adminEmailOpenBuilder(id) {
  // Guard anti duplo-clique: se já há um builder ativo ou um load em andamento,
  // ignora o segundo clique (evita duplo-init — 1ª instância criada e destruída
  // só pra criar a 2ª). O fluxo abrir → voltar → reabrir continua intacto porque
  // ambos os flags voltam a false ao destruir/concluir o load.
  if (_emBuilder || _emBuilderOpening) return;
  _emBuilderOpening = true;

  const isNew = !id;
  const t = isNew
    ? { name:'', category:'geral', subject:'', html:'', text:'', is_system:0 }
    : (_adminEmailData.templates.find(x => x.id === id) || {});
  const sys = _adminEmailIsSystem(t.is_system);
  _emBuilderCtx = { id: id || '', sys, t };

  const body = document.getElementById('admin-email-body');
  if (!body) { _emBuilderOpening = false; return; }

  // Destrói qualquer instância remanescente antes de montar a nova view.
  _adminEmailBuilderDestroy();

  const narrow = window.matchMedia('(max-width: 720px)').matches;
  // Templates existentes com HTML abrem como um único bloco HTML opaco (o
  // Templatical não decompõe HTML em blocos visuais) — avisamos o usuário.
  const legacy = !!(t && t.html && t.html.trim());

  body.innerHTML = `
    <div class="em-builder">
      <div class="em-builder-bar">
        <button class="btn btn-ghost btn-sm" onclick="_adminEmailBuilderBack()">${icon('arrow-left',14)} Voltar aos templates</button>
        <div class="em-builder-title">${icon('layout-template',15)} ${isNew ? 'Novo template' : 'Editar template'}</div>
        <div class="em-builder-bar-actions">
          <button id="em-builder-preview" class="btn btn-sm" onclick="_adminEmailBuilderPreview()">${icon('eye',14)} Preview com marca</button>
          <button id="em-builder-save" class="btn btn-primary btn-sm" onclick="_adminEmailBuilderSave()">${icon('save',14)} Salvar template</button>
        </div>
      </div>

      ${sys ? `<div class="em-builder-sysbanner">${icon('lock',12)} Template de sistema — nome e categoria travados. Assunto e conteúdo são editáveis.</div>` : ''}
      ${legacy ? `<div class="em-builder-sysbanner">${icon('code',12)} Template legado — editável como um único bloco HTML.</div>` : ''}
      ${narrow ? `<div class="em-builder-mobilewarn">${icon('alert-triangle',12)} <span>O editor visual funciona melhor no desktop.</span> <button class="btn btn-sm" onclick="_adminEmailEditTemplate('${id}')">${icon('code',12)} Usar editor básico</button></div>` : ''}

      <div class="em-builder-fields">
        <div class="form-group" style="margin:0">
          <label class="form-label">Nome ${sys ? '' : '*'}</label>
          <input id="et-name" class="form-control" value="${_escHtml(t.name || '')}" ${sys ? 'disabled' : ''}>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Categoria</label>
          <input id="et-category" class="form-control" value="${_escHtml(t.category || 'geral')}" ${sys ? 'disabled' : ''}>
        </div>
        <div class="form-group" style="margin:0;grid-column:1 / -1">
          <label class="form-label">Assunto</label>
          <input id="et-subject" class="form-control" value="${_escHtml(t.subject || '')}">
        </div>
      </div>

      <div class="em-builder-stage" id="em-builder-stage">
        <div id="em-gjs-canvas"></div>
        <div id="em-builder-loading" class="em-builder-overlay">
          <div class="spinner"></div>
          <div style="margin-top:12px;font-size:.85rem;color:var(--text-muted)">Carregando editor visual...</div>
        </div>
        <div id="em-builder-error" class="em-builder-overlay" style="display:none">
          <div style="text-align:center;max-width:360px">
            ${icon('wifi-off',28)}
            <p style="margin:12px 0;font-size:.9rem;color:var(--text)">Não foi possível carregar o editor visual. Verifique sua conexão e tente novamente.</p>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" onclick="_adminEmailBuilderRetry()">${icon('refresh-cw',14)} Tentar novamente</button>
              <button class="btn btn-sm" onclick="_adminEmailEditTemplate('${id}')">${icon('code',14)} Usar editor de código (básico)</button>
            </div>
          </div>
        </div>
      </div>

      <details class="em-builder-textwrap">
        <summary>${icon('type',13)} Texto (plain, opcional)</summary>
        <textarea id="et-text" class="form-control" rows="3" style="margin-top:8px">${_escHtml(t.text || '')}</textarea>
      </details>
    </div>`;

  // Scroll-lock: o builder vira overlay full-viewport; trava o scroll do body.
  // A classe é removida em _adminEmailBuilderDestroy (Back/Save/troca de sub-aba)
  // e, defensivamente, no route() do app ao navegar para outra página.
  document.body.classList.add('em-fullscreen-open');

  if (typeof lucide !== 'undefined') lucide.createIcons();
  _adminEmailBuilderLoad(t);
}

/** Carrega, uma única vez, os módulos ESM do Templatical + renderer + mjml via
 *  import() dinâmico (CDN). Anti carga dupla via promessa compartilhada; em caso
 *  de falha a promessa é limpa para permitir o "Tentar novamente". */
function _adminEmailLoadTplModules() {
  if (_emTplMods) return Promise.resolve(_emTplMods);
  if (_emTplLoadPromise) return _emTplLoadPromise;

  _emTplLoadPromise = Promise.all([
    import(_EM_TPL_EDITOR),
    import(_EM_TPL_RENDERER),
    import(_EM_TPL_TYPES),
    import(_EM_MJML),
  ]).then(([ed, rd, ty, mj]) => {
    const mjml2html = mj.default || mj.mjml2html || mj;
    if (typeof ed.init !== 'function' || typeof rd.renderToMjml !== 'function' || typeof mjml2html !== 'function') {
      throw new Error('Módulos do editor incompletos');
    }
    _emTplMods = {
      init: ed.init,
      renderToMjml: rd.renderToMjml,
      mjml2html,
      createDefaultTemplateContent: ty.createDefaultTemplateContent,
      createHtmlBlock: ty.createHtmlBlock,
      createTitleBlock: ty.createTitleBlock,
      createParagraphBlock: ty.createParagraphBlock,
      createButtonBlock: ty.createButtonBlock,
      createImageBlock: ty.createImageBlock,
    };
    return _emTplMods;
  }).catch(err => { _emTplLoadPromise = null; throw err; });

  return _emTplLoadPromise;
}

/** Carrega os assets e inicializa o editor. Alterna spinner/erro conforme resultado. */
async function _adminEmailBuilderLoad(t) {
  const spin = document.getElementById('em-builder-loading');
  const err  = document.getElementById('em-builder-error');
  if (err) err.style.display = 'none';
  if (spin) spin.style.display = '';
  try {
    await _adminEmailLoadTplModules();
    if (!document.getElementById('em-gjs-canvas')) return;  // usuário já saiu do builder
    await _adminEmailBuilderInit(t);
    if (spin) spin.style.display = 'none';
  } catch (e) {
    if (spin) spin.style.display = 'none';
    if (err)  err.style.display  = 'flex';
  } finally {
    // Libera o guard anti duplo-clique assim que o load resolve (sucesso, falha
    // ou saída antecipada), permitindo o fluxo normal de reabrir depois.
    _emBuilderOpening = false;
  }
}

/** Botão "Tentar novamente" após falha de CDN. */
function _adminEmailBuilderRetry() {
  const t = (_emBuilderCtx && _emBuilderCtx.t) || {};
  _adminEmailBuilderLoad(t);
}

/** Config de merge tags: sintaxe handlebars ({{ }}) + a lista de variáveis do
 *  app (_ET_VARS). O `value` é o token completo — o renderer o preserva literal
 *  no HTML final para o backend substituir depois. */
function _emMergeTagsConfig() {
  return {
    syntax: 'handlebars',
    tags: _ET_VARS.map(v => ({ label: v, value: '{{' + v + '}}' })),
    autocomplete: true,
  };
}

/** Blocos nativos do layout default para templates NOVOS (edição visual real). */
function _emDefaultBlocks(M) {
  return [
    M.createImageBlock({ src: '{{logo_url}}', alt: '{{app_name}}', width: 160, align: 'center' }),
    M.createTitleBlock({ content: 'Olá, {{name}}!', level: 1, textAlign: 'left', color: '#1f2937' }),
    M.createParagraphBlock({ content: 'Escreva aqui a mensagem do seu e-mail. Use os blocos à esquerda para montar o layout e digite <strong>{{</strong> para inserir variáveis dinâmicas.' }),
    M.createButtonBlock({ text: 'Acessar {{app_name}}', url: '{{app_url}}', backgroundColor: '{{primary_color}}', textColor: '#ffffff' }),
    M.createParagraphBlock({ content: '© {{year}} {{app_name}}. Todos os direitos reservados.' }),
  ];
}

/** Monta o TemplateContent (JSON) inicial. NOVO → blocos nativos de marca.
 *  EXISTENTE (HTML salvo) → um único bloco HTML legado (preserva o dado; o
 *  Templatical não decompõe HTML em blocos visuais). Nunca lança: em erro cai
 *  para o default vazio garantido pelo SDK, para o editor sempre abrir. */
function _emBuilderBuildContent(t, M) {
  const hasHtml = !!(t && t.html && t.html.trim());
  try {
    const base = M.createDefaultTemplateContent('Arial, Helvetica, sans-serif',
      { backgroundColor: '#f4f4f5', fontFamily: 'Arial, Helvetica, sans-serif' });
    if (hasHtml) {
      base.blocks = [ M.createHtmlBlock({ content: t.html }) ];
    } else {
      base.blocks = _emDefaultBlocks(M);
    }
    return base;
  } catch (e) {
    try { return M.createDefaultTemplateContent(); } catch (_) { return undefined; }
  }
}

/** Inicializa a instância Templatical no canvas com o conteúdo inicial. Async:
 *  init() resolve quando o editor Vue montou. */
async function _adminEmailBuilderInit(t) {
  const M = _emTplMods;
  if (!M || typeof M.init !== 'function') throw new Error('Templatical indisponível');

  // Segurança: desmonta instância anterior antes de criar nova (sem vazamento).
  if (_emBuilder) { try { _emBuilder.unmount(); } catch (_) {} _emBuilder = null; }

  const container = document.getElementById('em-gjs-canvas');
  if (!container) return;  // usuário já saiu do builder

  const content = _emBuilderBuildContent(t, M);

  _emBuilderReady = false;
  _emBuilderDirty = false;

  const editor = await M.init({
    container,
    content,
    shadowDom: true,        // isolamento total de CSS; o editor injeta o próprio CSS
    branding: false,        // sem rodapé "Powered by" (permitido pela licença)
    mergeTags: _emMergeTagsConfig(),
    onChange: () => { if (_emBuilderReady) _emBuilderDirty = true; },
  });

  // Re-check pós-await (crítico): se o usuário voltou/trocou de sub-aba enquanto
  // o init() estava pendente, o canvas já foi removido do DOM (ou o contexto do
  // template mudou). NÃO ressuscitamos a instância — desmontamos o editor órfão
  // e saímos. Caso contrário, _emBuilder ficaria truthy e o guard em
  // _adminEmailOpenBuilder bloquearia reabrir o builder para sempre; além de
  // vazar uma instância Vue montada num shadow DOM destacado.
  // (_emBuilderOpening é liberado pelo finally de _adminEmailBuilderLoad.)
  if (!document.getElementById('em-gjs-canvas') || !_emBuilderCtx || _emBuilderCtx.t !== t) {
    try { editor.unmount(); } catch (_) {}
    return;
  }

  _emBuilder = editor;
  // Só marca dirty a partir de agora — o load inicial de conteúdo não conta.
  setTimeout(() => { _emBuilderReady = true; }, 0);
}

/** Gera o HTML final (CSS inline, email-safe) a partir do JSON do editor:
 *  getContent() → renderToMjml() → MJML → mjml2html() → HTML. As merge tags
 *  {{var}} sobrevivem literais (o renderer converte os nós de merge tag em texto
 *  {{var}} e o mjml não toca nesse texto). allowHtmlBlocks=true renderiza os
 *  blocos HTML legados. */
async function _emExportHtml() {
  const M = _emTplMods;
  if (!_emBuilder || !M) return '';
  const content = _emBuilder.getContent();
  let res;
  try {
    const mjml = await M.renderToMjml(content, { allowHtmlBlocks: true });
    res = M.mjml2html(mjml, { validationLevel: 'skip', minify: false });
  } catch (e) {
    throw new Error('Falha ao compilar o HTML do template');
  }
  return (res && res.html) || '';
}

/** Desmonta a instância Templatical e limpa o estado de save/dirty. */
function _adminEmailBuilderDestroy() {
  _emBuilderSaving = false;
  _emBuilderReady = false;
  _emBuilderDirty = false;
  // Libera o scroll-lock do overlay full-viewport (idempotente).
  document.body.classList.remove('em-fullscreen-open');
  if (_emBuilder) { try { _emBuilder.unmount(); } catch (_) {} _emBuilder = null; }
}

/** Guard compartilhado (Back + troca de sub-aba): retorna true se é seguro sair
 *  do builder. Só dispara o confirm se o builder estiver realmente ATIVO e com
 *  alterações não salvas; com _emBuilder null (loading/init falhou) sai direto.
 *  O Templatical não expõe getDirtyCount — usamos o flag _emBuilderDirty
 *  alimentado pelo onChange (após o load inicial). */
function _adminEmailBuilderConfirmDiscard() {
  if (!_emBuilder) return true;
  if (_emBuilderDirty) return confirm('Você tem alterações não salvas no editor. Descartar e sair?');
  return true;
}

/** Voltar à lista, com guard de alterações não salvas. */
function _adminEmailBuilderBack() {
  if (!_adminEmailBuilderConfirmDiscard()) return;
  _adminEmailBuilderDestroy();
  _adminEmailRenderSub();
}

/** Salva o template: monta o payload conforme o contrato e faz POST /email/template. */
async function _adminEmailBuilderSave() {
  if (!_emBuilder || _emBuilderSaving) return;
  const ctx = _emBuilderCtx || {};

  let html;
  try {
    html = await _emExportHtml();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao gerar o HTML'), 'error');
    return;
  }

  // Não salva um template vazio silenciosamente (ex.: todos os blocos removidos).
  // Neste ponto o botão ainda não foi desabilitado nem _emBuilderSaving setado,
  // então basta avisar e sair mantendo o trabalho no builder.
  if (!html || !html.trim()) {
    toast('O template está vazio.', 'error');
    return;
  }

  const payload = {
    subject: (document.getElementById('et-subject') || {}).value || '',
    html:    html,
    text:    (document.getElementById('et-text') || {}).value || '',
  };
  if (ctx.id) payload.id = ctx.id;
  if (!ctx.sys) {
    const nameEl = document.getElementById('et-name');
    const catEl  = document.getElementById('et-category');
    const name = (nameEl ? nameEl.value : '').trim();
    const category = (catEl ? catEl.value : '').trim() || 'geral';
    if (!name) {
      toast('Nome é obrigatório.', 'error');
      if (nameEl) nameEl.focus();
      return;
    }
    payload.name = name;
    payload.category = category;
  }

  const btn  = document.getElementById('em-builder-save');
  const orig = btn ? btn.innerHTML : '';
  _emBuilderSaving = true;
  if (btn) { btn.disabled = true; btn.innerHTML = `${icon('loader',14)} Salvando...`; }
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    await _api('POST', '/email/template', payload);
    toast('Template salvo!', 'success');
    _adminEmailBuilderDestroy();
    await _adminEmailRenderSub();
  } catch (e) {
    // Erro: mantém o trabalho no builder, reabilita o botão.
    toast('Erro: ' + (e.message || 'falha ao salvar'), 'error');
    _emBuilderSaving = false;
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

/** Preview com marca: envia o HTML inline atual para /email/preview e exibe
 *  o resultado renderizado (logo + variáveis de exemplo) num modal isolado. */
async function _adminEmailBuilderPreview() {
  if (!_emBuilder) return;
  const subject = (document.getElementById('et-subject') || {}).value || '';

  const btn  = document.getElementById('em-builder-preview');
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = `${icon('loader',14)} Gerando...`; }
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const html = await _emExportHtml();
    const res = await _api('POST', '/email/preview', { html, subject });
    _adminEmailBuilderShowPreview((res && res.subject) || subject, (res && res.html) || '');
  } catch (e) {
    toast('Não foi possível gerar o preview.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

/** Modal de preview com iframe srcdoc isolado + toggle desktop/mobile. */
function _adminEmailBuilderShowPreview(subject, html) {
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:840px;width:calc(100% - 32px);max-height:92vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <div class="modal-title">${icon('eye',16)} Preview com marca</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-sm em-prev-dev active" data-dev="desktop" onclick="_adminEmailPreviewDevice('desktop')">${icon('monitor',13)} Desktop</button>
            <button class="btn btn-sm em-prev-dev" data-dev="mobile" onclick="_adminEmailPreviewDevice('mobile')">${icon('smartphone',13)} Mobile</button>
            <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
          </div>
        </div>
        <div class="modal-body" style="overflow:auto;background:var(--bg-subtle)">
          <div style="font-weight:600;font-size:.86rem;padding:8px 10px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;word-break:break-word;color:var(--text)">${_escHtml(subject || '(sem assunto)')}</div>
          <div style="display:flex;justify-content:center">
            <iframe id="em-prev-frame" style="width:100%;max-width:100%;height:68vh;border:1px solid var(--border);border-radius:8px;background:#fff;transition:max-width .2s"></iframe>
          </div>
        </div>
      </div>
    </div>`);
  const f = document.getElementById('em-prev-frame');
  if (f) f.srcdoc = html;
}

/** Alterna a largura do iframe de preview (100% vs 375px). */
function _adminEmailPreviewDevice(dev) {
  const f = document.getElementById('em-prev-frame');
  if (f) f.style.maxWidth = dev === 'mobile' ? '375px' : '100%';
  document.querySelectorAll('.em-prev-dev').forEach(b =>
    b.classList.toggle('active', b.dataset.dev === dev));
}

// ── C) Listas e grupos ────────────────────────────────────────────────────────

async function _adminEmailLists(body) {
  const lists = await _api('GET', '/email/lists');
  _adminEmailData.lists = lists;
  const rows = lists.length ? lists.map(l => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:.9rem">${_escHtml(l.name)}</span>
          ${l.dynamic_filter === 'all_users' ? `<span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--primary-light,#DDE7D8);color:var(--primary-600)">DINÂMICA</span>` : ''}
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
          ${_escHtml(l.description || 'Sem descrição')} &nbsp;·&nbsp; ${l.member_count || 0} membro(s)
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-sm" onclick="_adminEmailManageMembers('${l.id}')" style="font-size:.75rem;padding:4px 10px">${icon('users',12)} Membros</button>
        <button class="btn btn-sm" onclick="_adminEmailEditList('${l.id}')" style="font-size:.75rem;padding:4px 10px">${icon('pencil',12)} Editar</button>
        <button class="btn btn-sm" onclick="_adminEmailDeleteList('${l.id}')" style="font-size:.75rem;padding:4px 10px;color:var(--expense)">${icon('trash-2',12)}</button>
      </div>
    </div>`).join('') : '<p style="color:var(--text-muted);font-size:.85rem;padding:12px 0">Nenhuma lista ainda.</p>';

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px">
        <div class="card-title">${icon('users',14)} Listas e grupos</div>
        <button class="btn btn-primary btn-sm" onclick="_adminEmailEditList('')" style="font-size:.8rem">${icon('plus',14)} Nova lista</button>
      </div>
      ${rows}
    </div>`;
}

function _adminEmailEditList(id) {
  const isNew = !id;
  const l = isNew ? { name: '', description: '', dynamic_filter: '' } : (_adminEmailData.lists.find(x => x.id === id) || {});
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:460px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('users',16)} ${isNew ? 'Nova lista' : 'Editar lista'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome *</label>
            <input id="el-name" class="form-control" value="${_escHtml(l.name || '')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Descrição <span style="color:var(--text-muted);font-weight:400">(opcional)</span></label>
            <input id="el-desc" class="form-control" value="${_escHtml(l.description || '')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Filtro dinâmico</label>
            <select id="el-filter" class="form-control">
              <option value=""          ${l.dynamic_filter !== 'all_users' ? 'selected' : ''}>Estática (membros manuais)</option>
              <option value="all_users" ${l.dynamic_filter === 'all_users' ? 'selected' : ''}>Todos os usuários (dinâmica)</option>
            </select>
            <div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">Listas dinâmicas incluem automaticamente todos os usuários no envio.</div>
          </div>
          <div id="el-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button id="el-submit" class="btn btn-primary" onclick="_adminEmailSaveList('${id}')">${icon('save',14)} Salvar</button>
        </div>
      </div>
    </div>`);
}

async function _adminEmailSaveList(id) {
  const errEl = document.getElementById('el-error');
  const btn   = document.getElementById('el-submit');
  errEl.style.display = 'none';
  const name = document.getElementById('el-name').value.trim();
  if (!name) { errEl.textContent = 'Nome é obrigatório.'; errEl.style.display = ''; return; }
  const payload = {
    name,
    description:    document.getElementById('el-desc').value.trim(),
    dynamic_filter: document.getElementById('el-filter').value,
  };
  if (id) payload.id = id;
  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    await _api('POST', '/email/list', payload);
    closeModal();
    toast('Lista salva!', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    errEl.textContent = e.message || 'Erro ao salvar.'; errEl.style.display = '';
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function _adminEmailDeleteList(id) {
  const l = _adminEmailData.lists.find(x => x.id === id);
  if (!l) return;
  if (!confirm(`Excluir a lista "${l.name}" e todos os seus membros? Esta ação não pode ser desfeita.`)) return;
  try {
    await _api('DELETE', '/email/list?id=' + encodeURIComponent(id));
    toast('Lista excluída.', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao excluir'), 'error');
  }
}

function _adminEmailManageMembers(listId) {
  const l = _adminEmailData.lists.find(x => x.id === listId) || { name: '' };
  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:560px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('users',16)} Membros — ${_escHtml(l.name)}</div>
          <button class="btn btn-icon btn-ghost" onclick="_adminEmailCloseMembers()">${icon('x',16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
            <div class="form-group" style="margin:0">
              <label class="form-label">E-mail</label>
              <input id="emb-email" class="form-control" type="email" placeholder="pessoa@email.com">
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Nome</label>
              <input id="emb-name" class="form-control" placeholder="(opcional)">
            </div>
            <button class="btn btn-primary" onclick="_adminEmailAddMember('${listId}')" style="height:38px">${icon('plus',14)}</button>
          </div>
          <div>
            <button class="btn btn-ghost btn-sm" onclick="_adminEmailAddAllUsers('${listId}')" style="font-size:.8rem">${icon('user-plus',14)} Adicionar todos os usuários</button>
          </div>
          <div id="emb-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase">Membros atuais</div>
          <div id="emb-list"><div class="loading-screen" style="min-height:60px"><div class="spinner"></div></div></div>
        </div>
      </div>
    </div>`);
  _adminEmailLoadMembers(listId);
}

function _adminEmailCloseMembers() {
  closeModal();
  _adminEmailRenderSub();
}

async function _adminEmailLoadMembers(listId) {
  const cont = document.getElementById('emb-list');
  if (!cont) return;
  try {
    const members = await _api('GET', '/email/list-members?list_id=' + encodeURIComponent(listId));
    cont.innerHTML = members.length ? members.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div style="font-size:.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_escHtml(m.email)}</div>
          ${m.name ? `<div style="font-size:.76rem;color:var(--text-muted)">${_escHtml(m.name)}</div>` : ''}
        </div>
        <button class="btn btn-sm" onclick="_adminEmailRemoveMember('${listId}','${m.id}')" style="font-size:.75rem;padding:4px 8px;color:var(--expense)">${icon('trash-2',12)}</button>
      </div>`).join('') : '<p style="color:var(--text-muted);font-size:.83rem;padding:8px 0">Nenhum membro nesta lista.</p>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    cont.innerHTML = `<p style="color:var(--expense);font-size:.83rem">Erro: ${_escHtml(e.message || 'falha')}</p>`;
  }
}

async function _adminEmailAddMember(listId) {
  const errEl = document.getElementById('emb-error');
  errEl.style.display = 'none';
  const email = document.getElementById('emb-email').value.trim();
  const name  = document.getElementById('emb-name').value.trim();
  if (!email) { errEl.textContent = 'E-mail é obrigatório.'; errEl.style.display = ''; return; }
  try {
    await _api('POST', '/email/list-members', { list_id: listId, members: [{ email, name }] });
    document.getElementById('emb-email').value = '';
    document.getElementById('emb-name').value  = '';
    await _adminEmailLoadMembers(listId);
  } catch (e) {
    errEl.textContent = e.message || 'Erro ao adicionar.'; errEl.style.display = '';
  }
}

async function _adminEmailAddAllUsers(listId) {
  if (!confirm('Adicionar todos os usuários cadastrados a esta lista?')) return;
  const errEl = document.getElementById('emb-error');
  errEl.style.display = 'none';
  try {
    const r = await _api('POST', '/email/list-members', { list_id: listId, source: 'all_users' });
    toast(`${r.inserted || 0} usuário(s) adicionado(s).`, 'success');
    await _adminEmailLoadMembers(listId);
  } catch (e) {
    errEl.textContent = e.message || 'Erro ao adicionar.'; errEl.style.display = '';
  }
}

async function _adminEmailRemoveMember(listId, memberId) {
  try {
    await _api('DELETE', '/email/list-member?id=' + encodeURIComponent(memberId));
    await _adminEmailLoadMembers(listId);
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao remover'), 'error');
  }
}

// ── D) Campanhas ──────────────────────────────────────────────────────────────

async function _adminEmailCampaigns(body) {
  const [campaigns, templates, lists] = await Promise.all([
    _api('GET', '/email/campaigns'),
    _api('GET', '/email/templates'),
    _api('GET', '/email/lists'),
  ]);
  _adminEmailData.templates = templates;
  _adminEmailData.lists     = lists;

  const tplName  = id => (templates.find(t => t.id === id) || {}).name || '—';
  const listName = id => (lists.find(l => l.id === id) || {}).name || '—';
  const statusColor = s => s === 'sent' || s === 'done' ? 'var(--income-text)' : s === 'running' || s === 'queued' ? 'var(--warning,#d97706)' : s === 'draft' ? 'var(--text-muted)' : 'var(--expense)';

  const rows = campaigns.length ? campaigns.map(c => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:.9rem">${_escHtml(c.name || '(sem nome)')}</span>
          <span style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--border);color:${statusColor(c.status)}">${_escHtml((c.status || 'draft').toUpperCase())}</span>
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
          Lista: ${_escHtml(listName(c.list_id))}${c.template_id ? ` · Template: ${_escHtml(tplName(c.template_id))}` : ''}
          &nbsp;·&nbsp; ${c.total || 0} total / ${c.sent || 0} enviados / ${c.failed || 0} falhas
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-sm" onclick="_adminEmailSendCampaign('${c.id}')" style="font-size:.75rem;padding:4px 10px;background:var(--primary-light,#DDE7D8);color:var(--primary-600);border:none">${icon('send',12)} Enviar</button>
        <button class="btn btn-sm" onclick="_adminEmailEditCampaign('${c.id}')" style="font-size:.75rem;padding:4px 10px">${icon('pencil',12)}</button>
        <button class="btn btn-sm" onclick="_adminEmailDeleteCampaign('${c.id}')" style="font-size:.75rem;padding:4px 10px;color:var(--expense)">${icon('trash-2',12)}</button>
      </div>
    </div>`).join('') : '<p style="color:var(--text-muted);font-size:.85rem;padding:12px 0">Nenhuma campanha ainda.</p>';

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px">
        <div class="card-title">${icon('send',14)} Campanhas</div>
        <button class="btn btn-primary btn-sm" onclick="_adminEmailEditCampaign('')" style="font-size:.8rem">${icon('plus',14)} Nova campanha</button>
      </div>
      ${rows}
    </div>`;
}

function _adminEmailEditCampaign(id) {
  const isNew = !id;
  const c = isNew
    ? { name: '', template_id: '', subject: '', html: '', list_id: '', trigger_type: 'immediate', scheduled_for: '', event_key: '' }
    : (_adminEmailData.campaigns?.find(x => x.id === id) || {});
  // Campanhas não ficam em cache separado; recarrega via API caso edição direta sem cache.
  _adminEmailRenderCampaignModal(isNew, c, id);
}

async function _adminEmailRenderCampaignModal(isNew, c, id) {
  // Garante template/list options mesmo se veio de navegação direta.
  if (!_adminEmailData.templates.length || !_adminEmailData.lists.length) {
    try {
      const [templates, lists] = await Promise.all([_api('GET', '/email/templates'), _api('GET', '/email/lists')]);
      _adminEmailData.templates = templates; _adminEmailData.lists = lists;
    } catch (_) {}
  }
  // Recarrega dados reais da campanha ao editar (fonte de verdade).
  if (id) {
    try {
      const all = await _api('GET', '/email/campaigns');
      const found = all.find(x => x.id === id);
      if (found) c = found;
    } catch (_) {}
  }

  const tplOpts  = _adminEmailData.templates.map(t => `<option value="${t.id}" ${c.template_id === t.id ? 'selected' : ''}>${_escHtml(t.name)}</option>`).join('');
  const listOpts = _adminEmailData.lists.map(l => `<option value="${l.id}" ${c.list_id === l.id ? 'selected' : ''}>${_escHtml(l.name)}</option>`).join('');
  const trig = c.trigger_type || 'immediate';

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:640px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('send',16)} ${isNew ? 'Nova campanha' : 'Editar campanha'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome *</label>
            <input id="ec-name" class="form-control" value="${_escHtml(c.name || '')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Template</label>
            <select id="ec-template" class="form-control">
              <option value="">— Sem template (assunto/HTML manual) —</option>
              ${tplOpts}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Assunto <span style="color:var(--text-muted);font-weight:400">(deixe vazio para herdar do template)</span></label>
            <input id="ec-subject" class="form-control" value="${_escHtml(c.subject || '')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">HTML <span style="color:var(--text-muted);font-weight:400">(deixe vazio para herdar do template)</span></label>
            <textarea id="ec-html" class="form-control" rows="5" style="font-family:monospace;font-size:.82rem">${_escHtml(c.html || '')}</textarea>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Lista de destino *</label>
            <select id="ec-list" class="form-control">
              <option value="">— Selecione —</option>
              ${listOpts}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Disparo</label>
            <select id="ec-trigger" class="form-control" onchange="_adminEmailCampaignTrigger(this.value)">
              <option value="immediate" ${trig === 'immediate' ? 'selected' : ''}>Imediato</option>
              <option value="scheduled" ${trig === 'scheduled' ? 'selected' : ''}>Agendado</option>
              <option value="event"     ${trig === 'event'     ? 'selected' : ''}>Por evento</option>
            </select>
          </div>
          <div class="form-group" id="ec-scheduled-wrap" style="margin:0;display:${trig === 'scheduled' ? '' : 'none'}">
            <label class="form-label">Data/hora do agendamento</label>
            <input id="ec-scheduled" class="form-control" type="datetime-local" value="${_escHtml(_adminEmailToLocalInput(c.scheduled_for))}">
          </div>
          <div class="form-group" id="ec-event-wrap" style="margin:0;display:${trig === 'event' ? '' : 'none'}">
            <label class="form-label">Chave do evento</label>
            <input id="ec-event" class="form-control" value="${_escHtml(c.event_key || '')}" placeholder="ex: user_signup">
          </div>
          <div id="ec-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button id="ec-draft" class="btn btn-ghost" onclick="_adminEmailSaveCampaign('${id}', false)">${icon('save',14)} Salvar rascunho</button>
          <button id="ec-send" class="btn btn-primary" onclick="_adminEmailSaveCampaign('${id}', true)">${icon('send',14)} Enviar / Agendar</button>
        </div>
      </div>
    </div>`);
}

function _adminEmailCampaignTrigger(value) {
  const sw = document.getElementById('ec-scheduled-wrap');
  const ev = document.getElementById('ec-event-wrap');
  if (sw) sw.style.display = value === 'scheduled' ? '' : 'none';
  if (ev) ev.style.display = value === 'event' ? '' : 'none';
}

function _adminEmailToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function _adminEmailSaveCampaign(id, alsoSend) {
  const errEl = document.getElementById('ec-error');
  errEl.style.display = 'none';
  const name       = document.getElementById('ec-name').value.trim();
  const templateId = document.getElementById('ec-template').value;
  const subject    = document.getElementById('ec-subject').value;
  const html       = document.getElementById('ec-html').value;
  const listId     = document.getElementById('ec-list').value;
  const trigger    = document.getElementById('ec-trigger').value;

  const fail = msg => { errEl.textContent = msg; errEl.style.display = ''; };
  if (!name)   return fail('Nome é obrigatório.');
  if (!listId) return fail('Selecione uma lista de destino.');
  if (!templateId && !subject.trim()) return fail('Informe um template ou um assunto manual.');

  const payload = { name, template_id: templateId, subject, html, list_id: listId, trigger_type: trigger };
  if (trigger === 'scheduled') {
    const dt = document.getElementById('ec-scheduled').value;
    if (!dt) return fail('Informe a data/hora do agendamento.');
    payload.scheduled_for = new Date(dt).toISOString();
  }
  if (trigger === 'event') {
    const ev = document.getElementById('ec-event').value.trim();
    if (!ev) return fail('Informe a chave do evento.');
    payload.event_key = ev;
  }
  if (id) payload.id = id;

  const btnDraft = document.getElementById('ec-draft');
  const btnSend  = document.getElementById('ec-send');
  btnDraft.disabled = true; btnSend.disabled = true;
  try {
    const saved = await _api('POST', '/email/campaign', payload);
    const cid = saved.id || id;
    if (alsoSend) {
      const includeDisabled = confirm('Incluir também usuários que DESABILITARAM o recebimento de e-mails? Clique OK para forçar o envio a eles, ou Cancelar para respeitar a preferência.');
      const r = await _api('POST', '/email/send', { campaign_id: cid, include_disabled: includeDisabled });
      let msg = `${r.total || 0} e-mail(s) enfileirados.`;
      if (!includeDisabled && r.skipped_disabled) msg += ` ${r.skipped_disabled} ignorado(s) por notificações desabilitadas.`;
      toast(msg, 'success');
    } else {
      toast('Rascunho salvo!', 'success');
    }
    closeModal();
    await _adminEmailRenderSub();
  } catch (e) {
    fail(e.message || 'Erro ao salvar.');
    btnDraft.disabled = false; btnSend.disabled = false;
  }
}

async function _adminEmailSendCampaign(id) {
  if (!confirm('Enfileirar o envio desta campanha para todos os destinatários da lista?')) return;
  const includeDisabled = confirm('Incluir também usuários que DESABILITARAM o recebimento de e-mails? Clique OK para forçar o envio a eles, ou Cancelar para respeitar a preferência.');
  try {
    const r = await _api('POST', '/email/send', { campaign_id: id, include_disabled: includeDisabled });
    let msg = `${r.total || 0} e-mail(s) enfileirados.`;
    if (!includeDisabled && r.skipped_disabled) msg += ` ${r.skipped_disabled} ignorado(s) por notificações desabilitadas.`;
    toast(msg, 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao enviar'), 'error');
  }
}

async function _adminEmailDeleteCampaign(id) {
  if (!confirm('Excluir esta campanha? Esta ação não pode ser desfeita.')) return;
  try {
    await _api('DELETE', '/email/campaign?id=' + encodeURIComponent(id));
    toast('Campanha excluída.', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao excluir'), 'error');
  }
}

// ── E) Notificações padrão do sistema ─────────────────────────────────────────

async function _adminEmailNotifications(body) {
  const [types, templates] = await Promise.all([
    _api('GET', '/email/notification-types'),
    _api('GET', '/email/templates'),
  ]);
  _adminEmailData.notifTypes = types;
  _adminEmailData.templates  = templates;

  const rows = types.length ? types.map(n => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:.9rem">${_escHtml(n.name)}</span>
          <span style="font-size:.72rem;color:var(--text-muted);font-family:monospace">${_escHtml(n.key)}</span>
          ${_adminEmailIsSystem(n.default_on) ? `<span style="font-size:.68rem;font-weight:700;padding:1px 6px;border-radius:20px;background:var(--primary-light,#DDE7D8);color:var(--primary-600)">PADRÃO ON</span>` : ''}
          ${_adminEmailIsSystem(n.active) ? '' : `<span style="font-size:.68rem;font-weight:700;padding:1px 6px;border-radius:20px;background:var(--border);color:var(--text-muted)">INATIVA</span>`}
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">${_escHtml(n.description || 'Sem descrição')}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm" onclick="_adminEmailEditNotif('${n.id}')" style="font-size:.75rem;padding:4px 10px">${icon('pencil',12)} Editar</button>
        <button class="btn btn-sm" onclick="_adminEmailDeleteNotif('${n.id}')" style="font-size:.75rem;padding:4px 10px;color:var(--expense)">${icon('trash-2',12)}</button>
      </div>
    </div>`).join('') : '<p style="color:var(--text-muted);font-size:.85rem;padding:12px 0">Nenhuma notificação definida ainda.</p>';

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:12px">
        <div class="card-title">${icon('bell',14)} Notificações padrão</div>
        <button class="btn btn-primary btn-sm" onclick="_adminEmailEditNotif('')" style="font-size:.8rem">${icon('plus',14)} Nova</button>
      </div>
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">Defina os tipos de notificação; cada usuário liga/desliga em suas Configurações.</div>
      ${rows}
    </div>`;
}

function _adminEmailEditNotif(id) {
  const isNew = !id;
  const n = isNew
    ? { key: '', name: '', description: '', template_key: '', default_on: 1, active: 1 }
    : (_adminEmailData.notifTypes.find(x => x.id === id) || {});
  const sysTemplates = (_adminEmailData.templates || []).filter(t => _adminEmailIsSystem(t.is_system) && t.system_key);
  const tplOpts = sysTemplates.map(t => `<option value="${_escHtml(t.system_key)}" ${n.template_key === t.system_key ? 'selected' : ''}>${_escHtml(t.name)} (${_escHtml(t.system_key)})</option>`).join('');
  const defaultOn = _adminEmailIsSystem(n.default_on);
  const active    = n.active === undefined ? true : _adminEmailIsSystem(n.active);

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:480px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('bell',16)} ${isNew ? 'Nova notificação' : 'Editar notificação'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Chave (key) *</label>
            <input id="en-key" class="form-control" value="${_escHtml(n.key || '')}" placeholder="ex: plan_expiry" ${isNew ? '' : 'readonly'} style="font-family:monospace">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome *</label>
            <input id="en-name" class="form-control" value="${_escHtml(n.name || '')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Descrição</label>
            <input id="en-desc" class="form-control" value="${_escHtml(n.description || '')}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Template do sistema</label>
            <select id="en-template" class="form-control">
              <option value="">— Nenhum —</option>
              ${tplOpts}
            </select>
          </div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="en-default" ${defaultOn ? 'checked' : ''} style="width:16px;height:16px">
            <span style="font-size:.87rem">Ligada por padrão (default on)</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="en-active" ${active ? 'checked' : ''} style="width:16px;height:16px">
            <span style="font-size:.87rem">Ativa (visível para usuários)</span>
          </label>
          <div id="en-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button id="en-submit" class="btn btn-primary" onclick="_adminEmailSaveNotif('${id}')">${icon('save',14)} Salvar</button>
        </div>
      </div>
    </div>`);
}

async function _adminEmailSaveNotif(id) {
  const errEl = document.getElementById('en-error');
  const btn   = document.getElementById('en-submit');
  errEl.style.display = 'none';
  const key  = document.getElementById('en-key').value.trim();
  const name = document.getElementById('en-name').value.trim();
  if (!key)  { errEl.textContent = 'Chave é obrigatória.'; errEl.style.display = ''; return; }
  if (!name) { errEl.textContent = 'Nome é obrigatório.';  errEl.style.display = ''; return; }

  const payload = {
    key,
    name,
    description:  document.getElementById('en-desc').value.trim(),
    template_key: document.getElementById('en-template').value,
    default_on:  document.getElementById('en-default').checked,
    active:      document.getElementById('en-active').checked,
  };
  if (id) payload.id = id;

  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    await _api('POST', '/email/notification-type', payload);
    closeModal();
    toast('Notificação salva!', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    errEl.textContent = e.message || 'Erro ao salvar.'; errEl.style.display = '';
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function _adminEmailDeleteNotif(id) {
  const n = _adminEmailData.notifTypes.find(x => x.id === id);
  if (!n) return;
  if (!confirm(`Excluir a notificação "${n.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await _api('DELETE', '/email/notification-type?id=' + encodeURIComponent(id));
    toast('Notificação excluída.', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao excluir'), 'error');
  }
}

// ── E2) Regras de notificação automática ──────────────────────────────────────

const _RULE_CONDITIONS = {
  inactive_days:        'Dias sem acessar o sistema',
  no_transactions_days: 'Dias sem registrar lançamentos',
};

async function _adminEmailRules(body) {
  const [rules, templates] = await Promise.all([
    _api('GET', '/email/notification-rules'),
    _api('GET', '/email/templates'),
  ]);
  _adminEmailData.rules     = rules;
  _adminEmailData.templates = templates;

  const chip = (label, on) => `<span style="font-size:.68rem;font-weight:700;padding:1px 7px;border-radius:20px;background:${on ? 'var(--primary-light,#DDE7D8)' : 'var(--border)'};color:${on ? 'var(--primary-600)' : 'var(--text-muted)'}">${label}</span>`;

  const rows = rules.length ? rules.map(r => {
    const isEmail = _adminEmailIsSystem(r.channel_email);
    const isWa    = _adminEmailIsSystem(r.channel_whatsapp);
    const cond    = _RULE_CONDITIONS[r.condition_type] || r.condition_type;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-weight:600;font-size:.9rem">${_escHtml(r.name)}</span>
          ${_adminEmailIsSystem(r.active) ? '' : chip('INATIVA', false)}
        </div>
        <div style="font-size:.8rem;color:var(--text-muted)">
          Quando: <strong>${Number(r.threshold_days)}</strong> ${_escHtml(cond.toLowerCase())} · reenvio a cada ${Number(r.cooldown_days)} dias
        </div>
        <div style="display:flex;gap:5px;margin-top:6px">
          ${chip('E-mail', isEmail)}${chip('WhatsApp', isWa)}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm" onclick="_adminEmailEditRule('${r.id}')" style="font-size:.75rem;padding:4px 10px">${icon('pencil',12)} Editar</button>
        <button class="btn btn-sm" onclick="_adminEmailDeleteRule('${r.id}')" style="font-size:.75rem;padding:4px 10px;color:var(--expense)">${icon('trash-2',12)}</button>
      </div>
    </div>`;
  }).join('') : '<p style="color:var(--text-muted);font-size:.85rem;padding:12px 0">Nenhuma regra criada ainda. Crie uma regra para enviar notificações automáticas com base no comportamento do usuário.</p>';

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:12px">
        <div class="card-title">${icon('zap',14)} Regras de notificação automática</div>
        <button class="btn btn-primary btn-sm" onclick="_adminEmailEditRule('')" style="font-size:.8rem">${icon('plus',14)} Nova regra</button>
      </div>
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">
        Dispare e-mail e/ou WhatsApp automaticamente quando um usuário atender a um critério — por exemplo, 10 dias sem acessar ou 3 dias sem registrar lançamentos. As regras são avaliadas periodicamente pelo sistema.
      </div>
      ${rows}
    </div>`;
}

function _adminEmailEditRule(id) {
  const isNew = !id;
  const r = isNew
    ? { name: '', active: 1, condition_type: 'inactive_days', threshold_days: 10, channel_email: 1, channel_whatsapp: 0, email_template_id: '', whatsapp_text: '', cooldown_days: 30 }
    : (_adminEmailData.rules.find(x => x.id === id) || {});

  const templates = _adminEmailData.templates || [];
  const tplOpts = templates.map(t =>
    `<option value="${t.id}" ${r.email_template_id === t.id ? 'selected' : ''}>${_escHtml(t.name)}${_adminEmailIsSystem(t.is_system) ? ' (sistema)' : ''}</option>`
  ).join('');

  const condOpts = Object.entries(_RULE_CONDITIONS).map(([k, label]) =>
    `<option value="${k}" ${r.condition_type === k ? 'selected' : ''}>${_escHtml(label)}</option>`
  ).join('');

  const isEmail  = _adminEmailIsSystem(r.channel_email);
  const isWa     = _adminEmailIsSystem(r.channel_whatsapp);
  const isActive = r.active === undefined ? true : _adminEmailIsSystem(r.active);

  showModal(`
    <div class="modal-backdrop">
      <div class="modal" style="max-width:560px;width:calc(100% - 32px);max-height:92vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title">${icon('zap',16)} ${isNew ? 'Nova regra' : 'Editar regra'}</div>
          <button class="btn btn-icon btn-ghost" onclick="closeModal()">${icon('x',16)}</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
          <div class="form-group" style="margin:0">
            <label class="form-label">Nome da regra *</label>
            <input id="er-name" class="form-control" value="${_escHtml(r.name || '')}" placeholder="ex: Reengajamento — 10 dias inativo">
          </div>

          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase">Critério</div>
          <div style="display:grid;grid-template-columns:1fr 110px;gap:10px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Condição</label>
              <select id="er-condition" class="form-control">${condOpts}</select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Dias</label>
              <input id="er-threshold" class="form-control" type="number" min="1" value="${Number(r.threshold_days) || 10}">
            </div>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Reenviar no máximo a cada (dias)</label>
            <input id="er-cooldown" class="form-control" type="number" min="1" value="${Number(r.cooldown_days) || 30}">
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Evita reenviar a mesma notificação ao usuário antes deste intervalo.</div>
          </div>

          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);letter-spacing:.06em;text-transform:uppercase">Canais e modelos</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="er-ch-email" ${isEmail ? 'checked' : ''} onchange="_adminEmailRuleToggleChannels()" style="width:16px;height:16px">
            <span style="font-size:.87rem;font-weight:600">Notificar por e-mail</span>
          </label>
          <div id="er-email-box" class="form-group" style="margin:0;display:${isEmail ? 'block' : 'none'}">
            <label class="form-label">Modelo de e-mail</label>
            <select id="er-email-template" class="form-control">
              <option value="">— Selecione um modelo —</option>
              ${tplOpts}
            </select>
          </div>

          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="er-ch-wa" ${isWa ? 'checked' : ''} onchange="_adminEmailRuleToggleChannels()" style="width:16px;height:16px">
            <span style="font-size:.87rem;font-weight:600">Notificar por WhatsApp</span>
          </label>
          <div id="er-wa-box" class="form-group" style="margin:0;display:${isWa ? 'block' : 'none'}">
            <label class="form-label">Mensagem de WhatsApp</label>
            <textarea id="er-wa-text" class="form-control" rows="4" placeholder="Olá {nome}, sentimos a sua falta! ...">${_escHtml(r.whatsapp_text || '')}</textarea>
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Variáveis: {nome}, {email}, {telefone}, {plano}, {status}. Requer uma instância padrão de WhatsApp conectada.</div>
          </div>

          <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
            <input type="checkbox" id="er-active" ${isActive ? 'checked' : ''} style="width:16px;height:16px">
            <span style="font-size:.87rem">Regra ativa</span>
          </label>
          <div id="er-error" style="color:var(--expense);font-size:.83rem;display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button id="er-submit" class="btn btn-primary" onclick="_adminEmailSaveRule('${id}')">${icon('save',14)} Salvar</button>
        </div>
      </div>
    </div>`);
}

function _adminEmailRuleToggleChannels() {
  const emailBox = document.getElementById('er-email-box');
  const waBox    = document.getElementById('er-wa-box');
  if (emailBox) emailBox.style.display = document.getElementById('er-ch-email')?.checked ? 'block' : 'none';
  if (waBox)    waBox.style.display    = document.getElementById('er-ch-wa')?.checked    ? 'block' : 'none';
}

async function _adminEmailSaveRule(id) {
  const errEl = document.getElementById('er-error');
  const btn   = document.getElementById('er-submit');
  errEl.style.display = 'none';

  const name    = document.getElementById('er-name').value.trim();
  const chEmail = document.getElementById('er-ch-email').checked;
  const chWa    = document.getElementById('er-ch-wa').checked;
  const emailTemplateId = document.getElementById('er-email-template')?.value || '';
  const waText  = document.getElementById('er-wa-text')?.value || '';

  const fail = msg => { errEl.textContent = msg; errEl.style.display = ''; };
  if (!name) return fail('Nome é obrigatório.');
  if (!chEmail && !chWa) return fail('Selecione ao menos um canal.');
  if (chEmail && !emailTemplateId) return fail('Selecione o modelo de e-mail.');
  if (chWa && !waText.trim()) return fail('Escreva a mensagem de WhatsApp.');

  const payload = {
    name,
    active:           document.getElementById('er-active').checked,
    condition_type:   document.getElementById('er-condition').value,
    threshold_days:   parseInt(document.getElementById('er-threshold').value, 10) || 1,
    cooldown_days:    parseInt(document.getElementById('er-cooldown').value, 10) || 30,
    channel_email:    chEmail,
    channel_whatsapp: chWa,
    email_template_id: chEmail ? emailTemplateId : '',
    whatsapp_text:    chWa ? waText : '',
  };
  if (id) payload.id = id;

  const orig = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    await _api('POST', '/email/notification-rule', payload);
    closeModal();
    toast('Regra salva!', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    fail(e.message || 'Erro ao salvar.');
    btn.disabled = false; btn.innerHTML = orig;
  }
}

async function _adminEmailDeleteRule(id) {
  const r = _adminEmailData.rules.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Excluir a regra "${r.name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await _api('DELETE', '/email/notification-rule?id=' + encodeURIComponent(id));
    toast('Regra excluída.', 'success');
    await _adminEmailRenderSub();
  } catch (e) {
    toast('Erro: ' + (e.message || 'falha ao excluir'), 'error');
  }
}

// ── F) Log de envios ──────────────────────────────────────────────────────────

async function _adminEmailLog(body) {
  const logs = await _api('GET', '/email/log?limit=100');
  const statusColor = s => s === 'sent' ? 'var(--income-text)' : 'var(--expense)';
  const rows = logs.length ? logs.map(l => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-size:.78rem;color:var(--text-muted);white-space:nowrap">${_escHtml(l.sent_at || '')}</td>
      <td style="padding:8px 10px;font-size:.82rem">${_escHtml(l.to_email || '')}</td>
      <td style="padding:8px 10px;font-size:.82rem">${_escHtml(l.subject || '')}</td>
      <td style="padding:8px 10px;font-size:.78rem;font-weight:700;color:${statusColor(l.status)}">${_escHtml(l.status || '')}</td>
      <td style="padding:8px 10px;font-size:.78rem;color:var(--expense)">${_escHtml(l.error || '')}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-muted);font-size:.85rem">Nenhum envio registrado ainda.</td></tr>';

  body.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px">
        <div class="card-title">${icon('scroll-text',14)} Log de envios</div>
        <button class="btn btn-ghost btn-sm" onclick="_adminEmailRenderSub()" style="font-size:.8rem">${icon('refresh-cw',14)} Atualizar</button>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid var(--border);text-align:left">
              <th style="padding:8px 10px;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em">Data</th>
              <th style="padding:8px 10px;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em">Destinatário</th>
              <th style="padding:8px 10px;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em">Assunto</th>
              <th style="padding:8px 10px;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em">Status</th>
              <th style="padding:8px 10px;font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em">Erro</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
