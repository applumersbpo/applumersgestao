import { getDb, initDb, rowsToObjects, getSystemSetting } from '../_lib/db.js';
import { requireAuth, cors, signToken } from '../_lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDb();
    const { action } = req.query;
    const db = getDb();

    // GET /api/auth/register-status
    if (action === 'register-status' && req.method === 'GET') {
      const value = await getSystemSetting('allow_registration');
      return res.status(200).json({ allow_registration: value === '1' });
    }

    // POST /api/auth/login
    if (action === 'login') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

        const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
        const users = rowsToObjects(rows);

        if (users.length === 0) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

        const user = users[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos' });

        const role = user.role || (user.is_admin ? 'admin' : 'user');
        const token = await signToken({ sub: user.id, email: user.email, is_admin: !!user.is_admin, role });
        await db.execute({ sql: "UPDATE users SET last_login = ? WHERE id = ?", args: [new Date().toISOString(), user.id] });
        const { password_hash: _, ...safeUser } = user;
        return res.status(200).json({ token, user: safeUser });
      } catch (err) {
        console.error('LOGIN ERROR', err);
        // Generic error for production
        return res.status(500).json({ error: 'Erro interno' });
      }
    }

    // POST /api/auth/register
    if (action === 'register') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      try {
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

    // GET /api/auth/me
    if (action === 'me') {
      const payload = await requireAuth(req);
      const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [payload.sub] });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(401).json({ error: 'Unauthorized' });
      const { password_hash: _, ...user } = users[0];
      return res.status(200).json({ user });
    }

    // POST /api/auth/forgot
    if (action === 'forgot' && req.method === 'POST') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
      const { rows } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase().trim()] });
      const users = rowsToObjects(rows);
      if (!users.length) return res.status(200).json({ ok: true });
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 3600000).toISOString();
      await db.execute({
        sql: 'INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
        args: [crypto.randomUUID(), users[0].id, token, expires]
      });
      return res.status(200).json({ ok: true, _dev_token: token });
    }

    // POST /api/auth/reset
    if (action === 'reset' && req.method === 'POST') {
      const { token, password, passwordConfirm } = req.body || {};
      if (!token || !password) return res.status(400).json({ error: 'Dados inválidos' });
      if (password !== passwordConfirm) return res.status(400).json({ error: 'As senhas não coincidem' });
      if (password.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
      const now = new Date().toISOString();
      const { rows } = await db.execute({
        sql: 'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?',
        args: [token, now]
      });
      const resets = rowsToObjects(rows);
      if (!resets.length) return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo.' });
      const hash = await bcrypt.hash(password, 10);
      await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, resets[0].user_id] });
      await db.execute({ sql: 'UPDATE password_resets SET used = 1 WHERE id = ?', args: [resets[0].id] });
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Action not found' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
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
