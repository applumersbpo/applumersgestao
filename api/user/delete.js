import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const user = await requireAuth(req);
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Senha obrigatória' });

    const db = getDb();
    const { rows } = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.sub] });
    const users = rowsToObjects(rows);
    if (users.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    const valid = await bcrypt.compare(password, users[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Senha incorreta' });

    for (const table of ['categories', 'templates', 'transactions', 'installments', 'goals', 'settings', 'user_plans', 'password_resets']) {
      await db.execute({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [user.sub] });
    }
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.sub] });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
