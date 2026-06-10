import { getDb, initDb, rowsToObjects } from '../_lib/db.js';
import { requireAuth, cors } from '../_lib/auth.js';

const ALLOWED = ['categories', 'templates', 'transactions', 'settings', 'installments', 'goals', 'accounts', 'banks', 'annual-reports'];

const EXPENSE_TYPES_AR = ['expense', 'installment', 'general', 'daily'];

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
      if (name === 'annual-reports') {
        const year     = parseInt(req.query.year) || new Date().getFullYear();
        const todayStr = new Date().toISOString().split('T')[0];
        const { rows } = await db.execute({
          sql: `SELECT t.id, t.name, t.amount, t.transaction_type, t.status,
                       t.due_date, t.paid_date, t.month,
                       c.name  AS category_name,
                       c.color AS category_color,
                       c.icon  AS category_icon,
                       a.name  AS account_name
                FROM transactions t
                LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
                LEFT JOIN accounts   a ON a.id = t.account_id  AND a.user_id = t.user_id
                WHERE t.user_id = ? AND t.year = ?
                ORDER BY t.due_date ASC`,
          args: [user.sub, year],
        });
        const isIncome  = t => t.transaction_type === 'income';
        const isExpense = t => EXPENSE_TYPES_AR.includes(t.transaction_type);
        const isPending = t => t.status !== 'paid';
        const isOverdue = t => t.due_date && t.due_date < todayStr;
        const sumAmt    = arr => arr.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
        const mapItem   = t => ({
          id: t.id, name: t.name || '', amount: parseFloat(t.amount) || 0,
          transaction_type: t.transaction_type, status: t.status,
          due_date: t.due_date || null, paid_date: t.paid_date || null,
          category_name: t.category_name || 'Sem categoria',
          category_color: t.category_color || '#ADA897',
          category_icon: t.category_icon || '📦',
          account_name: t.account_name || '',
        });
        const months = Array.from({ length: 12 }, (_, i) => {
          const m = i + 1;
          const mRows = rows.filter(t => Number(t.month) === m);
          const items_a_receber    = mRows.filter(t => isIncome(t)  && isPending(t) && !isOverdue(t));
          const items_a_pagar      = mRows.filter(t => isExpense(t) && isPending(t) && !isOverdue(t));
          const items_rec_atrasado = mRows.filter(t => isIncome(t)  && isPending(t) &&  isOverdue(t));
          const items_pag_atrasado = mRows.filter(t => isExpense(t) && isPending(t) &&  isOverdue(t));
          const a_receber    = sumAmt(items_a_receber);
          const a_pagar      = sumAmt(items_a_pagar);
          const rec_atrasado = sumAmt(items_rec_atrasado);
          const pag_atrasado = sumAmt(items_pag_atrasado);
          return {
            month: m, year, a_receber, a_pagar, rec_atrasado, pag_atrasado,
            saldo_previsto: a_receber - a_pagar,
            saldo_com_atrasos: (a_receber + rec_atrasado) - (a_pagar + pag_atrasado),
            items_a_receber: items_a_receber.map(mapItem),
            items_a_pagar: items_a_pagar.map(mapItem),
            items_rec_atrasado: items_rec_atrasado.map(mapItem),
            items_pag_atrasado: items_pag_atrasado.map(mapItem),
          };
        });
        const annual = {
          a_receber: months.reduce((s, m) => s + m.a_receber, 0),
          a_pagar: months.reduce((s, m) => s + m.a_pagar, 0),
          rec_atrasado: months.reduce((s, m) => s + m.rec_atrasado, 0),
          pag_atrasado: months.reduce((s, m) => s + m.pag_atrasado, 0),
          saldo_previsto: months.reduce((s, m) => s + m.saldo_previsto, 0),
          saldo_com_atrasos: months.reduce((s, m) => s + m.saldo_com_atrasos, 0),
        };
        return res.json({ year, months, annual });
      }

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
