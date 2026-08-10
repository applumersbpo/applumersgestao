import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting, setWaNotifyAsk } from '../_lib/db.js';
import { waNotifyAskText } from '../_lib/assistant.js';
import { requireAuth, cors, isImpersonation, signToken } from '../_lib/auth.js';
import { logSystem } from '../_lib/audit.js';
import {
  evoBase, resolveKey, headers as evoHdrs, normalizeStatus, parseEvoError,
  connectionState, connectQr, deleteInstance, setSettings, setWebhook,
  createInstance, deriveWebhookUrl, sendText,
} from '../_lib/evolution.js';
import { groqChat, geminiGenerate, openaiChat } from '../_lib/ai.js';
import bcrypt from 'bcryptjs';

const SYSTEM_SETTING_KEYS = ['allow_registration', 'evolution_global_key', 'cron_secret', 'n8n_webhook_url', 'n8n_secret', 'ai_enabled', 'ai_groq_key', 'ai_groq_model', 'ai_groq_vision_model', 'ai_gemini_key', 'ai_gemini_model', 'ai_openai_key', 'ai_openai_vision_model', 'ai_openai_audio_model', 'wa_assistant_number', 'wa_signup_enabled', 'ai_rules', 'chatwoot_enabled', 'chatwoot_url', 'chatwoot_token', 'chatwoot_account_id', 'chatwoot_inbox_id'];

// Normaliza um telefone BR para o formato canônico: 55 + DDD(2) + 9 + 8 dígitos (celular).
// Insere o 9º dígito quando ausente (regra padrão: local de 10 dígitos cujo assinante
// começa em 6-9 é celular sem o 9). Retorna '' se não houver telefone; null se inválido.
function canonicalBrazilPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  let local = d;
  if (local.length > 11 && local.startsWith('55')) local = local.slice(2);
  if (local.length < 10 || local.length > 11) return null; // fora do padrão BR
  const ddd = local.slice(0, 2);
  let rest = local.slice(2);
  if (rest.length === 10) rest = rest.slice(-9); // proteção
  if (rest.length === 8 && /^[6-9]/.test(rest)) rest = '9' + rest; // celular sem o 9
  return '55' + ddd + rest;
}

// Global-key headers (create/delete/QR require admin key, not per-instance key)
const _evoGlobalHdrs = async () => {
  const key = await resolveKey(null);
  return evoHdrs(key);
};

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

    // ── Evolution API instance management ─────────────────────────────────────
    if (req.query.resource === 'evolution-instances') {
      const { rows } = await db.execute(
        'SELECT id, name, api_key, is_default, connection_status, created_at FROM evolution_instances ORDER BY is_default DESC, created_at ASC'
      );
      const registered = rowsToObjects(rows);
      const base = evoBase();

      const results = await Promise.all(registered.map(async inst => {
        const isDefault = inst.is_default === 1 || inst.is_default === '1';
        const dbStatus = inst.connection_status || 'unknown';

        if (!base) {
          return { name: inst.name, is_default: isDefault, connectionStatus: dbStatus, number: '' };
        }

        try {
          const { ok, data } = await connectionState({ name: inst.name, key: inst.api_key || null });
          if (!ok) {
            return { name: inst.name, is_default: isDefault, connectionStatus: dbStatus, number: '' };
          }
          const rawState = data?.instance?.state || data?.state || 'disconnected';
          const normalized = normalizeStatus(rawState);
          const number = data?.instance?.profileName || data?.profileName || '';
          // Persist refreshed status to DB
          await db.execute({
            sql: "UPDATE evolution_instances SET connection_status=?, last_status_at=datetime('now') WHERE name=?",
            args: [normalized, inst.name],
          });
          return { name: inst.name, is_default: isDefault, connectionStatus: normalized, number };
        } catch {
          return { name: inst.name, is_default: isDefault, connectionStatus: dbStatus, number: '' };
        }
      }));

      return res.status(200).json(results);
    }

    // Histórico de mensagens enviadas
    if (req.query.resource === 'message-logs') {
      const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
      const offset = (page - 1) * limit;
      const { rows: totalRows } = await db.execute({ sql: 'SELECT COUNT(*) as total FROM message_logs', args: [] });
      const total = rowsToObjects(totalRows)[0]?.total || 0;
      const { rows } = await db.execute({
        sql: `SELECT id, sent_by_name, sent_by_email, instance_name,
                     recipient_name, recipient_phone,
                     message_text, has_media, media_type, media_name,
                     status, error, sent_at
              FROM message_logs
              ORDER BY sent_at DESC
              LIMIT ? OFFSET ?`,
        args: [limit, offset],
      });
      return res.status(200).json({ logs: rowsToObjects(rows), total, page, limit });
    }

    // Interações do assistente de IA via WhatsApp (entradas + respostas)
    // Filtro opcional por usuário: ?user_id= (casa por user_id OU pelo telefone
    // cadastrado do usuário, cobrindo interações antigas sem user_id gravado).
    if (req.query.resource === 'wa-interactions') {
      const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
      const offset = (page - 1) * limit;

      const where = [];
      const filterArgs = [];
      if (req.query.user_id) {
        const uid = String(req.query.user_id);
        const { rows: uRows } = await db.execute({ sql: 'SELECT phone FROM users WHERE id = ?', args: [uid] });
        const uPhone = String(rowsToObjects(uRows)[0]?.phone || '').replace(/\D/g, '');
        if (uPhone) { where.push('(user_id = ? OR phone = ?)'); filterArgs.push(uid, uPhone); }
        else { where.push('user_id = ?'); filterArgs.push(uid); }
      } else if (req.query.phone) {
        const p = String(req.query.phone).replace(/\D/g, '');
        where.push('phone = ?'); filterArgs.push(p);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const { rows: totalRows } = await db.execute({ sql: `SELECT COUNT(*) as total FROM wa_interactions ${whereSql}`, args: filterArgs });
      const total = rowsToObjects(totalRows)[0]?.total || 0;
      const { rows } = await db.execute({
        sql: `SELECT id, phone, user_id, user_name, in_type, in_text, out_text, action, created_at
              FROM wa_interactions ${whereSql}
              ORDER BY created_at DESC
              LIMIT ? OFFSET ?`,
        args: [...filterArgs, limit, offset],
      });
      return res.status(200).json({ logs: rowsToObjects(rows), total, page, limit });
    }

    // Sugestões de melhoria enviadas pelos usuários (comando /melhorias no WhatsApp)
    if (req.query.resource === 'improvements') {
      const { rows } = await db.execute(
        `SELECT id, user_id, user_name, user_phone, text, priority, status, admin_note, created_at, decided_at
           FROM improvements ORDER BY created_at DESC`
      );
      return res.status(200).json({ improvements: rowsToObjects(rows) });
    }

    // Log de auditoria administrativa (system_log) com filtros de leitura
    if (req.query.resource === 'system-log') {
      const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
      const offset = (page - 1) * limit;

      const where = [];
      const args = [];
      if (req.query.action) { where.push('action = ?'); args.push(req.query.action); }
      if (req.query.actor)  { where.push('(actor_email LIKE ? OR actor_id LIKE ?)'); const t = `%${req.query.actor}%`; args.push(t, t); }
      if (req.query.target) { where.push('(target_label LIKE ? OR target_id LIKE ?)'); const t = `%${req.query.target}%`; args.push(t, t); }
      if (req.query.date_from) { where.push('created_at >= ?'); args.push(req.query.date_from); }
      if (req.query.date_to)   { where.push('created_at <= ?'); args.push(`${req.query.date_to} 23:59:59`); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const { rows: totalRows } = await db.execute({ sql: `SELECT COUNT(*) as total FROM system_log ${whereSql}`, args });
      const total = rowsToObjects(totalRows)[0]?.total || 0;
      const { rows } = await db.execute({
        sql: `SELECT id, actor_id, actor_email, actor_role, action, target_type, target_id, target_label, details, ip, created_at
              FROM system_log ${whereSql}
              ORDER BY created_at DESC
              LIMIT ? OFFSET ?`,
        args: [...args, limit, offset],
      });
      const { rows: actRows } = await db.execute('SELECT DISTINCT action FROM system_log ORDER BY action ASC');
      return res.status(200).json({
        logs: rowsToObjects(rows),
        total, page, limit,
        actions: rowsToObjects(actRows).map(r => r.action).filter(Boolean),
      });
    }

    // Retorna a instância padrão do sistema
    if (req.query.resource === 'evolution-default-instance') {
      const { rows } = await db.execute("SELECT name, api_key FROM evolution_instances WHERE is_default = 1 LIMIT 1");
      const inst = rowsToObjects(rows)[0] || null;
      return res.status(200).json(inst ? { found: true, name: inst.name, hasKey: !!inst.api_key } : { found: false });
    }

    if (req.query.resource === 'evolution-qr') {
      const { instance } = req.query;
      if (!instance) return res.status(400).json({ error: 'instance é obrigatório' });
      const { rows: instRows } = await db.execute({ sql: 'SELECT api_key FROM evolution_instances WHERE name=?', args: [instance] });
      const instKey = rowsToObjects(instRows)[0]?.api_key || null;
      const { ok, status: evoStatus, data } = await connectQr(instance, instKey);
      const status = ok ? 200 : (evoStatus === 401 ? 502 : evoStatus);
      return res.status(status).json(data);
    }

    // Status de campanha de disparo (polling do frontend)
    if (req.query.resource === 'campaign-status') {
      const campaignId = req.query.id || '';
      if (!campaignId) return res.status(400).json({ error: 'id é obrigatório' });
      const { rows } = await db.execute({
        sql: `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='sent'       THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status='skipped'    THEN 1 ELSE 0 END) as skipped
              FROM message_dispatch WHERE campaign_id=?`,
        args: [campaignId],
      });
      const s = rowsToObjects(rows)[0] || {};
      const pending    = Number(s.pending    || 0);
      const processing = Number(s.processing || 0);
      return res.status(200).json({
        total:      Number(s.total   || 0),
        sent:       Number(s.sent    || 0),
        failed:     Number(s.failed  || 0),
        pending,
        processing,
        skipped:    Number(s.skipped || 0),
        done:       pending + processing === 0,
      });
    }

    // Mensagens agendadas / na fila — campanhas com dispatches ainda pendentes
    if (req.query.resource === 'scheduled-messages') {
      const { rows } = await db.execute(`
        SELECT c.id, c.text, c.has_media, c.media_type, c.media_name, c.instance_name,
               c.created_by_name, c.status, c.cadence_ms, c.created_at,
               COUNT(d.id) AS pending_count,
               MIN(d.scheduled_for) AS next_at,
               MAX(d.scheduled_for) AS last_at,
               GROUP_CONCAT(d.recipient_name, '||') AS recipients
        FROM message_campaigns c
        JOIN message_dispatch d ON d.campaign_id = c.id AND d.status = 'pending'
        GROUP BY c.id
        ORDER BY next_at ASC`);
      const list = rowsToObjects(rows).map(r => ({
        id: r.id,
        text: r.text || '',
        has_media: Number(r.has_media) === 1,
        media_type: r.media_type || '',
        media_name: r.media_name || '',
        instance_name: r.instance_name || '',
        created_by_name: r.created_by_name || '',
        status: r.status || '',
        cadence_ms: Number(r.cadence_ms) || 0,
        created_at: r.created_at || '',
        pending_count: Number(r.pending_count) || 0,
        next_at: r.next_at || '',
        last_at: r.last_at || '',
        recipients: (r.recipients || '').split('||').filter(Boolean),
      }));
      return res.status(200).json({ scheduled: list });
    }

    // ── GET/PUT /api/admin/users?resource=system-settings
    if (req.query.resource === 'system-settings') {
      if (req.method === 'GET') {
        const result = {};
        for (const key of SYSTEM_SETTING_KEYS) {
          result[key] = await getSystemSetting(key);
        }
        return res.status(200).json(result);
      }
      if (req.method === 'PUT') {
        const updates = req.body || {};
        const changed = [];
        for (const key of SYSTEM_SETTING_KEYS) {
          if (key in updates) { await setSystemSetting(key, String(updates[key])); changed.push(key); }
        }
        if (changed.length) {
          await logSystem({
            req, actor: user, action: 'settings.update',
            targetType: 'system_setting', targetLabel: changed.join(', '),
            details: { changed },
          });
        }
        return res.status(200).json({ ok: true });
      }
    }

    // ── CRUD /api/admin/users?resource=knowledge  →  base de regras/documentos do assistente
    if (req.query.resource === 'knowledge') {
      if (req.method === 'GET') {
        const { rows } = await db.execute(
          'SELECT id, title, content, type, tags, enabled, source, created_at, updated_at FROM knowledge_docs ORDER BY updated_at DESC'
        );
        return res.status(200).json({ docs: rowsToObjects(rows) });
      }
      if (req.method === 'POST') {
        const { title, content, type, tags, enabled } = req.body || {};
        if (!title || !String(title).trim()) return res.status(400).json({ error: 'title obrigatório' });
        const id = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO knowledge_docs (id, title, content, type, tags, enabled, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'panel', datetime('now'), datetime('now'))`,
          args: [id, String(title).trim(), String(content || ''), type === 'doc' || type === 'faq' ? type : 'rule', String(tags || ''), enabled === false || enabled === 0 ? 0 : 1],
        });
        await logSystem({ req, actor: user, action: 'knowledge.create', targetType: 'knowledge_doc', targetLabel: String(title).trim() });
        return res.status(201).json({ id, ok: true });
      }
      if (req.method === 'PUT') {
        const { id, title, content, type, tags, enabled } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id obrigatório' });
        const sets = [], args = [];
        if (title != null)   { sets.push('title=?');   args.push(String(title)); }
        if (content != null) { sets.push('content=?'); args.push(String(content)); }
        if (type != null)    { sets.push('type=?');    args.push(type === 'doc' || type === 'faq' ? type : 'rule'); }
        if (tags != null)    { sets.push('tags=?');    args.push(String(tags)); }
        if (enabled != null) { sets.push('enabled=?'); args.push(enabled === false || enabled === 0 ? 0 : 1); }
        if (!sets.length) return res.status(400).json({ error: 'nada para atualizar' });
        sets.push("updated_at=datetime('now')");
        args.push(id);
        await db.execute({ sql: `UPDATE knowledge_docs SET ${sets.join(', ')} WHERE id=?`, args });
        await logSystem({ req, actor: user, action: 'knowledge.update', targetType: 'knowledge_doc', targetLabel: id });
        return res.status(200).json({ ok: true });
      }
      if (req.method === 'DELETE') {
        const id = req.query.id || (req.body || {}).id;
        if (!id) return res.status(400).json({ error: 'id obrigatório' });
        await db.execute({ sql: 'DELETE FROM knowledge_docs WHERE id=?', args: [id] });
        await logSystem({ req, actor: user, action: 'knowledge.delete', targetType: 'knowledge_doc', targetLabel: String(id) });
        return res.status(200).json({ ok: true });
      }
    }

    // ── GET /api/admin/users?stats=true  →  aggregate dashboard stats
    if (req.method === 'GET' && req.query.stats === 'true') {
      const [
        { rows: totalRows },
        { rows: mrrRows },
        { rows: txSumRows },
        { rows: userRows },
        { rows: bankRows },
        { rows: lastActiveRows },
        { rows: topCatRows },
        { rows: topBankRows },
        { rows: recentTxRows },
      ] = await Promise.all([
        db.execute('SELECT COUNT(*) as total FROM users WHERE is_admin = 0'),
        db.execute("SELECT COALESCE(SUM(up.monthly_fee),0) as mrr FROM user_plans up INNER JOIN users u ON u.id=up.user_id WHERE up.active=1 AND u.is_admin=0"),
        db.execute(`SELECT
          SUM(CASE WHEN t.transaction_type='income' THEN t.amount ELSE 0 END) as total_income,
          SUM(CASE WHEN t.transaction_type IN ('expense','general','daily','installment') THEN t.amount ELSE 0 END) as total_expense
          FROM transactions t
          INNER JOIN users u ON u.id = t.user_id
          WHERE u.is_admin = 0`),
        db.execute(`SELECT u.id, u.name, u.email, u.phone, u.role, u.is_admin, u.last_login, u.created_at,
          COUNT(t.id) as tx_count,
          COALESCE(SUM(CASE WHEN t.transaction_type='income' THEN t.amount ELSE 0 END),0) as total_income,
          COALESCE(SUM(CASE WHEN t.transaction_type IN ('expense','general','daily','installment') THEN t.amount ELSE 0 END),0) as total_expense,
          MAX(t.created_at) as last_tx_at,
          CASE
            WHEN NULLIF(u.last_login,'') IS NULL THEN MAX(t.created_at)
            WHEN MAX(t.created_at) IS NULL THEN NULLIF(u.last_login,'')
            WHEN u.last_login > MAX(t.created_at) THEN u.last_login
            ELSE MAX(t.created_at)
          END as last_active
          FROM users u
          LEFT JOIN transactions t ON t.user_id=u.id
          GROUP BY u.id
          ORDER BY u.is_admin ASC, tx_count DESC`),
        db.execute(`SELECT a.bank_name, COUNT(DISTINCT a.user_id) as user_count,
          COUNT(*) as account_count,
          COALESCE(SUM(a.initial_balance),0) as total_balance
          FROM accounts a
          INNER JOIN users u ON u.id = a.user_id
          WHERE a.bank_name != '' AND u.is_admin = 0
          GROUP BY a.bank_name
          ORDER BY account_count DESC
          LIMIT 10`),
        db.execute(`SELECT u.id, u.name, u.email, u.last_login, MAX(t.created_at) as last_tx_at,
          CASE
            WHEN NULLIF(u.last_login,'') IS NULL THEN MAX(t.created_at)
            WHEN MAX(t.created_at) IS NULL THEN NULLIF(u.last_login,'')
            WHEN u.last_login > MAX(t.created_at) THEN u.last_login
            ELSE MAX(t.created_at)
          END as last_active
          FROM users u
          LEFT JOIN transactions t ON t.user_id = u.id
          WHERE u.is_admin = 0
          GROUP BY u.id
          HAVING last_active IS NOT NULL
          ORDER BY last_active DESC LIMIT 1`),
        db.execute(`SELECT c.name, COUNT(t.id) as count
          FROM transactions t
          INNER JOIN users u ON u.id = t.user_id
          LEFT JOIN categories c ON c.id = t.category_id
          WHERE c.name IS NOT NULL AND u.is_admin = 0
          GROUP BY c.id, c.name
          ORDER BY count DESC
          LIMIT 5`),
        db.execute(`SELECT a.bank_name as name, COUNT(*) as count
          FROM accounts a
          INNER JOIN users u ON u.id = a.user_id
          WHERE a.bank_name != '' AND u.is_admin = 0
          GROUP BY a.bank_name
          ORDER BY count DESC
          LIMIT 5`),
        db.execute(`SELECT t.id, t.amount, t.transaction_type as type, t.name as description, t.created_at,
          u.name as user_name, u.email as user_email
          FROM transactions t
          INNER JOIN users u ON u.id = t.user_id
          WHERE u.is_admin = 0
          ORDER BY datetime(t.created_at) DESC
          LIMIT 10`),
      ]);

      const totals     = rowsToObjects(totalRows)[0]      || {};
      const mrrData    = rowsToObjects(mrrRows)[0]        || {};
      const txSums     = rowsToObjects(txSumRows)[0]      || {};
      const lastActive = rowsToObjects(lastActiveRows)[0] || null;

      return res.status(200).json({
        total_users:          totals.total         || 0,
        mrr:                  mrrData.mrr          || 0,
        total_income:         txSums.total_income  || 0,
        total_expense:        txSums.total_expense || 0,
        last_active_user:     lastActive,
        top_categories:       rowsToObjects(topCatRows),
        top_banks:            rowsToObjects(topBankRows),
        recent_transactions:  rowsToObjects(recentTxRows),
        users:                rowsToObjects(userRows),
        banks:                rowsToObjects(bankRows),
      });
    }

    // ── GET /api/admin/users  →  user list
    if (req.method === 'GET') {
      const { rows } = await db.execute('SELECT id, email, name, phone, role, is_admin, created_at FROM users ORDER BY created_at DESC');
      return res.status(200).json(rowsToObjects(rows));
    }

    // ── POST /api/admin/users  →  bulk actions
    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Testa as chaves de IA (Groq e/ou Gemini) com uma chamada mínima real.
      // Usa as chaves enviadas no corpo (permite testar antes de salvar).
      if (action === 'test-ai-connection') {
        const { groq_key, groq_model, gemini_key, gemini_model, openai_key, openai_model } = req.body || {};
        const result = { groq: null, gemini: null, openai: null };
        if (groq_key) {
          try {
            const out = await groqChat({ key: groq_key, model: groq_model || 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Responda apenas com a palavra: ok' }], temperature: 0 });
            result.groq = { ok: true, sample: (out || '').trim().slice(0, 40) };
          } catch (e) { result.groq = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
        }
        if (gemini_key) {
          try {
            const out = await geminiGenerate({ key: gemini_key, model: gemini_model || 'gemini-2.0-flash', parts: [{ text: 'Responda apenas com a palavra: ok' }] });
            result.gemini = { ok: true, sample: (out || '').trim().slice(0, 40) };
          } catch (e) { result.gemini = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
        }
        if (openai_key) {
          try {
            const out = await openaiChat({ key: openai_key, model: openai_model || 'gpt-4o-mini', messages: [{ role: 'user', content: 'Responda apenas com a palavra: ok' }], temperature: 0 });
            result.openai = { ok: true, sample: (out || '').trim().slice(0, 40) };
          } catch (e) { result.openai = { ok: false, error: String(e?.message || e).slice(0, 200) }; }
        }
        return res.status(200).json(result);
      }

      // Redige/melhora uma mensagem de WhatsApp com IA para o disparo em massa.
      // mode='create': usa o texto como briefing e gera a mensagem completa.
      // mode='improve': usa o texto como rascunho e o aprimora.
      if (action === 'ai-compose-message') {
        const mode = req.body?.mode === 'improve' ? 'improve' : 'create';
        const brief = String(req.body?.brief || req.body?.text || '').trim();
        if (!brief) return res.status(400).json({ error: 'Descreva a mensagem ou informe o texto a melhorar.' });

        const groqKey = await getSystemSetting('ai_groq_key');
        const groqModel = (await getSystemSetting('ai_groq_model')) || 'llama-3.3-70b-versatile';
        const geminiKey = await getSystemSetting('ai_gemini_key');
        const geminiModel = (await getSystemSetting('ai_gemini_model')) || 'gemini-2.0-flash';
        if (!groqKey && !geminiKey) {
          return res.status(400).json({ error: 'Nenhuma chave de IA configurada. Configure em Sistema → Assistente de IA.' });
        }

        const sys = `Você é um redator de mensagens de WhatsApp para a Lumers Flow (app de gestão financeira). Escreva em português do Brasil, com tom cordial, profissional, direto e claro. Use a formatação do WhatsApp quando fizer sentido: *negrito*, _itálico_. No máximo 1 ou 2 emojis discretos. NÃO use markdown de título, nem listas com # ou **. Para personalizar, você PODE usar a variável {nome} (também existem {email}, {telefone}, {status}, {plano}, {saldo}). Responda SOMENTE com o texto final da mensagem — sem aspas, sem comentários, sem explicações.`;
        const userPrompt = mode === 'improve'
          ? `Melhore a mensagem abaixo mantendo o sentido, corrigindo a escrita e deixando-a mais clara e envolvente:\n\n"""${brief}"""`
          : `Crie uma mensagem de WhatsApp a partir deste pedido/assunto:\n\n"""${brief}"""`;

        let text = '';
        try {
          if (groqKey) {
            text = await groqChat({ key: groqKey, model: groqModel, messages: [{ role: 'system', content: sys }, { role: 'user', content: userPrompt }], temperature: 0.7 });
          } else {
            text = await geminiGenerate({ key: geminiKey, model: geminiModel, systemInstruction: sys, parts: [{ text: userPrompt }] });
          }
        } catch (e) {
          return res.status(200).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
        }
        text = String(text || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
        if (!text) return res.status(200).json({ ok: false, error: 'A IA não retornou texto. Tente novamente.' });
        return res.status(200).json({ ok: true, text });
      }

      // Consulta de cota/uso dos provedores de IA. Groq expõe limites e restante
      // via headers de rate-limit (autoritativo). Gemini não expõe restante pela
      // API — fazemos um probe e reportamos apenas o status (ok/esgotado/erro).
      if (action === 'ai-quota') {
        const groqKey = await getSystemSetting('ai_groq_key');
        const groqModel = (await getSystemSetting('ai_groq_model')) || 'llama-3.3-70b-versatile';
        const geminiKey = await getSystemSetting('ai_gemini_key');
        const geminiModel = (await getSystemSetting('ai_gemini_model')) || 'gemini-2.0-flash';

        const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

        // ── Groq: probe mínimo lê headers x-ratelimit-* mesmo em 200 ──
        let groq = { configured: !!groqKey };
        if (groqKey) {
          try {
            const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
              body: JSON.stringify({ model: groqModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 }),
            });
            const h = r.headers;
            groq.status = r.status === 429 ? 'exhausted' : (r.ok ? 'ok' : 'error');
            groq.requests = {
              limit: num(h.get('x-ratelimit-limit-requests')),
              remaining: num(h.get('x-ratelimit-remaining-requests')),
              reset: h.get('x-ratelimit-reset-requests') || '',
            };
            groq.tokens = {
              limit: num(h.get('x-ratelimit-limit-tokens')),
              remaining: num(h.get('x-ratelimit-remaining-tokens')),
              reset: h.get('x-ratelimit-reset-tokens') || '',
            };
            if (r.status === 429) groq.retryAfter = h.get('retry-after') || '';
            if (!r.ok && r.status !== 429) {
              const d = await r.json().catch(() => ({}));
              groq.error = (d?.error?.message || `HTTP ${r.status}`).slice(0, 160);
            }
          } catch (e) { groq.status = 'error'; groq.error = String(e?.message || e).slice(0, 160); }
        }

        // ── Gemini: probe de saúde (a API não retorna cota restante) ──
        let gemini = { configured: !!geminiKey };
        if (geminiKey) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
            });
            gemini.status = r.status === 429 ? 'exhausted' : (r.ok ? 'ok' : 'error');
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              gemini.error = (d?.error?.message || `HTTP ${r.status}`).slice(0, 160);
              // Google às vezes devolve retryDelay em RESOURCE_EXHAUSTED.
              const details = d?.error?.details || [];
              const retry = details.find((x) => String(x['@type'] || '').includes('RetryInfo'));
              if (retry?.retryDelay) gemini.retryAfter = retry.retryDelay;
            }
          } catch (e) { gemini.status = 'error'; gemini.error = String(e?.message || e).slice(0, 160); }
        }

        return res.status(200).json({ ok: true, groq, gemini });
      }

      if (action === 'test-evolution-key') {
        const base = evoBase();
        if (!base) return res.status(500).json({ error: 'EVOLUTION_URL não configurada' });
        const hdrs = await _evoGlobalHdrs();
        const r = await fetch(`${base}/instance/fetchInstances?limit=1`, { headers: hdrs });
        if (r.status === 401) return res.status(200).json({ ok: false, error: 'Chave inválida — Evolution retornou 401' });
        if (!r.ok) return res.status(200).json({ ok: false, error: `Evolution retornou HTTP ${r.status}` });
        return res.status(200).json({ ok: true, key_preview: hdrs.apikey.slice(0, 8) + '…' });
      }

      // Create Evolution API instance — cria na API e registra no banco local
      if (action === 'create-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const base = evoBase();
        if (!base) return res.status(500).json({ error: 'Evolution API não configurada' });

        const instanceSettings = {
          rejectCall: true,
          msgCall: '',
          groupsIgnore: true,
          alwaysOnline: true,
          readMessages: false,
          readStatus: false,
          syncFullHistory: false,
        };

        // Webhook sempre configurado — URL derivada automaticamente (não depende de env obrigatória)
        const webhookUrl = deriveWebhookUrl(req);
        const webhookCfg = {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        };

        const createBody = {
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          ...instanceSettings,
          ...(webhookUrl ? { webhook: webhookCfg } : {}),
        };

        const { ok: createOk, status: createStatus, data } = await createInstance(createBody, null);
        if (createStatus === 401) return res.status(400).json({ error: 'Chave global inválida ou não configurada — salve a chave correta na seção acima antes de criar.' });
        if (!createOk) return res.status(createStatus).json(data);

        const _config = { settings: null, webhook: null };

        // Reforço pós-create: reaplica settings (F-207 — captura falhas em vez de engolir)
        try {
          const sr = await setSettings(instanceName, null, instanceSettings);
          _config.settings = { ok: sr.ok, status: sr.status, error: sr.ok ? null : sr.data };
          if (!sr.ok) console.error('[create-evolution-instance] settings/set falhou', instanceName, sr.status, JSON.stringify(sr.data));
        } catch (e) {
          _config.settings = { ok: false, status: 0, error: String(e?.message || e) };
          console.error('[create-evolution-instance] settings/set erro de rede', instanceName, e?.message);
        }

        // Webhook com tolerância v1/v2
        if (webhookUrl) {
          try {
            const wr = await setWebhook(instanceName, null, webhookCfg);
            _config.webhook = { ok: wr.ok, status: wr.status, form: wr.form, error: wr.ok ? null : wr.data };
            if (!wr.ok) console.error('[create-evolution-instance] webhook/set falhou', instanceName, wr.status, JSON.stringify(wr.data));
          } catch (e) {
            _config.webhook = { ok: false, status: 0, error: String(e?.message || e) };
            console.error('[create-evolution-instance] webhook/set erro de rede', instanceName, e?.message);
          }
        } else {
          _config.webhook = { skipped: true, reason: 'could not derive webhook URL' };
          console.warn('[create-evolution-instance] não foi possível derivar webhook URL para', instanceName);
        }

        const newId = crypto.randomUUID();
        const pickKey = (v) => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && typeof v.apikey === 'string') return v.apikey;
          return '';
        };
        const createdKey = pickKey(data?.hash) || pickKey(data?.apikey) || pickKey(data?.instance?.apikey) || pickKey(data?.instance?.hash) || '';
        await db.execute({ sql: 'INSERT OR IGNORE INTO evolution_instances (id, name, api_key) VALUES (?, ?, ?)', args: [newId, instanceName, createdKey] });
        await logSystem({ req, actor: user, action: 'evolution.instance_create', targetType: 'evolution_instance', targetId: newId, targetLabel: instanceName });
        return res.status(200).json({ ...data, _config });
      }

      // Link existing Evolution instance
      if (action === 'link-evolution-instance') {
        const { instanceName, instanceKey } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const base = evoBase();
        if (!base) return res.status(500).json({ error: 'Evolution API não configurada' });
        const { ok, status: evoStatus } = await connectionState({ name: instanceName, key: instanceKey || null });
        if (evoStatus === 401) return res.status(400).json({ error: 'Credenciais inválidas para esta instância.' });
        if (evoStatus === 404) return res.status(404).json({ error: `Instância "${instanceName}" não encontrada na Evolution.` });
        if (!ok) return res.status(400).json({ error: `Evolution retornou HTTP ${evoStatus}` });
        const newId = crypto.randomUUID();
        await db.execute({ sql: 'INSERT OR IGNORE INTO evolution_instances (id, name, api_key) VALUES (?, ?, ?)', args: [newId, instanceName, instanceKey || ''] });
        await logSystem({ req, actor: user, action: 'evolution.instance_link', targetType: 'evolution_instance', targetId: newId, targetLabel: instanceName });
        return res.status(200).json({ ok: true });
      }

      // Delete Evolution API instance
      if (action === 'delete-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        if (!evoBase()) return res.status(500).json({ error: 'Evolution API não configurada' });
        const { ok, status: evoStatus, data } = await deleteInstance(instanceName, null);
        await db.execute({ sql: 'DELETE FROM evolution_instances WHERE name = ?', args: [instanceName] });
        await logSystem({ req, actor: user, action: 'evolution.instance_delete', targetType: 'evolution_instance', targetLabel: instanceName, details: { evoStatus } });
        const status = ok ? 200 : (evoStatus === 401 ? 502 : evoStatus);
        return res.status(status).json(data);
      }

      // Unlink instance (remove from DB only)
      if (action === 'unlink-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        await db.execute({ sql: 'DELETE FROM evolution_instances WHERE name = ?', args: [instanceName] });
        await logSystem({ req, actor: user, action: 'evolution.instance_unlink', targetType: 'evolution_instance', targetLabel: instanceName });
        return res.status(200).json({ ok: true });
      }

      // Atualiza uma sugestão de melhoria (status/prioridade/nota) e, quando concluída
      // ou recusada, notifica o usuário que sugeriu pelo WhatsApp (instância padrão).
      if (action === 'improvement-update') {
        const { id, status, priority, admin_note } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id é obrigatório' });
        const { rows: iRows } = await db.execute({ sql: 'SELECT * FROM improvements WHERE id = ?', args: [id] });
        const imp = rowsToObjects(iRows)[0];
        if (!imp) return res.status(404).json({ error: 'melhoria não encontrada' });

        const sets = [], args = [];
        const validStatus = ['pending', 'in_progress', 'done', 'rejected'];
        const validPrio = ['low', 'medium', 'high'];
        const newStatus = validStatus.includes(status) ? status : imp.status;
        if (validStatus.includes(status)) { sets.push('status = ?'); args.push(status); }
        if (validPrio.includes(priority)) { sets.push('priority = ?'); args.push(priority); }
        if (typeof admin_note === 'string') { sets.push('admin_note = ?'); args.push(admin_note.slice(0, 500)); }
        const statusChanged = validStatus.includes(status) && status !== imp.status;
        if (statusChanged && (status === 'done' || status === 'rejected')) {
          sets.push("decided_at = datetime('now')"); sets.push('decided_by = ?'); args.push(user.sub);
        }
        if (!sets.length) return res.status(400).json({ error: 'nada para atualizar' });
        args.push(id);
        await db.execute({ sql: `UPDATE improvements SET ${sets.join(', ')} WHERE id = ?`, args });

        let notified = false;
        if (statusChanged && (status === 'done' || status === 'rejected') && imp.user_phone) {
          try {
            const { rows: instRows } = await db.execute("SELECT name, api_key FROM evolution_instances WHERE is_default = 1 LIMIT 1");
            const inst = rowsToObjects(instRows)[0];
            if (inst) {
              const first = (imp.user_name || '').trim().split(/\s+/)[0] || '';
              const shortIdea = String(imp.text || '').slice(0, 120);
              const note = typeof admin_note === 'string' && admin_note.trim() ? `\n\n📝 ${admin_note.trim()}` : '';
              const text = status === 'done'
                ? `✅ Olá, ${first}! Sua sugestão de melhoria foi *aceita e implementada*:\n\n_"${shortIdea}"_${note}\n\nObrigado por ajudar a melhorar o Lumers Flow! 🙌`
                : `Olá, ${first}. Analisamos sua sugestão:\n\n_"${shortIdea}"_\n\nDesta vez ela *não foi aceita*.${note}\n\nAgradecemos muito o seu envio — continue sugerindo! 💡`;
              await sendText({ name: inst.name, key: inst.api_key || null, number: imp.user_phone, text });
              notified = true;
            }
          } catch (e) { console.error('[improvements] notificar usuário falhou', e?.message); }
        }
        await logSystem({ req, actor: user, action: 'improvement.update', targetType: 'improvement', targetLabel: id, details: { status: newStatus, notified } });
        return res.status(200).json({ ok: true, notified });
      }

      // Define instância padrão
      if (action === 'set-default-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const instNameStr = String(instanceName);
        const instNameType = typeof instanceName;
        try {
          await db.execute('UPDATE evolution_instances SET is_default = 0');
        } catch(e1) {
          return res.status(500).json({ error: `Q1 failed: ${e1.message}` });
        }
        try {
          await db.execute({ sql: 'UPDATE evolution_instances SET is_default = 1 WHERE name = ?', args: [instNameStr] });
        } catch(e2) {
          return res.status(500).json({ error: `Q2 failed: ${e2.message} | type=${instNameType} | val=${instNameStr}` });
        }
        await logSystem({ req, actor: user, action: 'evolution.set_default', targetType: 'evolution_instance', targetLabel: instNameStr });
        return res.status(200).json({ ok: true });
      }

      // Atualiza a api_key de uma instância
      if (action === 'update-instance-key') {
        const { instanceName, instanceKey } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        if (!instanceKey) return res.status(400).json({ error: 'instanceKey é obrigatório' });
        await db.execute({ sql: 'UPDATE evolution_instances SET api_key = ? WHERE name = ?', args: [instanceKey, instanceName] });
        await logSystem({ req, actor: user, action: 'evolution.update_key', targetType: 'evolution_instance', targetLabel: instanceName });
        return res.status(200).json({ ok: true });
      }

      // Verifica status ao vivo na Evolution e reaplica o webhook
      if (action === 'test-evolution-connection') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const { rows: instRows } = await db.execute({ sql: 'SELECT name, api_key, connection_status FROM evolution_instances WHERE name=?', args: [instanceName] });
        const inst = rowsToObjects(instRows)[0] || null;
        if (!inst) return res.status(404).json({ error: `Instância "${instanceName}" não encontrada` });

        const dbStatus = inst.connection_status || 'unknown';
        const { ok, data } = await connectionState({ name: inst.name, key: inst.api_key || null });

        // Só atualiza/grava o status quando a chamada ao connectionState foi bem-sucedida.
        // Em falha transitória/HTTP não-2xx, preserva o status atual do DB para não
        // sobrescrever um status bom com 'disconnected' por um blip de rede (F-2).
        if (!ok) {
          const webhookUrl = deriveWebhookUrl(req);
          return res.status(200).json({
            ok: true,
            connectionStatus: dbStatus,
            number: '',
            webhookUrl,
            webhookError: null,
            testFailed: true,
          });
        }

        const rawState = data?.instance?.state || data?.state || 'disconnected';
        const normalized = normalizeStatus(rawState);
        const number = data?.instance?.profileName || data?.profileName || '';

        await db.execute({
          sql: "UPDATE evolution_instances SET connection_status=?, last_status_at=datetime('now') WHERE name=?",
          args: [normalized, inst.name],
        });

        const webhookUrl = deriveWebhookUrl(req);
        const webhookCfg = {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        };

        let webhookError = null;
        if (webhookUrl) {
          try {
            const wr = await setWebhook(inst.name, inst.api_key || null, webhookCfg);
            if (!wr.ok) webhookError = wr.data;
          } catch (e) {
            webhookError = e?.message || String(e);
          }
        }

        return res.status(200).json({ ok: true, connectionStatus: normalized, number, webhookUrl, webhookError: webhookError || null });
      }

      // Normalize phone numbers
      if (action === 'normalize-phones') {
        const { rows } = await db.execute("SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone != ''");
        const users = rowsToObjects(rows);
        let updated = 0;
        for (const u of users) {
          const digits = u.phone.replace(/\D/g, '');
          if (!digits) continue;
          let normalized = digits;
          if (digits.startsWith('55') && digits.length >= 12) {
            normalized = digits;
          } else if (digits.length > 11) {
            normalized = digits;
          } else {
            normalized = '55' + digits;
          }
          if (normalized !== digits) {
            await db.execute({ sql: 'UPDATE users SET phone = ? WHERE id = ?', args: [normalized, u.id] });
            updated++;
          }
        }
        return res.status(200).json({ ok: true, checked: users.length, updated });
      }

      // Send WhatsApp message — enfileira campanha e retorna imediatamente
      if (action === 'send-message') {
        const { user_ids, text, media_base64, media_type, media_name, delay_ms, scheduled_at, followup } = req.body;
        const followupEnabled = followup === true || followup === 1 || followup === '1' ? 1 : 0;
        if (!user_ids?.length) return res.status(400).json({ error: 'user_ids é obrigatório' });
        if (!text && !media_base64) return res.status(400).json({ error: 'mensagem ou mídia são obrigatórios' });

        // Agendamento opcional: base de tempo para o scheduled_for dos dispatches.
        // Sem agendamento, começa imediatamente (Date.now()).
        let baseTime = Date.now();
        if (scheduled_at) {
          const ts = Date.parse(scheduled_at);
          if (isNaN(ts)) return res.status(400).json({ error: 'Data de agendamento inválida' });
          if (ts < Date.now() - 60000) return res.status(400).json({ error: 'A data de agendamento deve ser no futuro' });
          baseTime = ts;
        }

        // Valida instância padrão e status de conexão (fonte: DB, atualizado por webhook/listagem)
        const { rows: defRows } = await db.execute("SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default=1 LIMIT 1");
        const defInst = rowsToObjects(defRows)[0] || null;
        if (!defInst) return res.status(400).json({ error: 'Nenhuma instância padrão definida. Acesse Sistema → WhatsApp e defina uma instância como padrão.' });

        const instStatus = defInst.connection_status || 'unknown';
        if (instStatus !== 'connected') {
          return res.status(400).json({ error: `Instância "${defInst.name}" não está conectada (status: ${instStatus}). Reconecte e tente novamente.` });
        }

        // Dados do remetente
        const { rows: senderRows } = await db.execute({ sql: 'SELECT name FROM users WHERE id=?', args: [user.sub] });
        const senderName  = rowsToObjects(senderRows)[0]?.name || user.email || '';
        const cadenceMs   = Math.max(0, parseInt(delay_ms) || 0);
        const hasMedia    = !!media_base64;

        // Cria campanha
        const campaignId = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO message_campaigns
                  (id, created_by_id, created_by_name, created_by_email, instance_name,
                   text, has_media, media_type, media_name, media_b64,
                   cadence_ms, total, sent, failed, status, followup_enabled, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,'running',?,datetime('now'))`,
          args: [
            campaignId, user.sub, senderName, user.email || '', defInst.name,
            text || '', hasMedia ? 1 : 0, media_type || '', media_name || '', media_base64 || '',
            cadenceMs, user_ids.length, followupEnabled,
          ],
        });

        // Busca telefones de todos os destinatários de uma vez
        const placeholders = user_ids.map(() => '?').join(',');
        const { rows: uRows } = await db.execute({
          sql: `SELECT id, name, phone FROM users WHERE id IN (${placeholders})`,
          args: user_ids,
        });
        const userMap = {};
        for (const u of rowsToObjects(uRows)) userMap[u.id] = u;

        // Enfileira dispatches
        let pendingIndex = 0;
        for (const uid of user_ids) {
          const u = userMap[uid] || { id: uid, name: '', phone: '' };
          const phone = (u.phone || '').replace(/\D/g, '');

          if (!phone) {
            // Sem telefone: skipped imediatamente
            await db.execute({
              sql: `INSERT INTO message_dispatch
                      (id, campaign_id, user_id, recipient_name, phone, status, attempts, scheduled_for, created_at)
                    VALUES (?,?,?,?,'','skipped',0,'',datetime('now'))`,
              args: [crypto.randomUUID(), campaignId, uid, u.name || ''],
            });
            await db.execute({
              sql: `INSERT INTO message_logs
                      (id,sent_by_id,sent_by_name,sent_by_email,instance_name,
                       recipient_id,recipient_name,recipient_phone,message_text,
                       has_media,media_type,media_name,status,error,sent_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
              args: [
                crypto.randomUUID(), user.sub, senderName, user.email || '', defInst.name,
                uid, u.name || '', '', text || '', hasMedia ? 1 : 0, media_type || '', media_name || '',
                'failed', 'sem telefone',
              ],
            });
          } else {
            const scheduledFor = new Date(baseTime + pendingIndex * cadenceMs).toISOString();
            await db.execute({
              sql: `INSERT INTO message_dispatch
                      (id, campaign_id, user_id, recipient_name, phone, status, attempts, scheduled_for, created_at)
                    VALUES (?,?,?,?,?,'pending',0,?,datetime('now'))`,
              args: [crypto.randomUUID(), campaignId, uid, u.name || '', phone, scheduledFor],
            });
            pendingIndex++;
          }
        }

        await logSystem({
          req, actor: user, action: 'message.campaign_send',
          targetType: 'campaign', targetId: campaignId,
          targetLabel: `${user_ids.length} destinatário(s)`,
          details: { total: user_ids.length, instance: defInst.name, has_media: hasMedia },
        });
        return res.status(200).json({ ok: true, campaign_id: campaignId, total: user_ids.length });
      }

      // Disparo em massa da PERGUNTA de preferência de notificações no WhatsApp.
      // Envia a pergunta 1..5 a todos os usuários com plano ativo + telefone e marca
      // a pergunta como pendente (wa_notify_ask) para que a resposta seja interpretada.
      if (action === 'notif-ask-broadcast') {
        // Valida instância padrão conectada.
        const { rows: defRows } = await db.execute("SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default=1 LIMIT 1");
        const defInst = rowsToObjects(defRows)[0] || null;
        if (!defInst) return res.status(400).json({ error: 'Nenhuma instância padrão definida. Acesse Sistema → WhatsApp e defina uma instância como padrão.' });
        const instStatus = defInst.connection_status || 'unknown';
        if (instStatus !== 'connected') {
          return res.status(400).json({ error: `Instância "${defInst.name}" não está conectada (status: ${instStatus}). Reconecte e tente novamente.` });
        }

        // Destinatários: plano ativo + telefone válido.
        const { rows: recRows } = await db.execute(
          `SELECT u.id, u.name, u.phone
             FROM users u
             JOIN user_plans p ON p.user_id = u.id
            WHERE p.active = 1 AND u.phone IS NOT NULL AND u.phone != ''`
        );
        const recipients = rowsToObjects(recRows).filter(u => (u.phone || '').replace(/\D/g, ''));
        if (recipients.length === 0) return res.status(400).json({ error: 'Nenhum usuário com plano ativo e telefone cadastrado.' });

        const { rows: senderRows } = await db.execute({ sql: 'SELECT name FROM users WHERE id=?', args: [user.sub] });
        const senderName = rowsToObjects(senderRows)[0]?.name || user.email || '';
        // Cadência padrão de 4s entre envios para evitar bloqueio anti-spam.
        const cadenceMs = 4000;
        // O texto usa {nome} — substituído pelo dispatcher (applyVars) por usuário.
        const askText = waNotifyAskText('{nome}');

        const campaignId = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO message_campaigns
                  (id, created_by_id, created_by_name, created_by_email, instance_name,
                   text, has_media, media_type, media_name, media_b64,
                   cadence_ms, total, sent, failed, status, followup_enabled, created_at)
                VALUES (?,?,?,?,?,?,0,'','','',?,?,0,0,'running',0,datetime('now'))`,
          args: [campaignId, user.sub, senderName, user.email || '', defInst.name, askText, cadenceMs, recipients.length],
        });

        let pendingIndex = 0;
        const baseTime = Date.now();
        for (const u of recipients) {
          const phone = (u.phone || '').replace(/\D/g, '');
          const scheduledFor = new Date(baseTime + pendingIndex * cadenceMs).toISOString();
          await db.execute({
            sql: `INSERT INTO message_dispatch
                    (id, campaign_id, user_id, recipient_name, phone, status, attempts, scheduled_for, created_at)
                  VALUES (?,?,?,?,?,'pending',0,?,datetime('now'))`,
            args: [crypto.randomUUID(), campaignId, u.id, u.name || '', phone, scheduledFor],
          });
          // Marca a pergunta como pendente para interpretar a resposta 1..5.
          try { await setWaNotifyAsk(u.id); } catch (_) {}
          pendingIndex++;
        }

        await logSystem({
          req, actor: user, action: 'message.notif_ask_broadcast',
          targetType: 'campaign', targetId: campaignId,
          targetLabel: `${recipients.length} destinatário(s)`,
          details: { total: recipients.length, instance: defInst.name },
        });
        return res.status(200).json({ ok: true, campaign_id: campaignId, total: recipients.length });
      }

      // Editar / reagendar mensagem agendada (texto e/ou nova data-base)
      if (action === 'scheduled-update') {
        const { campaign_id, text, scheduled_at } = req.body;
        if (!campaign_id) return res.status(400).json({ error: 'campaign_id é obrigatório' });

        const { rows: cRows } = await db.execute({
          sql: 'SELECT id, cadence_ms, has_media FROM message_campaigns WHERE id=? LIMIT 1',
          args: [campaign_id],
        });
        const camp = rowsToObjects(cRows)[0];
        if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });

        const { rows: pendRows } = await db.execute({
          sql: "SELECT id FROM message_dispatch WHERE campaign_id=? AND status='pending' ORDER BY scheduled_for ASC",
          args: [campaign_id],
        });
        const pending = rowsToObjects(pendRows);
        if (!pending.length) return res.status(400).json({ error: 'Não há mais mensagens pendentes nesta campanha' });

        // Atualiza o texto (compartilhado por todos os dispatches da campanha)
        if (typeof text === 'string') {
          if (!text.trim() && Number(camp.has_media) !== 1) {
            return res.status(400).json({ error: 'A mensagem não pode ficar vazia' });
          }
          await db.execute({ sql: 'UPDATE message_campaigns SET text=? WHERE id=?', args: [text, campaign_id] });
        }

        // Reagenda preservando a cadência entre destinatários
        if (scheduled_at) {
          const ts = Date.parse(scheduled_at);
          if (isNaN(ts)) return res.status(400).json({ error: 'Data de agendamento inválida' });
          if (ts < Date.now() - 60000) return res.status(400).json({ error: 'A data de agendamento deve ser no futuro' });
          const cadence = Math.max(0, Number(camp.cadence_ms) || 0);
          for (let i = 0; i < pending.length; i++) {
            const when = new Date(ts + i * cadence).toISOString();
            await db.execute({
              sql: "UPDATE message_dispatch SET scheduled_for=?, processing_at='' WHERE id=?",
              args: [when, pending[i].id],
            });
          }
          await db.execute({ sql: "UPDATE message_campaigns SET status='running' WHERE id=? AND status!='running'", args: [campaign_id] });
        }

        await logSystem({
          req, actor: user, action: 'message.scheduled_update',
          targetType: 'campaign', targetId: campaign_id,
          targetLabel: `${pending.length} pendente(s)`,
          details: { rescheduled: !!scheduled_at, text_changed: typeof text === 'string' },
        });
        return res.status(200).json({ ok: true, pending: pending.length });
      }

      // Disparar agora uma mensagem agendada (rebase para agora, mantendo cadência)
      if (action === 'scheduled-send-now') {
        const { campaign_id } = req.body;
        if (!campaign_id) return res.status(400).json({ error: 'campaign_id é obrigatório' });

        const { rows: cRows } = await db.execute({
          sql: 'SELECT cadence_ms FROM message_campaigns WHERE id=? LIMIT 1',
          args: [campaign_id],
        });
        const camp = rowsToObjects(cRows)[0];
        if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });

        const { rows: pendRows } = await db.execute({
          sql: "SELECT id FROM message_dispatch WHERE campaign_id=? AND status='pending' ORDER BY scheduled_for ASC",
          args: [campaign_id],
        });
        const pending = rowsToObjects(pendRows);
        if (!pending.length) return res.status(400).json({ error: 'Não há mais mensagens pendentes nesta campanha' });

        const cadence = Math.max(0, Number(camp.cadence_ms) || 0);
        const base = Date.now();
        for (let i = 0; i < pending.length; i++) {
          const when = new Date(base + i * cadence).toISOString();
          await db.execute({
            sql: "UPDATE message_dispatch SET scheduled_for=?, processing_at='' WHERE id=?",
            args: [when, pending[i].id],
          });
        }
        await db.execute({ sql: "UPDATE message_campaigns SET status='running' WHERE id=? AND status!='running'", args: [campaign_id] });

        await logSystem({
          req, actor: user, action: 'message.scheduled_send_now',
          targetType: 'campaign', targetId: campaign_id,
          targetLabel: `${pending.length} destinatário(s)`,
        });
        return res.status(200).json({ ok: true, pending: pending.length });
      }

      // Excluir mensagem agendada (remove os dispatches pendentes)
      if (action === 'scheduled-delete') {
        const { campaign_id } = req.body;
        if (!campaign_id) return res.status(400).json({ error: 'campaign_id é obrigatório' });

        const del = await db.execute({
          sql: "DELETE FROM message_dispatch WHERE campaign_id=? AND status='pending'",
          args: [campaign_id],
        });

        // Se nada mais resta a processar, marca a campanha como cancelada
        const { rows: remainRows } = await db.execute({
          sql: "SELECT COUNT(*) as cnt FROM message_dispatch WHERE campaign_id=? AND status IN ('pending','processing')",
          args: [campaign_id],
        });
        const remain = Number(rowsToObjects(remainRows)[0]?.cnt || 0);
        if (remain === 0) {
          await db.execute({
            sql: "UPDATE message_campaigns SET status='canceled' WHERE id=? AND status='running'",
            args: [campaign_id],
          });
        }

        await logSystem({
          req, actor: user, action: 'message.scheduled_delete',
          targetType: 'campaign', targetId: campaign_id,
          targetLabel: `${del.rowsAffected || 0} removido(s)`,
        });
        return res.status(200).json({ ok: true, removed: del.rowsAffected || 0 });
      }

      // Create user (admin bypass)
      if (action === 'create-user') {
        const { email, password, name, phone: rawPhone } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
        if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
        // Normaliza p/ formato canônico: 55 + DDD(2) + 9 + 8 dígitos (celular).
        // Insere o 9º dígito quando o número vem sem ele (regra padrão BR).
        const normalizedPhone = canonicalBrazilPhone(rawPhone);
        if (rawPhone && rawPhone.replace(/\D/g, '').length && !normalizedPhone) {
          return res.status(400).json({ error: 'Telefone inválido. Use DDD + número (ex.: 11 91234-5678).' });
        }
        const { rows: existing } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
        if (rowsToObjects(existing).length > 0) return res.status(400).json({ error: 'E-mail já cadastrado' });
        const hash = await bcrypt.hash(password, 10);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await db.execute({
          sql: 'INSERT INTO users (id, email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id, email.toLowerCase().trim(), hash, name, normalizedPhone, now],
        });
        await db.execute({
          sql: 'INSERT INTO user_plans (id, user_id, email, name, monthly_fee, active) VALUES (?, ?, ?, ?, 0, 1)',
          args: [crypto.randomUUID(), id, email.toLowerCase().trim(), name],
        });
        await logSystem({
          req, actor: user, action: 'user.create',
          targetType: 'user', targetId: id, targetLabel: email.toLowerCase().trim(),
          details: { name, phone: normalizedPhone },
        });
        return res.status(201).json({ ok: true, id });
      }

      // Generate a strong random secret and store as cron_secret
      if (action === 'generate-cron-secret') {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        await setSystemSetting('cron_secret', secret);
        await logSystem({ req, actor: user, action: 'settings.cron_secret_generate', targetType: 'system_setting', targetLabel: 'cron_secret' });
        return res.status(200).json({ ok: true, secret });
      }

      // Impersonação: emite token rebaixado (read-only, 2h) para "ver como" um usuário.
      // Consolidado aqui (antes em api/admin/impersonate.js) p/ caber no limite de 12 funções Hobby.
      // Os guards de topo (isImpersonation → 403, !is_admin → 403) já garantem anti-escalonamento
      // e que apenas admin/super_admin com token normal chegam até aqui.
      if (action === 'impersonate') {
        const { targetUserId } = req.body || {};
        if (!targetUserId) return res.status(400).json({ error: 'targetUserId é obrigatório' });

        const { rows: tRows } = await db.execute({
          sql: 'SELECT id, email, name FROM users WHERE id = ?',
          args: [targetUserId],
        });
        const target = rowsToObjects(tRows)[0];
        if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

        // Token rebaixado: is_admin SEMPRE false, role SEMPRE 'user', imp=true. Expira em 2h.
        const token = await signToken(
          {
            sub: target.id,
            email: target.email,
            is_admin: false,
            role: 'user',
            imp: true,
            imp_by: user.sub,
            imp_by_email: user.email,
          },
          { expiresIn: '2h' }
        );

        // Auditoria
        await db.execute({
          sql: 'INSERT INTO impersonation_logs (id, admin_id, admin_email, target_id, target_email) VALUES (?, ?, ?, ?, ?)',
          args: [crypto.randomUUID(), user.sub, user.email || '', target.id, target.email || ''],
        });
        await logSystem({
          req, actor: user, action: 'user.impersonate',
          targetType: 'user', targetId: target.id, targetLabel: target.email || target.name || target.id,
        });

        return res.status(200).json({
          token,
          target: { id: target.id, name: target.name || '', email: target.email },
        });
      }

      return res.status(400).json({ error: 'Ação inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
