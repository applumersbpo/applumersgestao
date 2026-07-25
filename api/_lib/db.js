import { createClient } from '@libsql/client';

let _client = null;
let _initialized = false;

export function getDb() {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL || 'libsql://placeholder.turso.io',
      authToken: process.env.TURSO_AUTH_TOKEN || '',
    });
    // Wrap execute to add diagnostics and guard against malformed calls
    try {
      const origExecute = _client.execute && _client.execute.bind(_client);
      if (origExecute) {
        _client.execute = async function(sqlOrObj, ...rest) {
          try {
            let info = { sql: '', args: [] };
            if (typeof sqlOrObj === 'string') {
              info.sql = sqlOrObj;
              if (rest && rest.length) info.args = rest[0];
            } else if (sqlOrObj && typeof sqlOrObj === 'object') {
              info.sql = sqlOrObj.sql;
              info.args = sqlOrObj.args || [];
              // normalize missing args in-place to avoid hrana doing Object.entries(undefined)
              try {
                if (!('args' in sqlOrObj) || sqlOrObj.args === undefined) sqlOrObj.args = [];
              } catch(_) {}
            } else {
              info.sql = String(sqlOrObj);
            }
            // Minimal logging to help debug problematic calls
            console.debug('[db.execute] SQL preview:', info.sql ? (info.sql.length > 200 ? info.sql.slice(0,200) + '...' : info.sql) : '<none>', 'args_len:', (info.args || []).length);
            const res = await origExecute(sqlOrObj, ...rest);
            return res;
          } catch (e) {
            try { console.error('[db.execute] ERROR', e && (e.stack || e.message)); } catch(_) {}
            // attach context and rethrow so upstream handlers can include it
            e.dbContext = { sqlOrObj };
            throw e;
          }
        };
      }
    } catch (wrapErr) {
      // If wrapping fails, log but continue returning the original client so app can still run
      try { console.error('[db.execute] wrapper setup failed', wrapErr && (wrapErr.stack || wrapErr.message)); } catch(_) {}
    }
  }
  return _client;
}

export async function initDb() {
  if (_initialized) return;
  const db = getDb();

  // Schema only — idempotent, fast
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS user_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT DEFAULT '',
      monthly_fee REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT DEFAULT '#94a3b8',
      icon TEXT DEFAULT '📦',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category_id TEXT DEFAULT '',
      transaction_type TEXT DEFAULT 'expense',
      kind TEXT DEFAULT 'fixed',
      amount REAL DEFAULT 0,
      due_day INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      template_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      category_id TEXT DEFAULT '',
      account_id TEXT DEFAULT '',
      transaction_type TEXT DEFAULT 'expense',
      kind TEXT DEFAULT 'fixed',
      amount REAL DEFAULT 0,
      due_date TEXT DEFAULT '',
      paid_date TEXT DEFAULT '',
      cash_date TEXT DEFAULT '',
      competence_date TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      month INTEGER DEFAULT 0,
      year INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS installments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category_id TEXT DEFAULT '',
      total_amount REAL DEFAULT 0,
      installments INTEGER DEFAULT 1,
      paid_installments INTEGER DEFAULT 0,
      due_day INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      account_id TEXT DEFAULT '',
      start_month INTEGER DEFAULT NULL,
      start_year INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_amount REAL DEFAULT 0,
      current_amount REAL DEFAULT 0,
      deadline TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT '🎯',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS banks (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      code TEXT DEFAULT '',
      name TEXT NOT NULL,
      logo_url TEXT DEFAULT '',
      published INTEGER DEFAULT 0,
      approved_by TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bank_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      bank_name TEXT DEFAULT '',
      type TEXT DEFAULT 'checking',
      currency TEXT DEFAULT 'BRL',
      initial_balance REAL DEFAULT 0,
      initial_balance_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS plan_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      monthly_fee REAL DEFAULT 0,
      features TEXT DEFAULT '{}',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ticker TEXT DEFAULT '',
      asset_class TEXT DEFAULT 'other',
      quantity REAL DEFAULT 0,
      avg_price REAL DEFAULT 0,
      current_price REAL DEFAULT 0,
      current_price_date TEXT DEFAULT '',
      institution TEXT DEFAULT '',
      icon TEXT DEFAULT '📈',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS investment_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      investment_id TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      quantity REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      date TEXT NOT NULL,
      month INTEGER DEFAULT 0,
      year INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT DEFAULT 'other',
      acquisition_value REAL DEFAULT 0,
      current_value REAL DEFAULT 0,
      current_value_date TEXT DEFAULT '',
      acquisition_date TEXT DEFAULT '',
      debt_amount REAL DEFAULT 0,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS asset_valuations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      value REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS evolution_instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_key TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS message_logs (
      id TEXT PRIMARY KEY,
      sent_by_id TEXT NOT NULL,
      sent_by_name TEXT DEFAULT '',
      sent_by_email TEXT DEFAULT '',
      instance_name TEXT DEFAULT '',
      recipient_id TEXT DEFAULT '',
      recipient_name TEXT DEFAULT '',
      recipient_phone TEXT DEFAULT '',
      message_text TEXT DEFAULT '',
      has_media INTEGER DEFAULT 0,
      media_type TEXT DEFAULT '',
      media_name TEXT DEFAULT '',
      status TEXT DEFAULT 'ok',
      error TEXT DEFAULT '',
      sent_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS message_campaigns (
      id TEXT PRIMARY KEY,
      created_by_id TEXT NOT NULL,
      created_by_name TEXT DEFAULT '',
      created_by_email TEXT DEFAULT '',
      instance_name TEXT DEFAULT '',
      text TEXT DEFAULT '',
      has_media INTEGER DEFAULT 0,
      media_type TEXT DEFAULT '',
      media_name TEXT DEFAULT '',
      media_b64 TEXT DEFAULT '',
      cadence_ms INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS message_dispatch (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      recipient_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      scheduled_for TEXT DEFAULT '',
      message_id TEXT DEFAULT '',
      error TEXT DEFAULT '',
      processing_at TEXT DEFAULT '',
      sent_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS impersonation_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_email TEXT DEFAULT '',
      target_id TEXT NOT NULL,
      target_email TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT DEFAULT '',
      html TEXT DEFAULT '',
      text TEXT DEFAULT '',
      category TEXT DEFAULT 'geral',
      is_system INTEGER DEFAULT 0,
      system_key TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      dynamic_filter TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_list_members (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      user_id TEXT DEFAULT '',
      email TEXT NOT NULL,
      name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_id TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      html TEXT DEFAULT '',
      list_id TEXT DEFAULT '',
      trigger_type TEXT DEFAULT 'immediate',
      scheduled_for TEXT DEFAULT '',
      event_key TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      total INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_dispatch (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      user_id TEXT DEFAULT '',
      to_email TEXT NOT NULL,
      to_name TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      html TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      scheduled_for TEXT DEFAULT '',
      message_id TEXT DEFAULT '',
      error TEXT DEFAULT '',
      processing_at TEXT DEFAULT '',
      sent_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS email_log (
      id TEXT PRIMARY KEY,
      to_email TEXT DEFAULT '',
      to_name TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      template_key TEXT DEFAULT '',
      campaign_id TEXT DEFAULT '',
      status TEXT DEFAULT 'sent',
      message_id TEXT DEFAULT '',
      error TEXT DEFAULT '',
      sent_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS notification_types (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      channel TEXT DEFAULT 'email',
      default_on INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      template_key TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS user_notification_prefs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      notif_key TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    // Auditoria administrativa: registra TODAS as ações de admin/super_admin
    // (criação/alteração/exclusão de usuários, config, instâncias etc.).
    // Separado de email_log de propósito — domínios diferentes.
    `CREATE TABLE IF NOT EXISTS system_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT DEFAULT '',
      actor_email TEXT DEFAULT '',
      actor_role TEXT DEFAULT '',
      action TEXT DEFAULT '',
      target_type TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      target_label TEXT DEFAULT '',
      details TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // evolution_instances — add is_default column if missing
  const { rows: eiCols } = await db.execute("PRAGMA table_info('evolution_instances')");
  if ((eiCols || []).length > 0 && !(eiCols || []).find(r => r.name === 'is_default')) {
    await db.execute("ALTER TABLE evolution_instances ADD COLUMN is_default INTEGER DEFAULT 0");
  }

  // Column migrations — safe PRAGMA checks
  const { rows: tcols } = await db.execute("PRAGMA table_info('transactions')");
  const existingCols = (tcols || []).map(r => r.name);
  if (!existingCols.includes('account_id')) {
    await db.execute("ALTER TABLE transactions ADD COLUMN account_id TEXT DEFAULT ''");
  }
  if (!existingCols.includes('cash_date')) {
    await db.execute("ALTER TABLE transactions ADD COLUMN cash_date TEXT DEFAULT ''");
  }
  if (!existingCols.includes('competence_date')) {
    await db.execute("ALTER TABLE transactions ADD COLUMN competence_date TEXT DEFAULT ''");
  }
  if (!existingCols.includes('paid_amount')) {
    // F-210: nullable, sem DEFAULT 0. NULL = "não-informado" (relatório usa amount);
    // 0 = "R$0 real pago". Novos registros gravam paid_amount explicitamente.
    await db.execute("ALTER TABLE transactions ADD COLUMN paid_amount REAL");
  }
  // F-210: legados que receberam paid_amount=0 na migração anterior significavam
  // "não-informado", não "R$0 real pago". Converte 0 → NULL UMA única vez. O flag em
  // system_settings garante idempotência e evita zerar pagamentos R$0 legítimos
  // criados depois (rodar de novo não causa dano).
  {
    const { rows: f210rows } = await db.execute({
      sql: "SELECT value FROM system_settings WHERE key = 'migr_f210_paid_amount_zero_to_null'",
      args: [],
    });
    if (!(f210rows || []).length) {
      // F-210: UPDATE + gravação do flag num único batch transacional (libsql) para
      // atomicidade — uma queda entre os dois reexecutaria o UPDATE no próximo boot,
      // re-anulando eventuais R$0 legítimos. O batch garante "tudo-ou-nada".
      await db.batch([
        "UPDATE transactions SET paid_amount = NULL WHERE paid_amount = 0",
        {
          sql: "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('migr_f210_paid_amount_zero_to_null', '1')",
          args: [],
        },
      ], 'write');
    }
  }

  // Migrations — installments table
  const { rows: iCols } = await db.execute("PRAGMA table_info('installments')");
  const iColNames = (iCols || []).map(r => r.name);
  if (!iColNames.includes('account_id'))  await db.execute("ALTER TABLE installments ADD COLUMN account_id TEXT DEFAULT ''");
  if (!iColNames.includes('start_month')) await db.execute("ALTER TABLE installments ADD COLUMN start_month INTEGER DEFAULT NULL");
  if (!iColNames.includes('start_year'))  await db.execute("ALTER TABLE installments ADD COLUMN start_year INTEGER DEFAULT NULL");

  // Migrations — users table
  const { rows: ucols } = await db.execute("PRAGMA table_info('users')");
  const uColNames = (ucols || []).map(r => r.name);
  if (!uColNames.includes('last_login')) {
    await db.execute("ALTER TABLE users ADD COLUMN last_login TEXT DEFAULT ''");
  }
  if (!uColNames.includes('role')) {
    await db.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    // Migrate existing is_admin=1 users to role='admin'
    await db.execute("UPDATE users SET role='admin' WHERE is_admin=1 AND role='user'");
  }
  if (!uColNames.includes('avatar')) {
    await db.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''");
  }

  // Garante que o super admin sempre tenha role e is_admin corretos
  await db.execute({
    sql: "UPDATE users SET role = 'super_admin', is_admin = 1 WHERE email = 'applumergestao@gmail.com'",
    args: [],
  });

  // Migrations — user_plans table
  const { rows: upcols } = await db.execute("PRAGMA table_info('user_plans')");
  const upColNames = (upcols || []).map(r => r.name);
  if (!upColNames.includes('plan_template_id')) {
    await db.execute("ALTER TABLE user_plans ADD COLUMN plan_template_id TEXT DEFAULT ''");
  }
  if (!upColNames.includes('features_override')) {
    await db.execute("ALTER TABLE user_plans ADD COLUMN features_override TEXT DEFAULT '{}'");
  }
  // Add logo_url to accounts
  const { rows: acols } = await db.execute("PRAGMA table_info('accounts')");
  const aColNames = (acols || []).map(r => r.name);
  if (!aColNames.includes('logo_url')) {
    await db.execute("ALTER TABLE accounts ADD COLUMN logo_url TEXT DEFAULT ''");
  }

  // evolution_instances — new status/qr columns
  const { rows: eiCols2 } = await db.execute("PRAGMA table_info('evolution_instances')");
  const eiColNames = (eiCols2 || []).map(r => r.name);
  if (!eiColNames.includes('connection_status')) {
    await db.execute("ALTER TABLE evolution_instances ADD COLUMN connection_status TEXT DEFAULT 'unknown'");
  }
  if (!eiColNames.includes('qr')) {
    await db.execute("ALTER TABLE evolution_instances ADD COLUMN qr TEXT DEFAULT ''");
  }
  if (!eiColNames.includes('last_status_at')) {
    await db.execute("ALTER TABLE evolution_instances ADD COLUMN last_status_at TEXT DEFAULT ''");
  }

  // message_logs — delivery tracking columns
  const { rows: mlCols } = await db.execute("PRAGMA table_info('message_logs')");
  const mlColNames = (mlCols || []).map(r => r.name);
  if (!mlColNames.includes('message_id')) {
    await db.execute("ALTER TABLE message_logs ADD COLUMN message_id TEXT DEFAULT ''");
  }
  if (!mlColNames.includes('delivery_status')) {
    await db.execute("ALTER TABLE message_logs ADD COLUMN delivery_status TEXT DEFAULT ''");
  }

  // message_dispatch index for queue processing
  await db.execute("CREATE INDEX IF NOT EXISTS idx_message_dispatch_status_scheduled ON message_dispatch(status, scheduled_for)");

  // Seed default system settings (INSERT OR IGNORE keeps existing values)
  await db.execute({ sql: "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('allow_registration', '0')", args: [] });

  // ===== E-mail subsystem =====
  // Indexes for dispatch queue processing and per-user notification prefs uniqueness
  await db.execute("CREATE INDEX IF NOT EXISTS idx_email_dispatch_status_scheduled ON email_dispatch(status, scheduled_for)");
  await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notif_prefs ON user_notification_prefs(user_id, notif_key)");

  // Seed e-mail system settings (INSERT OR IGNORE keeps existing values)
  await db.execute({ sql: "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('email_enabled', '0')", args: [] });
  await db.execute({ sql: "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('email_from', 'Lumers Flow <no-reply@app.lumersbpo.com.br>')", args: [] });
  await db.execute({ sql: "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('resend_api_key', '')", args: [] });

  // Seed system e-mail templates (idempotent por id fixo/system_key). HTML responsivo PT-BR.
  const _tplReset = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:#6366f1;padding:24px;text-align:center;"><span style="color:#ffffff;font-size:20px;font-weight:700;">Lumers Flow</span></td></tr>
      <tr><td style="padding:32px 24px;color:#1e293b;">
        <h1 style="margin:0 0 16px;font-size:20px;">Redefinição de senha</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Olá {{name}}, recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova senha:</p>
        <p style="text-align:center;margin:24px 0;"><a href="{{reset_link}}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Redefinir senha</a></p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#94a3b8;">Se o botão não funcionar, copie e cole este link no navegador:</p>
        <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="{{reset_link}}" style="color:#6366f1;">{{reset_link}}</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">Se você não solicitou essa alteração, ignore este e-mail.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;">&copy; Lumers Flow — <a href="{{app_url}}" style="color:#94a3b8;">{{app_url}}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const _tplWelcome = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:#10b981;padding:24px;text-align:center;"><span style="color:#ffffff;font-size:20px;font-weight:700;">Lumers Flow</span></td></tr>
      <tr><td style="padding:32px 24px;color:#1e293b;">
        <h1 style="margin:0 0 16px;font-size:20px;">Boas-vindas, {{name}}! 🎉</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">A sua conta na Lumers Flow foi criada com sucesso. Agora você pode organizar as suas finanças, acompanhar metas e ter controle total do seu fluxo de caixa.</p>
        <p style="text-align:center;margin:24px 0;"><a href="{{app_url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Acessar a plataforma</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">Qualquer dúvida, é só responder a este e-mail. Estamos por aqui para ajudar.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;">&copy; Lumers Flow — <a href="{{app_url}}" style="color:#94a3b8;">{{app_url}}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const _tplExpiry = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:#f59e0b;padding:24px;text-align:center;"><span style="color:#ffffff;font-size:20px;font-weight:700;">Lumers Flow</span></td></tr>
      <tr><td style="padding:32px 24px;color:#1e293b;">
        <h1 style="margin:0 0 16px;font-size:20px;">O seu plano está próximo do vencimento</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Olá {{name}}, o seu plano <strong>{{plan_name}}</strong> vence em <strong>{{expiry_date}}</strong>. Para continuar aproveitando todos os recursos sem interrupção, renove antes do vencimento.</p>
        <p style="text-align:center;margin:24px 0;"><a href="{{app_url}}" style="display:inline-block;background:#f59e0b;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Renovar plano</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">Se já efetuou a renovação, desconsidere este aviso.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;">&copy; Lumers Flow — <a href="{{app_url}}" style="color:#94a3b8;">{{app_url}}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  await db.execute({
    sql: "INSERT OR IGNORE INTO email_templates (id, name, subject, html, category, is_system, system_key) VALUES (?, ?, ?, ?, 'sistema', 1, 'reset_password')",
    args: ['tpl_sys_reset_password', 'Redefinição de senha', 'Redefina a sua senha — Lumers Flow', _tplReset],
  });
  await db.execute({
    sql: "INSERT OR IGNORE INTO email_templates (id, name, subject, html, category, is_system, system_key) VALUES (?, ?, ?, ?, 'sistema', 1, 'welcome')",
    args: ['tpl_sys_welcome', 'E-mail de boas-vindas', 'Bem-vindo(a) à Lumers Flow, {{name}}!', _tplWelcome],
  });
  await db.execute({
    sql: "INSERT OR IGNORE INTO email_templates (id, name, subject, html, category, is_system, system_key) VALUES (?, ?, ?, ?, 'sistema', 1, 'plan_expiry')",
    args: ['tpl_sys_plan_expiry', 'Lembrete de vencimento do plano', 'O seu plano {{plan_name}} vence em {{expiry_date}}', _tplExpiry],
  });

  // Migration one-time (guardada por flag): os 3 templates de sistema acima já existem
  // (INSERT OR IGNORE não atualiza linhas existentes), então este UPDATE troca o cabeçalho
  // para exibir o LOGO real ({{logo_url}}) e usar a cor da marca ({{primary_color}}) nos CTAs.
  // Roda uma ÚNICA vez — o flag evita clobberar edições futuras feitas pelo admin.
  if ((await getSystemSetting('email_tpl_logo_migrated')) !== '1') {
    const _tplResetLogo = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:{{primary_color}};padding:24px;text-align:center;"><img src="{{logo_url}}" alt="{{app_name}}" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;line-height:1;"></td></tr>
      <tr><td style="padding:32px 24px;color:#1e293b;">
        <h1 style="margin:0 0 16px;font-size:20px;">Redefinição de senha</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Olá {{name}}, recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova senha:</p>
        <p style="text-align:center;margin:24px 0;"><a href="{{reset_link}}" style="display:inline-block;background:{{primary_color}};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Redefinir senha</a></p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#94a3b8;">Se o botão não funcionar, copie e cole este link no navegador:</p>
        <p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="{{reset_link}}" style="color:{{primary_color}};">{{reset_link}}</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">Se você não solicitou essa alteração, ignore este e-mail.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;">&copy; {{app_name}} — <a href="{{app_url}}" style="color:#94a3b8;">{{app_url}}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    const _tplWelcomeLogo = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:{{primary_color}};padding:24px;text-align:center;"><img src="{{logo_url}}" alt="{{app_name}}" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;line-height:1;"></td></tr>
      <tr><td style="padding:32px 24px;color:#1e293b;">
        <h1 style="margin:0 0 16px;font-size:20px;">Boas-vindas, {{name}}! 🎉</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">A sua conta na {{app_name}} foi criada com sucesso. Agora você pode organizar as suas finanças, acompanhar metas e ter controle total do seu fluxo de caixa.</p>
        <p style="text-align:center;margin:24px 0;"><a href="{{app_url}}" style="display:inline-block;background:{{primary_color}};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Acessar a plataforma</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">Qualquer dúvida, é só responder a este e-mail. Estamos por aqui para ajudar.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;">&copy; {{app_name}} — <a href="{{app_url}}" style="color:#94a3b8;">{{app_url}}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    const _tplExpiryLogo = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:{{primary_color}};padding:24px;text-align:center;"><img src="{{logo_url}}" alt="{{app_name}}" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;line-height:1;"></td></tr>
      <tr><td style="padding:32px 24px;color:#1e293b;">
        <h1 style="margin:0 0 16px;font-size:20px;">O seu plano está próximo do vencimento</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Olá {{name}}, o seu plano <strong>{{plan_name}}</strong> vence em <strong>{{expiry_date}}</strong>. Para continuar aproveitando todos os recursos sem interrupção, renove antes do vencimento.</p>
        <p style="text-align:center;margin:24px 0;"><a href="{{app_url}}" style="display:inline-block;background:{{primary_color}};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Renovar plano</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">Se já efetuou a renovação, desconsidere este aviso.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;">&copy; {{app_name}} — <a href="{{app_url}}" style="color:#94a3b8;">{{app_url}}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    await db.execute({
      sql: "UPDATE email_templates SET html = ?, updated_at = datetime('now') WHERE id = 'tpl_sys_reset_password'",
      args: [_tplResetLogo],
    });
    await db.execute({
      sql: "UPDATE email_templates SET html = ?, updated_at = datetime('now') WHERE id = 'tpl_sys_welcome'",
      args: [_tplWelcomeLogo],
    });
    await db.execute({
      sql: "UPDATE email_templates SET html = ?, updated_at = datetime('now') WHERE id = 'tpl_sys_plan_expiry'",
      args: [_tplExpiryLogo],
    });
    await setSystemSetting('email_tpl_logo_migrated', '1');
  }

  // Seed notification types (idempotente por key). O admin gerencia a lista.
  await db.execute({
    sql: "INSERT OR IGNORE INTO notification_types (id, key, name, description, channel, default_on, active, template_key) VALUES (?, 'plan_expiry', 'Lembrete de vencimento do plano', 'Aviso enviado antes do vencimento do plano do usuário', 'email', 1, 1, 'plan_expiry')",
    args: ['ntf_plan_expiry'],
  });
  await db.execute({
    sql: "INSERT OR IGNORE INTO notification_types (id, key, name, description, channel, default_on, active, template_key) VALUES (?, 'welcome', 'E-mail de boas-vindas', 'E-mail enviado quando um novo usuário é criado', 'email', 1, 1, 'welcome')",
    args: ['ntf_welcome'],
  });

  _initialized = true;
}

export async function getSystemSetting(key) {
  const db = getDb();
  const { rows } = await db.execute({ sql: 'SELECT value FROM system_settings WHERE key = ?', args: [key] });
  if (!rows || rows.length === 0) return null;
  return rows[0].value ?? null;
}

export async function setSystemSetting(key, value) {
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    args: [key, value],
  });
}

export function rowsToObjects(rows) {
  if (!rows) return [];
  return rows.map(row => {
    const obj = {};
    if (!row) return obj;
    for (const [k, v] of Object.entries(row || {})) {
      obj[k] = v;
    }
    return obj;
  });
}
