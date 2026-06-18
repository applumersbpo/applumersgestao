import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting } from '../_lib/db.js';
import { requireAuth, cors, isImpersonation } from '../_lib/auth.js';
import {
  evoBase, resolveKey, headers as evoHdrs, normalizeStatus, parseEvoError,
  connectionState, connectQr, deleteInstance, setSettings, setWebhook,
  createInstance, deriveWebhookUrl,
} from '../_lib/evolution.js';
import bcrypt from 'bcryptjs';

const SYSTEM_SETTING_KEYS = ['allow_registration', 'evolution_global_key', 'cron_secret'];

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
        for (const key of SYSTEM_SETTING_KEYS) {
          if (key in updates) await setSystemSetting(key, String(updates[key]));
        }
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
          ORDER BY t.created_at DESC
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
          byEvents: true,
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
        return res.status(200).json({ ok: true });
      }

      // Delete Evolution API instance
      if (action === 'delete-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        if (!evoBase()) return res.status(500).json({ error: 'Evolution API não configurada' });
        const { ok, status: evoStatus, data } = await deleteInstance(instanceName, null);
        await db.execute({ sql: 'DELETE FROM evolution_instances WHERE name = ?', args: [instanceName] });
        const status = ok ? 200 : (evoStatus === 401 ? 502 : evoStatus);
        return res.status(status).json(data);
      }

      // Unlink instance (remove from DB only)
      if (action === 'unlink-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        await db.execute({ sql: 'DELETE FROM evolution_instances WHERE name = ?', args: [instanceName] });
        return res.status(200).json({ ok: true });
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
        return res.status(200).json({ ok: true });
      }

      // Atualiza a api_key de uma instância
      if (action === 'update-instance-key') {
        const { instanceName, instanceKey } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        if (!instanceKey) return res.status(400).json({ error: 'instanceKey é obrigatório' });
        await db.execute({ sql: 'UPDATE evolution_instances SET api_key = ? WHERE name = ?', args: [instanceKey, instanceName] });
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
          byEvents: true,
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
        const { user_ids, text, media_base64, media_type, media_name, delay_ms } = req.body;
        if (!user_ids?.length) return res.status(400).json({ error: 'user_ids é obrigatório' });
        if (!text && !media_base64) return res.status(400).json({ error: 'mensagem ou mídia são obrigatórios' });

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
                   cadence_ms, total, sent, failed, status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,'running',datetime('now'))`,
          args: [
            campaignId, user.sub, senderName, user.email || '', defInst.name,
            text || '', hasMedia ? 1 : 0, media_type || '', media_name || '', media_base64 || '',
            cadenceMs, user_ids.length,
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
            const scheduledFor = new Date(Date.now() + pendingIndex * cadenceMs).toISOString();
            await db.execute({
              sql: `INSERT INTO message_dispatch
                      (id, campaign_id, user_id, recipient_name, phone, status, attempts, scheduled_for, created_at)
                    VALUES (?,?,?,?,?,'pending',0,?,datetime('now'))`,
              args: [crypto.randomUUID(), campaignId, uid, u.name || '', phone, scheduledFor],
            });
            pendingIndex++;
          }
        }

        return res.status(200).json({ ok: true, campaign_id: campaignId, total: user_ids.length });
      }

      // Create user (admin bypass)
      if (action === 'create-user') {
        const { email, password, name, phone: rawPhone } = req.body;
        if (!email || !password || !name) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
        if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
        const phone = rawPhone ? rawPhone.replace(/\D/g, '') : '';
        const normalizedPhone = phone ? (phone.startsWith('55') ? phone : '55' + phone) : '';
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
        return res.status(201).json({ ok: true, id });
      }

      // Generate a strong random secret and store as cron_secret
      if (action === 'generate-cron-secret') {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        await setSystemSetting('cron_secret', secret);
        return res.status(200).json({ ok: true, secret });
      }

      return res.status(400).json({ error: 'Ação inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
