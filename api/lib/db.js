import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

let _client = null;
let _initialized = false;

export function getDb() {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL || 'libsql://placeholder.turso.io',
      authToken: process.env.TURSO_AUTH_TOKEN || '',
    });
  }
  return _client;
}

export async function initDb() {
  if (_initialized) return;
  const db = getDb();

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

  // Ensure transactions have new columns (safe migration)
  const { rows: tcols } = await db.execute({ sql: "PRAGMA table_info('transactions')" });
  const existingCols = (tcols || []).map(r => r.name);
  if (!existingCols.includes('account_id')) {
    await db.execute({ sql: "ALTER TABLE transactions ADD COLUMN account_id TEXT DEFAULT ''" });
  }
  if (!existingCols.includes('cash_date')) {
    await db.execute({ sql: "ALTER TABLE transactions ADD COLUMN cash_date TEXT DEFAULT ''" });
  }
  if (!existingCols.includes('competence_date')) {
    await db.execute({ sql: "ALTER TABLE transactions ADD COLUMN competence_date TEXT DEFAULT ''" });
  }

  // Migrate existing transactions to a default 'Caixa' account per user
  const { rows: users } = await db.execute({ sql: 'SELECT id FROM users' });
  for (const u of users) {
    const uid = u.id;
    // check if user already has a 'Caixa' account
    const { rows: exist } = await db.execute({ sql: 'SELECT id FROM accounts WHERE user_id = ? AND name = ?', args: [uid, 'Caixa'] });
    let accId;
    if (exist.length > 0) {
      accId = exist[0].id;
    } else {
      accId = crypto.randomUUID();
      await db.execute({ sql: 'INSERT INTO accounts (id, user_id, name, initial_balance, created_at) VALUES (?, ?, ?, ?, ?)', args: [accId, uid, 'Caixa', 0, new Date().toISOString()] });
    }
    // assign transactions without account_id to this account
    await db.execute({ sql: "UPDATE transactions SET account_id = ? WHERE user_id = ? AND (account_id = '' OR account_id IS NULL)", args: [accId, uid] });
  }

  // Seed/ensure admin user with correct credentials
  const { rows: adminRows } = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: ['applumergestao@gmail.com'] });
  const hash = await bcrypt.hash('123lumers', 10);
  if (adminRows.length === 0) {
    const id = crypto.randomUUID();
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, name, is_admin) VALUES (?, ?, ?, ?, 1)',
      args: [id, 'applumergestao@gmail.com', hash, 'Admin Lumers']
    });
    await db.execute({
      sql: 'INSERT INTO user_plans (id, user_id, email, name, monthly_fee, active) VALUES (?, ?, ?, ?, 0, 1)',
      args: [crypto.randomUUID(), id, 'applumergestao@gmail.com', 'Admin Lumers']
    });
  } else {
    await db.execute({
      sql: 'UPDATE users SET password_hash = ?, is_admin = 1 WHERE email = ?',
      args: [hash, 'applumergestao@gmail.com']
    });
  }

  _initialized = true;
}

export function rowsToObjects(rows) {
  return rows.map(row => {
    const obj = {};
    for (const [k, v] of Object.entries(row)) {
      obj[k] = v;
    }
    return obj;
  });
}
