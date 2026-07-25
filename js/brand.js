// js/brand.js — Lumers Flow — Gerenciador de Identidade Visual

// Bump this version whenever brand defaults change — forces cache bust for all users
const _BRAND_CACHE_KEY = 'lf_brand_cache_v7';

const _BRAND_DEFAULTS = {
  appName:       'Lumers Flow',
  primary:       '#3A5A40',
  primaryDark:   '#243d28',
  primaryLight:  '#DDE7D8',
  income:        '#3A5A40',
  incomeLight:   '#DDE7D8',
  expense:       '#C95A47',
  expenseLight:  '#FAEDE7',
  warning:       '#D4A24C',
  warningLight:  '#FAF1D8',
  bg:            '#FBF9F2',
  surface:       '#FFFFFF',
  border:        '#E8E2D0',
  text:          '#292720',
  textMuted:     '#5D594E',
  sidebarBg:        '#243d28',
  sidebarText:      '#ddd7c0',
  sidebarTextMuted: '#9faa8e',
  sidebarActive:    '#F8F4E4',
  sidebarHoverText: '#F8F4E4',
  sidebarAccent:    '#D4A24C',
  sidebarLogout:    '#F4DCD4',
  logoutBg:         '#243d28',
  logoutHoverBg:    '#C95A47',
  logoutHoverText:  '#FFFFFF',
  topbarBg:         '#FBF9F2',
  topbarText:       '#1E3322',
  bottomNavBg:      '#FBF9F2',
  bottomNavText:    '#807B6C',
  bottomNavActive:  '#3A5A40',
  bottomNavHover:   '#2C4630',
  // Annual reports dashboard colors
  annualCardHeader:   '#3A5A40',
  annualReceiver:     '#DDE7D8',
  annualPayer:        '#FAEDE7',
  annualOverdue:      '#FDDCD4',
  annualSaldoPos:     '#2C4630',
  annualSaldoNeg:     '#C95A47',
  annualSaldoZero:    '#807B6C',
  annualBorder:       '#E8E2D0',
  annualSummaryAccent:'#D4A24C',
  logoData:      'lumers-flow-logotipo.png',
  faviconData:   'favicon-lumers-flow.png',
  // Login screen customization
  loginLayout:       'centered',
  loginPanelBg:      '#3A5A40',
  loginFormBg:       '#f8fff5',
  loginPanelBgImage: '',
  loginBrandEyebrow: '',
  loginBrandHeading: '',
  loginBrandDesc:    '',
  loginHeroTagline:  '',
  loginTitle:        '',
  loginSubtitle:     '',
  loginPill1:        '',
  loginPill2:        '',
  loginPill3:        '',
  loginCopyright:    '',
  loginScreenBg:   '#d9d9d9',
  loginBtnFrom:    '#178f8f',
  loginBtnTo:      '#64d953',
  loginPanelFrom:  '#84c859',
  loginPanelDark:  '#07130f',
};

let _brand = { ..._BRAND_DEFAULTS };

// Aplica cache (cores + modelo da tela de login) imediatamente ao carregar,
// sem esperar a rede — evita que o modelo salvo apareça com atraso.
(function _applyCachedEarly() {
  try {
    // Remove old cache keys to prevent stale theme from overriding new CSS
    localStorage.removeItem('lf_brand_cache');
    localStorage.removeItem('lf_brand_cache_v2');
    localStorage.removeItem('lf_brand_cache_v3');
    localStorage.removeItem('lf_brand_cache_v4');
    localStorage.removeItem('lf_brand_cache_v5');
    localStorage.removeItem('lf_brand_cache_v6');
    const cached = localStorage.getItem(_BRAND_CACHE_KEY);
    if (cached) {
      const cfg = _normalizeBrand(JSON.parse(cached));
      _applyCssVars(cfg);
      _applyLoginConfig(cfg);
    }
  } catch (_) {}
})();

// Reaplica o modelo da tela de login a partir do cache (idempotente:
// só seta textContent/estilos em nós existentes, nunca cria/duplica).
// Usado após montar/reconstruir o DOM do #auth-screen para não ser sobrescrito.
function applyLoginModelFromCache() {
  try {
    const cached = localStorage.getItem(_BRAND_CACHE_KEY);
    if (cached) _applyLoginConfig(_normalizeBrand(JSON.parse(cached)));
  } catch (_) {}
}

// ── Utilitários de cor ────────────────────────────────────────────────────────

function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function _rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function _darken(hex, pct = 0.15) {
  const { r, g, b } = _hexToRgb(hex);
  return _rgbToHex(r*(1-pct), g*(1-pct), b*(1-pct));
}
function _lighten(hex, pct = 0.85) {
  const { r, g, b } = _hexToRgb(hex);
  return _rgbToHex(r+(255-r)*pct, g+(255-g)*pct, b+(255-b)*pct);
}
function _hexToRgba(hex, alpha) {
  const { r, g, b } = _hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Escape HTML ───────────────────────────────────────────────────────────────

function _escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[c])
  );
}

// ── Normaliza config (compatibilidade com formato antigo) ─────────────────────

function _normalizeBrand(cfg) {
  if (!cfg) return { ..._BRAND_DEFAULTS };
  const n = { ..._BRAND_DEFAULTS };

  // Copia campos novos
  Object.keys(n).forEach(k => {
    if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '') n[k] = cfg[k];
  });

  // Compat: formato antigo
  if (cfg.primaryColor && !cfg.primary) n.primary = cfg.primaryColor;
  if (cfg.logoUrl      && !cfg.logoData)     n.logoData    = cfg.logoUrl;
  if (cfg.faviconUrl   && !cfg.faviconData)  n.faviconData = cfg.faviconUrl;

  // Auto-computa variantes "dark/light" se ainda são os defaults
  if (n.primary !== _BRAND_DEFAULTS.primary) {
    if (n.primaryDark  === _BRAND_DEFAULTS.primaryDark)  n.primaryDark  = _darken(n.primary);
    if (n.primaryLight === _BRAND_DEFAULTS.primaryLight) n.primaryLight = _lighten(n.primary);
  }
  if (n.income  !== _BRAND_DEFAULTS.income  && n.incomeLight  === _BRAND_DEFAULTS.incomeLight)  n.incomeLight  = _lighten(n.income);
  if (n.expense !== _BRAND_DEFAULTS.expense && n.expenseLight === _BRAND_DEFAULTS.expenseLight) n.expenseLight = _lighten(n.expense);
  if (n.warning !== _BRAND_DEFAULTS.warning && n.warningLight === _BRAND_DEFAULTS.warningLight) n.warningLight = _lighten(n.warning);

  return n;
}

// ── Aplica variáveis CSS ──────────────────────────────────────────────────────

function _applyCssVars(cfg) {
  const c = _normalizeBrand(cfg);
  const styleId = 'brand-override-style';
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement('style');
    style.id = styleId;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = `:root {
    --primary:         ${c.primary};
    --primary-dark:    ${c.primaryDark};
    --primary-light:   ${c.primaryLight};
    --primary-600:     ${c.primary};
    --primary-700:     ${c.primaryDark};
    --primary-100:     ${c.primaryLight};
    --income:          ${c.income};
    --income-light:    ${c.incomeLight};
    --income-text:     ${_darken(c.income, 0.1)};
    --expense:         ${c.expense};
    --expense-light:   ${c.expenseLight};
    --expense-text:    ${_darken(c.expense, 0.2)};
    --warning:         ${c.warning};
    --warning-light:   ${c.warningLight};
    --warning-text:    ${_darken(c.warning, 0.3)};
    --bg:              ${c.bg};
    --bg-subtle:       ${_darken(c.bg, 0.03)};
    --surface:         ${c.surface};
    --border:          ${c.border};
    --border-strong:   ${_darken(c.border, 0.1)};
    --text:            ${c.text};
    --text-muted:      ${c.textMuted};
    --text-soft:       ${_lighten(c.textMuted, 0.3)};
    --text-light:      ${_lighten(c.textMuted, 0.55)};
    --sidebar-bg:              ${c.sidebarBg};
    --sidebar-text:            ${c.sidebarText};
    --sidebar-text-muted:      ${c.sidebarTextMuted};
    --sidebar-active:          ${c.sidebarActive};
    --sidebar-hover-text:      ${c.sidebarHoverText};
    --sidebar-accent:          ${c.sidebarAccent};
    --sidebar-logout-color:    ${c.sidebarLogout};
    --sidebar-active-bg:       ${_hexToRgba(c.sidebarActive, 0.16)};
    --sidebar-hover-bg:        ${_hexToRgba(c.sidebarActive, 0.11)};
    --sidebar-hover-indicator: ${_hexToRgba(c.sidebarAccent, 0.45)};
    --sidebar-border:          ${_hexToRgba(c.sidebarActive, 0.10)};
    --sidebar-logout-bg:          ${c.logoutBg};
    --sidebar-logout-hover-bg:    ${c.logoutHoverBg};
    --sidebar-logout-hover-text:  ${c.logoutHoverText};
    --topbar-bg:    ${_hexToRgba(c.topbarBg, 0.94)};
    --topbar-text:  ${c.topbarText};
    --bottom-nav-bg:     ${_hexToRgba(c.bottomNavBg, 0.95)};
    --bottom-nav-text:   ${c.bottomNavText};
    --bottom-nav-active: ${c.bottomNavActive};
    --bottom-nav-hover:  ${c.bottomNavHover};
    --annual-card-header:    ${c.annualCardHeader};
    --annual-receiver:       ${c.annualReceiver};
    --annual-payer:          ${c.annualPayer};
    --annual-overdue:        ${c.annualOverdue};
    --annual-saldo-pos:      ${c.annualSaldoPos};
    --annual-saldo-neg:      ${c.annualSaldoNeg};
    --annual-saldo-zero:     ${c.annualSaldoZero};
    --annual-border:         ${c.annualBorder};
    --annual-summary-accent: ${c.annualSummaryAccent};
    --login-screen-bg:  ${c.loginScreenBg || '#d9d9d9'};
    --login-btn-from:   ${c.loginBtnFrom  || '#178f8f'};
    --login-btn-to:     ${c.loginBtnTo    || '#64d953'};
    --login-panel-from: ${c.loginPanelFrom || '#84c859'};
    --login-panel-dark: ${c.loginPanelDark || '#07130f'};
  }`;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.primary);
}

// ── Aplica brand completa no DOM ──────────────────────────────────────────────

function _applyBrand(cfg) {
  _brand = _normalizeBrand(cfg);
  _applyCssVars(_brand);
  _applyLoginConfig(_brand);

  const name    = _brand.appName || _BRAND_DEFAULTS.appName;
  const hasLogo = !!_brand.logoData;

  document.title = name;

  // Nome do app: visível somente quando não há logotipo
  document.querySelectorAll('.brand-app-name').forEach(el => {
    el.textContent    = name;
    el.style.display  = hasLogo ? 'none' : '';
  });

  // Favicon
  if (_brand.faviconData) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = _brand.faviconData;
  }

  // Logos
  document.querySelectorAll('.brand-logo-container').forEach(container => {
    const isAuth = container.dataset.variant === 'auth';

    if (hasLogo) {
      if (isAuth) {
        // Tela de login: logotipo ocupa todo o bloco de cabeçalho (substitui ícone + nome)
        container.innerHTML = `<img src="${_escHtml(_brand.logoData)}" alt="${_escHtml(name)}"
          style="height:72px;max-width:240px;width:auto;object-fit:contain;display:block">`;
        container.style.cssText = 'margin:0 auto;display:block;width:fit-content';
      } else {
        // Sidebar: logotipo se expande para ocupar todo o espaço disponível (onde ficava ícone + nome)
        container.innerHTML = `<img src="${_escHtml(_brand.logoData)}" alt="${_escHtml(name)}"
          style="height:32px;max-width:192px;width:auto;object-fit:contain;display:block">`;
        container.style.flex = '1';
      }
    } else {
      // Sem logotipo: exibe ícone SVG padrão
      const sz = isAuth ? 44 : 28;
      container.innerHTML = `<svg width="${sz}" height="${sz}" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="8" fill="var(--primary)"/>
        <rect x="7" y="13" width="14" height="2" rx="1" fill="#fff"/>
        <rect x="7" y="9" width="9" height="2" rx="1" fill="rgba(255,255,255,.55)"/>
        <rect x="7" y="17" width="11" height="2" rx="1" fill="rgba(255,255,255,.35)"/>
      </svg>`;
      container.style.flex = '';
      if (isAuth) container.style.cssText = 'margin:0 auto 10px;display:block;width:fit-content';
    }
  });
}

// ── Configuração da tela de login ─────────────────────────────────────────────

function _applyLoginConfig(cfg) {
  const authScreen = document.querySelector('#auth-screen');
  if (!authScreen) return;

  const visualPanel = authScreen.querySelector('.auth-visual');
  const formArea    = authScreen.querySelector('.auth-form-area');

  // Screen background
  if (cfg.loginScreenBg && /^#[0-9a-fA-F]{6}$/.test(cfg.loginScreenBg)) {
    authScreen.style.background = cfg.loginScreenBg;
  } else {
    authScreen.style.background = '';
  }

  // Visual panel background
  const bgImg      = cfg.loginPanelBgImage || '';
  const panelColor = (cfg.loginPanelBg && /^#[0-9a-fA-F]{6}$/.test(cfg.loginPanelBg)) ? cfg.loginPanelBg : '';

  if (visualPanel) {
    if (panelColor && bgImg) {
      visualPanel.style.background         = panelColor;
      visualPanel.style.backgroundImage    = `url(${bgImg})`;
      visualPanel.style.backgroundSize     = 'cover';
      visualPanel.style.backgroundPosition = 'center';
    } else if (panelColor) {
      visualPanel.style.background         = panelColor;
      visualPanel.style.backgroundImage    = 'none';
      visualPanel.style.backgroundSize     = '';
      visualPanel.style.backgroundPosition = '';
    } else if (bgImg) {
      visualPanel.style.background         = '';
      visualPanel.style.backgroundImage    = [
        `url(${bgImg})`,
        'radial-gradient(circle at 72% 68%, rgba(212,162,76,.6) 0%, transparent 38%)',
        'radial-gradient(circle at 18% 28%, rgba(22,93,98,.45) 0%, transparent 35%)',
        'linear-gradient(155deg, #132018 0%, #1c2a20 45%, #3A5A40 100%)',
      ].join(',');
      visualPanel.style.backgroundSize     = 'cover, auto, auto, auto';
      visualPanel.style.backgroundPosition = 'center, 72% 68%, 18% 28%, center';
    } else {
      visualPanel.style.background         = '';
      visualPanel.style.backgroundImage    = '';
      visualPanel.style.backgroundSize     = '';
      visualPanel.style.backgroundPosition = '';
    }
  }

  // Form area background color
  if (formArea) {
    if (cfg.loginFormBg && /^#[0-9a-fA-F]{6}$/.test(cfg.loginFormBg)) {
      formArea.style.background = cfg.loginFormBg;
    } else {
      formArea.style.background = '';
    }
  }

  // Textos do painel visual
  const eyebrow = authScreen.querySelector('.auth-brand-eyebrow');
  if (eyebrow && cfg.loginBrandEyebrow) eyebrow.textContent = cfg.loginBrandEyebrow;

  const heading = authScreen.querySelector('.auth-brand-heading');
  if (heading && cfg.loginBrandHeading) heading.textContent = cfg.loginBrandHeading;

  const desc = authScreen.querySelector('.auth-brand-desc');
  if (desc && cfg.loginBrandDesc) desc.textContent = cfg.loginBrandDesc;

  const titleEl = document.getElementById('auth-title');
  if (titleEl && cfg.loginTitle &&
      (titleEl.textContent === 'Entrar' || titleEl.textContent === 'Bem-vindo de volta')) {
    titleEl.textContent = cfg.loginTitle;
  }

  const subtitleEl = authScreen.querySelector('.auth-form-subtitle');
  if (subtitleEl && cfg.loginSubtitle) subtitleEl.textContent = cfg.loginSubtitle;

  const pillEls = authScreen.querySelectorAll('.auth-pill-text');
  const pills = [cfg.loginPill1, cfg.loginPill2, cfg.loginPill3];
  pillEls.forEach((el, i) => { if (pills[i]) el.textContent = pills[i]; });

  const copyright = document.getElementById('auth-brand-copyright');
  if (copyright && cfg.loginCopyright) copyright.textContent = cfg.loginCopyright;
}

// ── API pública ───────────────────────────────────────────────────────────────

async function loadBrand() {
  try {
    const cached = localStorage.getItem(_BRAND_CACHE_KEY);
    if (cached) _applyBrand(JSON.parse(cached));
  } catch (_) {}
  try {
    const res = await fetch('/api/brand');
    if (!res.ok) return;
    const cfg = await res.json();
    _applyBrand(cfg);
    localStorage.setItem(_BRAND_CACHE_KEY, JSON.stringify(cfg));
  } catch (_) {}
}

async function saveBrand(cfg) {
  await _api('POST', '/brand', cfg);
  _applyBrand(cfg);
  localStorage.setItem(_BRAND_CACHE_KEY, JSON.stringify(cfg));
}

function getBrand()         { return { ..._brand }; }
function getBrandDefaults() { return { ..._BRAND_DEFAULTS }; }

// ── Icon Picker ───────────────────────────────────────────────────────────────
const _ICON_SETS = {
  finance: {
    label: 'Finanças',
    icons: ['📈','📉','💹','💰','💵','💴','💶','💷','💎','🏦','💳','🪙','💸','🤑','📊','📋','🧾','🔑','⭐','🌟','💫','🎯','🏆','🥇','🥈','🥉'],
  },
  assets: {
    label: 'Bens',
    icons: ['🏠','🏡','🏢','🏗️','🏭','🏬','🏪','🚗','🚙','🚕','🏍️','✈️','🛥️','⛵','🚁','🛢️','💻','🖥️','📱','📺','📡','🔌','⚡','🔋'],
  },
  nature: {
    label: 'Outros',
    icons: ['🌾','🌿','🌊','☀️','🌙','⚙️','🔧','🔨','⚒️','🛠️','🔩','⛏️','🎨','🎪','🎭','🎬','🎵','🏋️','🌏','🌐','🗺️','🧩','🔮','💡'],
  },
};

function showIconPicker(currentIcon, onSelect) {
  const el = document.createElement('div');
  el.id = 'icon-picker-overlay';
  el.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.45);
  `;

  const tabs = Object.entries(_ICON_SETS).map(([k, s]) =>
    `<button class="icon-picker-tab" data-tab="${k}" style="
      padding:6px 12px;border:none;background:none;cursor:pointer;
      font-size:.8rem;font-weight:600;color:var(--text-muted);
      border-bottom:2px solid transparent;transition:.15s;
    ">${s.label}</button>`
  ).join('');

  el.innerHTML = `
    <div style="
      background:var(--surface);border-radius:16px;
      box-shadow:0 16px 48px rgba(0,0,0,.2);
      width:calc(100vw - 32px);max-width:360px;
      display:flex;flex-direction:column;overflow:hidden;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 0">
        <div style="font-weight:700;font-size:.92rem;color:var(--text)">Escolher Ícone</div>
        <button id="icon-picker-close" style="
          background:none;border:none;cursor:pointer;padding:4px;
          color:var(--text-muted);font-size:1.1rem;line-height:1;
        ">✕</button>
      </div>
      <div style="display:flex;gap:4px;padding:8px 16px 0;border-bottom:1px solid var(--border)">
        ${tabs}
      </div>
      <div id="icon-picker-grid" style="
        display:grid;grid-template-columns:repeat(8,1fr);gap:4px;
        padding:12px 14px;max-height:240px;overflow-y:auto;
      "></div>
      <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px">
        <span style="font-size:.78rem;color:var(--text-muted)">Ou digite:</span>
        <input id="icon-picker-custom" class="form-control" style="flex:1;height:34px;font-size:1rem;text-align:center"
          maxlength="4" placeholder="✍️" value="${currentIcon || ''}">
        <button id="icon-picker-confirm" class="btn btn-primary btn-sm">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(el);

  function renderTab(tabKey) {
    const grid = el.querySelector('#icon-picker-grid');
    const icons = _ICON_SETS[tabKey]?.icons || [];
    grid.innerHTML = icons.map(ico => `
      <button class="icon-picker-btn" data-ico="${ico}" style="
        background:none;border:1px solid transparent;border-radius:8px;
        padding:6px;font-size:1.4rem;cursor:pointer;text-align:center;
        transition:.12s;line-height:1;
        ${ico === currentIcon ? 'background:var(--primary-100);border-color:var(--primary-400)' : ''}
      " title="${ico}">${ico}</button>
    `).join('');

    el.querySelectorAll('.icon-picker-tab').forEach(t => {
      const active = t.dataset.tab === tabKey;
      t.style.color      = active ? 'var(--primary-600)' : 'var(--text-muted)';
      t.style.borderBottomColor = active ? 'var(--primary-600)' : 'transparent';
    });
  }

  renderTab('finance');

  el.querySelectorAll('.icon-picker-tab').forEach(t => {
    t.addEventListener('click', () => renderTab(t.dataset.tab));
  });

  el.querySelector('#icon-picker-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-ico]');
    if (!btn) return;
    onSelect(btn.dataset.ico);
    el.remove();
  });

  el.querySelector('#icon-picker-close').addEventListener('click', () => el.remove());
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });

  el.querySelector('#icon-picker-confirm').addEventListener('click', () => {
    const val = el.querySelector('#icon-picker-custom').value.trim();
    if (val) onSelect(val);
    el.remove();
  });
}
