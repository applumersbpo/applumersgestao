import { getDb, initDb, rowsToObjects } from '../_lib/db.js';
import { requireAuth, cors, signToken, isImpersonation } from '../_lib/auth.js';

// POST /api/admin/impersonate
// Admin/super_admin emite um token de impersonação (read-only, 2h) para "ver como" um usuário.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await initDb();
    const requester = await requireAuth(req);

    // Um token de impersonação NUNCA pode emitir outro (anti-escalonamento).
    if (isImpersonation(requester)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Apenas admin/super_admin podem impersonar.
    if (!requester.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { targetUserId } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId é obrigatório' });

    const db = getDb();
    const { rows } = await db.execute({
      sql: 'SELECT id, email, name FROM users WHERE id = ?',
      args: [targetUserId],
    });
    const target = rowsToObjects(rows)[0];
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Token rebaixado: is_admin SEMPRE false, role SEMPRE 'user', imp=true. Expira em 2h.
    const token = await signToken(
      {
        sub: target.id,
        email: target.email,
        is_admin: false,
        role: 'user',
        imp: true,
        imp_by: requester.sub,
        imp_by_email: requester.email,
      },
      { expiresIn: '2h' }
    );

    // Auditoria
    await db.execute({
      sql: 'INSERT INTO impersonation_logs (id, admin_id, admin_email, target_id, target_email) VALUES (?, ?, ?, ?, ?)',
      args: [crypto.randomUUID(), requester.sub, requester.email || '', target.id, target.email || ''],
    });

    return res.status(200).json({
      token,
      target: { id: target.id, name: target.name || '', email: target.email },
    });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro interno' });
  }
}
