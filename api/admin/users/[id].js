import { getDb, initDb, rowsToObjects } from '../../lib/db.js';
import { requireAuth, cors } from '../../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.query;
    const db = getDb();

    if (req.method === 'GET') {
      const { rows: uRows } = await db.execute({ sql: 'SELECT id,email,name,phone,role,is_admin,last_login,created_at FROM users WHERE id=?', args: [id] });
      const userObj = rowsToObjects(uRows)[0];
      if (!userObj) return res.status(404).json({ error: 'Not found' });

      const { rows: planRows } = await db.execute({ sql: 'SELECT * FROM user_plans WHERE user_id=? LIMIT 1', args: [id] });
      const plan = rowsToObjects(planRows)[0] || null;

      const { rows: mRows } = await db.execute({ sql: `SELECT month, year, SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END) as expense FROM transactions WHERE user_id=? GROUP BY year, month ORDER BY year DESC, month DESC LIMIT 12`, args: [id] });

      const { rows: cRows } = await db.execute({ sql: `SELECT c.name, c.icon, c.color, COALESCE(SUM(t.amount),0) as total FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.user_id=? AND t.transaction_type IN ('expense','general','daily','installment') AND c.id IS NOT NULL GROUP BY t.category_id ORDER BY total DESC LIMIT 5`, args: [id] });

      return res.status(200).json({
        user: userObj,
        plan,
        monthly: rowsToObjects(mRows),
        topCategories: rowsToObjects(cRows),
      });
    }

    if (req.method === 'PUT') {
      const { name, email, phone, role, password } = req.body || {};
      const fields = [];
      const values = [];

      if (name !== undefined)  { fields.push('name = ?');  values.push(name); }
      if (phone !== undefined) { fields.push('phone = ?'); values.push(phone ? phone.replace(/\D/g, '') : ''); }
      if (email !== undefined) {
        const emailNorm = email.toLowerCase().trim();
        const { rows: ex } = await db.execute({ sql: 'SELECT id FROM users WHERE email=? AND id!=?', args: [emailNorm, id] });
        if (rowsToObjects(ex).length > 0) return res.status(400).json({ error: 'E-mail já em uso por outro usuário' });
        fields.push('email = ?'); values.push(emailNorm);
      }
      if (role !== undefined) {
        const validRoles = ['user', 'admin', 'super_admin'];
        if (!validRoles.includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
        fields.push('role = ?');     values.push(role);
        fields.push('is_admin = ?'); values.push(role === 'admin' || role === 'super_admin' ? 1 : 0);
      }
      if (password) {
        if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
        const hash = await bcrypt.hash(password, 10);
        fields.push('password_hash = ?'); values.push(hash);
      }
      if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

      await db.execute({ sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`, args: [...values, id] });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      for (const table of ['categories', 'templates', 'transactions', 'installments', 'goals', 'settings', 'user_plans', 'password_resets']) {
        await db.execute({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [id] });
      }
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};
      if (action === 'test-whatsapp') {
        const { rows } = await db.execute({ sql: 'SELECT name, phone FROM users WHERE id = ?', args: [id] });
        const target = rowsToObjects(rows)[0];
        if (!target?.phone) return res.status(400).json({ error: 'Usuário sem número de WhatsApp' });

        const url = process.env.EVOLUTION_URL;
        const key = process.env.EVOLUTION_APIKEY;
        if (!url || !key) return res.status(500).json({ error: 'Evolution API não configurada' });

        const nome = (target.name || '').split(' ')[0] || 'você';
        const msg = `✅ Conexão confirmada, ${nome}! Sua conta Lumers BPO está ativa e integrada ao WhatsApp.`;

        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: key },
          body: JSON.stringify({ number: target.phone, text: msg }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return res.status(502).json({ error: 'Falha ao enviar', detail: data });
        return res.status(200).json({ ok: true, phone: target.phone });
      }
      return res.status(400).json({ error: 'Ação inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
