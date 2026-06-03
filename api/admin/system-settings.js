import { initDb, getSystemSetting, setSystemSetting } from '../lib/db.js';
import { cors, requireAuth } from '../lib/auth.js';

const ALLOWED_KEYS = ['allow_registration'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

  await initDb();

  if (req.method === 'GET') {
    const result = {};
    for (const key of ALLOWED_KEYS) {
      result[key] = await getSystemSetting(key);
    }
    return res.status(200).json(result);
  }

  if (req.method === 'PUT') {
    const updates = req.body || {};
    for (const key of ALLOWED_KEYS) {
      if (key in updates) {
        await setSystemSetting(key, String(updates[key]));
      }
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
