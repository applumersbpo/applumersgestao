import crypto from 'crypto';
import { getDb, getSystemSetting, rowsToObjects } from './db.js';

const DEFAULT_FROM = 'Lumers Flow <no-reply@lumersbpo.com.br>';

// Lê config de e-mail de system_settings com fallback a env vars.
export async function getEmailConfig() {
  const enabledSetting = await getSystemSetting('email_enabled');
  const fromSetting = await getSystemSetting('email_from');
  const apiKeySetting = await getSystemSetting('resend_api_key');

  const enabled = enabledSetting === '1' || process.env.EMAIL_ENABLED === '1';
  const from = fromSetting || process.env.EMAIL_FROM || DEFAULT_FROM;
  const apiKey = apiKeySetting || process.env.RESEND_API_KEY || '';

  return { enabled, from, apiKey };
}

// Substitui {{chave}} por vars[chave]. Undefined/null viram ''.
export function renderTemplate(str, vars) {
  if (!str) return '';
  const data = vars || {};
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = data[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Grava uma linha em email_log. Nunca lança (best-effort logging).
async function logEmail({ toEmail, toName, subject, templateKey, campaignId, status, messageId, error }) {
  try {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO email_log (id, to_email, to_name, subject, template_key, campaign_id, status, message_id, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        toEmail || '',
        toName || '',
        subject || '',
        templateKey || '',
        campaignId || '',
        status || 'sent',
        messageId || '',
        error || '',
      ],
    });
  } catch (e) {
    try { console.error('[email.logEmail] failed', e && (e.stack || e.message)); } catch (_) {}
  }
}

// Envia e-mail via Resend REST API. NUNCA lança pra fora.
export async function sendEmail({ to, toName, subject, html, text, templateKey, campaignId }) {
  const config = await getEmailConfig();

  if (!config.enabled || !config.apiKey) {
    await logEmail({
      toEmail: to, toName, subject, templateKey, campaignId,
      status: 'failed', error: 'disabled/no-key',
    });
    return { ok: false, skipped: true, error: 'email disabled or no api key' };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: subject || '',
        html: html || '',
        text: text || '',
      }),
    });

    let data = null;
    try { data = await resp.json(); } catch (_) { data = null; }

    if (!resp.ok) {
      const error = (data && (data.message || data.name)) || `HTTP ${resp.status}`;
      await logEmail({
        toEmail: to, toName, subject, templateKey, campaignId,
        status: 'failed', error,
      });
      return { ok: false, error };
    }

    const id = data && data.id ? data.id : '';
    await logEmail({
      toEmail: to, toName, subject, templateKey, campaignId,
      status: 'sent', messageId: id,
    });
    return { ok: true, id };
  } catch (e) {
    const error = (e && (e.message || String(e))) || 'unknown error';
    await logEmail({
      toEmail: to, toName, subject, templateKey, campaignId,
      status: 'failed', error,
    });
    return { ok: false, error };
  }
}

// Busca template de sistema por system_key. Retorna objeto ou null.
export async function getSystemTemplate(systemKey) {
  const db = getDb();
  const { rows } = await db.execute({
    sql: 'SELECT * FROM email_templates WHERE system_key = ? AND is_system = 1 LIMIT 1',
    args: [systemKey || ''],
  });
  const objs = rowsToObjects(rows);
  return objs.length ? objs[0] : null;
}

// Renderiza um template de sistema com vars e envia.
export async function sendTemplateEmail({ to, toName, systemKey, vars, campaignId }) {
  const tpl = await getSystemTemplate(systemKey);
  if (!tpl) {
    return { ok: false, error: 'template not found' };
  }
  const subject = renderTemplate(tpl.subject, vars);
  const html = renderTemplate(tpl.html, vars);
  const text = renderTemplate(tpl.text, vars);
  return sendEmail({
    to, toName, subject, html, text,
    templateKey: systemKey, campaignId,
  });
}
