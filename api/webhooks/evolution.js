import { getDb, initDb } from '../_lib/db.js';
import { normalizeStatus } from '../_lib/evolution.js';

export default async function handler(req, res) {
  // Respond 200 immediately so Evolution doesn't retry on slow processing
  res.status(200).json({ ok: true });

  if (req.method !== 'POST') return;

  try {
    await initDb();
    const db = getDb();
    const body = req.body || {};

    // Normalize event name from multiple possible locations
    const rawEvent = req.query.event || body.event || body.type || '';
    const event = rawEvent.toUpperCase().replace(/\./g, '_').replace(/-/g, '_');

    // CONNECTION_UPDATE: persist connection status to DB
    if (event === 'CONNECTION_UPDATE') {
      const instanceName = body.instance || body.instanceName || body.sender || '';
      if (!instanceName) return;
      const data = body.data || body;
      const rawState = data.state || data.status || data.instance?.state || '';
      if (rawState) {
        const normalized = normalizeStatus(rawState);
        await db.execute({
          sql: "UPDATE evolution_instances SET connection_status=?, last_status_at=datetime('now') WHERE name=?",
          args: [normalized, instanceName],
        });
      }
      return;
    }

    // QRCODE_UPDATED: persist QR code to DB
    if (event === 'QRCODE_UPDATED') {
      const instanceName = body.instance || body.instanceName || body.sender || '';
      if (!instanceName) return;
      const data = body.data || body;
      const qrCode = data.qrcode?.base64 || data.base64 || data.qr || '';
      await db.execute({
        sql: "UPDATE evolution_instances SET qr=?, last_status_at=datetime('now') WHERE name=?",
        args: [qrCode, instanceName],
      });
      return;
    }

    // MESSAGES_UPDATE: update delivery status of sent messages
    if (event === 'MESSAGES_UPDATE') {
      const msgs = body.data || [];
      const msgList = Array.isArray(msgs) ? msgs : [msgs];
      for (const msg of msgList) {
        const msgId = msg.key?.id || msg.id || '';
        const deliveryStatus = msg.update?.status || msg.status || '';
        if (!msgId || !deliveryStatus) continue;
        await db.execute({
          sql: "UPDATE message_logs SET delivery_status=? WHERE message_id=? AND message_id!=''",
          args: [deliveryStatus.toUpperCase(), msgId],
        }).catch(() => {});
      }
      return;
    }

    // MESSAGES_UPSERT: track delivery status for fromMe messages (ignore groups)
    if (event === 'MESSAGES_UPSERT') {
      const msgs = body.data || [];
      const msgList = Array.isArray(msgs) ? msgs : [msgs];
      for (const msg of msgList) {
        if (!msg.key?.fromMe) continue;
        if ((msg.key?.remoteJid || '').includes('@g.us')) continue;
        const msgId = msg.key?.id || '';
        const deliveryStatus = msg.status || '';
        if (!msgId || !deliveryStatus) continue;
        await db.execute({
          sql: "UPDATE message_logs SET delivery_status=? WHERE message_id=? AND message_id!=''",
          args: [deliveryStatus.toUpperCase(), msgId],
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[webhook/evolution]', err);
  }
}
