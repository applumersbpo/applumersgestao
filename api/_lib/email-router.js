import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting } from './db.js';
import { requireAuth, cors } from './auth.js';
import * as email from './email.js';
import crypto from 'crypto';

const DEFAULT_FROM = 'Lumers Flow <no-reply@app.lumersbpo.com.br>';

// Actions acessíveis por qualquer usuário autenticado. Todo o resto exige admin.
const USER_ACTIONS = new Set(['my-notifications']);

export default async function emailRouter(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const { action } = req.query;
    const db = getDb();

    const payload = await requireAuth(req);
    const isAdmin = payload.is_admin || ['admin', 'super_admin'].includes(payload.role);

    // Guard admin: rotas admin exigem isAdmin.
    if (!USER_ACTIONS.has(action) && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ───────────────────────── CONFIG ─────────────────────────
    if (action === 'config') {
      if (req.method === 'GET') {
        const enabled = (await getSystemSetting('email_enabled')) === '1';
        const from = (await getSystemSetting('email_from')) || DEFAULT_FROM;
        const key = await getSystemSetting('resend_api_key');
        return res.status(200).json({ enabled, from, hasKey: !!key });
      }
      if (req.method === 'POST') {
        const { enabled, from, apiKey } = req.body || {};
        await setSystemSetting('email_enabled', enabled ? '1' : '0');
        await setSystemSetting('email_from', from || DEFAULT_FROM);
        // Só grava a chave se vier não-vazia — nunca apaga chave existente com string vazia.
        if (typeof apiKey === 'string' && apiKey.trim() !== '') {
          await setSystemSetting('resend_api_key', apiKey.trim());
        }
        return res.status(200).json({ ok: true });
      }
    }

    // ───────────────────────── TEMPLATES ─────────────────────────
    if (action === 'templates' && req.method === 'GET') {
      const { rows } = await db.execute(
        'SELECT * FROM email_templates ORDER BY is_system DESC, name ASC'
      );
      return res.status(200).json(rowsToObjects(rows));
    }

    if (action === 'template') {
      if (req.method === 'POST') {
        const { id, name, subject, html, text, category } = req.body || {};
        if (id) {
          const { rows } = await db.execute({ sql: 'SELECT * FROM email_templates WHERE id = ?', args: [id] });
          const existing = rowsToObjects(rows)[0];
          if (!existing) return res.status(404).json({ error: 'Template não encontrado' });
          const isSystem = existing.is_system === 1 || existing.is_system === '1';
          if (isSystem) {
            // Sistema: só subject/html/text editáveis; name/category/system_key travados.
            await db.execute({
              sql: "UPDATE email_templates SET subject = ?, html = ?, text = ?, updated_at = datetime('now') WHERE id = ?",
              args: [subject ?? existing.subject, html ?? existing.html, text ?? existing.text, id],
            });
          } else {
            await db.execute({
              sql: "UPDATE email_templates SET name = ?, subject = ?, html = ?, text = ?, category = ?, updated_at = datetime('now') WHERE id = ?",
              args: [name ?? existing.name, subject ?? existing.subject, html ?? existing.html, text ?? existing.text, category ?? existing.category, id],
            });
          }
          return res.status(200).json({ ok: true, id });
        }
        // Novo template do usuário — is_system=0.
        const newId = crypto.randomUUID();
        await db.execute({
          sql: "INSERT INTO email_templates (id, name, subject, html, text, category, is_system, system_key, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, datetime('now'))",
          args: [newId, name || '', subject || '', html || '', text || '', category || 'geral', payload.sub || ''],
        });
        return res.status(201).json({ ok: true, id: newId });
      }
      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id é obrigatório' });
        const { rows } = await db.execute({ sql: 'SELECT is_system FROM email_templates WHERE id = ?', args: [id] });
        const existing = rowsToObjects(rows)[0];
        if (!existing) return res.status(404).json({ error: 'Template não encontrado' });
        if (existing.is_system === 1 || existing.is_system === '1') {
          return res.status(400).json({ error: 'Templates de sistema não podem ser removidos' });
        }
        await db.execute({ sql: 'DELETE FROM email_templates WHERE id = ?', args: [id] });
        return res.status(200).json({ ok: true });
      }
    }

    // ───────────────────────── LISTS ─────────────────────────
    if (action === 'lists' && req.method === 'GET') {
      const { rows } = await db.execute(
        `SELECT l.*, (SELECT COUNT(*) FROM email_list_members m WHERE m.list_id = l.id) AS member_count
         FROM email_lists l ORDER BY l.created_at DESC`
      );
      return res.status(200).json(rowsToObjects(rows));
    }

    if (action === 'list') {
      if (req.method === 'POST') {
        const { id, name, description, dynamic_filter } = req.body || {};
        if (id) {
          const { rows } = await db.execute({ sql: 'SELECT id FROM email_lists WHERE id = ?', args: [id] });
          if (!rowsToObjects(rows)[0]) return res.status(404).json({ error: 'Lista não encontrada' });
          await db.execute({
            sql: 'UPDATE email_lists SET name = ?, description = ?, dynamic_filter = ? WHERE id = ?',
            args: [name || '', description || '', dynamic_filter || '', id],
          });
          return res.status(200).json({ ok: true, id });
        }
        const newId = crypto.randomUUID();
        await db.execute({
          sql: 'INSERT INTO email_lists (id, name, description, dynamic_filter, created_by) VALUES (?, ?, ?, ?, ?)',
          args: [newId, name || '', description || '', dynamic_filter || '', payload.sub || ''],
        });
        return res.status(201).json({ ok: true, id: newId });
      }
      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id é obrigatório' });
        await db.execute({ sql: 'DELETE FROM email_list_members WHERE list_id = ?', args: [id] });
        await db.execute({ sql: 'DELETE FROM email_lists WHERE id = ?', args: [id] });
        return res.status(200).json({ ok: true });
      }
    }

    // ───────────────────────── LIST MEMBERS ─────────────────────────
    if (action === 'list-members') {
      if (req.method === 'GET') {
        const { list_id } = req.query;
        if (!list_id) return res.status(400).json({ error: 'list_id é obrigatório' });
        const { rows } = await db.execute({
          sql: 'SELECT * FROM email_list_members WHERE list_id = ? ORDER BY created_at DESC',
          args: [list_id],
        });
        return res.status(200).json(rowsToObjects(rows));
      }
      if (req.method === 'POST') {
        const body = req.body || {};
        const { list_id, source } = body;
        if (!list_id) return res.status(400).json({ error: 'list_id é obrigatório' });

        // Emails já existentes na lista (dedup).
        const { rows: exRows } = await db.execute({
          sql: 'SELECT email FROM email_list_members WHERE list_id = ?',
          args: [list_id],
        });
        const seen = new Set(rowsToObjects(exRows).map(r => (r.email || '').toLowerCase()));

        let incoming = [];
        if (source === 'all_users') {
          const { rows: uRows } = await db.execute('SELECT id, email, name FROM users');
          incoming = rowsToObjects(uRows).map(u => ({ email: u.email, name: u.name, user_id: u.id }));
        } else {
          incoming = Array.isArray(body.members) ? body.members : [];
        }

        let inserted = 0;
        for (const m of incoming) {
          const em = (m.email || '').trim();
          if (!em) continue;
          const emLower = em.toLowerCase();
          if (seen.has(emLower)) continue;
          seen.add(emLower);
          await db.execute({
            sql: 'INSERT INTO email_list_members (id, list_id, user_id, email, name) VALUES (?, ?, ?, ?, ?)',
            args: [crypto.randomUUID(), list_id, m.user_id || '', em, m.name || ''],
          });
          inserted++;
        }
        return res.status(200).json({ ok: true, inserted });
      }
    }

    if (action === 'list-member' && req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id é obrigatório' });
      await db.execute({ sql: 'DELETE FROM email_list_members WHERE id = ?', args: [id] });
      return res.status(200).json({ ok: true });
    }

    // ───────────────────────── CAMPAIGNS ─────────────────────────
    if (action === 'campaigns' && req.method === 'GET') {
      const { rows } = await db.execute('SELECT * FROM email_campaigns ORDER BY created_at DESC');
      return res.status(200).json(rowsToObjects(rows));
    }

    if (action === 'campaign') {
      if (req.method === 'POST') {
        const b = req.body || {};
        let subject = b.subject || '';
        let html = b.html || '';
        // Herda subject/html do template quando vazios.
        if (b.template_id && (!subject || !html)) {
          const { rows } = await db.execute({ sql: 'SELECT subject, html FROM email_templates WHERE id = ?', args: [b.template_id] });
          const tpl = rowsToObjects(rows)[0];
          if (tpl) {
            if (!subject) subject = tpl.subject || '';
            if (!html) html = tpl.html || '';
          }
        }
        const trigger = b.trigger_type || 'immediate';
        if (b.id) {
          const { rows } = await db.execute({ sql: 'SELECT id FROM email_campaigns WHERE id = ?', args: [b.id] });
          if (!rowsToObjects(rows)[0]) return res.status(404).json({ error: 'Campanha não encontrada' });
          await db.execute({
            sql: `UPDATE email_campaigns SET name = ?, template_id = ?, subject = ?, html = ?, list_id = ?,
                    trigger_type = ?, scheduled_for = ?, event_key = ? WHERE id = ?`,
            args: [b.name || '', b.template_id || '', subject, html, b.list_id || '', trigger, b.scheduled_for || '', b.event_key || '', b.id],
          });
          return res.status(200).json({ ok: true, id: b.id });
        }
        const newId = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO email_campaigns (id, name, template_id, subject, html, list_id, trigger_type, scheduled_for, event_key, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
          args: [newId, b.name || '', b.template_id || '', subject, html, b.list_id || '', trigger, b.scheduled_for || '', b.event_key || '', payload.sub || ''],
        });
        return res.status(201).json({ ok: true, id: newId });
      }
      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id é obrigatório' });
        await db.execute({ sql: 'DELETE FROM email_campaigns WHERE id = ?', args: [id] });
        return res.status(200).json({ ok: true });
      }
    }

    // ───────────────────────── SEND (materializa a fila) ─────────────────────────
    if (action === 'send' && req.method === 'POST') {
      const b = req.body || {};
      let campaignId = b.campaign_id || null;
      let name, templateId, subject, html, listId, trigger, scheduledFor;

      if (campaignId) {
        const { rows } = await db.execute({ sql: 'SELECT * FROM email_campaigns WHERE id = ?', args: [campaignId] });
        const c = rowsToObjects(rows)[0];
        if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
        name = c.name;
        templateId = c.template_id || '';
        subject = c.subject || '';
        html = c.html || '';
        listId = c.list_id || '';
        trigger = c.trigger_type || 'immediate';
        scheduledFor = c.scheduled_for || '';
      } else {
        name = b.name || 'Envio';
        templateId = b.template_id || '';
        subject = b.subject || '';
        html = b.html || '';
        listId = b.list_id || '';
        trigger = b.trigger_type || 'immediate';
        scheduledFor = b.scheduled_for || '';
      }

      // 1. Resolve subject/html base (mantém placeholders — o cron re-renderiza por destinatário).
      if (templateId && (!subject || !html)) {
        const { rows } = await db.execute({ sql: 'SELECT subject, html FROM email_templates WHERE id = ?', args: [templateId] });
        const tpl = rowsToObjects(rows)[0];
        if (tpl) {
          if (!subject) subject = tpl.subject || '';
          if (!html) html = tpl.html || '';
        }
      }

      if (!listId) return res.status(400).json({ error: 'list_id é obrigatório' });

      // 2. Coleta destinatários da lista (ou todos os users se dynamic_filter='all_users').
      const { rows: listRows } = await db.execute({ sql: 'SELECT dynamic_filter FROM email_lists WHERE id = ?', args: [listId] });
      const listRow = rowsToObjects(listRows)[0];
      let recipients = [];
      if (listRow && listRow.dynamic_filter === 'all_users') {
        const { rows: uRows } = await db.execute('SELECT id, email, name FROM users');
        recipients = rowsToObjects(uRows).map(u => ({ user_id: u.id, email: u.email, name: u.name }));
      } else {
        const { rows: mRows } = await db.execute({
          sql: 'SELECT user_id, email, name FROM email_list_members WHERE list_id = ?',
          args: [listId],
        });
        recipients = rowsToObjects(mRows).map(m => ({ user_id: m.user_id || '', email: m.email, name: m.name }));
      }

      const isScheduled = trigger === 'scheduled';
      const nowIso = new Date().toISOString();
      const dispatchWhen = isScheduled && scheduledFor ? scheduledFor : nowIso;

      // 3. Cria a campanha se for envio ad-hoc.
      if (!campaignId) {
        campaignId = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO email_campaigns (id, name, template_id, subject, html, list_id, trigger_type, scheduled_for, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [campaignId, name, templateId, subject, html, listId, trigger, scheduledFor, isScheduled ? 'queued' : 'running', payload.sub || ''],
        });
      }

      // 4. Materializa a fila: um email_dispatch por destinatário (envio real fica a cargo do cron).
      let total = 0;
      for (const r of recipients) {
        const em = (r.email || '').trim();
        if (!em) continue;
        await db.execute({
          sql: `INSERT INTO email_dispatch (id, campaign_id, user_id, to_email, to_name, subject, html, status, attempts, scheduled_for)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
          args: [crypto.randomUUID(), campaignId, r.user_id || '', em, r.name || '', subject, html, dispatchWhen],
        });
        total++;
      }

      // 5. Atualiza a campanha com o total e o status.
      await db.execute({
        sql: 'UPDATE email_campaigns SET total = ?, status = ? WHERE id = ?',
        args: [total, isScheduled ? 'queued' : 'running', campaignId],
      });

      // 6. Retorna — o envio real é feito pelo cron.
      return res.status(200).json({ ok: true, campaign_id: campaignId, total });
    }

    // ───────────────────────── TEST SEND (envio imediato) ─────────────────────────
    if (action === 'test-send' && req.method === 'POST') {
      const b = req.body || {};
      const { to, system_key } = b;
      if (!to) return res.status(400).json({ error: 'to é obrigatório' });

      if (system_key) {
        const result = await email.sendTemplateEmail({
          to, toName: b.to_name || '', systemKey: system_key, vars: b.vars || {},
        });
        return res.status(200).json(result);
      }

      let subject = b.subject || '';
      let html = b.html || '';
      if (b.template_id && (!subject || !html)) {
        const { rows } = await db.execute({ sql: 'SELECT subject, html, text FROM email_templates WHERE id = ?', args: [b.template_id] });
        const tpl = rowsToObjects(rows)[0];
        if (tpl) {
          if (!subject) subject = tpl.subject || '';
          if (!html) html = tpl.html || '';
        }
      }
      const result = await email.sendEmail({
        to, toName: b.to_name || '', subject: subject || 'Teste — Lumers Flow', html: html || '<p>Teste de envio.</p>',
      });
      return res.status(200).json(result);
    }

    // ───────────────────────── NOTIFICATION TYPES ─────────────────────────
    if (action === 'notification-types' && req.method === 'GET') {
      const { rows } = await db.execute('SELECT * FROM notification_types ORDER BY name ASC');
      return res.status(200).json(rowsToObjects(rows));
    }

    if (action === 'notification-type') {
      if (req.method === 'POST') {
        const b = req.body || {};
        const defaultOn = b.default_on ? 1 : 0;
        const active = b.active === undefined ? 1 : (b.active ? 1 : 0);
        if (b.id) {
          const { rows } = await db.execute({ sql: 'SELECT id FROM notification_types WHERE id = ?', args: [b.id] });
          if (!rowsToObjects(rows)[0]) return res.status(404).json({ error: 'Tipo de notificação não encontrado' });
          await db.execute({
            sql: 'UPDATE notification_types SET key = ?, name = ?, description = ?, template_key = ?, default_on = ?, active = ? WHERE id = ?',
            args: [b.key || '', b.name || '', b.description || '', b.template_key || '', defaultOn, active, b.id],
          });
          return res.status(200).json({ ok: true, id: b.id });
        }
        const newId = crypto.randomUUID();
        await db.execute({
          sql: 'INSERT INTO notification_types (id, key, name, description, template_key, default_on, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [newId, b.key || '', b.name || '', b.description || '', b.template_key || '', defaultOn, active],
        });
        return res.status(201).json({ ok: true, id: newId });
      }
      if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'id é obrigatório' });
        await db.execute({ sql: 'DELETE FROM notification_types WHERE id = ?', args: [id] });
        return res.status(200).json({ ok: true });
      }
    }

    // ───────────────────────── LOG ─────────────────────────
    if (action === 'log' && req.method === 'GET') {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10)));
      const { rows } = await db.execute({
        sql: 'SELECT * FROM email_log ORDER BY sent_at DESC LIMIT ?',
        args: [limit],
      });
      return res.status(200).json(rowsToObjects(rows));
    }

    // ───────────────────────── USER: MY NOTIFICATIONS ─────────────────────────
    if (action === 'my-notifications') {
      if (req.method === 'GET') {
        const { rows } = await db.execute({
          sql: `SELECT nt.key, nt.name, nt.description, nt.default_on, p.enabled AS pref_enabled
                FROM notification_types nt
                LEFT JOIN user_notification_prefs p ON p.notif_key = nt.key AND p.user_id = ?
                WHERE nt.active = 1
                ORDER BY nt.name ASC`,
          args: [payload.sub],
        });
        const list = rowsToObjects(rows).map(r => {
          const hasPref = r.pref_enabled !== null && r.pref_enabled !== undefined;
          const enabled = hasPref
            ? (r.pref_enabled === 1 || r.pref_enabled === '1')
            : (r.default_on === 1 || r.default_on === '1');
          return { key: r.key, name: r.name, description: r.description, enabled };
        });
        return res.status(200).json(list);
      }
      if (req.method === 'POST') {
        const prefs = (req.body && req.body.prefs) || {};
        for (const [key, val] of Object.entries(prefs)) {
          await db.execute({
            sql: `INSERT INTO user_notification_prefs (id, user_id, notif_key, enabled, updated_at)
                  VALUES (?, ?, ?, ?, datetime('now'))
                  ON CONFLICT(user_id, notif_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
            args: [crypto.randomUUID(), payload.sub, key, val ? 1 : 0],
          });
        }
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(404).json({ error: 'Action not found' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('[api/email]', err && (err.stack || err.message));
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
