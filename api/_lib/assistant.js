import { getDb, rowsToObjects } from './db.js';
import { getAiConfig, groqChat, groqTranscribeAudio, groqReadImage, geminiTranscribeAudio, geminiReadImage } from './ai.js';
import { sendText, evoBase, resolveKey, headers } from './evolution.js';

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
    sql: `SELECT id, email, name, phone, role, is_admin FROM users WHERE ${norm} IN (${placeholders})`,
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

async function insertTransaction(userId, { name, amount, type }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const iso = now.toISOString();
  const today = iso.slice(0, 10);
  await db.execute({
    sql: `INSERT INTO transactions (id, user_id, name, amount, transaction_type, kind, status, due_date, paid_date, month, year, notes, category_id, template_id, source, created_at)
          VALUES (?, ?, ?, ?, ?, 'variable', 'paid', ?, ?, ?, ?, 'Registrado via WhatsApp', '', '', 'whatsapp', ?)`,
    args: [id, userId, name || 'Lançamento', Number(amount) || 0, type === 'income' ? 'income' : 'expense', today, today, now.getMonth() + 1, now.getFullYear(), iso],
  });
  return id;
}

// ── Núcleo: classificação de intenção via Groq ───────────────────────────────

function buildSystemPrompt(user) {
  const isAdmin = user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin';
  return `Você é o assistente financeiro do Lumers Flow no WhatsApp. Fale sempre em português do Brasil, de forma breve, cordial e objetiva.

USUÁRIO ATUAL:
- Nome: ${user.name || 'Sem nome'}
- Nível de acesso: ${isAdmin ? 'ADMINISTRADOR (pode consultar dados de todos os usuários)' : 'USUÁRIO COMUM (só pode acessar a própria conta)'}

REGRAS DE ACESSO:
- Usuário comum: NUNCA revele dados de outros usuários. query_scope sempre "self".
- Administrador: pode usar query_scope "all_users" quando perguntar sobre todos os usuários/base.

O QUE VOCÊ PODE FAZER:
1. Registrar lançamentos (receitas e despesas) a partir de texto, áudio (já transcrito) ou print (já descrito).
2. Responder consultas sobre saldo, receitas, despesas e resumos.
3. Conversar e orientar sobre o uso.

REGRA IMPORTANTE DE CLASSIFICAÇÃO:
- Se o usuário quer registrar um valor mas NÃO está claro se é RECEITA (entrada) ou DESPESA (saída), use action "clarify" e pergunte gentilmente.
- Se estiver claro, use action "register" com type "income" ou "expense".

Responda SEMPRE em JSON válido com este formato exato:
{
  "action": "register" | "clarify" | "query" | "answer",
  "transaction": { "name": "string curta do lançamento", "amount": number, "type": "income" | "expense" | null },
  "query_scope": "self" | "all_users",
  "reply": "texto para enviar ao usuário no WhatsApp"
}
- Em "register": preencha transaction completo e um "reply" confirmando.
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
  if (!user) {
    const out = 'Olá! Este número ainda não está cadastrado no Lumers Flow. Peça ao administrador para cadastrar o seu WhatsApp e volte a falar comigo. 🙂';
    await reply(out);
    await logInteraction({ phone, user: null, inType: 'text', inText: '', outText: out, action: 'unknown_user' });
    return { handled: true, reason: 'unknown_user' };
  }

  const m = msg.message || {};
  const inType = m.audioMessage ? 'audio' : m.imageMessage ? 'image' : m.videoMessage ? 'video' : 'text';

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

  const conv = await getConversation(phone);

  // Monta a mensagem para o classificador, incluindo contexto pendente e de imagem
  let combined = userText || '';
  if (imageContext) combined += `\n\n[Conteúdo extraído do print enviado]: ${imageContext}`;
  if (conv.pending?.type === 'transaction') {
    combined = `[CONTEXTO: o usuário estava registrando "${conv.pending.name}" no valor de ${brl(conv.pending.amount)} e você perguntou se é RECEITA ou DESPESA. A mensagem atual provavelmente responde isso.]\n\n${combined}`;
  }

  let intent;
  try {
    const raw = await groqChat({
      key: cfg.groqKey,
      model: cfg.groqModel,
      jsonMode: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(user) },
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

  const isAdmin = user.is_admin === 1 || user.role === 'admin' || user.role === 'super_admin';
  let answer = intent.reply || '';
  let newPending = null;

  try {
    if (intent.action === 'clarify') {
      const t = intent.transaction || {};
      newPending = { type: 'transaction', name: t.name || conv.pending?.name || 'Lançamento', amount: t.amount || conv.pending?.amount || 0 };
      answer = intent.reply || 'Esse valor é uma receita (entrada) ou uma despesa (saída)?';
    } else if (intent.action === 'register') {
      const t = intent.transaction || {};
      const type = t.type === 'income' ? 'income' : 'expense';
      const amount = Number(t.amount) || Number(conv.pending?.amount) || 0;
      const name = t.name || conv.pending?.name || 'Lançamento';
      if (!amount) {
        newPending = { type: 'transaction', name, amount: 0 };
        answer = 'Entendi o lançamento, mas não peguei o valor. Qual é o valor?';
      } else {
        await insertTransaction(user.id, { name, amount, type });
        answer = intent.reply || `Pronto, ${firstName(user.name)}! Registrei ${type === 'income' ? 'a receita' : 'a despesa'} "${name}" de ${brl(amount)}. ✅`;
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
