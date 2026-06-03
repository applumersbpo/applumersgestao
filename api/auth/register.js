import { getDb, initDb, rowsToObjects, getSystemSetting } from '../lib/db.js';
import { cors } from '../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();

    const allow = await getSystemSetting('allow_registration');
    if (allow !== '1') {
      return res.status(403).json({ error: 'Cadastro de novas contas temporariamente desabilitado.' });
    }

    const { email, password, passwordConfirm, name } = req.body || {};
    const phone = req.body?.phone ? req.body.phone.replace(/\D/g, '') : '';
    const normalizedPhone = phone ? (phone.startsWith('55') ? phone : '55' + phone) : '';
    if (!email || !password) return res.status(400).json({ error: 'Preencha todos os campos', fields: {} });
    if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem', fields: {} });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres', fields: {} });

    const db = getDb();
    const { rows: existing } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
    if (rowsToObjects(existing).length > 0) {
      return res.status(400).json({ error: 'failed to create', fields: { email: 'E-mail já cadastrado' } });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, email.toLowerCase().trim(), hash, name || '', normalizedPhone, now]
    });
    await db.execute({
      sql: 'INSERT INTO user_plans (id, user_id, email, name, monthly_fee, active) VALUES (?, ?, ?, ?, 0, 1)',
      args: [crypto.randomUUID(), id, email.toLowerCase().trim(), name || '']
    });

    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    const user = rowsToObjects(rows)[0];
    const { password_hash: _, ...safeUser } = user;

    // Enviar boas-vindas pelo WhatsApp (não bloqueia o registro)
    if (normalizedPhone) _enviarBoasVindasWhatsApp(safeUser).catch(() => {});

    return res.status(201).json({ user: safeUser });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erro ao criar conta' });
  }
}

function _normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : '55' + digits;
}

async function _enviarBoasVindasWhatsApp(user) {
  const url  = process.env.EVOLUTION_URL;
  const key  = process.env.EVOLUTION_APIKEY;
  if (!url || !key || !user.phone) return;
  const nome = (user.name || '').split(' ')[0] || 'você';
  const msg  =
    `Olá, ${nome}! 👋 Aqui é a assistente da *Lumers BPO*!\n\n` +
    `Estou aqui para facilitar o seu controle financeiro direto pelo WhatsApp.\n\n` +
    `💸 *Despesa:* "gastei 35 no almoço"\n` +
    `💳 *Parcelamento:* "comprei tênis 300 em 3x"\n` +
    `💚 *Receita:* "recebi 2000 de salário"\n` +
    `🔔 *Conta:* "conta de luz 150 vence dia 20"\n\n` +
    `Pode testar agora! 🚀`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ number: _normalizePhone(user.phone), text: msg }),
  });
}
