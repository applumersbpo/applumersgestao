import crypto from 'crypto';
import { getDb } from './db.js';

// Extrai o IP real do cliente atrás do proxy da Vercel.
export function getClientIp(req) {
  try {
    const xff = (req && req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
    if (xff) return String(xff).split(',')[0].trim();
    return (req && req.headers && req.headers['x-real-ip']) || '';
  } catch (_) {
    return '';
  }
}

// Registra uma ação administrativa no system_log.
// Best-effort: NUNCA lança pra fora — auditoria não pode quebrar a operação.
export async function logSystem({ req, actor, action, targetType, targetId, targetLabel, details }) {
  try {
    const db = getDb();
    let detailsStr = '';
    if (details != null) {
      detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
    }
    await db.execute({
      sql: `INSERT INTO system_log (id, actor_id, actor_email, actor_role, action, target_type, target_id, target_label, details, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        (actor && actor.sub) || '',
        (actor && actor.email) || '',
        (actor && actor.role) || '',
        action || '',
        targetType || '',
        targetId || '',
        targetLabel || '',
        detailsStr,
        req ? getClientIp(req) : '',
      ],
    });
  } catch (e) {
    try { console.error('[audit.logSystem] failed', e && (e.stack || e.message)); } catch (_) {}
  }
}
