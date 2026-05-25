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
  primary:       '#2563EB',
  primaryDark:   '#1d4ed8',
  primaryLight:  '#dbeafe',
  income:        '#10b981',
  incomeLight:   '#d1fae5',
  expense:       '#ef4444',
  expenseLight:  '#fee2e2',
  warning:       '#f59e0b',
  warningLight:  '#fef3c7',
  bg:            '#F8FAFC',
  surface:       '#ffffff',
  border:        '#e2e8f0',
  text:          '#0f172a',
  textMuted:     '#64748b',
  sidebarBg:     '#0F172A',
  sidebarText:   '#94a3b8',
  sidebarActive: '#ffffff',
  logoData:      'lumers-flow-logotipo.png',
  faviconData:   'favicon-lumers-flow.png',
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
        'text', 'textMuted', 'sidebarBg', 'sidebarText', 'sidebarActive'];

      const cfg = {};
      for (const f of textFields) {
        cfg[f] = typeof body[f] === 'string' ? body[f].slice(0, 200) : (DEFAULTS[f] || '');
      }

      // logoData e faviconData podem ser base64 ou URLs
      cfg.logoData    = typeof body.logoData    === 'string' ? body.logoData.slice(0, 4_000_000)    : '';
      cfg.faviconData = typeof body.faviconData === 'string' ? body.faviconData.slice(0, 4_000_000) : '';

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
