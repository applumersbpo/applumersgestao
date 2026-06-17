import { getDb, initDb, rowsToObjects } from '../../_lib/db.js';
import { requireAuth, cors } from '../../_lib/auth.js';

const ALLOWED = ['categories', 'templates', 'transactions', 'settings', 'installments', 'goals', 'accounts', 'banks'];

const FIELDS = {
  categories:   ['name', 'type', 'color', 'icon'],
  templates:    ['name', 'category_id', 'transaction_type', 'kind', 'amount', 'due_day', 'active'],
  transactions: ['template_id', 'name', 'category_id', 'account_id', 'transaction_type', 'kind', 'amount', 'paid_amount', 'due_date', 'paid_date', 'cash_date', 'competence_date', 'status', 'month', 'year', 'notes'],
  settings:     ['key', 'value'],
  installments: ['name', 'category_id', 'total_amount', 'installments', 'paid_installments', 'due_day', 'notes'],
  goals:        ['name', 'target_amount', 'current_amount', 'deadline', 'color', 'icon'],
  accounts:     ['bank_id', 'name', 'bank_name', 'type', 'currency', 'initial_balance', 'initial_balance_date', 'notes'],
  banks:        ['code', 'name', 'logo_url', 'published', 'approved_by', 'notes'],
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const { name, id } = req.query;
    if (!ALLOWED.includes(name)) return res.status(404).json({ error: 'Collection not found' });

    const user = await requireAuth(req);
    const db = getDb();

    if (req.method === 'GET') {
      if (name === 'banks') {
        // banks can be fetched if published or owned by user
        const { rows } = await db.execute({
          sql: `SELECT * FROM banks WHERE id = ? AND (published = 1 OR user_id = ?)`,
          args: [id, user.sub]
        });
        const items = rowsToObjects(rows);
        if (items.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(items[0]);
      }

      const { rows } = await db.execute({
        sql: `SELECT * FROM ${name} WHERE id = ? AND user_id = ?`,
        args: [id, user.sub]
      });
      const items = rowsToObjects(rows);
      if (items.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(items[0]);
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const allowed = FIELDS[name] || [];
      const fields = allowed.filter(f => body[f] !== undefined);
      if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo válido' });
      const values = fields.map(f => body[f] ?? null);
      await db.execute({
        sql: `UPDATE ${name} SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
        args: [...values, id, user.sub]
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await db.execute({
        sql: `DELETE FROM ${name} WHERE id = ? AND user_id = ?`,
        args: [id, user.sub]
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
