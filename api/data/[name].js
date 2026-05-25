import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';

const ALLOWED = ['categories', 'templates', 'transactions', 'settings', 'installments', 'goals', 'accounts', 'banks'];

const FIELDS = {
  categories:   ['name', 'type', 'color', 'icon'],
  templates:    ['name', 'category_id', 'transaction_type', 'kind', 'amount', 'due_day', 'active'],
  transactions: ['template_id', 'name', 'category_id', 'account_id', 'transaction_type', 'kind', 'amount', 'due_date', 'paid_date', 'cash_date', 'competence_date', 'status', 'month', 'year', 'notes'],
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
    const { name } = req.query;
    if (!ALLOWED.includes(name)) return res.status(404).json({ error: 'Collection not found' });

    const user = await requireAuth(req);
    const db = getDb();

    if (req.method === 'GET') {
      if (name === 'banks') {
        // return published banks plus banks created by this user
        const { rows } = await db.execute({
          sql: `SELECT * FROM banks WHERE published = 1 OR user_id = ? ORDER BY created_at DESC`,
          args: [user.sub]
        });
        return res.status(200).json((rows || []).map(r => r || {}));
      }

      const { rows } = await db.execute({
        sql: `SELECT * FROM ${name} WHERE user_id = ? ORDER BY created_at DESC`,
        args: [user.sub]
      });
      return res.status(200).json((rows || []).map(r => r || {}));
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const allowed = FIELDS[name] || [];
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();
      const fields = allowed.filter(f => body[f] !== undefined);
      const values = fields.map(f => body[f] ?? null);

      if (fields.length === 0 && name !== 'settings') {
        return res.status(400).json({ error: 'Nenhum campo válido fornecido' });
      }

      await db.execute({
        sql: `INSERT INTO ${name} (id, user_id, ${fields.join(', ')}, created_at) VALUES (?, ?, ${fields.map(() => '?').join(', ')}, ?)`,
        args: [id, user.sub, ...values, now]
      });
      return res.status(201).json({ id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
