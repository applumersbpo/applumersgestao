import { getDb, rowsToObjects } from './db.js';
import { getAiConfig, groqChat, groqTranscribeAudio, groqReadImage, geminiTranscribeAudio, geminiReadImage, openaiReadImage, openaiReadDocument, openaiTranscribeAudio } from './ai.js';
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

// Prompt estruturado para faturas/comprovantes: orienta a IA a extrair conta/cartão,
// valores, datas de vencimento/fechamento e — crucial — parcelamentos.
const MEDIA_EXTRACT_PROMPT =
  'Este é um documento/print financeiro (possivelmente uma FATURA de cartão, boleto, comprovante ou recibo) enviado por um usuário de um app financeiro. Extraia de forma objetiva e estruturada, em português: nome do banco/cartão ou conta; valor(es) em reais; data(s) de vencimento e de fechamento da fatura (se houver); e a descrição do gasto ou recebimento e se aparenta ser RECEITA ou DESPESA. Se houver VÁRIAS despesas/compras (ex.: fatura de cartão com vários lançamentos), LISTE CADA UMA separadamente, com a descrição e o valor de cada compra. Se identificar uma COMPRA PARCELADA, informe claramente o número de parcelas e o valor total (ex.: "TV — R$ 3.500 em 8x"). Não invente dados que não estão no conteúdo. Se não for financeiro, descreva brevemente o que é. Responda curto.';

// Lê o conteúdo de uma imagem/print tentando Groq (visão) e, em falha, o Gemini.
// Retorna o texto extraído (não vazio). Se ambos falharem, lança Error com:
//   .kind = 'tech'  → falha técnica do provedor (API/limite) → função indisponível
//   .kind = 'empty' → provedor respondeu vazio → conteúdo não compreendido
// Lê o conteúdo de uma imagem/print. Ordem: OpenAI (primário) → Groq → Gemini (fallback).
async function readImageContent(cfg, base64, mime) {
  let threw = false;
  const providers = [];
  if (cfg.openaiKey) providers.push('openai');
  if (cfg.groqKey)   providers.push('groq');
  if (cfg.geminiKey) providers.push('gemini');
  for (const p of providers) {
    try {
      const t = p === 'openai'
        ? await openaiReadImage({ key: cfg.openaiKey, model: cfg.openaiVisionModel, base64, mime, prompt: MEDIA_EXTRACT_PROMPT })
        : p === 'groq'
        ? await groqReadImage({ key: cfg.groqKey, model: cfg.groqVisionModel, base64, mime, prompt: MEDIA_EXTRACT_PROMPT })
        : await geminiReadImage({ key: cfg.geminiKey, model: cfg.geminiModel, base64, mime, prompt: MEDIA_EXTRACT_PROMPT });
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

// Lê o conteúdo de um documento (PDF/fatura). OpenAI (primário) lê PDF via parte
// "file"; Gemini via inline_data (fallback). A visão do Groq não lê PDF.
async function readDocumentContent(cfg, base64, mime) {
  let threw = false;
  const providers = [];
  if (cfg.openaiKey) providers.push('openai');
  if (cfg.geminiKey) providers.push('gemini');
  if (!providers.length) { const err = new Error('no doc provider'); err.kind = 'tech'; throw err; }
  for (const p of providers) {
    try {
      const t = p === 'openai'
        ? await openaiReadDocument({ key: cfg.openaiKey, model: cfg.openaiVisionModel, base64, mime, prompt: MEDIA_EXTRACT_PROMPT })
        : await geminiReadImage({ key: cfg.geminiKey, model: cfg.geminiModel, base64, mime, prompt: MEDIA_EXTRACT_PROMPT });
      if (t && t.trim()) return t.trim();
    } catch (e) {
      threw = true;
      console.error(`[assistant] leitura de documento (${p}) falhou`, e?.message);
    }
  }
  const err = new Error('doc read failed'); err.kind = threw ? 'tech' : 'empty'; throw err;
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

// ── Guarda anti-loop/anti-bot ────────────────────────────────────────────────
// Lê/grava só a coluna `guard` de wa_conversations, sem tocar em pending/history
// (a linha pode nem existir ainda → upsert que só mexe em guard).
async function getGuard(phone) {
  const db = getDb();
  const { rows } = await db.execute({ sql: 'SELECT guard FROM wa_conversations WHERE phone = ?', args: [phone] });
  const row = rowsToObjects(rows)[0];
  return (row && row.guard) ? (safeParse(row.guard) || {}) : {};
}

async function saveGuard(phone, guard) {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO wa_conversations (phone, guard, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(phone) DO UPDATE SET guard=excluded.guard, updated_at=excluded.updated_at`,
    args: [phone, guard && Object.keys(guard).length ? JSON.stringify(guard) : ''],
  });
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

// Registra uma transação. Datas (opcionais, formato 'YYYY-MM-DD'):
//   competenceDate → data de competência (quando o gasto/recebimento ocorreu);
//                    define competence_date e o mês/ano de referência.
//   dueDate        → data de vencimento (define due_date). Padrão: a competência.
//   status         → 'paid' (padrão) ou 'pending' (conta a pagar/receber futura).
// Sem datas, mantém o comportamento antigo: tudo "hoje" e status 'paid'.
async function insertTransaction(userId, { name, amount, type, kind, accountId, categoryId, competenceDate, dueDate, status }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const iso = now.toISOString();
  const today = iso.slice(0, 10);
  const comp = competenceDate || today;       // competência (regime)
  const due = dueDate || comp;                // vencimento
  const st = status === 'pending' ? 'pending' : 'paid';
  const paid = st === 'paid' ? comp : '';     // pago → paid/cash na competência
  const cy = parseInt(String(comp).slice(0, 4), 10) || now.getFullYear();
  const cm = parseInt(String(comp).slice(5, 7), 10) || now.getMonth() + 1;
  await db.execute({
    sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, cash_date, competence_date, month, year, notes, category_id, template_id, account_id, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Registrado via WhatsApp', ?, '', ?, 'whatsapp', ?)`,
    args: [id, userId, name || 'Lançamento', Number(amount) || 0, type === 'income' ? 'income' : 'expense', kind === 'fixed' ? 'fixed' : 'variable', st, due, paid, paid, comp, cm, cy, categoryId || '', accountId || '', iso],
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
  const { rows } = await db.execute({ sql: 'SELECT id, name, bank_name, initial_balance, type, closing_day, due_day FROM accounts WHERE user_id=?', args: [userId] });
  return rowsToObjects(rows);
}

// Grava os dias de fechamento/vencimento da fatura do cartão na conta, para não
// precisar perguntar de novo em parcelamentos futuros no mesmo cartão.
async function setAccountCardDays(accountId, { closing_day, due_day } = {}) {
  const db = getDb();
  if (closing_day != null) await db.execute({ sql: 'UPDATE accounts SET closing_day=? WHERE id=?', args: [Number(closing_day), accountId] });
  if (due_day != null)     await db.execute({ sql: 'UPDATE accounts SET due_day=? WHERE id=?',     args: [Number(due_day), accountId] });
}

// Cria um parcelamento (compra parcelada no cartão). monthly = total/parcelas.
async function insertInstallment(userId, { name, total_amount, count, due_day, account_id, category_id, start_month, start_year }) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO installments (id, user_id, name, category_id, total_amount, installments, paid_installments, due_day, notes, account_id, start_month, start_year, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'Registrado via WhatsApp', ?, ?, ?, datetime('now'))`,
    args: [id, userId, name || 'Parcelamento', category_id || '', Number(total_amount) || 0, Number(count) || 1, Number(due_day) || 1, account_id || '', start_month != null ? Number(start_month) : null, start_year != null ? Number(start_year) : null],
  });
  return id;
}

// Calcula o mês/ano da PRIMEIRA parcela a partir dos dias de fechamento e vencimento
// da fatura. Se a compra caiu após o fechamento, entra na próxima fatura; se o
// vencimento é anterior ao fechamento, a fatura vence no mês seguinte ao fechamento.
function computeInstallmentStart(closingDay, dueDay) {
  const now = new Date();
  let m = now.getMonth(); // 0-11
  let y = now.getFullYear();
  const day = now.getDate();
  if (day > Number(closingDay)) m += 1;            // compra após o fechamento → próxima fatura
  if (Number(dueDay) < Number(closingDay)) m += 1; // vencimento cai no mês seguinte ao fechamento
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return { start_month: m + 1, start_year: y };
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

// Cria uma categoria de receita/despesa do usuário (via WhatsApp).
async function insertCategory(userId, { name, type, icon }) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO categories (id, user_id, name, type, icon, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [id, userId, name || 'Categoria', type === 'income' ? 'income' : 'expense', icon || '📦'],
  });
  return id;
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

// ── Baixa de contas a pagar (via WhatsApp) ────────────────────────────────────
// Busca despesas pendentes (status='pending') do usuário, opcionalmente filtradas
// por nome. Usado quando o usuário responde que já pagou uma conta do lembrete.
async function findPendingBills(userId, name) {
  const db = getDb();
  const { rows } = await db.execute({
    sql: `SELECT t.id, t.name, t.amount, t.due_date, c.name AS cat_name, a.name AS acc_name
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.user_id=? AND t.transaction_type='expense' AND t.status='pending'
          ORDER BY t.due_date ASC`,
    args: [userId],
  });
  let bills = rowsToObjects(rows);
  const n = String(name || '').trim().toLowerCase();
  if (n) {
    const filtered = bills.filter((b) => {
      const bn = String(b.name || '').toLowerCase();
      return bn === n || bn.includes(n) || n.includes(bn);
    });
    if (filtered.length) bills = filtered;
  }
  return bills;
}

// Dá baixa numa conta: status='paid', paid_date/cash_date na data informada.
async function markBillPaid(txId, paidDateISO) {
  const db = getDb();
  const paid = paidDateISO || new Date().toISOString().slice(0, 10);
  await db.execute({
    sql: `UPDATE transactions SET status='paid', paid_date=?, cash_date=? WHERE id=?`,
    args: [paid, paid, txId],
  });
}

// Continuação quando há mais de uma conta pendente com o mesmo nome: o usuário
// escolhe pelo número qual pagou (ou cancela).
async function runPayBillSelect(user, pending, raw) {
  const bills = pending.bills || [];
  const txt = String(raw || '').trim().toLowerCase();
  if (/^(n[ãa]o|cancela|cancelar|deixa|nenhum)/.test(txt)) {
    return { answer: 'Ok, não dei baixa em nenhuma conta. 🙂', pending: null };
  }
  const idx = parseInt(txt.replace(/\D/g, ''), 10);
  const bill = bills[idx - 1];
  if (!bill) {
    return { answer: `Não entendi. Responda com o *número* da conta que você pagou (1 a ${bills.length}), ou *cancelar*.`, pending };
  }
  await markBillPaid(bill.id, pending.paidDate);
  return { answer: `Pronto, ${firstName(user.name)}! Dei baixa em *${bill.name}* (${brl(bill.amount)}) como paga em ${_fmtDate(pending.paidDate)}. ✅`, pending: null };
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

// ── Fluxo de MÚLTIPLOS lançamentos (imagem/fatura com vários gastos) ───────────
// Quando um print/fatura traz várias despesas, o texto extraído pela IA é
// estruturado numa lista de itens. O usuário escolhe quais cadastrar, informa a
// conta e CONFIRMA (valores, descrições, categoria, conta) antes de registrar.

// Normaliza uma data em texto (dd/mm/aaaa, dd/mm, aaaa-mm-dd) para 'YYYY-MM-DD'.
// Retorna null se não reconhecer. Assume ano corrente quando o ano vier ausente.
function _normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
  if (m) {
    const d = String(m[1]).padStart(2, '0');
    const mo = String(m[2]).padStart(2, '0');
    let y = m[3] ? m[3] : String(new Date().getFullYear());
    if (y.length === 2) y = '20' + y;
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${y}-${mo}-${d}`;
  }
  return null;
}

// Formata 'YYYY-MM-DD' como dd/mm/aaaa para exibição. Vazio → '—'.
function _fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

// Estrutura o texto extraído de uma imagem/documento numa LISTA de lançamentos.
// Retorna { items, dueDate } — items: { name, amount, type, category_name, date }
// (date = data da compra/competência); dueDate = vencimento da fatura (se houver).
async function extractLineItems(cfg, contextText) {
  if (!cfg.groqKey || !contextText) return { items: [], dueDate: null };
  try {
    const raw = await groqChat({
      key: cfg.groqKey,
      model: cfg.groqModel,
      jsonMode: true,
      messages: [
        { role: 'system', content: 'Você extrai lançamentos financeiros de um texto que descreve um print/fatura/comprovante enviado por um usuário. Responda SOMENTE JSON no formato {"items":[{"name":"descrição curta (use o NOME DO ESTABELECIMENTO quando houver)","amount":number,"type":"income"|"expense","category_name":string|null,"date":"YYYY-MM-DD"|null}],"due_date":"YYYY-MM-DD"|null}. Liste CADA despesa/compra/recebimento individual como um item separado, com o valor em reais (apenas número, sem "R$"). Em "name" prefira o NOME DO ESTABELECIMENTO/loja. Em "date" coloque a DATA DA COMPRA/lançamento do item (competência) se aparecer. Em "due_date" (nível raiz) coloque a DATA DE VENCIMENTO da fatura, se for uma fatura de cartão. NÃO invente dados que não estejam no texto — use null quando não houver. IGNORE totais, subtotais, saldos, limites, pagamentos de fatura e juros — inclua apenas lançamentos individuais. Se houver apenas um lançamento, retorne um único item. Se não houver lançamento claro, retorne items vazio.' },
        { role: 'user', content: contextText },
      ],
    });
    const parsed = safeParse(raw) || {};
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = rawItems
      .map((it) => ({
        name: String(it.name || '').trim() || 'Lançamento',
        amount: Number(it.amount) || 0,
        type: it.type === 'income' ? 'income' : 'expense',
        category_name: it.category_name || null,
        date: _normalizeDate(it.date),
      }))
      .filter((it) => it.amount > 0);
    return { items, dueDate: _normalizeDate(parsed.due_date) };
  } catch (e) {
    console.error('[assistant] extração de itens falhou', e?.message);
    return { items: [], dueDate: null };
  }
}

function _multiListText(user, items) {
  const lines = items
    .map((it, i) => `*${i + 1}* — ${it.name} · ${brl(it.amount)}${it.date ? ` · ${_fmtDate(it.date)}` : ''}${it.type === 'income' ? ' (receita)' : ''}`)
    .join('\n');
  return `Encontrei estes lançamentos, ${firstName(user.name)}:\n\n${lines}\n\nQuais você quer cadastrar? Responda *todos*, os *números* (ex.: 1,3,4) ou *nenhum*.`;
}

// Interpreta a seleção do usuário. Retorna array de índices (0-based), [] para
// "nenhum"/cancelar, ou null se não deu para entender (re-perguntar).
function _parseSelection(raw, n) {
  const low = String(raw || '').trim().toLowerCase();
  if (/^(todos|todas|tudo|all)$/.test(low)) return [...Array(n).keys()];
  if (/^(nenhum|nenhuma|nada|cancelar|cancela)$/.test(low)) return [];
  const nums = (low.match(/\d+/g) || []).map((s) => parseInt(s, 10)).filter((x) => x >= 1 && x <= n);
  if (nums.length) return [...new Set(nums)].map((x) => x - 1);
  return null;
}

function _multiConfirmText(user, items, accName) {
  const lines = items
    .map((it, i) => `*${i + 1}* — ${it.name} · ${brl(it.amount)} · ${it.categoryName || 'sem categoria'} · comp ${_fmtDate(it.competenceDate)} · venc ${_fmtDate(it.dueDate)}${it.type === 'income' ? ' · receita' : ''}`)
    .join('\n');
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  return `Confere se está tudo certo antes de eu registrar${accName ? ` na conta *${accName}*` : ''}:\n\n${lines}\n\n*Total:* ${brl(total)}\n\n_(comp = competência · venc = vencimento)_\n\nResponda *sim* para registrar, ou *não* para cancelar.`;
}

async function _multiAskAccount(user, items, accounts, dueDate) {
  if (!accounts.length) {
    return {
      answer: `📌 Você ainda não tem *banco/conta* cadastrado. Me diga o *nome do banco/cartão* (ex.: Nubank) para eu criar e registrar os ${items.length} lançamentos. 😊\n\n_(ou responda *cancelar*)_`,
      pending: { type: 'multi_tx', step: 'account', items, dueDate },
    };
  }
  const list = accounts.map((a, i) => `*${i + 1}* — ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n');
  return {
    answer: `Em qual *banco/conta/cartão* registro esses *${items.length}* lançamentos?\n\n${list}\n\nResponda com o *número* ou o *nome*. Para um novo, envie *novo Nome* (ex.: novo Nubank).`,
    pending: { type: 'multi_tx', step: 'account', items, accounts, dueDate },
  };
}

// Resolve a competência e o vencimento de cada item. forced = data única (ISO)
// escolhida pelo usuário; se null, usa as datas da imagem (competência = data do
// item; vencimento = vencimento da fatura, com fallbacks). Sem nada, cai em hoje.
function _applyDates(items, invoiceDue, forced) {
  const today = new Date().toISOString().slice(0, 10);
  return items.map((it) => {
    const comp = forced || it.date || invoiceDue || today;
    const due = forced || invoiceDue || it.date || today;
    return { ...it, competenceDate: comp, dueDate: due };
  });
}

// Pergunta sobre as datas antes de confirmar: usar as datas da imagem ou uma nova.
async function _multiAskDates(user, items, invoiceDue, accountName) {
  const hasItemDates = items.some((it) => it.date);
  let info;
  if (invoiceDue && hasItemDates) info = `competência = data de cada compra na imagem · vencimento da fatura = ${_fmtDate(invoiceDue)}`;
  else if (invoiceDue) info = `vencimento da fatura = ${_fmtDate(invoiceDue)}`;
  else if (hasItemDates) info = 'datas das compras conforme a imagem';
  else info = 'não identifiquei datas na imagem';
  return {
    answer: `📅 Sobre as *datas* (${info}).\n\nQuer registrar com as *datas da imagem* ou usar uma *nova data*?\n\nResponda *imagem* (usa as datas do documento), *hoje* (data de hoje) ou envie uma data (ex.: 15/08/2026).`,
    pending: { type: 'multi_tx', step: 'date', items, dueDate: invoiceDue, accountName },
  };
}

// Processa a resposta do usuário em cada passo do fluxo de múltiplos lançamentos.
async function runMultiTxFlow(user, pending, raw) {
  const text = String(raw || '').trim();
  const low = text.toLowerCase();
  if (/^(cancela|cancelar|deixa|para|parar|desisto|desistir)$/i.test(low)) {
    return { answer: 'Ok, cancelei o cadastro. 🙂', pending: null };
  }

  if (pending.step === 'select') {
    const items = pending.items || [];
    const sel = _parseSelection(text, items.length);
    if (sel === null) {
      return { answer: 'Não entendi. Responda *todos*, os *números* (ex.: 1,3) ou *nenhum*.', pending };
    }
    if (!sel.length) {
      return { answer: 'Ok, não vou cadastrar nenhum. 🙂', pending: null };
    }
    const chosen = sel.map((i) => items[i]);
    // Casa a categoria sugerida de cada item com as categorias do usuário.
    const categories = await getUserCategories(user.id);
    for (const it of chosen) {
      const cat = it.category_name
        ? findCategoryByName(categories.filter((c) => !c.type || c.type === it.type), it.category_name)
        : null;
      it.categoryId = cat?.id || null;
      it.categoryName = cat?.name || null;
    }
    const accounts = await getUserAccounts(user.id);
    return await _multiAskAccount(user, chosen, accounts, pending.dueDate);
  }

  if (pending.step === 'account') {
    let accounts = pending.accounts || await getUserAccounts(user.id);
    const items = pending.items || [];
    let acc = null;
    const mNew = text.match(/^novo\s+(.+)/i);
    if (mNew) {
      const bankName = mNew[1].trim();
      const accId = await insertAccount(user.id, { name: bankName, bank_name: bankName, initial_balance: 0, type: 'checking' });
      accounts = await getUserAccounts(user.id);
      acc = accounts.find((a) => a.id === accId);
    } else if (!accounts.length) {
      if (!text) return { answer: 'Me diga o *nome do banco/cartão* para eu criar a conta (ex.: Nubank).', pending };
      const accId = await insertAccount(user.id, { name: text, bank_name: text, initial_balance: 0, type: 'checking' });
      accounts = await getUserAccounts(user.id);
      acc = accounts.find((a) => a.id === accId);
    } else {
      const num = parseInt(low, 10);
      if (!isNaN(num) && num >= 1 && num <= accounts.length) acc = accounts[num - 1];
      if (!acc) acc = findAccountByName(accounts, text);
    }
    if (!acc) {
      const list = accounts.map((a, i) => `*${i + 1}* — ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n');
      return { answer: `Não identifiquei a conta. Escolha pelo *número* ou *nome*:\n\n${list}\n\nOu envie *novo Nome* para criar uma.`, pending: { type: 'multi_tx', step: 'account', items, accounts, dueDate: pending.dueDate } };
    }
    const withAcc = items.map((it) => ({ ...it, accountId: acc.id }));
    return await _multiAskDates(user, withAcc, pending.dueDate, acc.name);
  }

  if (pending.step === 'date') {
    const items = pending.items || [];
    let forced = null;
    if (/^(imagem|documento|da imagem|do documento|sim|manter|mesma|mesmas|mantem|manten)/i.test(low)) {
      forced = null; // usa as datas da imagem
    } else if (/^(hoje|hj|agora|atual)/i.test(low)) {
      forced = new Date().toISOString().slice(0, 10);
    } else {
      const d = _normalizeDate(text);
      if (!d) return { answer: 'Não entendi a data. Responda *imagem*, *hoje*, ou envie uma data (ex.: 15/08/2026).', pending };
      forced = d;
    }
    const withDates = _applyDates(items, pending.dueDate, forced);
    return { answer: _multiConfirmText(user, withDates, pending.accountName), pending: { type: 'multi_tx', step: 'confirm', items: withDates, accountName: pending.accountName } };
  }

  if (pending.step === 'confirm') {
    const yes = /^(sim|s|confirmo|confirmar|pode|isso|ok|certo|correto|registrar|cadastrar)\b/i.test(low);
    const no = /^(n[ãa]o|nao|n|cancela|cancelar|errado|corrigir|deixa)\b/i.test(low);
    if (no) return { answer: 'Ok, cancelei o cadastro. Se quiser, me reenvie os dados corrigidos por texto. 🙂', pending: null };
    if (!yes) return { answer: 'Só confirmando: responda *sim* para registrar tudo, ou *não* para cancelar.', pending };
    const today = new Date().toISOString().slice(0, 10);
    let count = 0; let total = 0;
    for (const it of (pending.items || [])) {
      // Vencimento no futuro → lançamento fica como "a pagar/receber" (pending).
      const status = it.dueDate && it.dueDate > today ? 'pending' : 'paid';
      await insertTransaction(user.id, {
        name: it.name, amount: it.amount, type: it.type, kind: it.kind || null,
        accountId: it.accountId || null, categoryId: it.categoryId || null,
        competenceDate: it.competenceDate || null, dueDate: it.dueDate || null, status,
      });
      count += 1; total += Number(it.amount) || 0;
    }
    const accNote = pending.accountName ? ` na conta *${pending.accountName}*` : '';
    return { answer: `Pronto, ${firstName(user.name)}! Registrei *${count}* lançamento(s)${accNote}, total de ${brl(total)}. ✅`, pending: null };
  }

  return { answer: 'Vamos recomeçar: me envie o print/fatura ou os dados por texto. 🙂', pending: null };
}

// ── Fluxo conversacional de parcelamento (cartão → fechamento/vencimento → registrar) ──
// Compras parceladas viram um registro em `installments`. Precisamos do cartão/conta e,
// para saber quando cai a primeira parcela, dos dias de fechamento e vencimento da fatura
// (perguntados uma vez e guardados na conta).

function _instMonthly(inst) { return (Number(inst.total_amount) || 0) / (Number(inst.count) || 1); }
function _instSummary(inst) { return `"${inst.name}" (${inst.count}x de ${brl(_instMonthly(inst))}, total ${brl(inst.total_amount)})`; }

async function nextInstallmentStep(user, inst, accounts, categories) {
  // 1) Cartão/conta — obrigatório
  if (!inst.accountId) {
    if (!accounts.length) {
      const out = `📌 Você ainda não tem *cartão/conta* cadastrado. Para registrar o parcelamento de ${_instSummary(inst)}, me diga o *nome do cartão* (ex.: Nubank, Itaú) que eu cadastro e já registro. 😊\n\n_(ou responda *cancelar* para desistir)_`;
      return { answer: out, pending: { type: 'installment_flow', step: 'account_create', inst } };
    }
    const list = accounts.map((a, i) => `*${i + 1}* — ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n');
    const out = `Em qual *cartão/conta* foi o parcelamento de ${_instSummary(inst)}?\n\n${list}\n\nResponda com o *número* ou o *nome*. Para um cartão novo, envie *novo Nome* (ex.: novo Nubank).`;
    return { answer: out, pending: { type: 'installment_flow', step: 'account', inst, accounts } };
  }

  const acc = (accounts || []).find((a) => a.id === inst.accountId);

  // 2) Dia de fechamento da fatura — pergunta uma vez e guarda na conta
  if (acc && (acc.closing_day == null || acc.closing_day === '' || Number(acc.closing_day) < 1)) {
    const out = `Qual é o *dia de fechamento* da fatura do cartão ${acc.name}? (só o número, ex.: 5)`;
    return { answer: out, pending: { type: 'installment_flow', step: 'closing_day', inst, accounts } };
  }

  // 3) Dia de vencimento da fatura — pergunta uma vez e guarda na conta
  if (acc && (acc.due_day == null || acc.due_day === '' || Number(acc.due_day) < 1)) {
    const out = `E qual é o *dia de vencimento* da fatura do cartão ${acc.name}? (só o número, ex.: 12)`;
    return { answer: out, pending: { type: 'installment_flow', step: 'due_day', inst, accounts } };
  }

  // 4) Categoria — opcional
  if (!inst.categoryId && !inst.categorySkipped) {
    const cats = (categories || []).filter((c) => !c.type || c.type === 'expense');
    if (cats.length) {
      const list = cats.map((c, i) => `*${i + 1}* — ${c.icon ? c.icon + ' ' : ''}${c.name}`).join('\n');
      const out = `Quer classificar esse parcelamento numa *categoria*? (melhora seus relatórios)\n\n${list}\n\nResponda com o *número*/*nome*, ou *pular*.`;
      return { answer: out, pending: { type: 'installment_flow', step: 'category', inst, accounts, categories: cats } };
    }
  }

  // 5) Tudo resolvido — registra o parcelamento
  const closingDay = Number(acc?.closing_day) || 1;
  const dueDay = Number(acc?.due_day) || 1;
  const { start_month, start_year } = computeInstallmentStart(closingDay, dueDay);
  await insertInstallment(user.id, {
    name: inst.name, total_amount: inst.total_amount, count: inst.count, due_day: dueDay,
    account_id: inst.accountId, category_id: inst.categoryId, start_month, start_year,
  });
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const catNote = inst.categoryName ? ` · ${inst.categoryName}` : '';
  const accNote = acc ? ` no cartão ${acc.name}` : '';
  const out = `Pronto, ${firstName(user.name)}! Registrei o parcelamento de ${_instSummary(inst)}${accNote}${catNote}. Vence dia ${dueDay}, começando em ${meses[start_month - 1]}/${start_year}. ✅`;
  return { answer: out, pending: null };
}

async function runInstallmentFlow(user, pending, raw) {
  const text = String(raw || '').trim();
  const low = text.toLowerCase();
  const inst = pending.inst || {};

  if (/^(cancela|cancelar|deixa|para|parar|desisto|desistir)$/i.test(low)) {
    return { answer: 'Ok, cancelei o parcelamento. 🙂', pending: null };
  }

  if (pending.step === 'account_create') {
    if (!text) return { answer: 'Me diga o *nome do cartão* para eu cadastrar (ex.: Nubank).', pending };
    const accId = await insertAccount(user.id, { name: text, bank_name: text, initial_balance: 0, type: 'checking' });
    inst.accountId = accId;
    const accounts = await getUserAccounts(user.id);
    return await nextInstallmentStep(user, inst, accounts, await getUserCategories(user.id));
  }

  if (pending.step === 'account') {
    let accounts = pending.accounts || await getUserAccounts(user.id);
    const mNew = text.match(/^novo\s+(.+)/i);
    if (mNew) {
      const bankName = mNew[1].trim();
      const accId = await insertAccount(user.id, { name: bankName, bank_name: bankName, initial_balance: 0, type: 'checking' });
      inst.accountId = accId;
      accounts = await getUserAccounts(user.id);
      return await nextInstallmentStep(user, inst, accounts, await getUserCategories(user.id));
    }
    let acc = null;
    const num = parseInt(low, 10);
    if (!isNaN(num) && num >= 1 && num <= accounts.length) acc = accounts[num - 1];
    if (!acc) acc = findAccountByName(accounts, text);
    if (!acc) {
      const list = accounts.map((a, i) => `*${i + 1}* — ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n');
      return { answer: `Não identifiquei o cartão. Escolha pelo *número* ou *nome*:\n\n${list}\n\nOu envie *novo Nome* para cadastrar.`, pending };
    }
    inst.accountId = acc.id;
    return await nextInstallmentStep(user, inst, accounts, await getUserCategories(user.id));
  }

  if (pending.step === 'closing_day') {
    const d = parseInt(low.replace(/\D/g, ''), 10);
    if (isNaN(d) || d < 1 || d > 31) return { answer: 'Me diga só o *dia de fechamento* da fatura (número de 1 a 31).', pending };
    await setAccountCardDays(inst.accountId, { closing_day: d });
    const accounts = await getUserAccounts(user.id);
    return await nextInstallmentStep(user, inst, accounts, await getUserCategories(user.id));
  }

  if (pending.step === 'due_day') {
    const d = parseInt(low.replace(/\D/g, ''), 10);
    if (isNaN(d) || d < 1 || d > 31) return { answer: 'Me diga só o *dia de vencimento* da fatura (número de 1 a 31).', pending };
    await setAccountCardDays(inst.accountId, { due_day: d });
    const accounts = await getUserAccounts(user.id);
    return await nextInstallmentStep(user, inst, accounts, await getUserCategories(user.id));
  }

  if (pending.step === 'category') {
    const cats = pending.categories || [];
    const accounts = pending.accounts || await getUserAccounts(user.id);
    if (/^(pular|pula|sem|nenhuma|nao|não|skip)$/i.test(low)) {
      inst.categorySkipped = true;
      return await nextInstallmentStep(user, inst, accounts, cats);
    }
    let cat = null;
    const num = parseInt(low, 10);
    if (!isNaN(num) && num >= 1 && num <= cats.length) cat = cats[num - 1];
    if (!cat) cat = findCategoryByName(cats, text);
    if (!cat) {
      const list = cats.map((c, i) => `*${i + 1}* — ${c.name}`).join('\n');
      return { answer: `Não identifiquei a categoria. Escolha pelo *número*/*nome* ou envie *pular*:\n\n${list}`, pending };
    }
    inst.categoryId = cat.id; inst.categoryName = cat.name;
    return await nextInstallmentStep(user, inst, accounts, cats);
  }

  return { answer: 'Vamos recomeçar: me diga a compra parcelada (ex.: "comprei uma TV por 3500 em 8x").', pending: null };
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

  // Continuação do fluxo de parcelamento (cartão, fechamento/vencimento e categoria)
  if (conv.pending?.type === 'installment_flow') {
    const r = await runInstallmentFlow(user, conv.pending, raw);
    await reply(r.answer);
    await saveConversation(phone, user.id, r.pending, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: r.answer, action: 'installment_flow_step' });
    return { handled: true, reason: 'installment_flow_step' };
  }

  // Continuação do fluxo de MÚLTIPLOS lançamentos (seleção → conta → datas → confirmar)
  if (conv.pending?.type === 'multi_tx') {
    const r = await runMultiTxFlow(user, conv.pending, raw);
    await reply(r.answer);
    await saveConversation(phone, user.id, r.pending, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: r.answer, action: 'multi_tx_step' });
    return { handled: true, reason: 'multi_tx_step' };
  }

  // Continuação da baixa de conta (escolha qual conta pendente foi paga)
  if (conv.pending?.type === 'pay_bill') {
    const r = await runPayBillSelect(user, conv.pending, raw);
    await reply(r.answer);
    await saveConversation(phone, user.id, r.pending, conv.history || []);
    await logInteraction({ phone, user, inType, inText: raw, outText: r.answer, action: 'pay_bill_step' });
    return { handled: true, reason: 'pay_bill_step' };
  }

  return { handled: false };
}

// ── Núcleo: classificação de intenção via Groq ───────────────────────────────

function buildSystemPrompt(user, accounts = []) {
  const isAdmin = user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin';
  const accList = accounts.length
    ? accounts.map((a) => `- ${a.name}${a.bank_name ? ` (${a.bank_name})` : ''}`).join('\n')
    : '- (nenhuma conta/carteira cadastrada ainda)';
  return `Você é o assistente financeiro do Lumers Flow no WhatsApp — atende como uma pessoa de verdade, calorosa e prestativa, que cuida das finanças de quem fala com você. Fale sempre em português do Brasil, de forma breve, natural e humana (nada de robô). Seu objetivo é simplificar ao máximo a vida financeira da pessoa: entenda o que ela quer e faça por ela, perguntando só o essencial.

USUÁRIO ATUAL:
- Nome: ${user.name || 'Sem nome'}
- Nível de acesso: ${isAdmin ? 'ADMINISTRADOR (pode consultar dados de todos os usuários)' : 'USUÁRIO COMUM (só pode acessar a própria conta)'}

CONTAS/CARTEIRAS JÁ CADASTRADAS DO USUÁRIO:
${accList}

REGRAS DE ACESSO:
- Usuário comum: NUNCA revele dados de outros usuários. query_scope sempre "self".
- Administrador: pode usar query_scope "all_users" quando perguntar sobre todos os usuários/base.

COMO VOCÊ DEVE PENSAR (o mais importante):
Primeiro ENTENDA o que a pessoa realmente quer — como um amigo atento que cuida do dinheiro dela. As pessoas escrevem do jeito delas: com gírias, erros de digitação, áudio transcrito meio torto, mensagens curtas ou com várias coisas juntas. NÃO espere palavras exatas nem "comandos"; capte a INTENÇÃO por trás da mensagem e só então escolha a rota. Aja o quanto puder sozinho — só pergunte quando faltar algo essencial ou quando estiver genuinamente ambíguo. Nunca obrigue a pessoa a "falar do seu jeito". Use o histórico da conversa para entender o contexto.

AS ROTAS (escolha a que corresponde à INTENÇÃO, não a palavras-chave):
- register — a pessoa contou que GANHOU ou GASTOU dinheiro, ou COMPROU algo (à vista ou parcelado). type "income" (entrou) ou "expense" (saiu). Infira o que der: name (descrição curta), amount, kind ("fixed" p/ recorrente como salário/aluguel; "variable" p/ avulso; senão null), account_name (se citou "no Nubank", "pelo Itaú"…), category_name (pelo contexto: "almoço/ifood"→Alimentação, "uber/99"→Transporte, "salário"→Salário; na dúvida null). PARCELADO: installments = nº de parcelas (≥2) e amount = valor TOTAL da compra (se disser "10x de 300", total = 3000; "TV 3500 em 8x" → amount 3500, installments 8). À vista NÃO leva installments. NÃO pergunte sobre conta/categoria/cartão no reply — o sistema conduz isso depois.
- pay_bill — a pessoa avisou que JÁ PAGOU/QUITOU uma conta que estava a pagar (dar baixa em algo que já existia, não um gasto novo). pay_bill = { name (a conta paga), date ("YYYY-MM-DD"; "hoje"/"ontem"/uma data → converta; senão null), amount (se citou, senão null) }.
- create_account — quer criar/abrir uma CONTA, CARTEIRA ou CARTÃO (Nubank, Itaú, PicPay, dinheiro…). Um saldo citado é o SALDO INICIAL, jamais uma receita. account = { name, bank_name (se banco conhecido), initial_balance, type: "checking" padrão | "savings" | "wallet" }.
- create_category — quer criar uma CATEGORIA de receita/despesa (Pets, Academia, Freelance…). category = { name, type: "expense" padrão | "income", icon: 1 emoji que combine; na dúvida "📦" }. Não confunda com conta/carteira.
- query — quer SABER algo dos próprios números (saldo, quanto gastou/recebeu, resumo, "tô gastando muito?"). Defina query_scope; deixe reply vazio (o sistema responde com os dados).
- clarify — só quando você entendeu que é um lançamento mas está REALMENTE ambíguo se entrou ou saiu dinheiro. Pergunte de forma leve.
- answer — conversa, saudação, dúvida de uso, agradecimento, ou quando nada acima se aplica. Responda com calor humano.${isAdmin ? `
- manage_user (SÓ admin) — criar/editar/excluir usuários DO SISTEMA (não confunda com conta/carteira bancária). user_op = { op: "create"|"edit"|"delete", name, email, phone, password, target, generate_password }. Criar: colete nome completo, e-mail, telefone com DDD (OBRIGATÓRIO) e senha (mín. 8); "gere a senha" → generate_password=true. Extraia só o que o admin informou; o que faltar é pedido depois. Editar/excluir: target = e-mail ou nome. Admin pode usar query_scope "all_users" em consultas sobre a base.` : ''}

EXEMPLOS (a intenção importa, não as palavras exatas):
- "gastei 50 no ifood agora" → register, expense, name "iFood", amount 50, category_name "Alimentação"
- "caiu meu salário, 3200" → register, income, name "Salário", amount 3200, kind "fixed", category_name "Salário"
- "peguei um celular em 10x de 300" (com erro de digitação) → register, expense, name "Celular", amount 3000, installments 10
- "paguei a luz ontem" → pay_bill, name "luz", date = ontem
- "quanto sobrou esse mês?" / "tô gastando demais? me ajuda" → query, scope "self"
- "abre uma carteira nubank, tenho 200 lá" → create_account, name "Nubank", bank_name "Nubank", initial_balance 200, type "wallet"
- "queria uma categoria pra academia" → create_category, name "Academia", type "expense", icon "🏋️"
- "coloca 100 aí" (não diz se entrou ou saiu) → clarify
- "e aí, blz? esse app é bom?" → answer (converse, leve e humano)

Responda SEMPRE em JSON válido com este formato exato:
{
  "action": "register" | "create_account" | "create_category" | "pay_bill" | "manage_user" | "clarify" | "query" | "answer",
  "transaction": { "name": "string curta do lançamento", "amount": number, "type": "income" | "expense" | null, "kind": "fixed" | "variable" | null, "installments": number | null, "account_name": "string" | null, "category_name": "string" | null },
  "account": { "name": "string", "bank_name": "string", "initial_balance": number, "type": "checking" | "savings" | "wallet" | null },
  "category": { "name": "string", "type": "income" | "expense", "icon": "string (1 emoji)" },
  "pay_bill": { "name": "string" | null, "date": "YYYY-MM-DD" | null, "amount": number | null },
  "user_op": { "op": "create" | "edit" | "delete" | null, "name": "string" | null, "email": "string" | null, "password": "string" | null, "phone": "string" | null, "target": "string" | null, "generate_password": boolean },
  "query_scope": "self" | "all_users",
  "reply": "texto para enviar ao usuário no WhatsApp"
}
TOM DAS SUAS RESPOSTAS (campo "reply"):
- Fale como gente, não como robô. Evite frases mecânicas tipo "Operação realizada com sucesso". Prefira algo natural e caloroso: "Feito! Anotei seu almoço de R$ 50 😋" / "Boa, salário registrado! 💪".
- Varie as palavras de uma mensagem para outra. Use o primeiro nome da pessoa de vez em quando, sem exagero. No máximo 1 emoji, quando fizer sentido. Seja breve.
- register: confirme o lançamento de forma natural — NÃO pergunte sobre conta/categoria (o sistema cuida disso na sequência).
- create_account / create_category: confirme a criação com naturalidade.
- pay_bill: o sistema encontra a conta e dá baixa; um "reply" curto confirmando já basta.
- clarify: "reply" = a pergunta leve (ex.: "esse valor entrou ou saiu?").
- query: "reply" pode ficar vazio (o sistema responde depois com os dados).
- answer: "reply" com a resposta, no tom acima.${isAdmin ? `
- manage_user (apenas admin): o sistema conduz a coleta e responde.` : ''}`;
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

  const isAdmin = !!user && (user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin');

  // ── Trava de interação: só responde a usuários cadastrados ──────────────────
  // A instância do WhatsApp recebe mensagens de MUITOS contatos (inclusive de outras
  // conversas/instâncias). Para não disparar mensagem automática a quem não é do
  // Lumers Flow (spam e loops entre bots), números não cadastrados são ignorados em
  // silêncio. O fluxo de auto-cadastro só roda se explicitamente habilitado no painel.
  if (!user) {
    if (cfg.signupEnabled) {
      return handleUnknownUser({ phone, text: quickText, inType, reply, inst });
    }
    return { handled: true, reason: 'unregistered_ignored' };
  }

  // ── Guarda anti-loop/anti-bot ──────────────────────────────────────────────
  // Protege contra o cenário em que o outro lado também é um bot/IA: cada resposta
  // nossa dispara outra mensagem dele, gerando um loop infinito de mensagens.
  // Aplica-se a usuários cadastrados não-admin (admins são isentos).
  if (!isAdmin) {
    const nowMs = Date.now();
    const WINDOW_MS = 60 * 1000;   // janela de contagem
    const MAX_IN_WINDOW = 8;       // > 8 mensagens em 60s → provável bot/loop
    const guard = await getGuard(phone);

    // Já mudo (bot suspeito): só o código exato de reativação retoma o atendimento.
    if (guard.muted) {
      const given = String(quickText || '').trim().replace(/\s+/g, '');
      if (guard.code && given === String(guard.code)) {
        await saveGuard(phone, {});
        const out = 'Tudo certo, reativei o atendimento! 🙂 Como posso te ajudar?';
        await reply(out);
        await logInteraction({ phone, user, inType, inText: quickText, outText: out, action: 'reactivated' });
        return { handled: true, reason: 'reactivated' };
      }
      // Continua em silêncio para quebrar o loop — não responde nem envia nada.
      return { handled: true, reason: 'muted' };
    }

    // Janela deslizante: conta mensagens recebidas; se estourar, entra em mute.
    let winStart = guard.windowStart ? Date.parse(guard.windowStart) : 0;
    let count = Number(guard.count) || 0;
    if (!winStart || nowMs - winStart > WINDOW_MS) { winStart = nowMs; count = 0; }
    count += 1;
    if (count > MAX_IN_WINDOW) {
      const code = String(Math.floor(1000 + Math.random() * 9000)); // 4 dígitos
      await saveGuard(phone, { muted: true, code, mutedAt: new Date().toISOString() });
      const out = `Percebi *muitas mensagens automáticas* nesta conversa, então vou pausar o atendimento para evitar um loop. 🤖\n\nSe você é uma *pessoa* e quer continuar, responda *exatamente* com este código:\n\n*${code}*`;
      await reply(out);
      await logInteraction({ phone, user, inType, inText: quickText, outText: out, action: 'auto_muted' });
      return { handled: true, reason: 'auto_muted' };
    }
    await saveGuard(phone, { windowStart: new Date(winStart).toISOString(), count });
  }

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
      // Áudio: Groq Whisper (primário) → OpenAI Whisper → Gemini (fallback).
      if (!cfg.groqKey && !cfg.openaiKey && !cfg.geminiKey) { await reply('Recebi seu áudio, mas a interpretação de áudio ainda não está configurada. Pode me mandar por texto? 🙂'); return { handled: true, reason: 'no_audio_provider' }; }
      const b64 = await getMediaBase64(inst.name, inst.api_key, msg.key);
      const mime = m.audioMessage.mimetype || 'audio/ogg';
      if (b64) {
        const audioProviders = [];
        if (cfg.groqKey)   audioProviders.push('groq');
        if (cfg.openaiKey) audioProviders.push('openai');
        if (cfg.geminiKey) audioProviders.push('gemini');
        for (const p of audioProviders) {
          try {
            userText = p === 'groq'
              ? await groqTranscribeAudio({ key: cfg.groqKey, base64: b64, mime })
              : p === 'openai'
              ? await openaiTranscribeAudio({ key: cfg.openaiKey, model: cfg.openaiAudioModel, base64: b64, mime })
              : await geminiTranscribeAudio({ key: cfg.geminiKey, model: cfg.geminiModel, base64: b64, mime });
            if (userText && userText.trim()) break;
          } catch (e) {
            console.error(`[assistant] transcrição de áudio (${p}) falhou`, e?.message);
          }
        }
      }
    } else if (m.imageMessage) {
      userText = m.imageMessage.caption || '';
      // Sem nenhum provedor de visão configurado → função indisponível.
      if (!cfg.openaiKey && !cfg.groqKey && !cfg.geminiKey) {
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
    } else if (m.documentMessage || m.documentWithCaptionMessage) {
      // Documentos (PDF/fatura): OpenAI (primário) ou Gemini (fallback) leem PDF.
      const docMsg = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage || {};
      userText = docMsg.caption || '';
      if (!cfg.openaiKey && !cfg.geminiKey) {
        await reply('A *leitura de documentos (PDF)* precisa da OpenAI ou do Gemini configurados. Me envie os dados por texto que eu registro (ex.: "comprei uma TV por 3500 em 8x"). 🙂');
        return { handled: true, reason: 'doc_unavailable' };
      }
      const b64 = await getMediaBase64(inst.name, inst.api_key, msg.key);
      if (!b64) {
        await reply('Não consegui baixar o documento que você enviou. Pode reenviar ou me mandar os dados por texto? 🙂');
        return { handled: true, reason: 'doc_download_failed' };
      }
      const mime = docMsg.mimetype || 'application/pdf';
      try {
        imageContext = await readDocumentContent(cfg, b64, mime);
      } catch (e) {
        if (e.kind === 'tech') {
          await reply('A *leitura de documentos está temporariamente indisponível*. Tente novamente em alguns minutos ou me envie os dados por texto. 🙏');
          return { handled: true, reason: 'doc_tech_unavailable' };
        }
        await reply('Não consegui *entender* esse documento. Se for uma fatura, reenvie o PDF ou me diga os dados por texto (ex.: "comprei uma TV por 3500 em 8x"). 🙂');
        return { handled: true, reason: 'doc_unreadable' };
      }
      if (imageLooksUnreadable(imageContext)) {
        await reply('Não consegui *entender* esse documento — a leitura ficou ruim. Reenvie a fatura ou me diga os dados por texto. 🙂');
        return { handled: true, reason: 'doc_unreadable' };
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

  // Imagem/documento com VÁRIOS lançamentos (ex.: fatura de cartão): em vez de
  // registrar direto um único gasto, conduz um fluxo de seleção + confirmação.
  if (imageContext && (m.imageMessage || m.documentMessage || m.documentWithCaptionMessage)) {
    const { items, dueDate } = await extractLineItems(cfg, imageContext);
    if (items.length >= 2) {
      const answer = _multiListText(user, items);
      const pending = { type: 'multi_tx', step: 'select', items, dueDate };
      await reply(answer);
      const history = [...(conv.history || []), { role: 'user', content: `[${items.length} lançamentos extraídos de ${inType === 'image' ? 'imagem' : 'documento'}]` }, { role: 'assistant', content: answer }];
      await saveConversation(phone, user.id, pending, history);
      await logInteraction({ phone, user, inType, inText: imageContext, outText: answer, action: 'multi_tx_start' });
      return { handled: true, action: 'multi_tx_start' };
    }
  }

  // Monta a mensagem para o classificador, incluindo contexto pendente e de imagem
  let combined = userText || '';
  if (imageContext) combined += `\n\n[Conteúdo extraído do documento/print enviado]: ${imageContext}`;
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
      temperature: 0.4, // um pouco de calor p/ respostas menos robóticas (JSON segue válido no 70b)
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
    } else if (intent.action === 'create_category') {
      const c = intent.category || {};
      const name = (c.name || '').trim();
      if (!name) {
        answer = 'Qual o *nome* da categoria que você quer criar? E é de *receita* ou *despesa*?';
      } else {
        const type = c.type === 'income' ? 'income' : 'expense';
        const existing = await getUserCategories(user.id);
        const dup = findCategoryByName(existing.filter((x) => !x.type || x.type === type), name);
        if (dup) {
          answer = `Você já tem a categoria *${dup.name}* (${type === 'income' ? 'receita' : 'despesa'}). 🙂`;
        } else {
          await insertCategory(user.id, { name, type, icon: c.icon });
          answer = intent.reply || `Pronto, ${firstName(user.name)}! Criei a categoria *${name}* (${type === 'income' ? 'receita' : 'despesa'}). ✅`;
        }
      }
    } else if (intent.action === 'pay_bill') {
      const pb = intent.pay_bill || {};
      const paidDate = _normalizeDate(pb.date) || new Date().toISOString().slice(0, 10);
      const bills = await findPendingBills(user.id, pb.name);
      if (bills.length === 0) {
        answer = pb.name
          ? `Não encontrei nenhuma conta a pagar pendente com "${pb.name}". 🤔 Se quiser, me diga que quer *registrar* como uma nova despesa.`
          : 'Você não tem contas a pagar pendentes no momento. 🎉';
      } else if (bills.length === 1) {
        await markBillPaid(bills[0].id, paidDate);
        answer = `Pronto, ${firstName(user.name)}! Dei baixa em *${bills[0].name}* (${brl(bills[0].amount)}) como paga em ${_fmtDate(paidDate)}. ✅`;
      } else {
        const list = bills.map((b, i) => `*${i + 1}* — ${b.name} · ${brl(b.amount)}${b.due_date ? ` · venc ${_fmtDate(String(b.due_date).slice(0, 10))}` : ''}`).join('\n');
        answer = `Encontrei mais de uma conta pendente. Qual você pagou?\n\n${list}\n\nResponda com o *número*.`;
        newPending = { type: 'pay_bill', bills, paidDate };
      }
    } else if (intent.action === 'register') {
      const t = intent.transaction || {};
      const type = t.type === 'income' ? 'income' : 'expense';
      const amount = Number(t.amount) || Number(conv.pending?.amount) || 0;
      const name = t.name || conv.pending?.name || 'Lançamento';
      const installCount = Math.floor(Number(t.installments) || 0);
      if (!amount) {
        newPending = { type: 'transaction', name, amount: 0 };
        answer = 'Entendi o lançamento, mas não peguei o valor. Qual é o valor?';
      } else if (installCount >= 2) {
        // Compra parcelada → fluxo de parcelamento (cartão + fechamento/vencimento)
        const acc = findAccountByName(accounts, t.account_name);
        const categories = await getUserCategories(user.id);
        const cat = findCategoryByName(categories.filter((c) => !c.type || c.type === 'expense'), t.category_name);
        const inst = {
          name, total_amount: amount, count: installCount,
          accountId: acc?.id || null,
          categoryId: cat?.id || null, categoryName: cat?.name || null,
        };
        const step = await nextInstallmentStep(user, inst, accounts, categories);
        answer = step.answer;
        newPending = step.pending;
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
