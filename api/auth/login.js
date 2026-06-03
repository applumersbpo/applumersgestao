import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { signToken, cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

    const db = getDb();
    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
    const users = rowsToObjects(rows);

    if (users.length === 0) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

    const role = user.role || (user.is_admin ? 'admin' : 'user');
    const token = await signToken({ sub: user.id, email: user.email, is_admin: !!user.is_admin, role });
    await db.execute({ sql: "UPDATE users SET last_login = ? WHERE id = ?", args: [new Date().toISOString(), user.id] });
    const { password_hash: _, ...safeUser } = user;
    return res.status(200).json({ token, user: safeUser });
  } catch (err) {
    console.error('LOGIN ERROR', err);
    // Generic error for production
    return res.status(500).json({ error: 'Erro interno' });
  }
}
