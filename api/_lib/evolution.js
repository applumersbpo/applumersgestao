import { getSystemSetting } from './db.js';

export function evoBase() {
  const url = process.env.EVOLUTION_URL || '';
  try { return new URL(url).origin; } catch { return ''; }
}

export async function resolveKey(instanceKey) {
  if (instanceKey) return instanceKey;
  const globalKey = await getSystemSetting('evolution_global_key');
  return globalKey || process.env.EVOLUTION_APIKEY || '';
}

export function headers(key) {
  return { 'Content-Type': 'application/json', apikey: key };
}

export function normalizeStatus(raw) {
  if (raw === 'open') return 'connected';
  if (raw === 'connecting') return 'connecting';
  return 'disconnected';
}

export function parseEvoError(data, status) {
  if (!data || typeof data !== 'object') return `HTTP ${status}`;
  const detail =
    (Array.isArray(data.message) ? data.message.join(', ') : data.message) ||
    (Array.isArray(data.response?.message) ? data.response.message.join(', ') : data.response?.message) ||
    data.error ||
    JSON.stringify(data).slice(0, 120);
  return detail || `HTTP ${status}`;
}

// Retries up to 3x on network errors or "Connection Closed" signals
export async function withRetry(fn) {
  const RETRYABLE = ['connection closed', 'econnreset', 'socket hang up', 'network error'];
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e.message || '').toLowerCase();
      const retryable = e._retryable
        || RETRYABLE.some(s => msg.includes(s))
        || e.name === 'FetchError'
        || e.name === 'TypeError';
      if (retryable && i < 2) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// Spin syntax: {opt1|opt2|opt3}
export function applySpin(str) {
  return str.replace(/\{([^{}]+\|[^{}]+)\}/g, (_, opts) => {
    const choices = opts.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

// Formata uma data ISO para dd/mm/aaaa (pt-BR). Retorna '' se ausente/inválida.
function fmtBrDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

// Substitui variáveis personalizadas do usuário
export function applyVars(str, u) {
  const lastAccess = fmtBrDate(u.last_active || u.last_login);
  return str
    .replace(/\{nome\}/gi,     u.name      || '')
    .replace(/\{email\}/gi,    u.email     || '')
    .replace(/\{telefone\}/gi, u.phone     || '')
    .replace(/\{status\}/gi,   u.plan_active == 1 ? 'Ativo' : 'Inativo')
    .replace(/\{plano\}/gi,    u.plan_name  || 'Sem plano')
    .replace(/\{ultimo_acesso\}/gi, lastAccess || 'nunca acessou')
    .replace(/\{saldo\}/gi,    u.saldo != null
      ? 'R$ ' + Number(u.saldo).toFixed(2).replace('.', ',')
      : '—');
}

const EXT_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function inferMimetype(media, mediaName) {
  const dataMatch = typeof media === 'string' ? media.match(/^data:([^;,]+)[;,]/) : null;
  if (dataMatch) return dataMatch[1];
  if (mediaName && mediaName.includes('.')) {
    const ext = mediaName.split('.').pop().toLowerCase();
    return EXT_MAP[ext] || '';
  }
  return '';
}

// Deriva a URL base do webhook — prioriza domínios estáveis de produção.
// VERCEL_URL fica por último: é a URL por-deployment (instável e protegida por
// Vercel Authentication), podendo registrar um endpoint inacessível na Evolution.
export function deriveWebhookUrl(req) {
  if (process.env.APP_BASE_URL) return `${process.env.APP_BASE_URL}/api/webhooks/evolution`;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/webhooks/evolution`;
  if (req && req.headers && req.headers.host) {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return `${proto}://${req.headers.host}/api/webhooks/evolution`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/webhooks/evolution`;
  return '';
}

export async function connectionState({ name, key }) {
  const base = evoBase();
  const k = await resolveKey(key);
  const r = await fetch(`${base}/instance/connectionState/${encodeURIComponent(name)}`, { headers: headers(k) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function sendText({ name, key, number, text }) {
  const base = evoBase();
  const k = await resolveKey(key);
  return withRetry(async () => {
    const r = await fetch(`${base}/message/sendText/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: headers(k),
      body: JSON.stringify({ number, text }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const errMsg = parseEvoError(data, r.status);
      const e = new Error(errMsg);
      if (errMsg.toLowerCase().includes('connection closed')) e._retryable = true;
      throw e;
    }
    return { ok: true, status: r.status, data };
  });
}

export async function sendMedia({ name, key, number, mediatype, media, caption, mimetype, fileName }) {
  const base = evoBase();
  const k = await resolveKey(key);
  const rawMedia = media && media.startsWith('data:') ? media.split(',')[1] : media;
  const mime = mimetype || inferMimetype(media, fileName);
  return withRetry(async () => {
    const r = await fetch(`${base}/message/sendMedia/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: headers(k),
      body: JSON.stringify({
        number,
        mediatype,
        media: rawMedia,
        caption,
        ...(mime ? { mimetype: mime } : {}),
        ...(fileName ? { fileName } : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const errMsg = parseEvoError(data, r.status);
      const e = new Error(errMsg);
      if (errMsg.toLowerCase().includes('connection closed')) e._retryable = true;
      throw e;
    }
    return { ok: true, status: r.status, data };
  });
}

// Envia mensagem com botões (Evolution v2 /message/sendButtons).
// buttons: [{ type: 'reply'|'url', label, url? }] — WhatsApp aceita no máx. 3.
// Atenção: em conexões Baileys o WhatsApp pode não renderizar botões (best-effort).
export async function sendButtons({ name, key, number, text, title, footer, buttons }) {
  const base = evoBase();
  const k = await resolveKey(key);
  const btns = (buttons || []).slice(0, 3).map((b, i) =>
    b.type === 'url'
      ? { type: 'url', displayText: b.label, url: b.url }
      : { type: 'reply', displayText: b.label, id: b.id || `btn_${i + 1}` },
  );
  return withRetry(async () => {
    const r = await fetch(`${base}/message/sendButtons/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: headers(k),
      body: JSON.stringify({
        number,
        ...(title ? { title } : {}),
        description: text || '',
        ...(footer ? { footer } : {}),
        buttons: btns,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const errMsg = parseEvoError(data, r.status);
      const e = new Error(errMsg);
      if (errMsg.toLowerCase().includes('connection closed')) e._retryable = true;
      throw e;
    }
    return { ok: true, status: r.status, data };
  });
}

export async function verifyNumbers({ name, key, numbers }) {
  const base = evoBase();
  const k = await resolveKey(key);
  const r = await fetch(`${base}/chat/whatsappNumbers/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: headers(k),
    body: JSON.stringify({ numbers }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function createInstance(body, globalKey) {
  const base = evoBase();
  const k = await resolveKey(globalKey || null);
  const r = await fetch(`${base}/instance/create`, {
    method: 'POST',
    headers: headers(k),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function connectQr(name, key) {
  const base = evoBase();
  const k = await resolveKey(key);
  const r = await fetch(`${base}/instance/connect/${encodeURIComponent(name)}`, { headers: headers(k) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function deleteInstance(name, key) {
  const base = evoBase();
  const k = await resolveKey(key);
  const r = await fetch(`${base}/instance/delete/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: headers(k),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export async function setSettings(name, key, settings) {
  const base = evoBase();
  const k = await resolveKey(key);
  const r = await fetch(`${base}/settings/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: headers(k),
    body: JSON.stringify(settings),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Tenta forma aninhada (v2) e, se falhar, forma flat (v1)
export async function setWebhook(name, key, webhookCfg) {
  const base = evoBase();
  const k = await resolveKey(key);

  const r1 = await fetch(`${base}/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: headers(k),
    body: JSON.stringify({ webhook: { enabled: true, ...webhookCfg } }),
  });
  if (r1.ok) {
    const data = await r1.json().catch(() => ({}));
    return { ok: true, status: r1.status, data, form: 'nested' };
  }

  const r2 = await fetch(`${base}/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: headers(k),
    body: JSON.stringify({ enabled: true, ...webhookCfg }),
  });
  const data2 = await r2.json().catch(() => ({}));
  return { ok: r2.ok, status: r2.status, data: data2, form: 'flat' };
}
