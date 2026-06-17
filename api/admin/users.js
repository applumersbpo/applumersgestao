import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting } from '../_lib/db.js';
import { requireAuth, cors } from '../_lib/auth.js';
import bcrypt from 'bcryptjs';

const SYSTEM_SETTING_KEYS = ['allow_registration', 'evolution_global_key'];

// Helper: extracts base URL from EVOLUTION_URL (e.g. https://host/message/sendText/inst → https://host)
function _evoBase() {
  const url = process.env.EVOLUTION_URL || '';
  try { const u = new URL(url); return u.origin; } catch { return ''; }
}
const _evoKey     = () => process.env.EVOLUTION_APIKEY || '';
const _evoHdrs    = () => ({ 'Content-Type': 'application/json', apikey: _evoKey() });
// Chave global usada para gerenciar instâncias (create/delete) — lida do banco em runtime
const _evoGlobalHdrs = async () => {
  const key = await getSystemSetting('evolution_global_key') || _evoKey();
  return { 'Content-Type': 'application/json', apikey: key };
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const db = getDb();

    // ── Evolution API instance management ─────────────────────────────────────
    // Lista APENAS as instâncias cadastradas neste sistema (tabela evolution_instances).
    // Nunca chama fetchInstances na conta global.
    if (req.query.resource === 'evolution-instances') {
      const base = _evoBase();
      const { rows } = await db.execute('SELECT id, name, api_key, is_default, created_at FROM evolution_instances ORDER BY is_default DESC, created_at ASC');
      const registered = rowsToObjects(rows);
      if (!base) return res.status(200).json(registered.map(r => ({ ...r, is_default: r.is_default === 1 || r.is_default === '1', connectionStatus: 'unknown' })));

      // Para cada instância registrada, busca o status individualmente
      const results = await Promise.all(registered.map(async inst => {
        try {
          const hdrs = inst.api_key
            ? { 'Content-Type': 'application/json', apikey: inst.api_key }
            : await _evoGlobalHdrs();
          const r = await fetch(`${base}/instance/connectionState/${encodeURIComponent(inst.name)}`, { headers: hdrs });
          if (!r.ok) return { name: inst.name, connectionStatus: 'disconnected', number: '' };
          const data = await r.json().catch(() => ({}));
          const state = data?.instance?.state || data?.state || 'disconnected';
          const number = data?.instance?.profileName || data?.profileName || '';
          return { name: inst.name, is_default: inst.is_default === 1 || inst.is_default === '1', connectionStatus: state === 'open' ? 'open' : 'disconnected', number };
        } catch {
          return { name: inst.name, is_default: inst.is_default === 1 || inst.is_default === '1', connectionStatus: 'disconnected', number: '' };
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
      const base = _evoBase();
      const r = await fetch(`${base}/instance/connect/${instance}`, { headers: await _evoGlobalHdrs() });
      const data = await r.json().catch(() => ({}));
      // Nunca repassar 401 da Evolution ao cliente — o frontend interpretaria como logout
      const status = r.ok ? 200 : (r.status === 401 ? 502 : r.status);
      return res.status(status).json(data);
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
        // Total de usuários comuns (não admins)
        db.execute('SELECT COUNT(*) as total FROM users WHERE is_admin = 0'),
        // MRR apenas de usuários comuns
        db.execute("SELECT COALESCE(SUM(up.monthly_fee),0) as mrr FROM user_plans up INNER JOIN users u ON u.id=up.user_id WHERE up.active=1 AND u.is_admin=0"),
        // Receitas e despesas apenas de usuários comuns
        db.execute(`SELECT
          SUM(CASE WHEN t.transaction_type='income' THEN t.amount ELSE 0 END) as total_income,
          SUM(CASE WHEN t.transaction_type IN ('expense','general','daily','installment') THEN t.amount ELSE 0 END) as total_expense
          FROM transactions t
          INNER JOIN users u ON u.id = t.user_id
          WHERE u.is_admin = 0`),
        // Lista de todos os usuários com seus dados financeiros
        // last_active = maior entre last_login e última transação criada
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
        // Bancos usados por usuários comuns
        db.execute(`SELECT a.bank_name, COUNT(DISTINCT a.user_id) as user_count,
          COUNT(*) as account_count,
          COALESCE(SUM(a.initial_balance),0) as total_balance
          FROM accounts a
          INNER JOIN users u ON u.id = a.user_id
          WHERE a.bank_name != '' AND u.is_admin = 0
          GROUP BY a.bank_name
          ORDER BY account_count DESC
          LIMIT 10`),
        // Último usuário comum ativo — considera login OU última transação
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
        // Categorias mais usadas por usuários comuns
        db.execute(`SELECT c.name, COUNT(t.id) as count
          FROM transactions t
          INNER JOIN users u ON u.id = t.user_id
          LEFT JOIN categories c ON c.id = t.category_id
          WHERE c.name IS NOT NULL AND u.is_admin = 0
          GROUP BY c.id, c.name
          ORDER BY count DESC
          LIMIT 5`),
        // Bancos mais usados por usuários comuns
        db.execute(`SELECT a.bank_name as name, COUNT(*) as count
          FROM accounts a
          INNER JOIN users u ON u.id = a.user_id
          WHERE a.bank_name != '' AND u.is_admin = 0
          GROUP BY a.bank_name
          ORDER BY count DESC
          LIMIT 5`),
        // Movimentações recentes de usuários comuns
        db.execute(`SELECT t.id, t.amount, t.transaction_type as type, t.name as description, t.created_at,
          u.name as user_name, u.email as user_email
          FROM transactions t
          INNER JOIN users u ON u.id = t.user_id
          WHERE u.is_admin = 0
          ORDER BY t.created_at DESC
          LIMIT 10`),
      ]);

      const totals     = rowsToObjects(totalRows)[0]     || {};
      const mrrData    = rowsToObjects(mrrRows)[0]       || {};
      const txSums     = rowsToObjects(txSumRows)[0]     || {};
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

      // Test Evolution global key — usa endpoint de info da instância configurada no env
      // para não listar instâncias de outras contas
      if (action === 'test-evolution-key') {
        const base = _evoBase();
        if (!base) return res.status(500).json({ error: 'EVOLUTION_URL não configurada' });
        const hdrs = await _evoGlobalHdrs();
        // Testa com fetchInstances mas limita a verificar apenas se a chave é válida (não usamos o resultado)
        const r = await fetch(`${base}/instance/fetchInstances?limit=1`, { headers: hdrs });
        if (r.status === 401) return res.status(200).json({ ok: false, error: 'Chave inválida — Evolution retornou 401' });
        if (!r.ok) return res.status(200).json({ ok: false, error: `Evolution retornou HTTP ${r.status}` });
        return res.status(200).json({ ok: true, key_preview: hdrs.apikey.slice(0, 8) + '…' });
      }

      // Create Evolution API instance — cria na API e registra no banco local
      if (action === 'create-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const base = _evoBase();
        if (!base) return res.status(500).json({ error: 'Evolution API não configurada' });
        const r = await fetch(`${base}/instance/create`, {
          method: 'POST',
          headers: await _evoGlobalHdrs(),
          body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 401) return res.status(400).json({ error: 'Chave global inválida ou não configurada — salve a chave correta na seção acima antes de criar.' });
        if (!r.ok) return res.status(r.status).json(data);

        // Aplica as configurações da instância (best-effort: NÃO pode quebrar a criação)
        try {
          await fetch(`${base}/settings/set/${encodeURIComponent(instanceName)}`, {
            method: 'POST',
            headers: await _evoGlobalHdrs(),
            body: JSON.stringify({
              rejectCall: true,
              msgCall: '',
              groupsIgnore: true,
              alwaysOnline: true,
              readMessages: false,
              readStatus: false,
              syncFullHistory: false,
            }),
          });
        } catch {
          // a instância já foi criada — ignora falha de settings e segue
        }

        // Webhook: só configura se houver URL definida em env (ver F-206). Sem hardcode.
        const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL || '';
        if (webhookUrl) {
          try {
            await fetch(`${base}/webhook/set/${encodeURIComponent(instanceName)}`, {
              method: 'POST',
              headers: await _evoGlobalHdrs(),
              body: JSON.stringify({ webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] } }),
            });
          } catch {
            // webhook é best-effort — segue mesmo se falhar
          }
        }

        // Registra no banco local para listagem futura
        const newId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
        // Em Evolution v2 `data.hash` pode ser string OU objeto `{ apikey }`. Garante string sempre.
        const pickKey = (v) => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && typeof v.apikey === 'string') return v.apikey;
          return '';
        };
        const createdKey = pickKey(data?.hash) || pickKey(data?.apikey) || pickKey(data?.instance?.apikey) || pickKey(data?.instance?.hash) || '';
        await db.execute({ sql: 'INSERT OR IGNORE INTO evolution_instances (id, name, api_key) VALUES (?, ?, ?)', args: [newId, instanceName, createdKey] });
        return res.status(200).json(data);
      }

      // Link existing Evolution instance — vincula instância já existente sem criar nova
      if (action === 'link-evolution-instance') {
        const { instanceName, instanceKey } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const base = _evoBase();
        if (!base) return res.status(500).json({ error: 'Evolution API não configurada' });
        // Verifica se a instância existe na Evolution antes de registrar
        const hdrs = instanceKey
          ? { 'Content-Type': 'application/json', apikey: instanceKey }
          : await _evoGlobalHdrs();
        const r = await fetch(`${base}/instance/connectionState/${encodeURIComponent(instanceName)}`, { headers: hdrs });
        if (r.status === 401) return res.status(400).json({ error: 'Credenciais inválidas para esta instância.' });
        if (r.status === 404) return res.status(404).json({ error: `Instância "${instanceName}" não encontrada na Evolution.` });
        if (!r.ok) return res.status(400).json({ error: `Evolution retornou HTTP ${r.status}` });
        // Registra no banco local
        const newId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
        await db.execute({ sql: 'INSERT OR IGNORE INTO evolution_instances (id, name, api_key) VALUES (?, ?, ?)', args: [newId, instanceName, instanceKey || ''] });
        return res.status(200).json({ ok: true });
      }

      // Delete Evolution API instance — remove da API e do banco local
      if (action === 'delete-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        const base = _evoBase();
        if (!base) return res.status(500).json({ error: 'Evolution API não configurada' });
        const r = await fetch(`${base}/instance/delete/${instanceName}`, {
          method: 'DELETE',
          headers: await _evoGlobalHdrs(),
        });
        // Remove do banco independentemente do resultado da API
        await db.execute({ sql: 'DELETE FROM evolution_instances WHERE name = ?', args: [instanceName] });
        const data = await r.json().catch(() => ({}));
        const status = r.ok ? 200 : (r.status === 401 ? 502 : r.status);
        return res.status(status).json(data);
      }

      // Unlink instance — remove apenas do banco local (sem deletar da Evolution)
      if (action === 'unlink-evolution-instance') {
        const { instanceName } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        await db.execute({ sql: 'DELETE FROM evolution_instances WHERE name = ?', args: [instanceName] });
        return res.status(200).json({ ok: true });
      }

      // Define instância padrão — desmarca todas e marca a escolhida
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

      // Atualiza a api_key de uma instância já cadastrada
      if (action === 'update-instance-key') {
        const { instanceName, instanceKey } = req.body;
        if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });
        if (!instanceKey) return res.status(400).json({ error: 'instanceKey é obrigatório' });
        await db.execute({ sql: 'UPDATE evolution_instances SET api_key = ? WHERE name = ?', args: [instanceKey, instanceName] });
        return res.status(200).json({ ok: true });
      }

      // Normalize all phone numbers to include DDI
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

      // Send WhatsApp message (text / any media) to a list of users
      if (action === 'send-message') {
        const { user_ids, text, image_url, media_base64, media_type, media_name, delay_ms } = req.body;
        if (!user_ids?.length) return res.status(400).json({ error: 'user_ids é obrigatório' });
        if (!text && !media_base64 && !image_url) return res.status(400).json({ error: 'mensagem ou mídia são obrigatórios' });

        // Usa a instância padrão cadastrada neste sistema
        const { rows: defRows } = await db.execute("SELECT name, api_key FROM evolution_instances WHERE is_default = 1 LIMIT 1");
        const defInst = rowsToObjects(defRows)[0] || null;
        if (!defInst) return res.status(400).json({ error: 'Nenhuma instância padrão definida. Acesse Sistema → WhatsApp e defina uma instância como padrão.' });

        const base = _evoBase();
        if (!base) return res.status(500).json({ error: 'Evolution API não configurada (EVOLUTION_URL ausente)' });

        // Fallback de chave: instância → chave global do DB (mesma usada em create/QR/delete) → env
        const globalKey    = await getSystemSetting('evolution_global_key');
        const instKey      = defInst.api_key || globalKey || _evoKey();
        const sendTextUrl  = `${base}/message/sendText/${encodeURIComponent(defInst.name)}`;
        const sendMediaUrl = `${base}/message/sendMedia/${encodeURIComponent(defInst.name)}`;
        const hasMedia     = !!(media_base64 || image_url);
        const mtype        = media_type || 'image';
        const media        = media_base64 || image_url;
        const evoHeaders   = { 'Content-Type': 'application/json', 'apikey': instKey };
        // Cadência: delay entre mensagens (máx 60 s para não estourar timeout serverless)
        const cadencia     = Math.min(Math.max(0, parseInt(delay_ms) || 0), 60000);

        // Randomiza variações {op1|op2|op3} — aplicado por mensagem (resultado diferente por usuário)
        const applySpin = (str) => str.replace(/\{([^{}]+\|[^{}]+)\}/g, (_, opts) => {
          const choices = opts.split('|');
          return choices[Math.floor(Math.random() * choices.length)];
        });

        // Substitui variáveis personalizadas do usuário
        const applyVars = (str, u) => str
          .replace(/\{nome\}/gi,     u.name      || '')
          .replace(/\{email\}/gi,    u.email     || '')
          .replace(/\{telefone\}/gi, u.phone     || '')
          .replace(/\{status\}/gi,   u.plan_active == 1 ? 'Ativo' : 'Inativo')
          .replace(/\{plano\}/gi,    u.plan_name  || 'Sem plano')
          .replace(/\{saldo\}/gi,    u.saldo != null
            ? 'R$ ' + Number(u.saldo).toFixed(2).replace('.', ',')
            : '—');

        const evoError = (data, status) => {
          if (!data || typeof data !== 'object') return `HTTP ${status}`;
          const detail =
            (Array.isArray(data.message) ? data.message.join(', ') : data.message) ||
            (Array.isArray(data.response?.message) ? data.response.message.join(', ') : data.response?.message) ||
            data.error ||
            JSON.stringify(data).slice(0, 120);
          return detail || `HTTP ${status}`;
        };

        const results = [];
        for (let i = 0; i < user_ids.length; i++) {
          const uid = user_ids[i];

          // Busca dados do usuário + plano + saldo das contas
          const [{ rows: uRows }, { rows: acctRows }] = await Promise.all([
            db.execute({
              sql: `SELECT u.name, u.email, u.phone,
                           p.active AS plan_active, p.name AS plan_name
                    FROM users u
                    LEFT JOIN user_plans p ON p.user_id = u.id
                    WHERE u.id = ?`,
              args: [uid],
            }),
            db.execute({
              sql: 'SELECT COALESCE(SUM(initial_balance), 0) AS saldo FROM accounts WHERE user_id = ?',
              args: [uid],
            }),
          ]);

          const target = rowsToObjects(uRows)[0];
          const acct   = rowsToObjects(acctRows)[0];
          if (target) target.saldo = acct?.saldo ?? null;

          if (!target?.phone) {
            results.push({ id: uid, ok: false, error: 'sem telefone' });
            await db.execute({ sql: `INSERT INTO message_logs (id,sent_by_id,sent_by_name,sent_by_email,instance_name,recipient_id,recipient_name,recipient_phone,message_text,has_media,media_type,media_name,status,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              args: [crypto.randomUUID(), user.id, user.name||'', user.email||'', defInst.name, uid, target?.name||'', '', text||'', hasMedia?1:0, mtype||'', media_name||'', 'failed', 'sem telefone'] });
            continue;
          }

          const phone = target.phone.replace(/\D/g, '');
          if (!phone) {
            results.push({ id: uid, ok: false, error: 'telefone inválido' });
            await db.execute({ sql: `INSERT INTO message_logs (id,sent_by_id,sent_by_name,sent_by_email,instance_name,recipient_id,recipient_name,recipient_phone,message_text,has_media,media_type,media_name,status,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              args: [crypto.randomUUID(), user.id, user.name||'', user.email||'', defInst.name, uid, target?.name||'', target?.phone||'', text||'', hasMedia?1:0, mtype||'', media_name||'', 'failed', 'telefone inválido'] });
            continue;
          }

          // Aplica spin + variáveis ao texto (resultado único por usuário)
          const personalizedText = applyVars(applySpin(text || ''), target);

          let logStatus = 'ok', logError = '';
          try {
            let resp;

            if (hasMedia) {
              const rawMedia = media && media.startsWith('data:') ? media.split(',')[1] : media;
              // Infere o mimetype: 1) prefixo data:<mime>;base64 da mídia original; 2) extensão do nome
              let mimetype = '';
              const dataMatch = typeof media === 'string' ? media.match(/^data:([^;,]+)[;,]/) : null;
              if (dataMatch) {
                mimetype = dataMatch[1];
              } else if (media_name && media_name.includes('.')) {
                const ext = media_name.split('.').pop().toLowerCase();
                const extMap = {
                  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
                  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
                  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
                  pdf: 'application/pdf', doc: 'application/msword',
                  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  xls: 'application/vnd.ms-excel',
                  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                };
                mimetype = extMap[ext] || '';
              }
              resp = await fetch(sendMediaUrl, {
                method: 'POST',
                headers: evoHeaders,
                body: JSON.stringify({
                  number:    phone,
                  mediatype: mtype,
                  media:     rawMedia,
                  caption:   personalizedText,
                  ...(mimetype ? { mimetype } : {}),
                  ...(media_name ? { fileName: media_name } : {}),
                }),
              });
            } else {
              resp = await fetch(sendTextUrl, {
                method: 'POST',
                headers: evoHeaders,
                body: JSON.stringify({ number: phone, text: personalizedText }),
              });
            }

            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              logStatus = 'failed';
              logError  = evoError(data, resp.status);
              results.push({ id: uid, ok: false, phone, error: logError });
            } else {
              results.push({ id: uid, ok: true, phone, name: target.name });
            }
          } catch(e) {
            logStatus = 'failed';
            logError  = e.message;
            results.push({ id: uid, ok: false, error: e.message });
          }

          // Registra no log de mensagens
          await db.execute({
            sql: `INSERT INTO message_logs (id,sent_by_id,sent_by_name,sent_by_email,instance_name,recipient_id,recipient_name,recipient_phone,message_text,has_media,media_type,media_name,status,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [
              crypto.randomUUID(),
              user.id, user.name || '', user.email || '',
              defInst.name,
              uid, target.name || '', phone,
              personalizedText,
              hasMedia ? 1 : 0, mtype || '', media_name || '',
              logStatus, logError,
            ],
          });

          // Cadência: aguarda antes da próxima mensagem
          if (cadencia > 0 && i < user_ids.length - 1) {
            await new Promise(r => setTimeout(r, cadencia));
          }
        }

        const sent = results.filter(r => r.ok).length;
        const total = user_ids.length;
        // Falha total: reflete erro no status/payload em vez de mascarar como sucesso
        if (sent === 0 && total > 0) {
          const firstErr = results.find(r => !r.ok && r.error)?.error || 'Falha ao enviar as mensagens';
          return res.status(502).json({ ok: false, error: firstErr, sent, total, results });
        }
        // Falha parcial: sucesso, mas sinaliza que nem todos foram enviados
        const partial = sent > 0 && sent < total;
        return res.status(200).json({ ok: true, ...(partial ? { partial: true } : {}), sent, total, results });
      }

      // Create user (admin bypass — ignores allow_registration)
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

      return res.status(400).json({ error: 'Ação inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
