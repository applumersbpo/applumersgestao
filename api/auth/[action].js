import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const { action } = req.query;
    const db = getDb();

    // GET /api/auth/me
    if (action === 'me') {
      const payload = await requireAuth(req);
      const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [payload.sub] });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(401).json({ error: 'Unauthorized' });
      const { password_hash: _, ...user } = users[0];
      return res.status(200).json({ user });
    }

    // POST /api/auth/forgot
    if (action === 'forgot' && req.method === 'POST') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
      const { rows } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(200).json({ ok: true });
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 3600000).toISOString();
      await db.execute({
        sql: 'INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
        args: [crypto.randomUUID(), users[0].id, token, expires]
      });
      return res.status(200).json({ ok: true, _dev_token: token });
    }

    // POST /api/auth/reset
    if (action === 'reset' && req.method === 'POST') {
      const { token, password, passwordConfirm } = req.body || {};
      if (!token || !password) return res.status(400).json({ error: 'Dados inválidos' });
      if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem' });
      if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
      const now = new Date().toISOString();
      const { rows } = await db.execute({
        sql: 'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?',
        args: [token, now]
      });
      const resets = rowsToObjects(rows);
      if (!resets.length) return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo.' });
      const hash = await bcrypt.hash(password, 10);
      await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, resets[0].user_id] });
      await db.execute({ sql: 'UPDATE password_resets SET used = 1 WHERE id = ?', args: [resets[0].id] });
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Action not found' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
