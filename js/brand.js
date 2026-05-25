// js/brand.js — Lumers Flow — Gerenciador de Identidade Visual

// Bump this version whenever brand defaults change — forces cache bust for all users
const _BRAND_CACHE_KEY = 'lf_brand_cache_v2';

const _BRAND_DEFAULTS = {
  appName:       'Lumers Flow',
  primary:       '#3A5A40',
  primaryDark:   '#2C4630',
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
  sidebarBg:     '#2C4630',
  sidebarText:   '#E6E0CC',
  sidebarActive: '#F8F4E4',
  logoData:      'lumers-flow-logotipo.png',
  faviconData:   'favicon-lumers-flow.png',
};

let _brand = { ..._BRAND_DEFAULTS };

// Aplica cache de cor imediatamente ao carregar (evita flash)
(function _applyCachedEarly() {
  try {
    // Remove old cache key to prevent stale blue theme from overriding new CSS
    localStorage.removeItem('lf_brand_cache');
    const cached = localStorage.getItem(_BRAND_CACHE_KEY);
    if (cached) _applyCssVars(JSON.parse(cached));
  } catch (_) {}
})();

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
    --sidebar-bg:          ${c.sidebarBg};
    --sidebar-text:        ${c.sidebarText};
    --sidebar-text-muted:  #B6BFA4;
    --sidebar-active:      ${c.sidebarActive};
    --sidebar-active-bg:   rgba(248,244,228,.14);
    --sidebar-hover-bg:    rgba(248,244,228,.08);
    --sidebar-border:      rgba(248,244,228,.1);
    --sidebar-accent:      ${c.warning};
  }`;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.primary);
}

// ── Aplica brand completa no DOM ──────────────────────────────────────────────

function _applyBrand(cfg) {
  _brand = _normalizeBrand(cfg);
  _applyCssVars(_brand);

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
