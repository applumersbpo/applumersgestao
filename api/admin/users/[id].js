import { getDb, initDb } from '../../lib/db.js';
import { requireAuth, cors } from '../../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.query;
    const db = getDb();

    if (req.method === 'DELETE') {
      // Delete all user data
      for (const table of ['categories', 'templates', 'transactions', 'installments', 'goals', 'settings', 'user_plans', 'password_resets']) {
        await db.execute({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [id] });
      }
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
