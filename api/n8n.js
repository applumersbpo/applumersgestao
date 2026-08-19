import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting, findUserByPhone } from './_lib/db.js';
import { cors } from './_lib/auth.js';
import { sendText, evoBase, resolveKey, headers, setWebhook, deriveWebhookUrl } from './_lib/evolution.js';
import { getAiConfig, openaiReadDocument, openaiReadImage, geminiReadImage, groqReadImage } from './_lib/ai.js';

const N8N_SECRET = process.env.N8N_SECRET || 'lumers-n8n-2025';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();

    // Validate secret — aceita o secret do env/fallback OU o configurado no painel
    const provided  = req.headers['x-n8n-secret'];
    const dbSecret  = await getSystemSetting('n8n_secret').catch(() => null);
    const isValid   = provided && (provided === N8N_SECRET || (dbSecret && provided === dbSecret));
    if (!isValid) return res.status(401).json({ error: 'Unauthorized' });

    const { op, phone, userId, record } = req.body || {};
    const db = getDb();

    // Resolve a instância padrão do painel (nome + apikey). Mantém a Evolution
    // server-side: o n8n nunca precisa saber instância/apikey.
    async function getDefaultInstance() {
      const { rows } = await db.execute(
        "SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default = 1 LIMIT 1"
      );
      return rowsToObjects(rows)[0] || null;
    }

    // Resolve category_id/account_id que venham como NOME (a IA às vezes manda
    // "Cartão de Crédito"/"Nubank" em vez do UUID) ou no alias `account`. Não
    // cria nada: se não achar, category_id fica como veio e account_id vazio.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const norm = (s) => String(s || '').trim().toLowerCase();
    async function resolveRefs(uid, rec) {
      if (!uid || !rec) return rec;
      if (rec.category_id && !UUID_RE.test(String(rec.category_id))) {
        const { rows } = await db.execute({ sql: 'SELECT id, name FROM categories WHERE user_id = ?', args: [uid] });
        const hit = rowsToObjects(rows).find((c) => norm(c.name) === norm(rec.category_id));
        if (hit) rec.category_id = hit.id;
      }
      const acctRaw = rec.account_id || rec.account;
      if (acctRaw) {
        if (UUID_RE.test(String(acctRaw))) {
          rec.account_id = acctRaw;
        } else {
          const { rows } = await db.execute({ sql: 'SELECT id, name FROM accounts WHERE user_id = ?', args: [uid] });
          const hit = rowsToObjects(rows).find((a) => norm(a.name) === norm(acctRaw));
          rec.account_id = hit ? hit.id : '';
        }
      }
      return rec;
    }

    // Diagnóstico da ligação Evolution -> app (webhook da instância padrão).
    // Com { fix: true } reaplica o webhook no caminho-base com byEvents:false.
    if (op === 'evoWiring') {
      const inst = await getDefaultInstance();
      if (!inst) return res.status(400).json({ error: 'Nenhuma instância padrão definida' });
      const base = evoBase();
      const k = await resolveKey(inst.api_key || null);
      let currentWebhook = null;
      try {
        const wr = await fetch(`${base}/webhook/find/${encodeURIComponent(inst.name)}`, { headers: headers(k) });
        currentWebhook = await wr.json().catch(() => ({ _status: wr.status }));
      } catch (e) { currentWebhook = { _error: String(e?.message || e) }; }

      let applied = null;
      if (req.body?.fix) {
        const webhookUrl = deriveWebhookUrl(req);
        const cfg = {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        };
        try {
          const sr = await setWebhook(inst.name, inst.api_key || null, cfg);
          applied = { ok: sr.ok, status: sr.status, form: sr.form, url: webhookUrl };
        } catch (e) { applied = { ok: false, error: String(e?.message || e) }; }
      }

      return res.status(200).json({
        name: inst.name,
        connection_status: inst.connection_status || null,
        evoBase: base,
        currentWebhook,
        applied,
      });
    }

    // Configurar as chaves da integração n8n (restrito a essas duas chaves)
    if (op === 'setConfig') {
      const { key, value } = req.body || {};
      const ALLOWED = ['n8n_webhook_url', 'n8n_secret', 'ai_groq_model', 'admin_alert_phones'];
      if (!ALLOWED.includes(key)) return res.status(400).json({ error: 'key não permitida' });
      await setSystemSetting(key, value == null ? '' : String(value));
      return res.status(200).json({ ok: true, key });
    }

    // Enviar resposta de texto via instância padrão do painel
    if (op === 'sendMessage') {
      const { text } = req.body || {};
      if (!phone || !text) return res.status(400).json({ error: 'phone and text required' });
      const inst = await getDefaultInstance();
      if (!inst) return res.status(400).json({ error: 'Nenhuma instância padrão definida' });
      const r = await sendText({ name: inst.name, key: inst.api_key || null, number: phone, text });
      return res.status(200).json({ ok: true, status: r.status });
    }

    // Baixar áudio (base64) de uma mensagem via instância padrão do painel
    if (op === 'getAudioBase64') {
      const { messageKey } = req.body || {};
      if (!messageKey) return res.status(400).json({ error: 'messageKey required' });
      const inst = await getDefaultInstance();
      if (!inst) return res.status(400).json({ error: 'Nenhuma instância padrão definida' });
      const base = evoBase();
      const k = await resolveKey(inst.api_key || null);
      const r = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(inst.name)}`, {
        method: 'POST',
        headers: headers(k),
        body: JSON.stringify({ message: { key: messageKey }, convertToMp4: false }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: 'Evolution getBase64 falhou', detail: data });
      return res.status(200).json({ base64: data.base64 || data.media || '' });
    }

    // Buscar usuário pelo número de WhatsApp (tolera formatação e 9º dígito).
    if (op === 'userByPhone') {
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const found = await findUserByPhone(phone);
      return res.status(200).json({ user: found || null });
    }

    // Adicionar transação para um usuário
    if (op === 'addTransaction') {
      if (!userId || !record) return res.status(400).json({ error: 'userId and record required' });
      await resolveRefs(userId, record);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const {
        name, amount, transaction_type, kind, status,
        due_date, paid_date, month, year, notes, category_id, account_id, template_id
      } = record;
      await db.execute({
        sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, month, year, notes, category_id, account_id, template_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, userId, name || '', Number(amount) || 0,
          transaction_type || 'expense', kind || 'variable',
          status || 'pending', due_date || '', paid_date || '',
          Number(month) || 0, Number(year) || 0,
          notes || '', category_id || '', account_id || '', template_id || '', now
        ]
      });
      return res.status(201).json({ id, ok: true });
    }

    // Adicionar parcelamento para um usuário
    if (op === 'addInstallment') {
      if (!userId || !record) return res.status(400).json({ error: 'userId and record required' });
      await resolveRefs(userId, record);
      const id = crypto.randomUUID();
      const now = new Date();
      const nowIso = now.toISOString();
      const { name, total_amount, installments, paid_installments, due_day, notes, category_id, account_id } = record;
      const startMonth = Number(record.start_month) || (now.getMonth() + 1);
      const startYear = Number(record.start_year) || now.getFullYear();
      await db.execute({
        sql: `INSERT INTO installments (id, user_id, name, total_amount, installments, paid_installments, due_day, notes, category_id, account_id, start_month, start_year, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, userId, name || '', Number(total_amount) || 0,
          Number(installments) || 1, Number(paid_installments) || 0,
          Number(due_day) || 1, notes || '', category_id || '', account_id || '',
          startMonth, startYear, nowIso
        ]
      });
      return res.status(201).json({ id, ok: true });
    }

    // Registrar uma sugestão de melhoria no painel de Melhorias. Aceita userId
    // direto OU resolve pelo phone. Guarda nome/telefone p/ exibir no painel. Fica
    // como pending/medium — o admin decide status e agrupamento depois.
    if (op === 'addImprovement') {
      const text = (record?.text || req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'record.text obrigatório' });
      let uid = userId || null;
      let uName = record?.user_name || '';
      let uPhone = record?.user_phone || phone || '';
      if (!uid && (phone || uPhone)) {
        const found = await findUserByPhone(phone || uPhone);
        if (found) { uid = found.id; uName = uName || found.name || ''; uPhone = uPhone || found.phone || ''; }
      } else if (uid && !uName) {
        const { rows } = await db.execute({ sql: 'SELECT name, phone FROM users WHERE id = ?', args: [uid] });
        const u = rowsToObjects(rows)[0];
        if (u) { uName = u.name || ''; uPhone = uPhone || u.phone || ''; }
      }
      const id = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO improvements (id, user_id, user_name, user_phone, text, priority, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'medium', 'pending', datetime('now'))`,
        args: [id, uid || '', uName || '', uPhone || '', text],
      });
      return res.status(201).json({ id, ok: true });
    }

    // Alerta de falha aos administradores (via WhatsApp). Chamado pelo workflow de
    // Error Trigger do n8n quando o assistente quebra (ex.: IA fora do ar, envio
    // falhou). Destinatários: system_setting `admin_alert_phones` (lista separada
    // por vírgula) OU, se vazio, telefones de todos os admin/super_admin. Tem
    // COOLDOWN (padrão 15 min) p/ não inundar os admins numa tempestade de erros.
    if (op === 'notifyAdmins') {
      const alert = req.body?.alert || {};
      const cooldownSec = Number(req.body?.cooldownSec ?? 900);
      const isTest = req.body?.test === true;

      // Cooldown: não reenvia se um alerta saiu há menos de cooldownSec.
      if (!isTest && cooldownSec > 0) {
        const lastRaw = await getSystemSetting('wa_alert_last_ts').catch(() => null);
        const last = Number(lastRaw) || 0;
        const nowSec = Math.floor(Date.now() / 1000);
        if (last && nowSec - last < cooldownSec) {
          return res.status(200).json({ ok: true, skipped: 'cooldown', secondsLeft: cooldownSec - (nowSec - last) });
        }
      }

      // Destinatários: lista manual do painel OU admins/super_admins com telefone.
      let phones = [];
      const manual = (await getSystemSetting('admin_alert_phones').catch(() => '')) || '';
      if (manual.trim()) {
        phones = manual.split(/[,;\n]/).map((s) => s.replace(/\D/g, '')).filter(Boolean);
      } else {
        const { rows } = await db.execute(
          "SELECT phone FROM users WHERE (is_admin = 1 OR role IN ('admin','super_admin')) AND phone IS NOT NULL AND phone != ''"
        );
        phones = rowsToObjects(rows).map((r) => String(r.phone).replace(/\D/g, '')).filter(Boolean);
      }
      phones = [...new Set(phones)];
      if (phones.length === 0) return res.status(200).json({ ok: true, sent: 0, warn: 'nenhum admin com telefone' });

      const inst = await getDefaultInstance();
      if (!inst) return res.status(400).json({ error: 'Nenhuma instância padrão definida' });

      const at = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const parts = [
        '🚨 *Lumers Flow — Falha no assistente*',
        '',
        'Detectamos uma falha de comunicação no atendimento via WhatsApp.',
      ];
      if (alert.message) parts.push('', `*Erro:* ${String(alert.message).slice(0, 300)}`);
      if (alert.node) parts.push(`*Etapa:* ${alert.node}`);
      if (alert.workflow) parts.push(`*Fluxo:* ${alert.workflow}`);
      if (alert.executionId) parts.push(`*Execução:* ${alert.executionId}`);
      parts.push(`*Quando:* ${at}`);
      parts.push('', 'As mensagens dos clientes podem estar sem resposta. Verifique o assistente/n8n.');
      const textMsg = parts.join('\n');

      const results = [];
      for (const p of phones) {
        try {
          const r = await sendText({ name: inst.name, key: inst.api_key || null, number: p, text: textMsg });
          results.push({ phone: p, status: r.status });
        } catch (e) {
          results.push({ phone: p, error: String(e?.message || e) });
        }
      }
      const sent = results.filter((r) => r.status && r.status < 300).length;
      if (sent > 0 && !isTest) {
        await setSystemSetting('wa_alert_last_ts', String(Math.floor(Date.now() / 1000))).catch(() => {});
      }
      return res.status(200).json({ ok: true, sent, recipients: phones.length, results });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ops do "cérebro no n8n": pontos de conexão, regras/documentos, contexto do
    // usuário, ações completas e leitura de mídia. O n8n lê as conexões do painel
    // (getConnections) e nunca precisa ter credenciais fixas no fluxo.
    // ─────────────────────────────────────────────────────────────────────────

    // Devolve todos os pontos de conexão configurados no painel para o n8n se
    // auto-configurar (Chatwoot, Evolution padrão e chaves/modelos de IA).
    if (op === 'getConnections') {
      const keys = [
        'chatwoot_enabled', 'chatwoot_url', 'chatwoot_token', 'chatwoot_account_id', 'chatwoot_inbox_id',
        'ai_enabled', 'ai_groq_key', 'ai_groq_model', 'ai_groq_vision_model', 'ai_gemini_key', 'ai_gemini_model',
        'ai_openai_key', 'ai_openai_vision_model', 'ai_openai_audio_model', 'wa_assistant_number',
      ];
      const cfg = {};
      for (const k of keys) cfg[k] = await getSystemSetting(k).catch(() => null);
      const inst = await getDefaultInstance();
      return res.status(200).json({
        chatwoot: {
          enabled: cfg.chatwoot_enabled === '1',
          url: cfg.chatwoot_url || '',
          token: cfg.chatwoot_token || '',
          account_id: cfg.chatwoot_account_id || '',
          inbox_id: cfg.chatwoot_inbox_id || '',
        },
        evolution: inst ? {
          instance: inst.name,
          api_key: inst.api_key || '',
          base: evoBase(),
          connection_status: inst.connection_status || null,
        } : null,
        ai: {
          enabled: cfg.ai_enabled === '1',
          groq_key: cfg.ai_groq_key || '',
          groq_model: cfg.ai_groq_model || '',
          groq_vision_model: cfg.ai_groq_vision_model || '',
          gemini_key: cfg.ai_gemini_key || '',
          gemini_model: cfg.ai_gemini_model || '',
          openai_key: cfg.ai_openai_key || '',
          openai_vision_model: cfg.ai_openai_vision_model || '',
          openai_audio_model: cfg.ai_openai_audio_model || '',
        },
        wa_assistant_number: cfg.wa_assistant_number || '',
      });
    }

    // Regras (texto livre do admin) + documentos ativos da base de conhecimento,
    // para injeção no prompt do assistente e/ou indexação em RAG pelo n8n.
    if (op === 'getRules') {
      const rules = await getSystemSetting('ai_rules').catch(() => null);
      const { rows } = await db.execute(
        'SELECT id, title, content, type, tags FROM knowledge_docs WHERE enabled=1 ORDER BY type ASC, updated_at DESC'
      );
      return res.status(200).json({ rules: rules || '', docs: rowsToObjects(rows) });
    }

    // Contexto financeiro do usuário: contas, categorias, contas a pagar pendentes,
    // metas e totais do mês corrente (pagos). Dá ao n8n visão para responder melhor.
    if (op === 'getUserContext') {
      let uid = userId;
      if (!uid && phone) {
        uid = (await findUserByPhone(phone))?.id;
      }
      if (!uid) return res.status(404).json({ error: 'user não encontrado' });
      const now = new Date();
      const [uRes, accRes, catRes, pendRes, goalRes, aggRes] = await Promise.all([
        db.execute({ sql: 'SELECT id, name, email, phone FROM users WHERE id = ?', args: [uid] }),
        db.execute({ sql: 'SELECT id, name, bank_name, type, initial_balance, closing_day, due_day FROM accounts WHERE user_id = ?', args: [uid] }),
        db.execute({ sql: 'SELECT id, name, type, icon FROM categories WHERE user_id = ?', args: [uid] }),
        db.execute({
          sql: `SELECT t.id, t.name, t.amount, t.due_date, c.name AS category, a.name AS account
                FROM transactions t
                LEFT JOIN categories c ON c.id = t.category_id
                LEFT JOIN accounts a ON a.id = t.account_id
                WHERE t.user_id = ? AND t.transaction_type='expense' AND t.status='pending'
                ORDER BY t.due_date ASC`,
          args: [uid],
        }),
        db.execute({ sql: 'SELECT id, name, target_amount, current_amount, deadline FROM goals WHERE user_id = ?', args: [uid] }).catch(() => ({ rows: [] })),
        db.execute({
          sql: `SELECT
                  COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END),0) AS income,
                  COALESCE(SUM(CASE WHEN transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END),0) AS expense
                FROM transactions WHERE user_id = ? AND status='paid' AND month = ? AND year = ?`,
          args: [uid, now.getMonth() + 1, now.getFullYear()],
        }).catch(() => ({ rows: [] })),
      ]);
      const agg = rowsToObjects(aggRes.rows)[0] || { income: 0, expense: 0 };
      return res.status(200).json({
        user: rowsToObjects(uRes.rows)[0] || null,
        accounts: rowsToObjects(accRes.rows),
        categories: rowsToObjects(catRes.rows),
        pending_bills: rowsToObjects(pendRes.rows),
        goals: rowsToObjects(goalRes.rows),
        month_totals: { income: Number(agg.income) || 0, expense: Number(agg.expense) || 0 },
      });
    }

    // Cria categoria de receita/despesa.
    if (op === 'createCategory') {
      if (!userId || !record?.name) return res.status(400).json({ error: 'userId e record.name obrigatórios' });
      const id = crypto.randomUUID();
      await db.execute({
        sql: `INSERT INTO categories (id, user_id, name, type, icon, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        args: [id, userId, record.name, record.type === 'income' ? 'income' : 'expense', record.icon || '📦'],
      });
      return res.status(201).json({ id, ok: true });
    }

    // Cria conta/carteira.
    if (op === 'createAccount') {
      if (!userId || !record?.name) return res.status(400).json({ error: 'userId e record.name obrigatórios' });
      const id = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      await db.execute({
        sql: `INSERT INTO accounts (id, user_id, name, bank_name, type, currency, initial_balance, initial_balance_date, notes, created_at)
              VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, 'Criada via n8n', datetime('now'))`,
        args: [id, userId, record.name, record.bank_name || '', record.type || 'checking', Number(record.initial_balance) || 0, today],
      });
      return res.status(201).json({ id, ok: true });
    }

    // Dá baixa numa conta a pagar (status='paid' + data de pagamento).
    if (op === 'markBillPaid') {
      const txId = record?.txId || req.body?.txId;
      if (!txId) return res.status(400).json({ error: 'txId obrigatório' });
      const paid = record?.paidDate || req.body?.paidDate || new Date().toISOString().slice(0, 10);
      await db.execute({
        sql: `UPDATE transactions SET status='paid', paid_date=?, cash_date=? WHERE id=?`,
        args: [paid, paid, txId],
      });
      return res.status(200).json({ ok: true });
    }

    // Baixa qualquer mídia (áudio, imagem, documento) de uma mensagem, em base64,
    // para o n8n transcrever/ler o conteúdo (OCR, PDF, etc.).
    if (op === 'getMediaBase64') {
      const { messageKey } = req.body || {};
      if (!messageKey) return res.status(400).json({ error: 'messageKey required' });
      const inst = await getDefaultInstance();
      if (!inst) return res.status(400).json({ error: 'Nenhuma instância padrão definida' });
      const base = evoBase();
      const k = await resolveKey(inst.api_key || null);
      const r = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(inst.name)}`, {
        method: 'POST',
        headers: headers(k),
        body: JSON.stringify({ message: { key: messageKey }, convertToMp4: false }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: 'Evolution getBase64 falhou', detail: data });
      return res.status(200).json({ base64: data.base64 || data.media || '', mimetype: data.mimetype || '' });
    }

    // Lê um anexo (PDF/imagem) a partir de uma URL pública (ex.: data_url que o
    // Chatwoot manda no webhook) e devolve o TEXTO extraído para o n8n injetar no
    // prompt. Reaproveita os leitores de documento/imagem (OpenAI primário, Gemini
    // e Groq como fallback). Sempre responde 200 com { text } — se não houver url
    // ou a leitura falhar, text vem vazio, para o nó HTTP do n8n nunca quebrar.
    if (op === 'readMedia') {
      let url = req.body?.url;
      if (!url) return res.status(200).json({ text: '' });
      // O Chatwoot pode gerar o data_url do anexo com um host (FRONTEND_URL) que não
      // resolve publicamente (ex.: chat.* em vez de chatwoot.*). Reescreve o host do
      // link de active_storage para o host do Chatwoot configurado no painel.
      try {
        const cwUrl = await getSystemSetting('chatwoot_url').catch(() => '');
        if (cwUrl && /\/rails\/active_storage\//.test(url)) {
          const cw = new URL(cwUrl);
          const u = new URL(url);
          if (u.host !== cw.host) {
            u.protocol = cw.protocol;
            u.host = cw.host;
            url = u.toString();
          }
        }
      } catch {}
      let base64 = '';
      let mime = req.body?.mimetype || '';
      try {
        const r = await fetch(url, { redirect: 'follow' });
        if (!r.ok) return res.status(200).json({ text: '', error: `download ${r.status}` });
        if (!mime) mime = r.headers.get('content-type') || '';
        base64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      } catch (e) {
        return res.status(200).json({ text: '', error: String(e?.message || e) });
      }
      const cfg = await getAiConfig();
      const isPdf = /pdf/i.test(mime) || /\.pdf(\?|$)/i.test(url);
      let text = '';
      try {
        if (isPdf) {
          if (cfg.openaiKey) {
            text = await openaiReadDocument({ key: cfg.openaiKey, model: cfg.openaiVisionModel, base64, mime: 'application/pdf' });
          } else if (cfg.geminiKey) {
            text = await geminiReadImage({ key: cfg.geminiKey, model: cfg.geminiModel, base64, mime: 'application/pdf' });
          }
        } else {
          if (cfg.openaiKey) {
            text = await openaiReadImage({ key: cfg.openaiKey, model: cfg.openaiVisionModel, base64, mime });
          } else if (cfg.geminiKey) {
            text = await geminiReadImage({ key: cfg.geminiKey, model: cfg.geminiModel, base64, mime });
          } else if (cfg.groqKey) {
            text = await groqReadImage({ key: cfg.groqKey, model: cfg.groqVisionModel, base64, mime });
          }
        }
      } catch (e) {
        return res.status(200).json({ text: '', error: String(e?.message || e) });
      }
      return res.status(200).json({ text: (text || '').trim(), mime });
    }

    // Histórico recente de uma conversa do Chatwoot — dá MEMÓRIA multi-turno ao
    // assistente no n8n (que por padrão só recebe a mensagem atual). Retorna as
    // últimas mensagens já mapeadas em papéis (user/assistant) para o prompt.
    // Sempre responde 200 com { history } (vazio em qualquer falha) para o nó
    // HTTP do n8n nunca quebrar o fluxo.
    if (op === 'getChatwootHistory') {
      const conversationId = req.body?.conversationId;
      // Janela de memória: no máximo 50 mensagens E no máximo 2 dias (o que vier
      // primeiro). Ambos configuráveis pelo n8n, mas com teto de 50 msgs.
      const limit = Math.min(Number(req.body?.limit) || 50, 50);
      const maxAgeDays = Number(req.body?.maxAgeDays) || 2;
      const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 86400;
      if (!conversationId) return res.status(200).json({ history: [] });
      const cwUrl = await getSystemSetting('chatwoot_url').catch(() => '');
      const cwToken = await getSystemSetting('chatwoot_token').catch(() => '');
      const cwAccount = await getSystemSetting('chatwoot_account_id').catch(() => '');
      if (!cwUrl || !cwToken || !cwAccount) return res.status(200).json({ history: [] });
      try {
        const endpoint = `${cwUrl.replace(/\/$/, '')}/api/v1/accounts/${cwAccount}/conversations/${conversationId}/messages`;
        const r = await fetch(endpoint, { headers: { api_access_token: cwToken } });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(200).json({ history: [], error: `chatwoot ${r.status}` });
        const arr = Array.isArray(data.payload) ? data.payload : (Array.isArray(data) ? data : []);
        const history = arr
          .filter((m) => m && (m.message_type === 0 || m.message_type === 1) && m.content && String(m.content).trim())
          .filter((m) => {
            // created_at do Chatwoot vem em epoch (segundos); tolera milissegundos.
            let ts = Number(m.created_at) || 0;
            if (ts > 1e12) ts = Math.floor(ts / 1000);
            return !ts || ts >= cutoff; // sem timestamp -> não descarta
          })
          .map((m) => ({ id: m.id, role: m.message_type === 0 ? 'user' : 'assistant', content: String(m.content).trim() }));
        return res.status(200).json({ history: history.slice(-limit) });
      } catch (e) {
        return res.status(200).json({ history: [], error: String(e?.message || e) });
      }
    }

    // Envia mensagem de volta a uma conversa do Chatwoot, usando as credenciais do painel.
    if (op === 'sendChatwoot') {
      const { conversationId, text } = req.body || {};
      const isPrivate = (req.body || {}).private === true;
      if (!conversationId || !text) return res.status(400).json({ error: 'conversationId e text obrigatórios' });
      const cwUrl = await getSystemSetting('chatwoot_url').catch(() => null);
      const cwToken = await getSystemSetting('chatwoot_token').catch(() => null);
      const cwAccount = await getSystemSetting('chatwoot_account_id').catch(() => null);
      if (!cwUrl || !cwToken || !cwAccount) return res.status(400).json({ error: 'Chatwoot não configurado no painel' });
      const endpoint = `${cwUrl.replace(/\/$/, '')}/api/v1/accounts/${cwAccount}/conversations/${conversationId}/messages`;
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', api_access_token: cwToken },
        body: JSON.stringify({ content: text, message_type: 'outgoing', private: isPrivate }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: 'Chatwoot send falhou', detail: data });
      return res.status(200).json({ ok: true, id: data.id || null });
    }

    return res.status(400).json({ error: 'op inválido' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
