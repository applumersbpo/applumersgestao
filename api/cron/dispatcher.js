import { getDb, initDb, rowsToObjects } from '../_lib/db.js';
import * as evo from '../_lib/evolution.js';

export default async function handler(req, res) {
  // Auth: Vercel cron header OR CRON_SECRET via query/header
  const isCron = req.headers['x-vercel-cron'] === '1';
  const secret = req.query.secret
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const cronSecret = process.env.CRON_SECRET;

  if (!isCron && (!cronSecret || secret !== cronSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await initDb();
    const db = getDb();
    const now = new Date().toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Recycle orphaned processing rows (stuck > 5 min) back to pending — single UPDATE before loop
    await db.execute({
      sql: `UPDATE message_dispatch SET status='pending', processing_at=''
            WHERE status='processing' AND processing_at != '' AND processing_at <= ?`,
      args: [fiveMinAgo],
    });

    // Select pending dispatches due now (orphans above are now pending too)
    // libsql does not support UPDATE...LIMIT so we SELECT first, then claim atomically per row
    const { rows: candidates } = await db.execute({
      sql: `SELECT d.id, d.campaign_id, d.user_id, d.recipient_name, d.phone,
                   d.status, d.attempts, d.scheduled_for,
                   c.text, c.has_media, c.media_type, c.media_name, c.media_b64,
                   c.instance_name, c.created_by_id, c.created_by_name, c.created_by_email
            FROM message_dispatch d
            JOIN message_campaigns c ON c.id = d.campaign_id
            WHERE d.status = 'pending' AND d.scheduled_for <= ?
            LIMIT 15`,
      args: [now],
    });

    const dispatches = rowsToObjects(candidates);
    const processed = [];

    for (const d of dispatches) {
      // Atomic claim: only proceed if we win the race (pending only — no double-claim on processing)
      const claimRes = await db.execute({
        sql: `UPDATE message_dispatch SET status='processing', processing_at=?
              WHERE id=? AND status='pending'`,
        args: [now, d.id],
      });
      if (!claimRes.rowsAffected) continue;

      // Check instance is connected (DB as source of truth)
      const { rows: instRows } = await db.execute({
        sql: "SELECT name, api_key, connection_status FROM evolution_instances WHERE name=? LIMIT 1",
        args: [d.instance_name],
      });
      const inst = rowsToObjects(instRows)[0];
      const instStatus = inst?.connection_status || 'unknown';

      if (instStatus !== 'connected') {
        // Instance is down — release back to pending, retry on next tick
        await db.execute({
          sql: "UPDATE message_dispatch SET status='pending', processing_at='' WHERE id=?",
          args: [d.id],
        });
        processed.push({ id: d.id, result: 'deferred', reason: 'instance_down' });
        continue;
      }

      // Load user data for template personalization
      const [{ rows: uRows }, { rows: acctRows }] = await Promise.all([
        db.execute({
          sql: `SELECT u.name, u.email, u.phone,
                       p.active AS plan_active, p.name AS plan_name
                FROM users u
                LEFT JOIN user_plans p ON p.user_id = u.id
                WHERE u.id = ?`,
          args: [d.user_id],
        }),
        db.execute({
          sql: "SELECT COALESCE(SUM(initial_balance), 0) AS saldo FROM accounts WHERE user_id=?",
          args: [d.user_id],
        }),
      ]);

      const target = rowsToObjects(uRows)[0] || { name: d.recipient_name, email: '', phone: d.phone };
      target.saldo = rowsToObjects(acctRows)[0]?.saldo ?? null;

      const personalizedText = evo.applyVars(evo.applySpin(d.text || ''), target);
      const hasMedia = !!d.has_media;

      let sendResult;
      try {
        if (hasMedia && d.media_b64) {
          sendResult = await evo.sendMedia({
            name: d.instance_name,
            key: inst.api_key || null,
            number: d.phone,
            mediatype: d.media_type || 'image',
            media: d.media_b64,
            caption: personalizedText,
            mimetype: evo.inferMimetype(d.media_b64, d.media_name),
            fileName: d.media_name || '',
          });
        } else {
          sendResult = await evo.sendText({
            name: d.instance_name,
            key: inst.api_key || null,
            number: d.phone,
            text: personalizedText,
          });
        }
      } catch (sendErr) {
        sendResult = { ok: false, data: {}, status: 0, _error: sendErr.message };
      }

      const msgId = sendResult?.data?.key?.id
        || sendResult?.data?.message?.key?.id
        || '';

      if (sendResult?.ok) {
        await db.execute({
          sql: "UPDATE message_dispatch SET status='sent', sent_at=?, message_id=? WHERE id=?",
          args: [now, msgId, d.id],
        });
        await db.execute({
          sql: "UPDATE message_campaigns SET sent=sent+1 WHERE id=?",
          args: [d.campaign_id],
        });
        await db.execute({
          sql: `INSERT INTO message_logs
                  (id,sent_by_id,sent_by_name,sent_by_email,instance_name,
                   recipient_id,recipient_name,recipient_phone,message_text,
                   has_media,media_type,media_name,status,error,message_id,sent_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
          args: [
            crypto.randomUUID(),
            d.created_by_id, d.created_by_name, d.created_by_email,
            d.instance_name,
            d.user_id, target.name || '', d.phone,
            personalizedText,
            hasMedia ? 1 : 0, d.media_type || '', d.media_name || '',
            'ok', '', msgId,
          ],
        });
        processed.push({ id: d.id, result: 'sent' });
      } else {
        const errMsg = sendResult?._error
          || evo.parseEvoError(sendResult?.data, sendResult?.status);
        const attempts = (Number(d.attempts) || 0) + 1;

        if (attempts < 3) {
          const retryAt = new Date(Date.now() + 30_000).toISOString();
          await db.execute({
            sql: "UPDATE message_dispatch SET status='pending', attempts=?, scheduled_for=?, processing_at='', error=? WHERE id=?",
            args: [attempts, retryAt, errMsg, d.id],
          });
          processed.push({ id: d.id, result: 'retry', attempts });
        } else {
          await db.execute({
            sql: "UPDATE message_dispatch SET status='failed', attempts=?, error=? WHERE id=?",
            args: [attempts, errMsg, d.id],
          });
          await db.execute({
            sql: "UPDATE message_campaigns SET failed=failed+1 WHERE id=?",
            args: [d.campaign_id],
          });
          await db.execute({
            sql: `INSERT INTO message_logs
                    (id,sent_by_id,sent_by_name,sent_by_email,instance_name,
                     recipient_id,recipient_name,recipient_phone,message_text,
                     has_media,media_type,media_name,status,error,sent_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
            args: [
              crypto.randomUUID(),
              d.created_by_id, d.created_by_name, d.created_by_email,
              d.instance_name,
              d.user_id, target.name || '', d.phone,
              personalizedText,
              hasMedia ? 1 : 0, d.media_type || '', d.media_name || '',
              'failed', errMsg,
            ],
          });
          processed.push({ id: d.id, result: 'failed', error: errMsg });
        }
      }

      // Mark campaign done when no more pending/processing rows remain
      const { rows: remainRows } = await db.execute({
        sql: "SELECT COUNT(*) as cnt FROM message_dispatch WHERE campaign_id=? AND status IN ('pending','processing')",
        args: [d.campaign_id],
      });
      const remain = Number(rowsToObjects(remainRows)[0]?.cnt || 0);
      if (remain === 0) {
        await db.execute({
          sql: "UPDATE message_campaigns SET status='done' WHERE id=? AND status='running'",
          args: [d.campaign_id],
        });
      }
    }

    return res.status(200).json({ ok: true, processed: processed.length, details: processed });
  } catch (err) {
    console.error('[dispatcher]', err);
    return res.status(500).json({ error: err.message });
  }
}
