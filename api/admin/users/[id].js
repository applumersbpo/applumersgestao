import { getDb, initDb, rowsToObjects } from '../../lib/db.js';
import { requireAuth, cors } from '../../lib/auth.js';

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
      const { rows: uRows } = await db.execute({ sql: 'SELECT id,email,name,phone,last_login,created_at FROM users WHERE id=?', args: [id] });
      const userObj = rowsToObjects(uRows)[0];
      if (!userObj) return res.status(404).json({ error: 'Not found' });

      // Monthly breakdown (last 12 months)
      const { rows: mRows } = await db.execute({ sql: `SELECT month, year, SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END) as expense FROM transactions WHERE user_id=? GROUP BY year, month ORDER BY year DESC, month DESC LIMIT 12`, args: [id] });

      // Top spending categories
      const { rows: cRows } = await db.execute({ sql: `SELECT c.name, c.icon, c.color, COALESCE(SUM(t.amount),0) as total FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.user_id=? AND t.transaction_type IN ('expense','general','daily','installment') AND c.id IS NOT NULL GROUP BY t.category_id ORDER BY total DESC LIMIT 5`, args: [id] });

      return res.status(200).json({
        user: userObj,
        monthly: rowsToObjects(mRows),
        topCategories: rowsToObjects(cRows)
      });
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
