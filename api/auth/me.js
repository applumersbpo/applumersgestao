import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const payload = await requireAuth(req);
    const db = getDb();
    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [payload.sub] });
    const users = rowsToObjects(rows);
    if (users.length === 0) return res.status(401).json({ error: 'Unauthorized' });
    const { password_hash: _, ...user } = users[0];
    return res.status(200).json({ user });
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
