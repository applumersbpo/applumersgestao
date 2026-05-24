import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const user = await requireAuth(req);
    const { name, phone } = req.body || {};
    const db = getDb();

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo' });

    await db.execute({ sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`, args: [...values, user.sub] });
    // Also update user_plans name
    if (name) await db.execute({ sql: 'UPDATE user_plans SET name = ? WHERE user_id = ?', args: [name, user.sub] });

    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.sub] });
    const updated = rowsToObjects(rows)[0];
    const { password_hash: _, ...safeUser } = updated;
    return res.status(200).json({ user: safeUser });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
