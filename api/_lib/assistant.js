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

// Lê o conteúdo de uma imagem/print tentando Groq (visão) e, em falha, o Gemini.
// Retorna o texto extraído (não vazio). Se ambos falharem, lança Error com:
//   .kind = 'tech'  → falha técnica do provedor (API/limite) → função indisponível
//   .kind = 'empty' → provedor respondeu vazio → conteúdo não compreendido
async function readImageContent(cfg, base64, mime) {
  let threw = false;
  const providers = [];
  if (cfg.groqKey)   providers.push('groq');
  if (cfg.geminiKey) providers.push('gemini');
  for (const p of providers) {
    try {
      const t = p === 'groq'
        ? await groqReadImage({ key: cfg.groqKey, base64, mime })
        : await geminiReadImage({ key: cfg.geminiKey, model: cfg.geminiModel, base64, mime });
      if (t && t.trim()) return t.trim();
    } catch (e) {
      threw = true;
      console.error(`[assistant] leitura de imagem (${p}) falhou`, e?.message);
    }
  }
  const err = new Error('image read failed');
  err.kind = threw ? 'tech' : 'empty';
  throw err;
}

// Heurística: o modelo respondeu, mas dizendo que não consegue ler (borrada/ilegível),
// ou o texto é curto demais para ser um comprovante útil.
function imageLooksUnreadable(t) {
  const s = String(t || '').trim().toLowerCase();
  if (s.length < 8) return true;
  return /(n[ãa]o\s+(consigo|foi poss[ií]vel|d[áa]\s+para|consegui)[^.]*(ler|identificar|entender|distinguir|vis))|ileg[íi]vel|muito\s+borrad|imagem\s+borrad|baixa\s+qualidade|n[ãa]o\s+est[áa]\s+n[ií]tid|pouco\s+n[ií]tid|can'?t\s+(read|see)|unable\s+to\s+(read|identify)/i.test(s);
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

// Heurística para decidir se um texto é plausivelmente o NOME de uma pessoa.
// Números não cadastrados costumam mandar como primeira mensagem coisas que NÃO
// são o nome deles (anúncios encaminhados, links, "oi", perguntas, correntes).
// Nesses casos não devemos salvar a mensagem como nome — precisamos pedir o nome.
function looksLikeName(s) {
  const t = String(s || '').trim();
  if (t.length < 2 || t.length > 60) return false;   // curto demais ou texto longo (anúncio)
  if (/[\r\n]/.test(t)) return false;                 // várias linhas = mensagem encaminhada
  if (/(https?:\/\/|www\.|\.com|\.br|@|\b\d{4,}\b)/i.test(t)) return false; // link/email/telefone/preço
  if (/[?!]{1,}$/.test(t) || /\?/.test(t)) return false; // pergunta
  if ((t.match(/\d/g) || []).length > 2) return false; // muitos dígitos
  if (t.split(/\s+/).length > 6) return false;          // frase, não um nome
  // Termos típicos de anúncio/saudação/corrente — não são nomes.
  if (/\b(oi|ol[áa]|bom dia|boa tarde|boa noite|promo|promo[çc][ãa]o|desconto|oferta|gr[áa]tis|clique|link|whatsapp|zap|grupo|vaga|renda|ganhe|invista|cripto|body|bom demais|imperd[íi]vel|aproveite|acesse|confira)\b/i.test(t)) return false;
  // Um nome deve ser predominantemente letras (com acentos), espaços, ponto ou hífen.
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]*$/.test(t)) return false;
  // Precisa ter ao menos uma "palavra" alfabética de 2+ letras.
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) return false;
  return true;
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

async function insertTransaction(userId, { name, amount, type, kind, accountId, categoryId }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const iso = now.toISOString();
  const today = iso.slice(0, 10);
  await db.execute({
    sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, cash_date, month, year, notes, category_id, template_id, account_id, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, 'Registrado via WhatsApp', ?, '', ?, 'whatsapp', ?)`,
    args: [id, userId, name || 'Lançamento', Number(amount) || 0, type === 'income' ? 'income' : 'expense', kind === 'fixed' ? 'fixed' : 'variable', today, today, today, now.getMonth() + 1, now.getFullYear(), categoryId || '', accountId || '', iso],
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

// ── Categorias do usuário ─────────────────────────────────────────────────────

async function getUserCategories(userId) {
  const db = getDb();
  const { rows } = await db.execute({ sql: 'SELECT id, name, type, icon FROM categories WHERE user_id=?', args: [userId] });
  return rowsToObjects(rows);
}

// Casa o nome citado ("mercado", "salário") com uma categoria existente.
function findCategoryByName(categories, name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  if (!n) return null;
  return categories.find((c) => {
    const cn = String(c.name || '').toLowerCase();
    return cn === n || (cn && (cn.includes(n) || n.includes(cn)));
  }) || null;
}

// ── Fluxo conversacional de lançamento (conta → categoria → registrar) ─────────
// O usuário precisa dizer em qual banco/conta registrar. Sem conta cadastrada,
// oferecemos criar na hora. A categoria é opcional (melhora os relatórios).

function _txVerb(tx) { return tx.type === 'income' ? 'a receita' : 'a despesa'; }
function _txSummary(tx) { return `${_txVerb(tx)} "${tx.name}" de ${brl(tx.amount)}`; }

// Decide o próximo passo do fluxo. Se todos os dados necessários já existem,
// registra e retorna { pending: null }. Caso contrário, faz UMA pergunta.
async function nextTxStep(user, tx, accounts, categories) {
  // 1) Conta/banco — obrigatório
  if (!tx.accountId) {
    if (!accounts.length) {
      const out = `📌 Você ainda não tem nenhum *banco/conta* cadastrado. Para registrar ${_txSummary(tx)}, me diga o *nome do banco* (ex.: Nubank, Itaú, PicPay) que eu crio a conta e já registro tudo. 😊\n\n_(ou responda *cancelar* para desistir)_`;
      return { answer: out, pending: { type: 'tx_flow', step: 'account_create', tx } };
    }
    const list = accounts.map((a, i) => `*${i + 1}* — ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n');
    const out = `Em qual *banco/conta* devo registrar ${_txSummary(tx)}?\n\n${list}\n\nResponda com o *número* ou o *nome*. Para um banco novo, envie *novo Nome* (ex.: novo PicPay).`;
    return { answer: out, pending: { type: 'tx_flow', step: 'account', tx, accounts } };
  }

  // 2) Categoria — opcional (só pergunta se não identificou e existem categorias do tipo)
  if (!tx.categoryId && !tx.categorySkipped) {
    const cats = (categories || []).filter((c) => !c.type || c.type === tx.type);
    if (cats.length) {
      const list = cats.map((c, i) => `*${i + 1}* — ${c.icon ? c.icon + ' ' : ''}${c.name}`).join('\n');
      const out = `Não identifiquei a *categoria*. Quer classificar ${_txVerb(tx)} para melhorar seus relatórios?\n\n${list}\n\nResponda com o *número*/*nome*, ou *pular*.`;
      return { answer: out, pending: { type: 'tx_flow', step: 'category', tx, accounts, categories: cats } };
    }
  }

  // 3) Tudo resolvido — registra
  await insertTransaction(user.id, {
    name: tx.name, amount: tx.amount, type: tx.type, kind: tx.kind,
    accountId: tx.accountId, categoryId: tx.categoryId,
  });
  const acc = (accounts || []).find((a) => a.id === tx.accountId);
  const accNote = acc ? ` na conta ${acc.name}` : '';
  const catNote = tx.categoryName ? ` · ${tx.categoryName}` : '';
  const out = `Pronto, ${firstName(user.name)}! Registrei ${_txSummary(tx)}${accNote}${catNote}. ✅`;
  return { answer: out, pending: null };
}

// Processa a resposta do usuário em cada passo do fluxo de lançamento.
async function runTxFlow(user, pending, raw) {
  const text = String(raw || '').trim();
  const low = text.toLowerCase();
  const tx = pending.tx || {};

  if (/^(cancela|cancelar|deixa|para|parar|desisto|desistir)$/i.test(low)) {
    return { answer: 'Ok, cancelei o registro. 🙂', pending: null };
  }

  if (pending.step === 'account_create') {
    if (!text) return { answer: 'Me diga o *nome do banco* para eu criar a conta (ex.: Nubank).', pending };
    const accId = await insertAccount(user.id, { name: text, bank_name: text, initial_balance: 0, type: 'checking' });
    tx.accountId = accId;
    const accounts = await getUserAccounts(user.id);
    return await nextTxStep(user, tx, accounts, await getUserCategories(user.id));
  }

  if (pending.step === 'account') {
    let accounts = pending.accounts || await getUserAccounts(user.id);
    const mNew = text.match(/^novo\s+(.+)/i);
    if (mNew) {
      const bankName = mNew[1].trim();
      const accId = await insertAccount(user.id, { name: bankName, bank_name: bankName, initial_balance: 0, type: 'checking' });
      tx.accountId = accId;
      accounts = await getUserAccounts(user.id);
      return await nextTxStep(user, tx, accounts, await getUserCategories(user.id));
    }
    let acc = null;
    const num = parseInt(low, 10);
    if (!isNaN(num) && num >= 1 && num <= accounts.length) acc = accounts[num - 1];
    if (!acc) acc = findAccountByName(accounts, text);
    if (!acc) {
      const list = accounts.map((a, i) => `*${i + 1}* — ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n');
      return { answer: `Não identifiquei a conta. Escolha pelo *número* ou *nome*:\n\n${list}\n\nOu envie *novo Nome* para criar uma.`, pending };
    }
    tx.accountId = acc.id;
    return await nextTxStep(user, tx, accounts, await getUserCategories(user.id));
  }

  if (pending.step === 'category') {
    const cats = pending.categories || [];
    const accounts = pending.accounts || await getUserAccounts(user.id);
    if (/^(pular|pula|sem|nenhuma|nao|não|skip)$/i.test(low)) {
      tx.categorySkipped = true;
      return await nextTxStep(user, tx, accounts, cats);
    }
    let cat = null;
    const num = parseInt(low, 10);
    if (!isNaN(num) && num >= 1 && num <= cats.length) cat = cats[num - 1];
    if (!cat) cat = findCategoryByName(cats, text);
    if (!cat) {
      const list = cats.map((c, i) => `*${i + 1}* — ${c.name}`).join('\n');
      return { answer: `Não identifiquei a categoria. Escolha pelo *número*/*nome* ou envie *pular*:\n\n${list}`, pending };
    }
    tx.categoryId = cat.id; tx.categoryName = cat.name;
    return await nextTxStep(user, tx, accounts, cats);
  }

  return { answer: 'Vamos recomeçar: me diga o lançamento (ex.: "gastei 30 com almoço").', pending: null };
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
    // A mensagem não parece um nome (ex.: anúncio encaminhado, link, saudação ou
    // pergunta). Não salvamos como nome — tratamos como continuidade de conversa e
    // pedimos, de forma clara, apenas o nome para prosseguir.
    if (!looksLikeName(t)) {
      const out = 'Para liberar o seu acesso ao *Lumers Flow*, eu preciso primeiro do seu *nome*. 🙂\n\nMe diga *apenas o seu nome completo* (ex.: _Maria Silva_) e seguimos com o cadastro.';
      await reply(out);
      await saveConversation(phone, '', { type: 'signup', step: 'name', data }, conv.history || []);
      await logInteraction({ phone, user: null, inType, inText: t, outText: out, action: 'signup_name_rejected' });
      return { handled: true, reason: 'signup_name_rejected' };
    }
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

// ── Moderação de conteúdo do assistente WhatsApp ─────────────────────────────

// Termos proibidos (xingamentos e conteúdo sexual explícito). A comparação é feita
// sobre o texto normalizado (minúsculo, sem acento) com limites de palavra, para
// evitar falsos positivos (ex.: "São Paulo" não casa com "pau").
const BLOCKED_TERMS = [
  'porra', 'caralho', 'buceta', 'boceta', 'cacete', 'merda', 'bosta', 'fdp',
  'viado', 'veado', 'corno', 'otario', 'babaca', 'arrombado', 'arrombada',
  'desgraca', 'vagabundo', 'vagabunda', 'puta', 'puto', 'piranha', 'cuzao',
  'escroto', 'imbecil', 'idiota', 'retardado', 'filho da puta', 'vai se foder',
  'vai tomar no cu', 'tomar no cu', 'pornografia', 'pornografico', 'porno',
  'xvideos', 'xvideo', 'pornhub', 'nude', 'nudes', 'xoxota', 'transar',
  'transando', 'gozar', 'gozada', 'punheta', 'siririca', 'masturba',
];

function normalizeForModeration(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Retorna o termo proibido encontrado, ou null.
function detectBlockedContent(text) {
  const n = ' ' + normalizeForModeration(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  for (const term of BLOCKED_TERMS) {
    const t = normalizeForModeration(term);
    if (n.includes(' ' + t + ' ')) return term;
  }
  return null;
}

async function notifyAdminsBlocked(inst, user, reason) {
  const admins = await listAdminPhones();
  const text = `🚫 *Usuário bloqueado no assistente WhatsApp*\n\n👤 ${user.name || user.email}\n✉️ ${user.email}\n📱 ${user.phone || '—'}\nMotivo: ${reason}\n\nPara reativar, responda:\n*desbloquear ${user.email}*`;
  for (const a of admins) {
    try { await sendText({ name: inst.name, key: inst.api_key || null, number: a.phone, text }); }
    catch (e) { console.error('[assistant] notificar admin de bloqueio falhou', e?.message); }
  }
  return admins.length;
}

// Escalada de moderação: 3 avisos e, na 4ª ocorrência, bloqueia o acesso e notifica admins.
async function warnOrBlock(user, phone, reply, inst, reason) {
  const db = getDb();
  const next = Number(user.wa_warnings || 0) + 1;
  if (next > 3) {
    await db.execute({ sql: 'UPDATE users SET wa_blocked=1 WHERE id=?', args: [user.id] });
    const out = '🚫 Seu acesso ao assistente foi *bloqueado* por uso indevido repetido. Um administrador foi notificado. Para reativar, entre em contato com o suporte.';
    await reply(out);
    await notifyAdminsBlocked(inst, user, reason);
    return { out, action: 'moderation_blocked' };
  }
  await db.execute({ sql: 'UPDATE users SET wa_warnings=? WHERE id=?', args: [next, user.id] });
  const msgs = {
    1: '⚠️ *Aviso 1/3*: identifiquei conteúdo impróprio ou uso indevido na sua mensagem. Por favor, mantenha o respeito ao usar o assistente.',
    2: '⚠️ *Aviso 2/3*: detectei novamente conteúdo impróprio ou tentativa de uso indevido. Mais uma ocorrência e o seu acesso poderá ser suspenso.',
    3: '⚠️ *Último aviso (3/3)*: na *próxima* ocorrência o seu acesso ao assistente será *bloqueado* automaticamente e um administrador será avisado.',
  };
  const out = msgs[next] || msgs[3];
  await reply(out);
  return { out, action: 'moderation_warn' };
}

// ── Sugestões de melhoria (comando /melhorias) ───────────────────────────────

async function createImprovement(user, phone, text) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO improvements (id, user_id, user_name, user_phone, text, priority, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'medium', 'pending', datetime('now'))`,
    args: [id, user.id, user.name || '', phone, String(text || '').slice(0, 1000)],
  });
  return id;
}

async function notifyAdminsNewImprovement(inst, user, phone, ideaText) {
  const admins = await listAdminPhones();
  const who = user.name || user.email || phone || 'Usuário';
  const contact = user.email ? `\n✉️ ${user.email}` : '';
  const text = `💡 *Nova sugestão de melhoria*\n\n👤 ${who}${contact}\n📱 ${phone || '—'}\n\nSugestão:\n"${String(ideaText || '').slice(0, 1000)}"`;
  for (const a of admins) {
    try { await sendText({ name: inst.name, key: inst.api_key || null, number: a.phone, text }); }
    catch (e) { console.error('[assistant] notificar admin de melhoria falhou', e?.message); }
  }
  return admins.length;
}

// ── Textos de ajuda / menu ───────────────────────────────────────────────────

const HELP_OVERVIEW = `🤖 *Assistente Lumers Flow — Ajuda*

Eu cuido das suas finanças direto pelo WhatsApp. Você pode:
• 💸 Registrar despesas: _"gastei 30 no almoço"_
• 💰 Registrar receitas: _"recebi 2000 de salário"_
• 🏦 Criar contas/carteiras: _"criar carteira Nubank com saldo 200"_
• 📊 Consultar saldo e resumos: _"qual meu saldo este mês?"_
• 🎙️ Mandar áudio ou 📷 print de comprovante — eu entendo e lanço pra você

*Comandos:*
• */ajuda* _sua pergunta_ — tira dúvidas sobre o sistema
• */melhorias* _sua ideia_ — envie uma sugestão de melhoria

❌ *O que eu não faço:* não acesso dados de outros usuários, não faço transferências bancárias reais e não dou recomendações de investimento.

É só mandar sua mensagem que eu cuido do resto! 😉`;

function systemMenuText(name) {
  return `🛠️ *Painel do Sistema* — olá, ${firstName(name)}!

Responda com o *número* da opção:

1️⃣ Cadastrar usuário
2️⃣ Editar usuário
3️⃣ Excluir usuário
4️⃣ 📊 Relatório do sistema
5️⃣ ✉️ Enviar mensagem para um usuário
6️⃣ ℹ️ Ver funcionalidades do sistema

_Responda "sair" para fechar o menu._`;
}

const SYSTEM_FEATURES_TEXT = `ℹ️ *Funcionalidades do Lumers Flow*

*Já disponíveis:*
• Lançamentos por texto, áudio e imagem (WhatsApp)
• Contas/carteiras e saldo consolidado
• Relatórios mensais e anuais no app
• Gestão de usuários e planos (admin)
• Disparo de mensagens e campanhas (admin)
• Solicitação de acesso e aprovação via WhatsApp
• Moderação automática e bloqueio por uso indevido

*Em evolução:*
• Metas e alertas inteligentes
• Categorização automática por IA
• Painel de melhorias sugeridas pelos usuários

Envie */melhorias* seguido da sua ideia para contribuir! 🚀`;

function isTestMessage(text) {
  const n = normalizeForModeration(text);
  return /esse e um teste/.test(n) || (/\bteste\b/.test(n) && /gastei\s*30\s*com\s*almoco/.test(n));
}

const TEST_SIMULATION_TEXT = `🎉 *Você acabou de testar o assistente!*

Recebi _"gastei 30 com almoço"_ e entendi:
• Tipo: 💸 Despesa
• Valor: R$ 30,00
• Descrição: Almoço

⚠️ Como isto é um *teste*, não registrei nada de verdade.

Na prática, quando você manda uma mensagem assim, eu lanço automaticamente no seu app — sem abrir nada, sem planilha. Você também pode:
• 💰 _"recebi 2000 de salário"_
• 🏦 _"criar carteira Nubank com saldo 200"_
• 📊 _"qual meu saldo este mês?"_
• 🎙️ mandar áudio ou 📷 print do comprovante

Digite */ajuda* para tirar dúvidas ou */melhorias* para sugerir algo.

Pronto pra começar? É só mandar seu primeiro lançamento de verdade! 😉`;

// Responde a uma dúvida sobre o sistema usando o Groq (fallback: visão geral estática).
async function answerHelpQuestion(cfg, user, question) {
  if (!cfg.groqKey) return HELP_OVERVIEW;
  try {
    const composed = await groqChat({
      key: cfg.groqKey,
      model: cfg.groqModel,
      messages: [
        { role: 'system', content: `Você é o assistente de suporte do Lumers Flow (app de gestão financeira com assistente no WhatsApp). Responda em português do Brasil, breve e cordial, usando o primeiro nome do usuário (${firstName(user.name)}).
O QUE O SISTEMA FAZ: registra receitas/despesas por texto, áudio e imagem no WhatsApp; cria contas/carteiras; informa saldo e resumos; tem relatórios mensais/anuais no app; admins gerenciam usuários e planos.
O QUE NÃO FAZ: não acessa dados de outros usuários (usuário comum só vê a própria conta); não faz transferências bancárias reais; não dá recomendações de investimento.
COMANDOS: /ajuda (dúvidas), /melhorias (sugestões).
Responda APENAS sobre o funcionamento do sistema. Se perguntarem algo fora disso, oriente gentilmente a usar o assistente para finanças.` },
        { role: 'user', content: String(question || '').slice(0, 500) },
      ],
    });
    return composed || HELP_OVERVIEW;
  } catch (e) {
    console.error('[assistant] ajuda groq falhou', e?.message);
    return HELP_OVERVIEW;
  }
}

// Continua o menu /system (apenas admin). Retorna { answer, pending }.
async function runSystemMenu(user, pending, userText, inst) {
  const step = pending?.step || 'menu';
  const t = String(userText || '').trim();
  const low = normalizeForModeration(t);

  if (/\b(sair|cancelar|cancela|fechar|voltar)\b/.test(low)) {
    return { answer: 'Menu fechado. Quando precisar, é só enviar */system* de novo. 🙂', pending: null };
  }

  if (step === 'menu') {
    const choice = (t.match(/[1-6]/) || [])[0];
    if (choice === '1') return { answer: 'Cadastrar usuário 📝\nMe envie em uma mensagem: *nome completo*, *e-mail* e *telefone (com DDD)* do novo usuário. Se quiser, diga "gerar senha".', pending: null };
    if (choice === '2') return { answer: 'Editar usuário ✏️\nMe diga o *e-mail* do usuário e o que deseja alterar (nome, telefone ou senha).', pending: null };
    if (choice === '3') return { answer: 'Excluir usuário 🗑️\nMe envie o *e-mail* do usuário que deseja excluir para eu confirmar.', pending: null };
    if (choice === '4') {
      const snap = await getAdminSnapshot();
      const top = (snap.usuarios || []).slice(0, 8)
        .map((u, i) => `${i + 1}. ${u.nome} — ${u.lancamentos} lanç. (rec ${u.receitas} / desp ${u.despesas})`)
        .join('\n');
      return { answer: `📊 *Relatório do Sistema*\n\n👥 Usuários: *${snap.total_usuarios}*\n\n*Mais ativos:*\n${top || '— sem dados —'}`, pending: null };
    }
    if (choice === '5') return { answer: 'Enviar mensagem ✉️\nPara *quem* devo enviar? Envie o *e-mail* ou o *nome* do usuário.', pending: { type: 'system', step: 'broadcast_target' } };
    if (choice === '6') return { answer: SYSTEM_FEATURES_TEXT, pending: null };
    return { answer: 'Opção inválida. Responda com um número de *1* a *6*, ou "sair".', pending: { type: 'system', step: 'menu' } };
  }

  if (step === 'broadcast_target') {
    const target = await findSystemUser(t);
    if (!target) return { answer: 'Não encontrei esse usuário. Envie o *e-mail* exato dele.', pending: { type: 'system', step: 'broadcast_target' } };
    if (!target.phone) return { answer: `${target.name} (${target.email}) não tem WhatsApp cadastrado, não consigo enviar. Escolha outro usuário (e-mail) ou "sair".`, pending: { type: 'system', step: 'broadcast_target' } };
    return { answer: `Certo! Vou enviar para *${target.name}* (${target.email}). Agora me envie o *texto da mensagem*.`, pending: { type: 'system', step: 'broadcast_text', target: target.email, targetPhone: target.phone, targetName: target.name } };
  }

  if (step === 'broadcast_text') {
    const wphone = canonicalBrazilPhone(pending.targetPhone);
    if (!wphone) return { answer: 'O telefone do destinatário é inválido. Menu cancelado.', pending: null };
    try {
      await sendText({ name: inst.name, key: inst.api_key || null, number: wphone, text: t });
      return { answer: `✅ Mensagem enviada para *${pending.targetName}* (${pending.target}).`, pending: null };
    } catch (e) {
      return { answer: `Não consegui enviar: ${e?.message || 'erro'}. Tente novamente ou "sair".`, pending: { type: 'system', step: 'broadcast_text', target: pending.target, targetPhone: pending.targetPhone, targetName: pending.targetName } };
    }
  }

  return { answer: 'Menu encerrado.', pending: null };
}

// Roteia comandos, moderação, teste e modos pendentes (help/system/improvement).
// Retorna { handled: true, ... } quando trata a mensagem; caso contrário { handled: false }.
async function handleWaCommands({ user, isAdmin, phone, userText, inType, reply, inst, conv, cfg }) {
  const raw = String(userText || '').trim();
  const low = raw.toLowerCase();

  // Admin: desbloquear usuário via WhatsApp (apenas admin ativa/inativa contas).
  if (isAdmin && /^desbloquear\s+/i.test(raw)) {
    const target = await findSystemUser(raw.replace(/^desbloquear\s+/i, '').trim());
    let out;
    if (!target) out = 'Não encontrei esse usuário. Envie: *desbloquear e-mail@do-usuario*';
    else {
      const db = getDb();
      await db.execute({ sql: 'UPDATE users SET wa_blocked=0, wa_warnings=0 WHERE id=?', args: [target.id] });
      out = `✅ Acesso de *${target.name}* (${target.email}) reativado. Avisos zerados.`;
    }
    await reply(out);
    await logInteraction({ phone, user, inType, inText: raw, outText: out, action: 'wa_unblock' });
    return { handled: true, reason: 'wa_unblock' };
  }

  // Moderação de conteúdo (não-admin): xingamentos / conteúdo sexual.
  if (!isAdmin) {
    const bad = detectBlockedContent(raw);
    if (bad) {
      const r = await warnOrBlock(user, phone, reply, inst, `conteúdo proibido: "${bad}"`);
      await logInteraction({ phone, user, inType, inText: raw, outText: r.out, action: r.action });
      return { handled: true, reason: r.action };
    }
  }

  // /ajuda [pergunta]
  if (low === '/ajuda' || low.startsWith('/ajuda ')) {
    const q = raw.slice(6).trim();
    const out = q ? await answerHelpQuestion(cfg, user, q) : HELP_OVERVIEW;
    await reply(out);
    await logInteraction({ phone, user, inType, inText: raw, outText: out, action: 'help' });
    return { handled: true, reason: 'help' };
  }

  // /system (somente admin) — tentativa de não-admin conta como uso indevido.
  if (low === '/system' || low.startsWith('/system')) {
    if (!isAdmin) {
      const r = await warnOrBlock(user, phone, reply, inst, 'tentou usar comando de administrador (/system)');
      await logInteraction({ phone, user, inType, inText: raw, outText: r.out, action: r.action });
      return { handled: true, reason: r.action };
    }
    const out = systemMenuText(user.name);
    await reply(out);
    await saveConversation(phone, user.id, { type: 'system', step: 'menu' }, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: out, action: 'system_menu' });
    return { handled: true, reason: 'system_menu' };
  }

  // /melhorias [texto]
  if (low === '/melhorias' || low.startsWith('/melhorias ') || low.startsWith('/melhoria ')) {
    const idea = raw.replace(/^\/melhorias?\s*/i, '').trim();
    if (idea) {
      await createImprovement(user, phone, idea);
      await notifyAdminsNewImprovement(inst, user, phone, idea);
      const out = `💡 Recebi sua sugestão, ${firstName(user.name)}! Ela foi registrada e será analisada pela equipe. Você recebe um retorno por aqui quando ela for avaliada. Obrigado! 🙌`;
      await reply(out);
      await saveConversation(phone, user.id, null, conv.history || []);
      await logInteraction({ phone, user, inType, inText: raw, outText: out, action: 'improvement_saved' });
      return { handled: true, reason: 'improvement_saved' };
    }
    const out = '💡 Que ótimo que você quer contribuir! Me envie, em uma mensagem, a sua *sugestão de melhoria* para o Lumers Flow.';
    await reply(out);
    await saveConversation(phone, user.id, { type: 'improvement' }, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: out, action: 'improvement_prompt' });
    return { handled: true, reason: 'improvement_prompt' };
  }

  // Mensagem de teste do onboarding (esse é um teste "gastei 30 com almoço")
  if (isTestMessage(raw)) {
    await reply(TEST_SIMULATION_TEXT);
    await saveConversation(phone, user.id, null, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: TEST_SIMULATION_TEXT, action: 'test_simulation' });
    return { handled: true, reason: 'test_simulation' };
  }

  // Continuação de modos pendentes
  if (conv.pending?.type === 'improvement') {
    await createImprovement(user, phone, raw);
    await notifyAdminsNewImprovement(inst, user, phone, raw);
    const out = `💡 Recebi sua sugestão, ${firstName(user.name)}! Ela foi registrada e será analisada pela equipe. Você recebe um retorno por aqui quando ela for avaliada. Obrigado! 🙌`;
    await reply(out);
    await saveConversation(phone, user.id, null, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: out, action: 'improvement_saved' });
    return { handled: true, reason: 'improvement_saved' };
  }

  if (conv.pending?.type === 'system' && isAdmin) {
    const r = await runSystemMenu(user, conv.pending, raw, inst);
    await reply(r.answer);
    await saveConversation(phone, user.id, r.pending, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: r.answer, action: 'system_menu_step' });
    return { handled: true, reason: 'system_menu_step' };
  }

  // Continuação do fluxo de lançamento (escolha de banco/conta e categoria)
  if (conv.pending?.type === 'tx_flow') {
    const r = await runTxFlow(user, conv.pending, raw);
    await reply(r.answer);
    await saveConversation(phone, user.id, r.pending, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: r.answer, action: 'tx_flow_step' });
    return { handled: true, reason: 'tx_flow_step' };
  }

  return { handled: false };
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
- REGISTRAR LANÇAMENTO: use action "register" com type "income" (receita/entrada) ou "expense" (despesa/saída). Se o usuário citar uma conta ("no Nubank", "pelo Itaú"), preencha transaction.account_name com esse nome. Se ele indicar que é fixo/recorrente ou variável/avulso, preencha transaction.kind ("fixed" ou "variable"); na dúvida deixe null. Se der para inferir a categoria pelo contexto (ex.: "almoço" → Alimentação; "salário" → Salário; "uber" → Transporte), preencha transaction.category_name; na dúvida deixe null. NÃO pergunte sobre banco/conta nem categoria no "reply": o próprio sistema conduz essas perguntas depois.
- Se o usuário quer registrar um valor mas NÃO está claro se é RECEITA ou DESPESA (e não é criação de conta), use action "clarify" e pergunte gentilmente.

Responda SEMPRE em JSON válido com este formato exato:
{
  "action": "register" | "create_account" | "manage_user" | "clarify" | "query" | "answer",
  "transaction": { "name": "string curta do lançamento", "amount": number, "type": "income" | "expense" | null, "kind": "fixed" | "variable" | null, "account_name": "string" | null, "category_name": "string" | null },
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

  // Acesso ao assistente bloqueado por moderação (somente não-admin é bloqueável).
  if (!isAdmin && user.wa_blocked === 1) {
    const out = 'Seu acesso ao assistente do WhatsApp está *bloqueado* por uso indevido. Fale com um administrador para reativar. 🚫';
    await reply(out);
    await logInteraction({ phone, user, inType, inText: quickText, outText: out, action: 'blocked' });
    return { handled: true, reason: 'blocked' };
  }

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
      userText = m.imageMessage.caption || '';
      // Sem nenhum provedor de visão configurado → função indisponível.
      if (!cfg.groqKey && !cfg.geminiKey) {
        await reply('A *leitura de imagens não está disponível* no momento. Me envie os dados por texto (ex.: "gastei 30 no mercado") que eu registro. 🙂');
        return { handled: true, reason: 'image_unavailable' };
      }
      const b64 = await getMediaBase64(inst.name, inst.api_key, msg.key);
      if (!b64) {
        await reply('Não consegui baixar a imagem que você enviou. Pode reenviar ou me mandar os dados por texto? 🙂');
        return { handled: true, reason: 'image_download_failed' };
      }
      const mime = m.imageMessage.mimetype || 'image/jpeg';
      try {
        imageContext = await readImageContent(cfg, b64, mime);
      } catch (e) {
        if (e.kind === 'tech') {
          await reply('A *leitura de imagens está temporariamente indisponível*. Tente novamente em alguns minutos ou me envie os dados por texto. 🙏');
          return { handled: true, reason: 'image_tech_unavailable' };
        }
        await reply('Não consegui *entender* o conteúdo dessa imagem. Se for um recibo, reenvie mais nítido e bem enquadrado, ou me diga os dados por texto (ex.: "gastei 30 no mercado"). 🙂');
        return { handled: true, reason: 'image_unreadable' };
      }
      // Leu algo, mas o próprio modelo indicou que a imagem está ilegível/borrada.
      if (imageLooksUnreadable(imageContext)) {
        await reply('Não consegui *entender* o conteúdo dessa imagem — a leitura ficou ruim. Reenvie o recibo mais nítido e bem enquadrado, ou me diga os dados por texto. 🙂');
        return { handled: true, reason: 'image_unreadable' };
      }
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

  // Comandos (/ajuda, /system, /melhorias), moderação, teste de onboarding e modos
  // pendentes — tratados antes do classificador de IA.
  const cmd = await handleWaCommands({ user, isAdmin, phone, userText, inType, reply, inst, conv, cfg });
  if (cmd?.handled) return cmd;

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
        // Fluxo guiado: resolve banco/conta (pergunta ou cria) e categoria (opcional)
        const acc = findAccountByName(accounts, t.account_name);
        const categories = await getUserCategories(user.id);
        const cat = findCategoryByName(categories.filter((c) => !c.type || c.type === type), t.category_name);
        const tx = {
          name, amount, type, kind: t.kind || null,
          accountId: acc?.id || null,
          categoryId: cat?.id || null, categoryName: cat?.name || null,
        };
        const step = await nextTxStep(user, tx, accounts, categories);
        answer = step.answer;
        newPending = step.pending;
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
