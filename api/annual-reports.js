import { getDb, initDb } from './lib/db.js';
import { requireAuth, cors } from './lib/auth.js';

const EXPENSE_TYPES = ['expense', 'installment', 'general', 'daily'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireAuth(req);
    await initDb();
    const db = getDb();

    const year     = parseInt(req.query.year) || new Date().getFullYear();
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Fetch all year transactions with category + account names
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
      args: [user.id, year],
    });

    const isIncome  = t => t.transaction_type === 'income';
    const isExpense = t => EXPENSE_TYPES.includes(t.transaction_type);
    const isPending = t => t.status !== 'paid';
    const isOverdue = t => t.due_date && t.due_date < todayStr;
    const sumAmt    = arr => arr.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

    const mapItem = t => ({
      id:             t.id,
      name:           t.name           || '',
      amount:         parseFloat(t.amount) || 0,
      transaction_type: t.transaction_type,
      status:         t.status,
      due_date:       t.due_date  || null,
      paid_date:      t.paid_date || null,
      category_name:  t.category_name  || 'Sem categoria',
      category_color: t.category_color || '#ADA897',
      category_icon:  t.category_icon  || '📦',
      account_name:   t.account_name   || '',
    });

    const months = Array.from({ length: 12 }, (_, i) => {
      const m     = i + 1;
      const mRows = rows.filter(t => Number(t.month) === m);

      // Pending & not yet overdue
      const items_a_receber    = mRows.filter(t => isIncome(t)  && isPending(t) && !isOverdue(t));
      const items_a_pagar      = mRows.filter(t => isExpense(t) && isPending(t) && !isOverdue(t));
      // Pending & overdue
      const items_rec_atrasado = mRows.filter(t => isIncome(t)  && isPending(t) &&  isOverdue(t));
      const items_pag_atrasado = mRows.filter(t => isExpense(t) && isPending(t) &&  isOverdue(t));

      const a_receber    = sumAmt(items_a_receber);
      const a_pagar      = sumAmt(items_a_pagar);
      const rec_atrasado = sumAmt(items_rec_atrasado);
      const pag_atrasado = sumAmt(items_pag_atrasado);

      return {
        month: m,
        year,
        a_receber,
        a_pagar,
        rec_atrasado,
        pag_atrasado,
        saldo_previsto:    a_receber - a_pagar,
        saldo_com_atrasos: (a_receber + rec_atrasado) - (a_pagar + pag_atrasado),
        items_a_receber:    items_a_receber.map(mapItem),
        items_a_pagar:      items_a_pagar.map(mapItem),
        items_rec_atrasado: items_rec_atrasado.map(mapItem),
        items_pag_atrasado: items_pag_atrasado.map(mapItem),
      };
    });

    const annual = {
      a_receber:         months.reduce((s, m) => s + m.a_receber, 0),
      a_pagar:           months.reduce((s, m) => s + m.a_pagar, 0),
      rec_atrasado:      months.reduce((s, m) => s + m.rec_atrasado, 0),
      pag_atrasado:      months.reduce((s, m) => s + m.pag_atrasado, 0),
      saldo_previsto:    months.reduce((s, m) => s + m.saldo_previsto, 0),
      saldo_com_atrasos: months.reduce((s, m) => s + m.saldo_com_atrasos, 0),
    };

    return res.json({ year, months, annual });
  } catch (e) {
    if (e.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: e.message });
  }
}
