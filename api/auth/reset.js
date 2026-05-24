import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const { token, password, passwordConfirm } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Dados inválidos' });
    if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem' });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });

    const db = getDb();
    const now = new Date().toISOString();
    const { rows } = await db.execute({
      sql: 'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?',
      args: [token, now]
    });
    const resets = rowsToObjects(rows);
    if (resets.length === 0) return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo.' });

    const hash = await bcrypt.hash(password, 10);
    await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, resets[0].user_id] });
    await db.execute({ sql: 'UPDATE password_resets SET used = 1 WHERE id = ?', args: [resets[0].id] });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
