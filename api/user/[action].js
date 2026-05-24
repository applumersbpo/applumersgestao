import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    const { action } = req.query;
    const db = getDb();

    // GET /api/user/profile
    if (action === 'profile' && req.method === 'PUT') {
      const { name, phone } = req.body || {};
      const fields = [];
      const values = [];
      if (name !== undefined)  { fields.push('name = ?');  values.push(name); }
      if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
      if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo' });
      await db.execute({ sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`, args: [...values, user.sub] });
      if (name) await db.execute({ sql: 'UPDATE user_plans SET name = ? WHERE user_id = ?', args: [name, user.sub] });
      const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.sub] });
      const updated = rowsToObjects(rows)[0];
      const { password_hash: _, ...safeUser } = updated;
      return res.status(200).json({ user: safeUser });
    }

    // POST /api/user/password
    if (action === 'password' && req.method === 'POST') {
      const { oldPassword, password, passwordConfirm } = req.body || {};
      if (!oldPassword || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
      if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
      if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem' });
      const { rows } = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.sub] });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(404).json({ error: 'Usuário não encontrado' });
      const valid = await bcrypt.compare(oldPassword, users[0].password_hash);
      if (!valid) return res.status(400).json({ error: 'Senha atual incorreta', data: { oldPassword: { message: 'Senha atual incorreta' } } });
      const hash = await bcrypt.hash(password, 10);
      await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, user.sub] });
      return res.status(200).json({ ok: true });
    }

    // DELETE /api/user/delete
    if (action === 'delete' && req.method === 'DELETE') {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: 'Senha obrigatória' });
      const { rows } = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.sub] });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(404).json({ error: 'Usuário não encontrado' });
      const valid = await bcrypt.compare(password, users[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Senha incorreta' });
      for (const table of ['categories', 'templates', 'transactions', 'installments', 'goals', 'settings', 'user_plans', 'password_resets']) {
        await db.execute({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [user.sub] });
      }
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.sub] });
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Action not found' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
