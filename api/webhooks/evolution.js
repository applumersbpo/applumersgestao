import { getDb, initDb, getSystemSetting } from '../_lib/db.js';
import { normalizeStatus } from '../_lib/evolution.js';
import { handleAssistantMessage } from '../_lib/assistant.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  // Nota: respondemos 200 só ao FINAL do processamento. Em serverless (Vercel),
  // trabalho assíncrono disparado após enviar a resposta pode ser congelado antes
  // de concluir — o que fazia o fan-out (fetch externo para o n8n) nunca completar.
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
      if (!instanceName) return res.status(200).json({ ok: true });
      const data = body.data || body;
      const rawState = data.state || data.status || data.instance?.state || '';
      if (rawState) {
        const normalized = normalizeStatus(rawState);
        await db.execute({
          sql: "UPDATE evolution_instances SET connection_status=?, last_status_at=datetime('now') WHERE name=?",
          args: [normalized, instanceName],
        });
      }
      return res.status(200).json({ ok: true });
    }

    // QRCODE_UPDATED: persist QR code to DB
    if (event === 'QRCODE_UPDATED') {
      const instanceName = body.instance || body.instanceName || body.sender || '';
      if (!instanceName) return res.status(200).json({ ok: true });
      const data = body.data || body;
      const qrCode = data.qrcode?.base64 || data.base64 || data.qr || '';
      await db.execute({
        sql: "UPDATE evolution_instances SET qr=?, last_status_at=datetime('now') WHERE name=?",
        args: [qrCode, instanceName],
      });
      return res.status(200).json({ ok: true });
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
      return res.status(200).json({ ok: true });
    }

    // MESSAGES_UPSERT: track delivery status for fromMe messages e faz fan-out
    // das mensagens RECEBIDAS (não-fromMe, não-grupo) para o n8n, quando configurado.
    if (event === 'MESSAGES_UPSERT') {
      const msgs = body.data || [];
      const msgList = Array.isArray(msgs) ? msgs : [msgs];

      // Config lida uma vez, só se houver mensagem recebida a processar.
      // Quando ai_enabled=1, o "cérebro" roda no próprio app (assistente multimodal
      // com nível de acesso); caso contrário, mantém o fan-out para o n8n.
      const hasIncoming = msgList.some(
        (m) => m && !m.key?.fromMe && !(m.key?.remoteJid || '').includes('@g.us'),
      );
      const aiEnabled = hasIncoming ? ((await getSystemSetting('ai_enabled').catch(() => null)) === '1') : false;
      const n8nUrl    = (hasIncoming && !aiEnabled) ? await getSystemSetting('n8n_webhook_url').catch(() => null) : null;
      const n8nSecret = n8nUrl ? await getSystemSetting('n8n_secret').catch(() => null) : null;
      const instanceName = body.instance || body.instanceName || body.sender || '';

      for (const msg of msgList) {
        if ((msg.key?.remoteJid || '').includes('@g.us')) continue;

        // fromMe: rastreia status de entrega das mensagens enviadas pelo sistema
        if (msg.key?.fromMe) {
          const msgId = msg.key?.id || '';
          const deliveryStatus = msg.status || '';
          if (!msgId || !deliveryStatus) continue;
          await db.execute({
            sql: "UPDATE message_logs SET delivery_status=? WHERE message_id=? AND message_id!=''",
            args: [deliveryStatus.toUpperCase(), msgId],
          }).catch(() => {});
          continue;
        }

        // Recebida: assistente de IA no app (preferencial) ou fan-out para o n8n.
        if (aiEnabled) {
          await handleAssistantMessage(msg, instanceName).catch((e) => console.error('[webhook/evolution] assistente falhou', e?.message));
        } else if (n8nUrl) {
          await fetch(n8nUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(n8nSecret ? { 'x-n8n-secret': n8nSecret } : {}),
            },
            body: JSON.stringify({ event: 'messages.upsert', instance: instanceName, data: msg }),
          }).catch((e) => console.error('[webhook/evolution] fan-out n8n falhou', e?.message));
        }
      }
    }
  } catch (err) {
    console.error('[webhook/evolution]', err);
  }
  // Responde 200 ao final — garante que o fan-out (fetch ao n8n) já concluiu.
  if (!res.headersSent) res.status(200).json({ ok: true });
}
