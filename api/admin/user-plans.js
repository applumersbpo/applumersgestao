import { getDb, initDb, rowsToObjects } from '../_lib/db.js';
import { requireAuth, cors, isImpersonation } from '../_lib/auth.js';
import { sendTemplateEmail } from '../_lib/email.js';

const APP_URL = process.env.APP_URL || 'https://app.lumersbpo.com.br';

// Vencimento mensal do plano = mesmo dia do mês de created_at (regra do cron,
// BLOCK B do dispatcher). Devolve o próximo vencimento >= hoje (UTC), com o dia
// limitado ao tamanho do mês (31 em fevereiro → 28/29).
function nextDue(createdAt) {
  const raw = String(createdAt || '');
  const created = new Date(/[TZ]/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
  if (isNaN(created.getTime())) return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const D = created.getUTCDate();
  const build = (y, m) => new Date(Date.UTC(y, m, Math.min(D, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
  let due = build(today.getUTCFullYear(), today.getUTCMonth());
  if (due < today) due = build(today.getUTCFullYear(), today.getUTCMonth() + 1);
  return due;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const fmtBR = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    // Um token de impersonação nunca acessa área admin.
    if (isImpersonation(user)) return res.status(403).json({ error: 'Forbidden' });
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

    // ── Cobranças: um item por plano ativo, com vencimento, data prevista de
    // envio (3 dias antes, igual ao cron) e se o lembrete deste ciclo já saiu.
    if (req.query.resource === 'charges') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { rows } = await db.execute(`
        SELECT up.id, up.user_id, up.email AS plan_email, up.name AS plan_name, up.monthly_fee, up.created_at, up.active,
               pt.name AS template_name, pt.monthly_fee AS template_fee,
               u.name AS user_name, u.email AS user_email, u.phone AS user_phone
        FROM user_plans up
        LEFT JOIN plan_templates pt ON pt.id = up.plan_template_id
        LEFT JOIN users u ON u.id = up.user_id
        WHERE up.active = 1
        ORDER BY up.created_at ASC`);
      const plans = rowsToObjects(rows);
      // Último lembrete de vencimento por e-mail (um SELECT para todos).
      const { rows: logRows } = await db.execute(`
        SELECT to_email, status, sent_at, error FROM email_log
        WHERE template_key = 'plan_expiry' ORDER BY sent_at ASC`);
      const lastByEmail = {};
      for (const l of rowsToObjects(logRows)) lastByEmail[String(l.to_email).toLowerCase()] = l;

      const charges = plans.map((p) => {
        const due = nextDue(p.created_at);
        const sendAt = due ? new Date(due.getTime() - 3 * 86400000) : null;
        const email = String(p.user_email || p.plan_email || '').toLowerCase();
        const last = lastByEmail[email] || null;
        // Enviado neste ciclo = registro 'sent' nos 10 dias antes do vencimento (mesma janela do cron).
        const cycleStart = due ? new Date(due.getTime() - 10 * 86400000).toISOString() : '';
        const sentThisCycle = !!(last && last.status === 'sent' && due && String(last.sent_at).replace(' ', 'T') >= cycleStart);
        return {
          id: p.id, user_id: p.user_id || '', customer: p.user_name || p.plan_name || p.plan_email || '—',
          email, phone: p.user_phone || '',
          service: p.template_name || p.plan_name || 'Plano',
          amount: Number(p.monthly_fee) || Number(p.template_fee) || 0,
          due_date: due ? ymd(due) : '', send_date: sendAt ? ymd(sendAt) : '',
          status: sentThisCycle ? 'sent' : (last && last.status === 'failed' && String(last.sent_at).replace(' ', 'T') >= cycleStart ? 'failed' : 'pending'),
          last_sent_at: last ? last.sent_at : '', last_status: last ? last.status : '', last_error: last ? last.error : '',
        };
      });
      return res.status(200).json(charges);
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

      // Disparo manual da cobrança (mesmo e-mail plan_expiry do cron). `force`
      // ignora o opt-out de notificações porque é uma ação explícita do admin.
      if (action === 'send-charge') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID obrigatório' });
        const { rows } = await db.execute({
          sql: `SELECT up.*, pt.name AS template_name, u.name AS user_name, u.email AS user_email
                FROM user_plans up LEFT JOIN plan_templates pt ON pt.id = up.plan_template_id
                LEFT JOIN users u ON u.id = up.user_id WHERE up.id = ? LIMIT 1`, args: [id] });
        const p = rowsToObjects(rows)[0];
        if (!p) return res.status(404).json({ error: 'Plano não encontrado' });
        const to = p.user_email || p.email;
        if (!to) return res.status(400).json({ error: 'Cliente sem e-mail cadastrado' });
        const due = nextDue(p.created_at);
        const r = await sendTemplateEmail({
          to, toName: p.user_name || p.name || '', systemKey: 'plan_expiry', force: true,
          vars: { name: String(p.user_name || p.name || '').split(' ')[0], plan_name: p.template_name || p.name || '', expiry_date: due ? fmtBR(due) : '', app_url: APP_URL },
        });
        if (!r.ok) return res.status(502).json({ error: r.error || 'Falha no envio' });
        return res.status(200).json({ ok: true });
      }

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
