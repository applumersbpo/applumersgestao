import { getDb, initDb } from './lib/db.js';
import { requireAuth, cors } from './lib/auth.js';

// Aumenta o limite para comportar logos em base64 (~2MB imagem → ~2.7MB base64)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

const DEFAULTS = {
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
  annualCardHeader:    '#3A5A40',
  annualReceiver:      '#DDE7D8',
  annualPayer:         '#FAEDE7',
  annualOverdue:       '#FDDCD4',
  annualSaldoPos:      '#2C4630',
  annualSaldoNeg:      '#C95A47',
  annualSaldoZero:     '#807B6C',
  annualBorder:        '#E8E2D0',
  annualSummaryAccent: '#D4A24C',
  logoData:      'lumers-flow-logotipo.png',
  faviconData:   'favicon-lumers-flow.png',
  // Login screen customization
  loginLayout:       'split',
  loginPanelBg:      '',
  loginFormBg:       '',
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
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  await initDb();
  const db = getDb();

  // GET — público, sem autenticação
  if (req.method === 'GET') {
    try {
      const { rows } = await db.execute({
        sql: "SELECT value FROM settings WHERE user_id = '__brand__' AND key = 'brand_config'",
        args: [],
      });
      if (rows.length === 0) return res.json(DEFAULTS);
      return res.json(JSON.parse(rows[0].value));
    } catch (_) {
      return res.json(DEFAULTS);
    }
  }

  // POST — somente admin
  if (req.method === 'POST') {
    try {
      const user = await requireAuth(req);
      if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

      const body = req.body || {};

      // Sanitiza campos de texto simples
      const textFields = ['appName', 'primary', 'primaryDark', 'primaryLight',
        'income', 'incomeLight', 'expense', 'expenseLight',
        'warning', 'warningLight', 'bg', 'surface', 'border',
        'text', 'textMuted', 'sidebarBg', 'sidebarText', 'sidebarTextMuted',
        'sidebarActive', 'sidebarHoverText', 'sidebarAccent', 'sidebarLogout',
        'logoutBg', 'logoutHoverBg', 'logoutHoverText',
        'topbarBg', 'topbarText',
        'bottomNavBg', 'bottomNavText', 'bottomNavActive', 'bottomNavHover',
        'annualCardHeader', 'annualReceiver', 'annualPayer', 'annualOverdue',
        'annualSaldoPos', 'annualSaldoNeg', 'annualSaldoZero',
        'annualBorder', 'annualSummaryAccent',
        // Login screen
        'loginLayout', 'loginPanelBg', 'loginFormBg',
        'loginBrandEyebrow', 'loginBrandHeading', 'loginBrandDesc',
        'loginHeroTagline', 'loginTitle', 'loginSubtitle',
        'loginPill1', 'loginPill2', 'loginPill3', 'loginCopyright'];

      const cfg = {};
      for (const f of textFields) {
        cfg[f] = typeof body[f] === 'string' ? body[f].slice(0, 200) : (DEFAULTS[f] || '');
      }

      // Campos de mídia: podem ser base64 ou URLs
      cfg.logoData          = typeof body.logoData          === 'string' ? body.logoData.slice(0, 4_000_000)          : '';
      cfg.faviconData       = typeof body.faviconData       === 'string' ? body.faviconData.slice(0, 4_000_000)       : '';
      cfg.loginPanelBgImage = typeof body.loginPanelBgImage === 'string' ? body.loginPanelBgImage.slice(0, 4_000_000) : '';

      const value = JSON.stringify(cfg);

      await db.execute({
        sql: `INSERT OR REPLACE INTO settings (id, user_id, key, value, created_at)
              VALUES ('brand-config', '__brand__', 'brand_config', ?, datetime('now'))`,
        args: [value],
      });

      return res.json({ ok: true });
    } catch (e) {
      if (e.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
