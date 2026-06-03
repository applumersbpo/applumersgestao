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
  ];

  for (const sql of tables) {
    await db.execute(sql);
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

  // Add last_login to users
  const { rows: ucols } = await db.execute("PRAGMA table_info('users')");
  const uColNames = (ucols || []).map(r => r.name);
  if (!uColNames.includes('last_login')) {
    await db.execute("ALTER TABLE users ADD COLUMN last_login TEXT DEFAULT ''");
  }
  // Add logo_url to accounts
  const { rows: acols } = await db.execute("PRAGMA table_info('accounts')");
  const aColNames = (acols || []).map(r => r.name);
  if (!aColNames.includes('logo_url')) {
    await db.execute("ALTER TABLE accounts ADD COLUMN logo_url TEXT DEFAULT ''");
  }

  _initialized = true;
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
