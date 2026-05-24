import { getDb, initDb } from '../../lib/db.js';
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

    if (req.method === 'PUT') {
      const { monthly_fee, active, name } = req.body || {};
      const fields = [];
      const values = [];
      if (monthly_fee !== undefined) { fields.push('monthly_fee = ?'); values.push(monthly_fee); }
      if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
      if (name !== undefined) { fields.push('name = ?'); values.push(name); }
      if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo' });
      await db.execute({ sql: `UPDATE user_plans SET ${fields.join(', ')} WHERE id = ?`, args: [...values, id] });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await db.execute({ sql: 'DELETE FROM user_plans WHERE id = ?', args: [id] });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
