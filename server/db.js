import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH } from './config.js';

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_secret TEXT,
      totp_pending TEXT,
      must_change INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      last_login INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      created INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      ip TEXT,
      ua TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tickets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY,
      identifier TEXT NOT NULL,
      name TEXT,
      reason TEXT NOT NULL,
      author TEXT NOT NULL,
      expires INTEGER,
      created INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS warns (
      id INTEGER PRIMARY KEY,
      identifier TEXT NOT NULL,
      name TEXT,
      reason TEXT NOT NULL,
      author TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      identifier TEXT PRIMARY KEY,
      name TEXT,
      ping INTEGER,
      ids TEXT,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS whitelist (
      id INTEGER PRIMARY KEY,
      identifier TEXT UNIQUE NOT NULL,
      note TEXT,
      author TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resources (
      name TEXT PRIMARY KEY,
      folder TEXT,
      actual TEXT NOT NULL DEFAULT 'unknown',
      desired TEXT,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      hhmm TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_key TEXT
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      user TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      author TEXT NOT NULL,
      status TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      nonce TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      user_id INTEGER,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
  `);
  for (const sql of [
    'ALTER TABLE users ADD COLUMN cfx_id TEXT',
    'ALTER TABLE users ADD COLUMN cfx_name TEXT',
    'ALTER TABLE users ADD COLUMN prefs TEXT',
    'ALTER TABLE users ADD COLUMN ingame_license TEXT',
    'ALTER TABLE players ADD COLUMN play_ms INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE resources ADD COLUMN folder TEXT',
  ]) {
    try { db.exec(sql); } catch (err) {
      if (!String(err.message).includes('duplicate column')) throw err;
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingame_web_tickets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cfx ON users(cfx_id) WHERE cfx_id IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ingame_license ON users(ingame_license) WHERE ingame_license IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_players_last ON players(last_seen DESC)');
  return db;
}

export function audit(db, user, action, detail, ip) {
  db.prepare('INSERT INTO audit (user, action, detail, ip, created) VALUES (?, ?, ?, ?, ?)')
    .run(user, action, detail || '', ip || '', Date.now());
}

/** Orbit-interne Events (nicht FX-Konsole). */
export function auditSystem(db, action, detail = '') {
  try {
    audit(db, 'system', action, String(detail || '').slice(0, 500), 'local');
  } catch { /* db noch nicht bereit */ }
}

/** Callback für Sync/Deploy: schreibt nur Audit, nie die FiveM-Konsole. */
export function auditLogger(db, actionPrefix = 'orbit') {
  return (msg) => {
    const text = String(msg || '').trim();
    if (!text) return;
    auditSystem(db, actionPrefix, text);
  };
}

export function settingMap(db) {
  const out = {};
  for (const row of db.prepare('SELECT k, v FROM settings').all()) out[row.k] = row.v;
  return out;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, String(value));
}
