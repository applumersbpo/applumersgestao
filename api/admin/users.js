import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const db = getDb();

    if (req.method === 'GET') {
      const { rows } = await db.execute('SELECT id, email, name, phone, is_admin, created_at FROM users ORDER BY created_at DESC');
      return res.status(200).json(rowsToObjects(rows));
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
