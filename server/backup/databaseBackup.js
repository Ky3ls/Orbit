/**
 * MySQL-Datenbank-Backup via mysqldump (DSN aus Panel-Settings).
 * Fallback: klare Fehlermeldung wenn mysqldump/DSN fehlt.
 */
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { mysqlReady } from '../mysql.js';
import {
  assertBackupType,
  backupId,
  enforceRetention,
  normalizeRetention,
  resolveBackupPath,
  stamp,
  typeDir,
} from './store.js';

const execFileAsync = promisify(execFile);

function parseMysqlDsn(dsn) {
  let url;
  try {
    url = new URL(String(dsn || ''));
  } catch {
    throw new Error('MySQL-DSN ungültig.');
  }
  if (!String(url.protocol).startsWith('mysql')) {
    throw new Error('MySQL-DSN muss mysql://… sein.');
  }
  const database = url.pathname.replace(/^\//, '');
  if (!database) throw new Error('MySQL-DSN ohne Datenbankname.');
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database,
  };
}

async function ensureMysqldump() {
  try {
    await execFileAsync('mysqldump', ['--version'], { timeout: 8_000 });
  } catch {
    throw new Error('mysqldump ist nicht installiert oder nicht im PATH.');
  }
}

function redactSecret(text, secret) {
  const s = String(text || '');
  if (!secret) return s.slice(0, 400);
  return s.split(secret).join('***').slice(0, 400);
}

/**
 * @param {{ settings: Record<string,string>, retention?: number }} opts
 */
export async function createDatabaseBackup(opts = {}) {
  assertBackupType('database');
  const settings = opts.settings || {};
  if (!mysqlReady(settings)) {
    throw new Error('MySQL nicht konfiguriert (mysql_connection_string / mysqlDsn).');
  }
  await ensureMysqldump();

  const cfg = parseMysqlDsn(settings.mysqlDsn);
  const retention = normalizeRetention(opts.retention);
  const safeDb = cfg.database.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'db';
  const filename = `database-${safeDb}-${stamp()}.sql.gz`;
  const dest = resolveBackupPath('database', filename);
  typeDir('database');

  const args = [
    `--host=${cfg.host}`,
    `--port=${cfg.port}`,
    `--user=${cfg.user}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    '--hex-blob',
    '--default-character-set=utf8mb4',
    cfg.database,
  ];
  const env = { ...process.env, MYSQL_PWD: cfg.password };

  let stderr = '';
  try {
    const child = spawn('mysqldump', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (c) => {
      stderr += String(c);
      if (stderr.length > 2000) stderr = stderr.slice(0, 2000);
    });

    const gzip = createGzip({ level: 6 });
    const out = fs.createWriteStream(dest, { mode: 0o600 });

    const pipeDone = pipeline(child.stdout, gzip, out);
    const exitDone = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('mysqldump Timeout (10 Min).'));
      }, 600_000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(redactSecret(stderr || `mysqldump exit ${code}`, cfg.password)));
      });
    });

    await Promise.all([pipeDone, exitDone]);
  } catch (err) {
    try { fs.unlinkSync(dest); } catch { /* ignore */ }
    throw err instanceof Error ? err : new Error(String(err));
  }

  const st = fs.statSync(dest);
  if (!st.size) {
    try { fs.unlinkSync(dest); } catch { /* ignore */ }
    throw new Error('mysqldump lieferte leere Ausgabe.');
  }

  const retentionResult = enforceRetention('database', retention);
  return {
    id: backupId('database', filename),
    type: 'database',
    name: filename,
    size: st.size,
    created: Math.floor(st.mtimeMs),
    path: dest,
    database: cfg.database,
    retention: retentionResult,
  };
}
