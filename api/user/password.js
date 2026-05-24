import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const user = await requireAuth(req);
    const { oldPassword, password, passwordConfirm } = req.body || {};

    if (!oldPassword || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
    if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem' });

    const db = getDb();
    const { rows } = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.sub] });
    const users = rowsToObjects(rows);
    if (users.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    const valid = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Senha atual incorreta', data: { oldPassword: { message: 'Senha atual incorreta' } } });

    const hash = await bcrypt.hash(password, 10);
    await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, user.sub] });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
