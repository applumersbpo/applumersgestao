import { getDb, initDb, rowsToObjects } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const db = getDb();

    // ── Plan Templates ─────────────────────────────────────────────────────────
    if (req.query.resource === 'plan-templates') {
      if (req.method === 'GET') {
        const { rows } = await db.execute('SELECT * FROM plan_templates ORDER BY name ASC');
        return res.status(200).json(rowsToObjects(rows));
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── User Plans ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (req.query.user_id) {
        const { rows } = await db.execute({ sql: 'SELECT * FROM user_plans WHERE user_id=? LIMIT 1', args: [req.query.user_id] });
        return res.status(200).json(rowsToObjects(rows)[0] || null);
      }
      const { rows } = await db.execute(`
        SELECT up.*, pt.name as template_name
        FROM user_plans up
        LEFT JOIN plan_templates pt ON pt.id = up.plan_template_id
        ORDER BY up.created_at DESC`);
      return res.status(200).json(rowsToObjects(rows));
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Create plan template
      if (action === 'create-template') {
        const { name, description, monthly_fee, features, active } = req.body;
        if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
        const id = crypto.randomUUID();
        await db.execute({
          sql: 'INSERT INTO plan_templates (id, name, description, monthly_fee, features, active) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id, name, description || '', monthly_fee || 0, JSON.stringify(features || {}), active !== false ? 1 : 0],
        });
        return res.status(201).json({ id });
      }

      // Update plan template
      if (action === 'update-template') {
        const { id, name, description, monthly_fee, features, active } = req.body;
        if (!id) return res.status(400).json({ error: 'ID obrigatório' });
        const fields = [];
        const vals = [];
        if (name !== undefined)        { fields.push('name = ?');        vals.push(name); }
        if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
        if (monthly_fee !== undefined) { fields.push('monthly_fee = ?'); vals.push(monthly_fee); }
        if (features !== undefined)    { fields.push('features = ?');    vals.push(JSON.stringify(features)); }
        if (active !== undefined)      { fields.push('active = ?');      vals.push(active ? 1 : 0); }
        if (!fields.length) return res.status(400).json({ error: 'Nenhum campo' });
        await db.execute({ sql: `UPDATE plan_templates SET ${fields.join(', ')} WHERE id = ?`, args: [...vals, id] });
        return res.status(200).json({ ok: true });
      }

      // Delete plan template
      if (action === 'delete-template') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID obrigatório' });
        // Unlink users from this template
        await db.execute({ sql: "UPDATE user_plans SET plan_template_id='' WHERE plan_template_id=?", args: [id] });
        await db.execute({ sql: 'DELETE FROM plan_templates WHERE id=?', args: [id] });
        return res.status(200).json({ ok: true });
      }

      // Create user plan (legacy)
      const { email, name, monthly_fee, active, user_id } = req.body || {};
      const id = crypto.randomUUID();
      await db.execute({
        sql: 'INSERT INTO user_plans (id, user_id, email, name, monthly_fee, active) VALUES (?, ?, ?, ?, ?, ?)',
        args: [id, user_id || '', email || '', name || '', monthly_fee || 0, active !== false ? 1 : 0],
      });
      return res.status(201).json({ id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
