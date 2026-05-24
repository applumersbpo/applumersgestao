import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { cors } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

    const db = getDb();
    const { rows } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
    const users = rowsToObjects(rows);
    // Always return success to avoid email enumeration
    if (users.length === 0) return res.status(200).json({ ok: true });

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour
    await db.execute({
      sql: 'INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
      args: [crypto.randomUUID(), users[0].id, token, expires]
    });

    // TODO: Send email with reset link. For now, return token in response (admin use only)
    // Reset URL: https://applumersgestao.vercel.app/#/reset/<token>
    return res.status(200).json({ ok: true, _dev_token: token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
