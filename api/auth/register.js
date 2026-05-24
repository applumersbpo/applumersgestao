import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const { email, password, passwordConfirm, name, phone } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Preencha todos os campos', fields: {} });
    if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem', fields: {} });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres', fields: {} });

    const db = getDb();
    const { rows: existing } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
    if (rowsToObjects(existing).length > 0) {
      return res.status(400).json({ error: 'failed to create', fields: { email: 'E-mail já cadastrado' } });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, email.toLowerCase().trim(), hash, name || '', phone || '', now]
    });
    await db.execute({
      sql: 'INSERT INTO user_plans (id, user_id, email, name, monthly_fee, active) VALUES (?, ?, ?, ?, 0, 1)',
      args: [crypto.randomUUID(), id, email.toLowerCase().trim(), name || '']
    });

    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    const user = rowsToObjects(rows)[0];
    const { password_hash: _, ...safeUser } = user;
    return res.status(201).json({ user: safeUser });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar conta' });
  }
}
