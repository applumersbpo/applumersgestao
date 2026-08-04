import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting } from './_lib/db.js';
import { cors } from './_lib/auth.js';
import { sendText, evoBase, resolveKey, headers } from './_lib/evolution.js';

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
        "SELECT name, api_key FROM evolution_instances WHERE is_default = 1 LIMIT 1"
      );
      return rowsToObjects(rows)[0] || null;
    }

    // Configurar as chaves da integração n8n (restrito a essas duas chaves)
    if (op === 'setConfig') {
      const { key, value } = req.body || {};
      const ALLOWED = ['n8n_webhook_url', 'n8n_secret'];
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

    // Buscar usuário pelo número de WhatsApp
    if (op === 'userByPhone') {
      if (!phone) return res.status(400).json({ error: 'phone required' });
      const { rows } = await db.execute({
        sql: 'SELECT id, email, name, phone FROM users WHERE phone = ?',
        args: [phone]
      });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(200).json({ user: null });
      return res.status(200).json({ user: users[0] });
    }

    // Adicionar transação para um usuário
    if (op === 'addTransaction') {
      if (!userId || !record) return res.status(400).json({ error: 'userId and record required' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const {
        name, amount, transaction_type, kind, status,
        due_date, paid_date, month, year, notes, category_id, template_id
      } = record;
      await db.execute({
        sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, month, year, notes, category_id, template_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, userId, name || '', Number(amount) || 0,
          transaction_type || 'expense', kind || 'variable',
          status || 'pending', due_date || '', paid_date || '',
          Number(month) || 0, Number(year) || 0,
          notes || '', category_id || '', template_id || '', now
        ]
      });
      return res.status(201).json({ id, ok: true });
    }

    // Adicionar parcelamento para um usuário
    if (op === 'addInstallment') {
      if (!userId || !record) return res.status(400).json({ error: 'userId and record required' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { name, total_amount, installments, paid_installments, due_day, notes, category_id } = record;
      await db.execute({
        sql: `INSERT INTO installments (id, user_id, name, total_amount, installments, paid_installments, due_day, notes, category_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, userId, name || '', Number(total_amount) || 0,
          Number(installments) || 1, Number(paid_installments) || 0,
          Number(due_day) || 1, notes || '', category_id || '', now
        ]
      });
      return res.status(201).json({ id, ok: true });
    }

    return res.status(400).json({ error: 'op inválido' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
