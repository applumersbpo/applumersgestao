import { getDb, initDb, rowsToObjects } from './_lib/db.js';
import { cors } from './_lib/auth.js';

const N8N_SECRET = process.env.N8N_SECRET || 'lumers-n8n-2025';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate secret
  const secret = req.headers['x-n8n-secret'];
  if (secret !== N8N_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await initDb();
    const { op, phone, userId, record } = req.body || {};
    const db = getDb();

    // Buscar usuário pelo número de WhatsApp
    if (op === 'userByPhone') {
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const { rows } = await db.execute({
        sql: 'SELECT id, email, name, phone FROM users WHERE phone = ?',
        args: [phone]
      });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(200).json({ user: null });
      return res.status(200).json({ user: users[0] });
    }

    // Adicionar transação para um usuário
    if (op === 'addTransaction') {
      if (!userId || !record) return res.status(400).json({ error: 'userId and record required' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const {
        name, amount, transaction_type, kind, status,
        due_date, paid_date, month, year, notes, category_id, template_id
      } = record;
      await db.execute({
        sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, month, year, notes, category_id, template_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, userId, name || '', Number(amount) || 0,
          transaction_type || 'expense', kind || 'variable',
          status || 'pending', due_date || '', paid_date || '',
          Number(month) || 0, Number(year) || 0,
          notes || '', category_id || '', template_id || '', now
        ]
      });
      return res.status(201).json({ id, ok: true });
    }

    // Adicionar parcelamento para um usuário
    if (op === 'addInstallment') {
      if (!userId || !record) return res.status(400).json({ error: 'userId and record required' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { name, total_amount, installments, paid_installments, due_day, notes, category_id } = record;
      await db.execute({
        sql: `INSERT INTO installments (id, user_id, name, total_amount, installments, paid_installments, due_day, notes, category_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, userId, name || '', Number(total_amount) || 0,
          Number(installments) || 1, Number(paid_installments) || 0,
          Number(due_day) || 1, notes || '', category_id || '', now
        ]
      });
      return res.status(201).json({ id, ok: true });
    }

    return res.status(400).json({ error: 'op inválido' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
