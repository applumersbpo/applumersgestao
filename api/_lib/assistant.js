import { getDb, rowsToObjects } from './db.js';
import { getAiConfig, groqChat, groqTranscribeAudio, groqReadImage, geminiTranscribeAudio, geminiReadImage } from './ai.js';
import { sendText, evoBase, resolveKey, headers } from './evolution.js';
import { sendTemplateEmail } from './email.js';
import bcrypt from 'bcryptjs';

// ── Helpers de infraestrutura ────────────────────────────────────────────────

async function getDefaultInstance() {
  const db = getDb();
  const { rows } = await db.execute(
    "SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default = 1 LIMIT 1"
  );
  return rowsToObjects(rows)[0] || null;
}

// Baixa a mídia (base64) de uma mensagem via Evolution.
async function getMediaBase64(instanceName, key, messageKey) {
  const base = evoBase();
  const k = await resolveKey(key || null);
  const r = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: headers(k),
    body: JSON.stringify({ message: { key: messageKey }, convertToMp4: false }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return '';
  return data.base64 || data.media || '';
}

// Gera as variações plausíveis de um número BR para casar com o que está salvo,
// tolerando: código do país 55 presente/ausente e o 9º dígito do celular presente/ausente.
// Ex.: WhatsApp manda "5511912345678"; o cadastro pode estar como "551112345678",
// "11912345678", "1112345678", etc. Retorna todos os formatos só-dígitos possíveis.
function brazilPhoneVariants(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const set = new Set();
  if (!d) return [];
  set.add(d);
  // remove o código do país 55 quando presente
  let local = d;
  if (local.length > 11 && local.startsWith('55')) local = local.slice(2);
  set.add(local);
  if (local.length >= 10) {
    const ddd = local.slice(0, 2);
    const rest = local.slice(2); // 8 (sem 9) ou 9 (com 9) dígitos
    let with9, without9;
    if (rest.length === 9 && rest[0] === '9') {
      with9 = rest; without9 = rest.slice(1);
    } else if (rest.length === 8) {
      without9 = rest; with9 = '9' + rest;
    } else {
      with9 = rest; without9 = rest;
    }
    for (const r of [with9, without9]) {
      set.add(ddd + r);
      set.add('55' + ddd + r);
    }
  }
  return [...set].filter(Boolean);
}

async function userByPhone(phone) {
  const db = getDb();
  const variants = brazilPhoneVariants(phone);
  if (!variants.length) return null;
  // Normaliza a coluna phone no SQL (remove espaço, parênteses, hífen, +, ponto)
  // para casar mesmo com números salvos formatados.
  const norm = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'(',''),')',''),'-',''),'+',''),'.','')";
  const placeholders = variants.map(() => '?').join(',');
  const { rows } = await db.execute({
    sql: `SELECT id, email, name, phone, role, is_admin, last_login FROM users WHERE ${norm} IN (${placeholders})`,
    args: variants,
  });
  return rowsToObjects(rows)[0] || null;
}

async function getConversation(phone) {
  const db = getDb();
  const { rows } = await db.execute({ sql: 'SELECT phone, user_id, pending, history FROM wa_conversations WHERE phone = ?', args: [phone] });
  const row = rowsToObjects(rows)[0];
  if (!row) return { phone, user_id: '', pending: null, history: [] };
  return {
    phone,
    user_id: row.user_id || '',
    pending: row.pending ? safeParse(row.pending) : null,
    history: row.history ? safeParse(row.history) || [] : [],
  };
}

async function saveConversation(phone, userId, pending, history) {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO wa_conversations (phone, user_id, pending, history, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(phone) DO UPDATE SET user_id=excluded.user_id, pending=excluded.pending, history=excluded.history, updated_at=excluded.updated_at`,
    args: [phone, userId || '', pending ? JSON.stringify(pending) : '', history ? JSON.stringify(history.slice(-6)) : ''],
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Registra a interação (entrada + resposta) no painel (tabela wa_interactions).
async function logInteraction({ phone, user, inType, inText, outText, action }) {
  try {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO wa_interactions (id, phone, user_id, user_name, in_type, in_text, out_text, action, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(), phone || '', user?.id || '', user?.name || '',
        inType || 'text', String(inText || '').slice(0, 1000), String(outText || '').slice(0, 1000),
        action || '', new Date().toISOString(),
      ],
    });
  } catch (e) { console.error('[assistant] log de interação falhou', e?.message); }
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

// ── Snapshot financeiro (respeitando o nível de acesso) ──────────────────────

async function getSelfSnapshot(userId) {
  const db = getDb();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [{ rows: accRows }, { rows: paidRows }, { rows: monthRows }] = await Promise.all([
    db.execute({ sql: 'SELECT COALESCE(SUM(initial_balance),0) as bal FROM accounts WHERE user_id=?', args: [userId] }),
    db.execute({
      sql: `SELECT
              COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END),0) as income_paid,
              COALESCE(SUM(CASE WHEN transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END),0) as expense_paid
            FROM transactions WHERE user_id=? AND status='paid'`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT
              COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END),0) as income_month,
              COALESCE(SUM(CASE WHEN transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END),0) as expense_month,
              COALESCE(SUM(CASE WHEN status='pending' AND transaction_type IN ('expense','general','daily','installment') THEN amount ELSE 0 END),0) as expense_pending
            FROM transactions WHERE user_id=? AND month=? AND year=?`,
      args: [userId, month, year],
    }),
  ]);
  const acc = rowsToObjects(accRows)[0] || {};
  const paid = rowsToObjects(paidRows)[0] || {};
  const mon = rowsToObjects(monthRows)[0] || {};
  const saldo = Number(acc.bal || 0) + Number(paid.income_paid || 0) - Number(paid.expense_paid || 0);
  return {
    saldo_atual: brl(saldo),
    receitas_mes: brl(mon.income_month),
    despesas_mes: brl(mon.expense_month),
    despesas_pendentes_mes: brl(mon.expense_pending),
    mes_referencia: `${String(month).padStart(2, '0')}/${year}`,
  };
}

async function getAdminSnapshot() {
  const db = getDb();
  const [{ rows: totRows }, { rows: userRows }] = await Promise.all([
    db.execute('SELECT COUNT(*) as total FROM users WHERE is_admin=0'),
    db.execute(`SELECT u.name, u.email,
        COALESCE(SUM(CASE WHEN t.transaction_type='income' THEN t.amount ELSE 0 END),0) as income,
        COALESCE(SUM(CASE WHEN t.transaction_type IN ('expense','general','daily','installment') THEN t.amount ELSE 0 END),0) as expense,
        COUNT(t.id) as tx_count
      FROM users u LEFT JOIN transactions t ON t.user_id=u.id
      WHERE u.is_admin=0
      GROUP BY u.id ORDER BY tx_count DESC LIMIT 20`),
  ]);
  const total = rowsToObjects(totRows)[0]?.total || 0;
  const users = rowsToObjects(userRows).map((u) => ({
    nome: u.name || u.email,
    receitas: brl(u.income),
    despesas: brl(u.expense),
    lancamentos: Number(u.tx_count || 0),
  }));
  return { total_usuarios: total, usuarios: users };
}

function brl(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}

// ── Registro de lançamento ───────────────────────────────────────────────────

async function insertTransaction(userId, { name, amount, type, kind, accountId }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const iso = now.toISOString();
  const today = iso.slice(0, 10);
  await db.execute({
    sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, cash_date, month, year, notes, category_id, template_id, account_id, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, 'Registrado via WhatsApp', '', '', ?, 'whatsapp', ?)`,
    args: [id, userId, name || 'Lançamento', Number(amount) || 0, type === 'income' ? 'income' : 'expense', kind === 'fixed' ? 'fixed' : 'variable', today, today, today, now.getMonth() + 1, now.getFullYear(), accountId || '', iso],
  });
  return id;
}

// Cria uma conta/carteira do usuário. O saldo informado vira o saldo inicial
// (initial_balance), NUNCA uma receita/lançamento.
async function insertAccount(userId, { name, bank_name, initial_balance, type }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  await db.execute({
    sql: `INSERT INTO accounts (id, user_id, name, bank_name, type, currency, initial_balance, initial_balance_date, notes, created_at)
          VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, 'Criada via WhatsApp', datetime('now'))`,
    args: [id, userId, name || 'Conta', bank_name || '', type || 'checking', Number(initial_balance) || 0, today],
  });
  return id;
}

async function getUserAccounts(userId) {
  const db = getDb();
  const { rows } = await db.execute({ sql: 'SELECT id, name, bank_name, initial_balance FROM accounts WHERE user_id=?', args: [userId] });
  return rowsToObjects(rows);
}

// Casa o nome citado pelo usuário ("no Nubank") com uma conta existente.
function findAccountByName(accounts, name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  if (!n) return null;
  return accounts.find((a) => {
    const an = String(a.name || '').toLowerCase();
    const bn = String(a.bank_name || '').toLowerCase();
    return an === n || bn === n || (an && (an.includes(n) || n.includes(an))) || (bn && (bn.includes(n) || n.includes(bn)));
  }) || null;
}

// ── Gestão de usuários do sistema (somente admin) ────────────────────────────

// Normaliza telefone BR p/ o formato canônico: 55 + DDD(2) + 9 + 8 dígitos.
// Retorna '' se vazio; null se inválido; caso contrário o número canônico.
function canonicalBrazilPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  let local = d;
  if (local.length > 11 && local.startsWith('55')) local = local.slice(2);
  if (local.length < 10 || local.length > 11) return null;
  const ddd = local.slice(0, 2);
  let rest = local.slice(2);
  if (rest.length === 10) rest = rest.slice(-9);
  if (rest.length === 8 && /^[6-9]/.test(rest)) rest = '9' + rest;
  return '55' + ddd + rest;
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return 'Lf' + Array.from(bytes).map((b) => b.toString(36)).join('').slice(0, 8);
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

// Cria um usuário do sistema (mesma lógica do painel admin). Retorna {ok, id?, error?}.
async function createSystemUser({ name, email, password, phone }) {
  const db = getDb();
  const mail = String(email || '').toLowerCase().trim();
  if (!name || !mail || !password) return { ok: false, error: 'faltam dados obrigatórios' };
  if (!isValidEmail(mail)) return { ok: false, error: 'e-mail inválido' };
  if (String(password).length < 8) return { ok: false, error: 'senha mínima de 8 caracteres' };
  const normalizedPhone = canonicalBrazilPhone(phone);
  if (phone && String(phone).replace(/\D/g, '').length && normalizedPhone === null) {
    return { ok: false, error: 'telefone inválido' };
  }
  const { rows: existing } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [mail] });
  if (rowsToObjects(existing).length > 0) return { ok: false, error: 'e-mail já cadastrado' };
  const hash = await bcrypt.hash(String(password), 10);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute({
    sql: 'INSERT INTO users (id, email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, mail, hash, name, normalizedPhone || '', now],
  });
  await db.execute({
    sql: 'INSERT INTO user_plans (id, user_id, email, name, monthly_fee, active) VALUES (?, ?, ?, ?, 0, 1)',
    args: [crypto.randomUUID(), id, mail, name],
  });
  return { ok: true, id };
}

// Localiza um usuário-alvo por e-mail (exato) ou nome (parcial). Ignora admins? Não —
// admin pode gerenciar qualquer conta comum; evitamos alvejar a si mesmo em delete.
async function findSystemUser(query) {
  const db = getDb();
  const q = String(query || '').trim();
  if (!q) return null;
  if (isValidEmail(q)) {
    const { rows } = await db.execute({ sql: 'SELECT id, name, email, phone, is_admin FROM users WHERE email = ?', args: [q.toLowerCase()] });
    return rowsToObjects(rows)[0] || null;
  }
  const { rows } = await db.execute({ sql: 'SELECT id, name, email, phone, is_admin FROM users WHERE LOWER(name) LIKE ? LIMIT 2', args: [`%${q.toLowerCase()}%`] });
  const found = rowsToObjects(rows);
  return found.length === 1 ? found[0] : null; // ambíguo → null (pede e-mail)
}

async function updateSystemUser(id, { name, phone, password }) {
  const db = getDb();
  const sets = [];
  const args = [];
  if (name) { sets.push('name = ?'); args.push(name); }
  if (phone !== undefined && phone !== null && phone !== '') {
    const np = canonicalBrazilPhone(phone);
    if (np === null) return { ok: false, error: 'telefone inválido' };
    sets.push('phone = ?'); args.push(np);
  }
  if (password) {
    if (String(password).length < 8) return { ok: false, error: 'senha mínima de 8 caracteres' };
    sets.push('password_hash = ?'); args.push(await bcrypt.hash(String(password), 10));
  }
  if (!sets.length) return { ok: false, error: 'nada para atualizar' };
  args.push(id);
  await db.execute({ sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args });
  return { ok: true };
}

async function deleteSystemUser(id) {
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM user_plans WHERE user_id = ?', args: [id] });
  return { ok: true };
}

// Executa a operação de gestão de usuário conforme a coleta multi-turno.
// Retorna { answer, pending } — pending mantém a coleta em andamento.
async function runManageUser(adminUser, userOp, pending) {
  const op = userOp.op || pending?.op || 'create';

  if (op === 'create') {
    const f = { ...(pending?.fields || {}) };
    for (const k of ['name', 'email', 'password', 'phone']) {
      if (userOp[k] != null && String(userOp[k]).trim() !== '') f[k] = String(userOp[k]).trim();
    }
    if ((userOp.generate_password || pending?.generate) && !f.password) f.password = randomPassword();

    const missing = [];
    if (!f.name) missing.push('nome completo');
    if (!f.email) missing.push('e-mail');
    if (!f.phone) missing.push('telefone com DDD (obrigatório)');
    if (!f.password) missing.push('senha (mín. 8 caracteres) — ou diga "gerar senha"');
    if (missing.length) {
      return {
        pending: { type: 'admin_user', op: 'create', fields: f, generate: !!(userOp.generate_password || pending?.generate) },
        answer: `Certo! Para criar o usuário, ainda preciso de: ${missing.join(', ')}. Pode me enviar?`,
      };
    }
    const r = await createSystemUser(f);
    if (!r.ok) {
      // Mantém o que já foi coletado e pede a correção do dado problemático.
      const clearPwd = /senha/.test(r.error);
      const nf = { ...f };
      if (/e-mail já/.test(r.error) || /e-mail inválido/.test(r.error)) nf.email = undefined;
      if (clearPwd) nf.password = undefined;
      if (/telefone/.test(r.error)) nf.phone = undefined;
      return {
        pending: { type: 'admin_user', op: 'create', fields: nf },
        answer: `Não consegui concluir: ${r.error}. Pode me reenviar esse dado corrigido?`,
      };
    }
    return {
      pending: { type: 'admin_user', op: 'notify_welcome', notify: { name: f.name, email: f.email, password: f.password, phone: f.phone } },
      answer: `Pronto! Usuário *${f.name}* (${f.email}) criado com sucesso. ✅\nSenha: *${f.password}*\n\nDeseja que eu informe o usuário dos dados de acesso? Vou enviar e-mail e WhatsApp com login, senha e link de acesso. (responda "sim" ou "não")`,
    };
  }

  if (op === 'edit') {
    const target = await findSystemUser(userOp.target || pending?.target);
    if (!target) {
      return { pending: { type: 'admin_user', op: 'edit', changes: { name: userOp.name, phone: userOp.phone, password: userOp.password } },
        answer: 'Qual usuário você quer editar? Me diga o e-mail dele (mais preciso) ou o nome exato.' };
    }
    const changes = { ...(pending?.changes || {}) };
    for (const k of ['name', 'phone', 'password']) if (userOp[k] != null && String(userOp[k]).trim() !== '') changes[k] = String(userOp[k]).trim();
    if (!changes.name && !changes.phone && !changes.password) {
      return { pending: { type: 'admin_user', op: 'edit', target: target.email }, answer: `Encontrei ${target.name} (${target.email}). O que deseja alterar? (nome, telefone ou senha)` };
    }
    const r = await updateSystemUser(target.id, changes);
    if (!r.ok) return { pending: { type: 'admin_user', op: 'edit', target: target.email }, answer: `Não consegui atualizar: ${r.error}. Pode reenviar?` };
    return { pending: null, answer: `Feito! Dados de ${target.name} (${target.email}) atualizados. ✅` };
  }

  if (op === 'delete') {
    const target = await findSystemUser(userOp.target || pending?.target);
    if (!target) {
      return { pending: { type: 'admin_user', op: 'delete' }, answer: 'Qual usuário você quer excluir? Me envie o e-mail dele para eu confirmar.' };
    }
    if (target.id === adminUser.id) {
      return { pending: null, answer: 'Por segurança, não posso excluir a sua própria conta de administrador. 🙂' };
    }
    // Confirmação explícita antes de excluir.
    if (!pending || pending.op !== 'delete_confirm' || pending.target !== target.email) {
      return { pending: { type: 'admin_user', op: 'delete_confirm', target: target.email },
        answer: `⚠️ Confirmar exclusão de *${target.name}* (${target.email})? Isso remove o usuário e todos os dados dele. Responda "sim" para confirmar ou "não" para cancelar.` };
    }
    const r = await deleteSystemUser(target.id);
    return { pending: null, answer: r.ok ? `Usuário ${target.name} (${target.email}) excluído. ✅` : 'Não consegui excluir agora. Tente de novo.' };
  }

  return { pending: null, answer: 'Não entendi a operação de usuário. Você quer criar, editar ou excluir?' };
}

// Envia os dados de acesso (login, senha, link) ao novo usuário por e-mail e WhatsApp.
// force=true no e-mail: envio confirmado pelo admin, ignora opt-out.
async function notifyWelcome(inst, notify) {
  const appUrl = process.env.APP_URL || 'https://app.lumersbpo.com.br';
  const vars = { name: notify.name, login: notify.email, password: notify.password, app_url: appUrl };
  let emailOk = false, waOk = false, emailErr = '';
  try {
    const r = await sendTemplateEmail({ to: notify.email, toName: notify.name, systemKey: 'welcome_credentials', vars, force: true });
    emailOk = !!r.ok;
    if (!r.ok) emailErr = r.error || 'falha no envio';
  } catch (e) { emailErr = e?.message || 'erro'; console.error('[assistant] welcome email falhou', e?.message); }

  const wphone = canonicalBrazilPhone(notify.phone);
  if (wphone) {
    const waText = `Olá, ${firstName(notify.name)}! 🎉\n\nA sua conta na Lumers Flow foi criada com sucesso.\n\n🔑 *Dados de acesso*\nLogin: ${notify.email}\nSenha: ${notify.password}\nAcesse: ${appUrl}\n\nRecomendamos trocar a senha após o primeiro acesso.`;
    try { await sendText({ name: inst.name, key: inst.api_key || null, number: wphone, text: waText }); waOk = true; }
    catch (e) { console.error('[assistant] welcome whatsapp falhou', e?.message); }
  }

  const parts = [
    emailOk ? '✅ e-mail enviado' : `⚠️ e-mail não enviado${emailErr ? ` (${emailErr})` : ''}`,
    wphone ? (waOk ? '✅ WhatsApp enviado' : '⚠️ WhatsApp não enviado') : '',
  ].filter(Boolean);
  return { answer: `Notifiquei ${firstName(notify.name)}:\n${parts.join('\n')}` };
}

// ── Solicitação de acesso (número não cadastrado → aprovação por admin) ───────

// Pedido de acesso ainda pendente vindo deste número (evita reabrir a coleta).
async function getOpenSignupByPhone(phone) {
  const db = getDb();
  const variants = brazilPhoneVariants(phone);
  if (!variants.length) return null;
  const norm = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'(',''),')',''),'-',''),'+',''),'.','')";
  const ph = variants.map(() => '?').join(',');
  const { rows } = await db.execute({
    sql: `SELECT id, name, email, phone, status FROM signup_requests WHERE status='pending' AND ${norm} IN (${ph}) ORDER BY created_at DESC LIMIT 1`,
    args: variants,
  });
  return rowsToObjects(rows)[0] || null;
}

async function createSignupRequest({ name, email, phone }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const ph = canonicalBrazilPhone(phone) || String(phone || '').replace(/\D/g, '');
  await db.execute({
    sql: `INSERT INTO signup_requests (id, name, email, phone, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))`,
    args: [id, name, String(email).toLowerCase().trim(), ph],
  });
  return id;
}

// Localiza um pedido pendente pelo código curto (prefixo do id) enviado ao admin.
async function findSignupByCode(code) {
  const db = getDb();
  const c = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c.length < 4) return null;
  const { rows } = await db.execute({
    sql: `SELECT id, name, email, phone, status FROM signup_requests WHERE status='pending' AND lower(id) LIKE ? ORDER BY created_at DESC LIMIT 2`,
    args: [c + '%'],
  });
  const found = rowsToObjects(rows);
  return found.length === 1 ? found[0] : null;
}

// Único pedido pendente (permite o admin responder só "aprovar" sem código).
async function getSingleOpenSignup() {
  const db = getDb();
  const { rows } = await db.execute(
    "SELECT id, name, email, phone, status FROM signup_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 2"
  );
  const f = rowsToObjects(rows);
  return f.length === 1 ? f[0] : null;
}

// Telefones (canônicos) dos administradores com WhatsApp cadastrado.
async function listAdminPhones() {
  const db = getDb();
  const { rows } = await db.execute(
    "SELECT name, phone FROM users WHERE (is_admin=1 OR role IN ('admin','super_admin')) AND NULLIF(phone,'') IS NOT NULL"
  );
  return rowsToObjects(rows)
    .map((a) => ({ name: a.name, phone: canonicalBrazilPhone(a.phone) }))
    .filter((a) => a.phone);
}

async function notifyAdminsNewSignup(inst, req) {
  const admins = await listAdminPhones();
  const code = String(req.id).slice(0, 6);
  const text = `🆕 *Nova solicitação de acesso* ao Lumers Flow\n\n👤 Nome: ${req.name}\n✉️ E-mail: ${req.email}\n📱 WhatsApp: ${req.phone}\n\nPara liberar, responda:\n*aprovar #${code}*\nPara negar:\n*recusar #${code}*`;
  for (const a of admins) {
    try { await sendText({ name: inst.name, key: inst.api_key || null, number: a.phone, text }); }
    catch (e) { console.error('[assistant] notificar admin de cadastro falhou', e?.message); }
  }
  return admins.length;
}

// Aprova o pedido: cria o usuário, marca aprovado e envia os dados de acesso.
async function approveSignup(inst, req, adminUser) {
  const db = getDb();
  const password = randomPassword();
  const r = await createSystemUser({ name: req.name, email: req.email, password, phone: req.phone });
  if (!r.ok) {
    if (/e-mail já/.test(r.error)) {
      await db.execute({ sql: "UPDATE signup_requests SET status='approved', decided_at=datetime('now'), decided_by=? WHERE id=?", args: [adminUser.id, req.id] });
      return { answer: `A conta de *${req.name}* (${req.email}) já existia — marquei o pedido como resolvido. ✅` };
    }
    return { answer: `Não consegui criar a conta de ${req.name}: ${r.error}. O pedido segue pendente.` };
  }
  await db.execute({ sql: "UPDATE signup_requests SET status='approved', decided_at=datetime('now'), decided_by=? WHERE id=?", args: [adminUser.id, req.id] });
  await notifyWelcome(inst, { name: req.name, email: req.email, password, phone: req.phone });
  return { answer: `✅ Cadastro de *${req.name}* (${req.email}) aprovado! A conta foi criada e os dados de acesso foram enviados por e-mail e WhatsApp.` };
}

async function rejectSignup(inst, req, adminUser) {
  const db = getDb();
  await db.execute({ sql: "UPDATE signup_requests SET status='rejected', decided_at=datetime('now'), decided_by=? WHERE id=?", args: [adminUser.id, req.id] });
  const wphone = canonicalBrazilPhone(req.phone);
  if (wphone) {
    try { await sendText({ name: inst.name, key: inst.api_key || null, number: wphone, text: `Olá, ${firstName(req.name)}. Sua solicitação de acesso ao Lumers Flow não foi aprovada no momento. Em caso de dúvida, fale com o administrador. 🙂` }); }
    catch (e) { console.error('[assistant] aviso de recusa falhou', e?.message); }
  }
  return { answer: `Cadastro de *${req.name}* (${req.email}) recusado. O solicitante foi avisado.` };
}

// Máquina de estados da coleta de solicitação de acesso para números não cadastrados.
async function handleUnknownUser({ phone, text, inType, reply, inst }) {
  const conv = await getConversation(phone);
  const pend = conv.pending?.type === 'signup' ? conv.pending : null;
  const t = String(text || '').trim();

  // Já existe pedido em análise → não reabre a coleta.
  const open = await getOpenSignupByPhone(phone);
  if (open && !pend) {
    const out = `Olá! Já recebemos a sua solicitação de acesso (em nome de ${open.name}). Ela está em análise por um administrador — assim que for aprovada, você recebe os dados de acesso por aqui e por e-mail. 🙂`;
    await reply(out);
    await logInteraction({ phone, user: null, inType, inText: t, outText: out, action: 'signup_pending' });
    return { handled: true, reason: 'signup_pending' };
  }

  // Sem coleta em andamento → inicia pedindo o nome.
  if (!pend) {
    const out = 'Olá! 👋 Este número ainda não tem acesso ao Lumers Flow. Posso registrar a sua *solicitação de acesso* para um administrador aprovar.\n\nPara começar, me diga o seu *nome completo*.';
    await reply(out);
    await saveConversation(phone, '', { type: 'signup', step: 'name', data: {} }, conv.history || []);
    await logInteraction({ phone, user: null, inType, inText: t, outText: out, action: 'signup_start' });
    return { handled: true, reason: 'signup_start' };
  }

  const data = { ...(pend.data || {}) };

  if (pend.step === 'name') {
    if (t.length < 2) { await reply('Preciso do seu nome completo para seguir. Como você se chama?'); return { handled: true, reason: 'signup_name_invalid' }; }
    data.name = t;
    const out = `Prazer, ${firstName(data.name)}! Agora me envie o seu *e-mail* para acesso.`;
    await reply(out);
    await saveConversation(phone, '', { type: 'signup', step: 'email', data }, conv.history || []);
    await logInteraction({ phone, user: null, inType, inText: t, outText: out, action: 'signup_name' });
    return { handled: true, reason: 'signup_name' };
  }

  if (pend.step === 'email') {
    const email = t.toLowerCase();
    if (!isValidEmail(email)) { await reply('Esse e-mail não parece válido. Pode conferir e reenviar? (ex.: nome@email.com)'); return { handled: true, reason: 'signup_email_invalid' }; }
    const db = getDb();
    const { rows: ex } = await db.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [email] });
    if (rowsToObjects(ex).length) {
      const out = 'Esse e-mail já possui cadastro no Lumers Flow. Se é você, acesse com a sua senha em https://app.lumersbpo.com.br (ou use "Esqueci minha senha"). 🙂';
      await reply(out);
      await saveConversation(phone, '', null, conv.history || []);
      await logInteraction({ phone, user: null, inType, inText: email, outText: out, action: 'signup_email_exists' });
      return { handled: true, reason: 'signup_email_exists' };
    }
    data.email = email;
    const reqId = await createSignupRequest({ name: data.name, email: data.email, phone });
    await saveConversation(phone, '', null, conv.history || []);
    const n = await notifyAdminsNewSignup(inst, { id: reqId, name: data.name, email: data.email, phone: canonicalBrazilPhone(phone) || phone });
    const out = n
      ? `Perfeito, ${firstName(data.name)}! ✅ Sua solicitação foi enviada para aprovação de um administrador. Assim que for aprovada, você recebe os dados de acesso por aqui e por e-mail.`
      : `Recebi seus dados, ${firstName(data.name)}. Ainda não há um administrador com WhatsApp para aprovar agora, mas o pedido ficou registrado e será analisado em breve.`;
    await reply(out);
    await logInteraction({ phone, user: null, inType, inText: data.email, outText: out, action: 'signup_submitted' });
    return { handled: true, reason: 'signup_submitted' };
  }

  // Estado inesperado → recomeça a coleta.
  await reply('Vamos recomeçar sua solicitação de acesso. Qual é o seu *nome completo*?');
  await saveConversation(phone, '', { type: 'signup', step: 'name', data: {} }, conv.history || []);
  return { handled: true, reason: 'signup_reset' };
}

// ── Núcleo: classificação de intenção via Groq ───────────────────────────────

function buildSystemPrompt(user, accounts = []) {
  const isAdmin = user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin';
  const accList = accounts.length
    ? accounts.map((a) => `- ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n')
    : '- (nenhuma conta/carteira cadastrada ainda)';
  return `Você é o assistente financeiro do Lumers Flow no WhatsApp. Fale sempre em português do Brasil, de forma breve, cordial e objetiva. Seu objetivo é simplificar ao máximo a gestão financeira do usuário — faça as operações por ele e só pergunte quando for realmente necessário.

USUÁRIO ATUAL:
- Nome: ${user.name || 'Sem nome'}
- Nível de acesso: ${isAdmin ? 'ADMINISTRADOR (pode consultar dados de todos os usuários)' : 'USUÁRIO COMUM (só pode acessar a própria conta)'}

CONTAS/CARTEIRAS JÁ CADASTRADAS DO USUÁRIO:
${accList}

REGRAS DE ACESSO:
- Usuário comum: NUNCA revele dados de outros usuários. query_scope sempre "self".
- Administrador: pode usar query_scope "all_users" quando perguntar sobre todos os usuários/base.

O QUE VOCÊ PODE FAZER:
1. Registrar lançamentos (receitas e despesas) a partir de texto, áudio (já transcrito) ou print (já descrito).
2. Criar contas/carteiras bancárias (ex.: "cadastre a carteira Nubank com saldo de R$200"). Um SALDO informado ao criar uma conta é o SALDO INICIAL da conta — NÃO é uma receita/lançamento.
3. Responder consultas sobre saldo, receitas, despesas e resumos.
4. Conversar e orientar sobre o uso.${isAdmin ? `
5. GESTÃO DE USUÁRIOS DO SISTEMA (apenas admin): criar, editar e excluir contas de usuários do Lumers Flow. Use action "manage_user" e preencha "user_op".
   - Criar: op="create". Colete nome completo, e-mail, telefone com DDD (OBRIGATÓRIO) e senha (mín. 8 caracteres). Se o admin disser "gere/gerar senha", marque generate_password=true. NÃO invente dados: extraia só o que o admin informar; os dados que faltarem serão pedidos automaticamente. Após criar, o sistema pergunta se deve notificar o novo usuário dos dados de acesso.
   - Editar: op="edit", "target" = e-mail ou nome do usuário; preencha os campos a alterar (name, phone, password).
   - Excluir: op="delete", "target" = e-mail ou nome do usuário.
   Não confunda "usuário do sistema" com "conta/carteira bancária" (create_account).` : ''}

REGRAS DE CLASSIFICAÇÃO (siga com atenção):
- CRIAR CONTA/CARTEIRA: se o usuário pedir para "criar/cadastrar/adicionar/abrir" uma "conta", "carteira", "banco" (ex.: Nubank, Itaú, PicPay) — mesmo mencionando um saldo — use action "create_account" e preencha "account" com { name, bank_name, initial_balance, type }. NUNCA registre isso como receita. Se o nome for de um banco conhecido, use-o também em bank_name. type: "checking" (conta corrente, padrão), "savings" (poupança) ou "wallet" (carteira/dinheiro).
- REGISTRAR LANÇAMENTO: use action "register" com type "income" (receita/entrada) ou "expense" (despesa/saída). Se o usuário citar uma conta ("no Nubank", "pelo Itaú"), preencha transaction.account_name com esse nome. Se ele indicar que é fixo/recorrente ou variável/avulso, preencha transaction.kind ("fixed" ou "variable"); na dúvida deixe null.
- Se o usuário quer registrar um valor mas NÃO está claro se é RECEITA ou DESPESA (e não é criação de conta), use action "clarify" e pergunte gentilmente.

Responda SEMPRE em JSON válido com este formato exato:
{
  "action": "register" | "create_account" | "manage_user" | "clarify" | "query" | "answer",
  "transaction": { "name": "string curta do lançamento", "amount": number, "type": "income" | "expense" | null, "kind": "fixed" | "variable" | null, "account_name": "string" | null },
  "account": { "name": "string", "bank_name": "string", "initial_balance": number, "type": "checking" | "savings" | "wallet" | null },
  "user_op": { "op": "create" | "edit" | "delete" | null, "name": "string" | null, "email": "string" | null, "password": "string" | null, "phone": "string" | null, "target": "string" | null, "generate_password": boolean },
  "query_scope": "self" | "all_users",
  "reply": "texto para enviar ao usuário no WhatsApp"
}
- Em "register": preencha transaction e um "reply" confirmando.
- Em "create_account": preencha account e um "reply" confirmando a criação.
- Em "manage_user" (apenas admin): preencha user_op; o sistema conduz a coleta e responde.
- Em "clarify": "reply" deve ser a pergunta (ex.: isso é uma receita ou uma despesa?).
- Em "query": defina query_scope; "reply" pode ficar vazio (será preenchido depois com os dados).
- Em "answer": "reply" com a resposta.`;
}

// ── Ponto de entrada: processa UMA mensagem recebida ─────────────────────────

export async function handleAssistantMessage(msg, instanceName) {
  const cfg = await getAiConfig();
  if (!cfg.enabled) return { handled: false, reason: 'ai_disabled' };

  const remoteJid = msg.key?.remoteJid || '';
  const phone = remoteJid.split('@')[0].replace(/\D/g, '');
  if (!phone) return { handled: false, reason: 'no_phone' };

  const inst = (await getDefaultInstance()) || { name: instanceName, api_key: null };
  const reply = (text) => sendText({ name: inst.name, key: inst.api_key || null, number: phone, text }).catch((e) => console.error('[assistant] reply falhou', e?.message));

  const user = await userByPhone(phone);

  const m = msg.message || {};
  const inType = m.audioMessage ? 'audio' : m.imageMessage ? 'image' : m.videoMessage ? 'video' : 'text';
  const quickText = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '';

  // Número não cadastrado → fluxo de solicitação de acesso (aprovação por admin).
  if (!user) {
    return handleUnknownUser({ phone, text: quickText, inType, reply, inst });
  }

  const isAdmin = user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin';

  // Primeiro login obrigatório: usuário comum que NUNCA acessou o sistema não pode
  // operar pelo WhatsApp antes de concluir o primeiro login no app. Admin é isento
  // (precisa do WhatsApp para aprovar solicitações e sempre tem acesso ao painel).
  if (!isAdmin && !user.last_login) {
    const appUrl = process.env.APP_URL || 'https://app.lumersbpo.com.br';
    const out = `Oi, ${firstName(user.name)}! 👋 Antes de usar o assistente pelo WhatsApp, você precisa fazer o *seu primeiro acesso* no sistema:\n\n1️⃣ Acesse ${appUrl}\n2️⃣ Entre com o seu e-mail (${user.email}) e a senha que você recebeu\n3️⃣ Depois é só voltar aqui que a gente começa 😉\n\nSe não tem a senha ou esqueceu, toque em "Esqueci minha senha" na tela de acesso.`;
    await reply(out);
    await logInteraction({ phone, user, inType, inText: quickText, outText: out, action: 'login_required' });
    return { handled: true, reason: 'login_required' };
  }

  // Vídeo não é suportado
  if (m.videoMessage) {
    const out = `Oi, ${firstName(user.name)}! Ainda não consigo entender vídeos. Você pode me mandar por texto, áudio ou um print. 🙂`;
    await reply(out);
    await logInteraction({ phone, user, inType, inText: '', outText: out, action: 'video_unsupported' });
    return { handled: true, reason: 'video_unsupported' };
  }

  // Extrai o conteúdo textual da mensagem (texto direto, ou via áudio/imagem)
  let userText = '';
  let imageContext = '';
  try {
    if (m.conversation) {
      userText = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      userText = m.extendedTextMessage.text;
    } else if (m.audioMessage) {
      // Áudio é transcrito pelo Groq Whisper (cota própria, separada do Gemini).
      // Fallback para o Gemini caso só a chave do Gemini esteja configurada.
      if (!cfg.groqKey && !cfg.geminiKey) { await reply('Recebi seu áudio, mas a interpretação de áudio ainda não está configurada. Pode me mandar por texto? 🙂'); return { handled: true, reason: 'no_audio_provider' }; }
      const b64 = await getMediaBase64(inst.name, inst.api_key, msg.key);
      const mime = m.audioMessage.mimetype || 'audio/ogg';
      if (b64) {
        userText = cfg.groqKey
          ? await groqTranscribeAudio({ key: cfg.groqKey, base64: b64, mime })
          : await geminiTranscribeAudio({ key: cfg.geminiKey, model: cfg.geminiModel, base64: b64, mime });
      }
    } else if (m.imageMessage) {
      // Print/imagem é lido pelo Groq (visão, cota própria). Fallback para o Gemini.
      if (!cfg.groqKey && !cfg.geminiKey) { await reply('Recebi seu print, mas a interpretação de imagens ainda não está configurada. Pode me mandar os dados por texto? 🙂'); return { handled: true, reason: 'no_image_provider' }; }
      const b64 = await getMediaBase64(inst.name, inst.api_key, msg.key);
      const mime = m.imageMessage.mimetype || 'image/jpeg';
      if (b64) {
        imageContext = cfg.groqKey
          ? await groqReadImage({ key: cfg.groqKey, base64: b64, mime })
          : await geminiReadImage({ key: cfg.geminiKey, model: cfg.geminiModel, base64: b64, mime });
      }
      userText = m.imageMessage.caption || '';
    }
  } catch (e) {
    console.error('[assistant] extração de mídia falhou', e?.message);
    const quota = /\b429\b|quota|rate.?limit/i.test(e?.message || '');
    await reply(
      quota
        ? 'A cota da IA de áudio/imagem atingiu o limite momentâneo. Tente de novo em alguns minutos, ou me mande por texto. 🙏'
        : 'Tive um problema ao processar sua mensagem. Pode tentar de novo? 🙏',
    );
    return { handled: true, reason: quota ? 'media_quota' : 'media_error' };
  }

  if (!userText && !imageContext) {
    await reply(`Oi, ${firstName(user.name)}! Não consegui entender o conteúdo. Pode me mandar por texto, áudio ou print? 🙂`);
    return { handled: true, reason: 'empty' };
  }

  if (!cfg.groqKey) {
    await reply('O assistente de IA ainda não está totalmente configurado. Avise o administrador. 🙂');
    return { handled: true, reason: 'no_groq' };
  }

  // Decisão de solicitação de acesso pelo admin ("aprovar #cod" / "recusar #cod"),
  // tratada fora do classificador de IA. Só sequestra a mensagem se houver um pedido
  // pendente correspondente; caso contrário, segue para o fluxo normal.
  if (isAdmin && /\b(aprovar|aprova|aprovo|liberar|libera|recusar|recusa|negar|nega|rejeitar|rejeita)\b/i.test(userText || '')) {
    const isApprove = /\b(aprovar|aprova|aprovo|liberar|libera)\b/i.test(userText);
    const stripped = userText.replace(/\b(aprovar|aprova|aprovo|liberar|libera|recusar|recusa|negar|nega|rejeitar|rejeita)\b/gi, ' ');
    const codeM = /#?([a-f0-9]{4,8})/i.exec(stripped);
    let sreq = codeM ? await findSignupByCode(codeM[1]) : null;
    if (!sreq) sreq = await getSingleOpenSignup();
    if (sreq) {
      const r = isApprove ? await approveSignup(inst, sreq, user) : await rejectSignup(inst, sreq, user);
      await reply(r.answer);
      await logInteraction({ phone, user, inType, inText: userText, outText: r.answer, action: isApprove ? 'signup_approved' : 'signup_rejected' });
      return { handled: true, reason: 'signup_decision' };
    }
  }

  const conv = await getConversation(phone);

  // Monta a mensagem para o classificador, incluindo contexto pendente e de imagem
  let combined = userText || '';
  if (imageContext) combined += `\n\n[Conteúdo extraído do print enviado]: ${imageContext}`;
  if (conv.pending?.type === 'transaction') {
    combined = `[CONTEXTO: o usuário estava registrando "${conv.pending.name}" no valor de ${brl(conv.pending.amount)} e você perguntou se é RECEITA ou DESPESA. A mensagem atual provavelmente responde isso.]\n\n${combined}`;
  } else if (conv.pending?.type === 'admin_user') {
    const collected = conv.pending.op === 'create'
      ? `Dados já coletados: ${JSON.stringify(conv.pending.fields || {})}.`
      : `Operação em andamento: ${conv.pending.op}${conv.pending.target ? ` (alvo: ${conv.pending.target})` : ''}.`;
    combined = `[CONTEXTO: uma operação de GESTÃO DE USUÁRIO (op=${conv.pending.op}) está em andamento. ${collected} A mensagem atual provavelmente fornece o(s) dado(s) que faltavam. Use action "manage_user" e preencha user_op apenas com o que a mensagem trouxer.]\n\n${combined}`;
  }

  const accounts = await getUserAccounts(user.id);

  let intent;
  try {
    const raw = await groqChat({
      key: cfg.groqKey,
      model: cfg.groqModel,
      jsonMode: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(user, accounts) },
        ...(conv.history || []).map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: combined },
      ],
    });
    intent = safeParse(raw) || { action: 'answer', reply: raw };
  } catch (e) {
    console.error('[assistant] groq falhou', e?.message);
    await reply('Não consegui pensar na resposta agora. Pode tentar de novo em instantes? 🙏');
    return { handled: true, reason: 'groq_error' };
  }

  let answer = intent.reply || '';
  let newPending = null;

  try {
    if (intent.action === 'clarify' && conv.pending?.type !== 'admin_user') {
      const t = intent.transaction || {};
      newPending = { type: 'transaction', name: t.name || conv.pending?.name || 'Lançamento', amount: t.amount || conv.pending?.amount || 0 };
      answer = intent.reply || 'Esse valor é uma receita (entrada) ou uma despesa (saída)?';
    } else if (intent.action === 'manage_user' || conv.pending?.op === 'delete_confirm' || conv.pending?.op === 'notify_welcome') {
      if (!isAdmin) {
        answer = 'Essa operação é exclusiva para administradores. 🙂';
      } else {
        let userOp = intent.user_op || {};
        // Atalho de confirmação de exclusão: "sim/não" quando aguardando confirmação.
        if (conv.pending?.op === 'delete_confirm') {
          const yes = /\b(sim|confirmo|confirmar|pode|isso|ok|exclui[r]?|deletar)\b/i.test(userText || '');
          const no = /\b(n[ãa]o|cancela|cancelar|deixa|para)\b/i.test(userText || '');
          if (no) { answer = 'Ok, exclusão cancelada. 🙂'; newPending = null; }
          else if (yes) { const r = await runManageUser(user, { op: 'delete', target: conv.pending.target }, conv.pending); answer = r.answer; newPending = r.pending; }
          else { answer = 'Só confirmando: responda "sim" para excluir ou "não" para cancelar.'; newPending = conv.pending; }
        } else if (conv.pending?.op === 'notify_welcome') {
          const yes = /\b(sim|confirmo|confirmar|pode|isso|ok|manda[r]?|envia[r]?|quero)\b/i.test(userText || '');
          const no = /\b(n[ãa]o|deixa|depois|cancela|cancelar|dispensa)\b/i.test(userText || '');
          if (no) { answer = 'Ok, não vou notificar o usuário agora. Você pode repassar os dados de acesso manualmente. 🙂'; newPending = null; }
          else if (yes) { const r = await notifyWelcome(inst, conv.pending.notify); answer = r.answer; newPending = null; }
          else { answer = 'Deseja que eu envie os dados de acesso ao usuário? Responda "sim" ou "não". 🙂'; newPending = conv.pending; }
        } else {
          const r = await runManageUser(user, userOp, conv.pending?.type === 'admin_user' ? conv.pending : null);
          answer = r.answer;
          newPending = r.pending;
        }
      }
    } else if (intent.action === 'create_account') {
      const a = intent.account || {};
      const name = a.name || 'Conta';
      await insertAccount(user.id, { name, bank_name: a.bank_name, initial_balance: a.initial_balance, type: a.type });
      const bal = Number(a.initial_balance) || 0;
      answer = intent.reply || `Pronto, ${firstName(user.name)}! Criei a conta "${name}"${bal ? ` com saldo inicial de ${brl(bal)}` : ''}. ✅`;
    } else if (intent.action === 'register') {
      const t = intent.transaction || {};
      const type = t.type === 'income' ? 'income' : 'expense';
      const amount = Number(t.amount) || Number(conv.pending?.amount) || 0;
      const name = t.name || conv.pending?.name || 'Lançamento';
      if (!amount) {
        newPending = { type: 'transaction', name, amount: 0 };
        answer = 'Entendi o lançamento, mas não peguei o valor. Qual é o valor?';
      } else {
        const acc = findAccountByName(accounts, t.account_name);
        await insertTransaction(user.id, { name, amount, type, kind: t.kind, accountId: acc?.id });
        const accNote = acc ? ` na conta ${acc.name}` : '';
        answer = intent.reply || `Pronto, ${firstName(user.name)}! Registrei ${type === 'income' ? 'a receita' : 'a despesa'} "${name}" de ${brl(amount)}${accNote}. ✅`;
      }
    } else if (intent.action === 'query') {
      const scope = intent.query_scope === 'all_users' && isAdmin ? 'all_users' : 'self';
      const data = scope === 'all_users' ? await getAdminSnapshot() : await getSelfSnapshot(user.id);
      const composed = await groqChat({
        key: cfg.groqKey,
        model: cfg.groqModel,
        messages: [
          { role: 'system', content: `Você é o assistente financeiro do Lumers Flow. Responda em português do Brasil, breve e cordial, usando o primeiro nome do usuário (${firstName(user.name)}). Baseie-se APENAS nos dados fornecidos. Formate valores em reais.` },
          { role: 'user', content: `Pergunta do usuário: "${userText || 'resumo financeiro'}"\n\nDados (${scope === 'all_users' ? 'de todos os usuários' : 'da conta do usuário'}):\n${JSON.stringify(data, null, 2)}` },
        ],
      });
      answer = composed || 'Não encontrei dados para responder agora.';
    } else {
      answer = intent.reply || `Oi, ${firstName(user.name)}! Como posso te ajudar com suas finanças?`;
    }
  } catch (e) {
    console.error('[assistant] execução da ação falhou', e?.message);
    answer = 'Tive um problema ao concluir. Pode tentar de novo? 🙏';
  }

  await reply(answer);

  const history = [...(conv.history || []), { role: 'user', content: combined }, { role: 'assistant', content: answer }];
  await saveConversation(phone, user.id, newPending, history);
  await logInteraction({ phone, user, inType, inText: userText || imageContext || '', outText: answer, action: intent.action });

  return { handled: true, action: intent.action };
}
