import { getDb, initDb, rowsToObjects, getSystemSetting, setSystemSetting } from '../lib/db.js';
import { requireAuth, cors } from '../lib/auth.js';

const SYSTEM_SETTING_KEYS = ['allow_registration'];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const user = await requireAuth(req);
    if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

    const db = getDb();

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
      ] = await Promise.all([
        db.execute('SELECT COUNT(*) as total FROM users'),
        db.execute("SELECT COALESCE(SUM(monthly_fee),0) as mrr FROM user_plans WHERE active=1"),
        db.execute(`SELECT
          SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END) as total_income,
          SUM(CASE WHEN transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END) as total_expense
          FROM transactions`),
        db.execute(`SELECT u.id, u.name, u.email, u.phone, u.last_login, u.created_at,
          COUNT(t.id) as tx_count,
          COALESCE(SUM(CASE WHEN t.transaction_type='income' THEN t.amount ELSE 0 END),0) as total_income,
          COALESCE(SUM(CASE WHEN t.transaction_type IN ('expense','general','daily','installment') THEN t.amount ELSE 0 END),0) as total_expense
          FROM users u
          LEFT JOIN transactions t ON t.user_id=u.id
          GROUP BY u.id
          ORDER BY tx_count DESC`),
        db.execute(`SELECT a.bank_name, COUNT(DISTINCT a.user_id) as user_count,
          COUNT(*) as account_count,
          COALESCE(SUM(a.initial_balance),0) as total_balance
          FROM accounts a
          WHERE a.bank_name != ''
          GROUP BY a.bank_name
          ORDER BY account_count DESC
          LIMIT 10`),
      ]);

      const totals  = rowsToObjects(totalRows)[0]  || {};
      const mrrData = rowsToObjects(mrrRows)[0]    || {};
      const txSums  = rowsToObjects(txSumRows)[0]  || {};

      return res.status(200).json({
        total_users:   totals.total        || 0,
        mrr:           mrrData.mrr         || 0,
        total_income:  txSums.total_income  || 0,
        total_expense: txSums.total_expense || 0,
        users:  rowsToObjects(userRows),
        banks:  rowsToObjects(bankRows),
      });
    }

    // ── GET /api/admin/users  →  user list
    if (req.method === 'GET') {
      const { rows } = await db.execute('SELECT id, email, name, phone, is_admin, created_at FROM users ORDER BY created_at DESC');
      return res.status(200).json(rowsToObjects(rows));
    }

    // ── POST /api/admin/users  →  bulk actions
    if (req.method === 'POST') {
      const { action } = req.body || {};

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
        const { user_ids, text, image_url, media_base64, media_type, media_name } = req.body;
        if (!user_ids?.length) return res.status(400).json({ error: 'user_ids é obrigatório' });
        if (!text && !media_base64 && !image_url) return res.status(400).json({ error: 'mensagem ou mídia são obrigatórios' });

        const baseUrl = process.env.EVOLUTION_URL;
        const key     = process.env.EVOLUTION_APIKEY;
        if (!baseUrl || !key) return res.status(500).json({ error: 'Evolution API não configurada' });

        // Build endpoint URLs — EVOLUTION_URL must contain the sendText path
        const sendTextUrl  = baseUrl.replace(/send\w+/, 'sendText');
        const sendMediaUrl = baseUrl.replace(/send\w+/, 'sendMedia');

        const hasMedia = !!(media_base64 || image_url);
        const mtype    = media_type || 'image';
        const media    = media_base64 || image_url;
        const evoHeaders = { 'Content-Type': 'application/json', 'apikey': key };

        // Helper: extract the best error string from an Evolution API error response
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
        for (const uid of user_ids) {
          const { rows } = await db.execute({ sql: 'SELECT name, phone FROM users WHERE id=?', args: [uid] });
          const target = rowsToObjects(rows)[0];
          if (!target?.phone) { results.push({ id: uid, ok: false, error: 'sem telefone' }); continue; }

          // Sanitise phone: digits only, must start with country code
          const phone = target.phone.replace(/\D/g, '');
          if (!phone) { results.push({ id: uid, ok: false, error: 'telefone inválido' }); continue; }

          try {
            let resp;

            if (hasMedia) {
              // Strip data URL prefix if present — Evolution expects raw base64 only
              const rawMedia = media && media.startsWith('data:')
                ? media.split(',')[1]
                : media;

              resp = await fetch(sendMediaUrl, {
                method: 'POST',
                headers: evoHeaders,
                body: JSON.stringify({
                  number:    phone,
                  mediatype: mtype,
                  media:     rawMedia,
                  caption:   text || '',
                  ...(media_name ? { fileName: media_name } : {}),
                }),
              });
            } else {
              // Evolution API sendText: flat { number, text }
              resp = await fetch(sendTextUrl, {
                method: 'POST',
                headers: evoHeaders,
                body: JSON.stringify({ number: phone, text }),
              });
            }

            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              results.push({ id: uid, ok: false, phone, error: evoError(data, resp.status) });
            } else {
              results.push({ id: uid, ok: true, phone });
            }
          } catch(e) {
            results.push({ id: uid, ok: false, error: e.message });
          }
        }

        const sent = results.filter(r => r.ok).length;
        return res.status(200).json({ ok: true, sent, total: user_ids.length, results });
      }

      return res.status(400).json({ error: 'Ação inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: err.message });
  }
}
