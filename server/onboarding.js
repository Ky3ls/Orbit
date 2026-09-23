import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { portOpen } from './fivem.js';
import { listOrbitServers } from './orbitServersDb.js';
import { ORBIT_SERVERS_ROOT } from './config.js';
import { prodReadiness } from './prodConfig.js';
import { settingMap } from './db.js';
import { detectTxAdminEnvironment } from './txAdminMigration.js';
import { installedArtifacts } from './artifacts.js';
import fs from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);

export async function checkPortInUse(port, host = '127.0.0.1') {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return { ok: false, port: p, inUse: false, error: 'Port ungültig.' };
  }
  const inUse = await portOpen(host, p);
  return { ok: true, port: p, inUse, available: !inUse };
}

export function orbitPortConflict(db, port, { ignoreInactive = true, exceptDataPath = '' } = {}) {
  const rows = listOrbitServers(db);
  const except = String(exceptDataPath || '').replace(/\/$/, '');
  const row = rows.find((s) => {
    if (Number(s.port) !== Number(port)) return false;
    if (except && String(s.data_path || '').replace(/\/$/, '') === except) return false;
    if (ignoreInactive && !Number(s.is_active)) return false;
    return true;
  });
  return row ? { id: row.id, name: row.name, dataPath: row.data_path } : null;
}

export async function detectMysqlService() {
  for (const svc of ['mariadb', 'mysql']) {
    try {
      const { stdout } = await exec('systemctl', ['is-active', svc], { timeout: 5000 });
      if (String(stdout).trim() === 'active') {
        return { installed: true, running: true, service: svc };
      }
    } catch { /* next */ }
  }
  try {
    await exec('which', ['mysql'], { timeout: 3000 });
    return { installed: true, running: false, service: '' };
  } catch {
    return { installed: false, running: false, service: '' };
  }
}

/**
 * Installiert MariaDB nur wenn noch kein MySQL/MariaDB-Dienst existiert.
 * Bestehende Installationen werden nie angefasst (kein apt, kein Restart).
 */
export async function installMysql(logLine = () => {}) {
  const existing = await detectMysqlService();
  if (existing.running) {
    logLine('ok', `MySQL/MariaDB läuft bereits (${existing.service}) — Installation übersprungen.`);
    return existing;
  }
  if (existing.installed) {
    logLine('info', 'MySQL/MariaDB installiert, Dienst starten…');
    for (const svc of ['mysql', 'mariadb']) {
      try {
        await exec('sudo', ['-n', 'systemctl', 'enable', '--now', svc], { timeout: 60_000 });
        break;
      } catch { /* next */ }
    }
    const st = await detectMysqlService();
    if (st.running) {
      logLine('ok', `Dienst ${st.service} gestartet.`);
      return st;
    }
    throw new Error('MySQL ist installiert, startet aber nicht. Bitte systemctl status mysql prüfen.');
  }

  logLine('info', 'Kein MySQL gefunden — MariaDB wird installiert (apt)…');
  await exec('sudo', ['-n', 'apt-get', 'update', '-qq'], { timeout: 180_000 });
  await exec('sudo', [
    '-n', 'env', 'DEBIAN_FRONTEND=noninteractive',
    'apt-get', 'install', '-y', '-qq', 'mariadb-server',
  ], { timeout: 600_000 });
  await exec('sudo', ['-n', 'systemctl', 'enable', '--now', 'mariadb'], { timeout: 60_000 }).catch(async () => {
    await exec('sudo', ['-n', 'systemctl', 'enable', '--now', 'mysql'], { timeout: 60_000 });
  });
  const st = await detectMysqlService();
  if (!st.running) throw new Error('MariaDB installiert, Dienst läuft nicht.');
  logLine('ok', 'MariaDB installiert und gestartet.');
  return st;
}

function safeIdent(name) {
  const s = String(name || '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48);
  if (!s) throw new Error('Ungültiger Datenbankname.');
  return s;
}

export function defaultDbName(serverName) {
  return safeIdent(`orbit_${serverName}`).toLowerCase();
}

/**
 * Legt DB + App-User an.
 * Standard: sudo mysql (auth_socket / systemd) — kein root-Passwort nötig.
 * Nur wenn ein root-Passwort gesetzt ist: TCP-Login als root.
 */
export async function provisionMysqlDatabase(opts) {
  const dbName = safeIdent(opts.dbName);
  const appUser = safeIdent(opts.appUser || 'orbit');
  const appPass = String(opts.appPassword || randomBytes(12).toString('hex'));
  const passSql = appPass.replace(/'/g, "''");
  const sql = [
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `CREATE USER IF NOT EXISTS '${appUser}'@'localhost' IDENTIFIED BY '${passSql}';`,
    `ALTER USER '${appUser}'@'localhost' IDENTIFIED BY '${passSql}';`,
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${appUser}'@'localhost';`,
    'FLUSH PRIVILEGES;',
  ].join(' ');

  const rootPw = opts.rootPassword == null ? '' : String(opts.rootPassword).trim();

  if (rootPw) {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: rootPw,
    });
    try {
      for (const stmt of sql.split(';').filter(Boolean)) {
        await conn.query(stmt);
      }
    } finally {
      await conn.end();
    }
  } else {
    try {
      await exec('sudo', ['-n', 'mysql', '-e', sql], { timeout: 30_000 });
    } catch (err) {
      const msg = String(err?.stderr || err?.message || err);
      throw new Error(
        `MySQL per sudo fehlgeschlagen (${msg.slice(0, 180)}). `
        + 'Root nutzt oft auth_socket — leer lassen reicht, wenn orbit sudo mysql darf. '
        + 'Sonst root-Passwort eintragen.',
      );
    }
  }

  const dsn = `mysql://${encodeURIComponent(appUser)}:${encodeURIComponent(appPass)}@127.0.0.1/${dbName}?charset=utf8mb4`;
  return { dsn, dbName, appUser, appPassword: appPass };
}

export async function buildSetupPreflight(db) {
  const settings = settingMap(db);
  const paths = prodReadiness(settings.fxDataPath || '', settings.fxServerRoot || '');
  const mysql = await detectMysqlService();
  const port = Number(settings.fivemPort) || 30120;
  const portCheck = await checkPortInUse(port);
  const serversRoot = settings.orbitServersRoot || ORBIT_SERVERS_ROOT;
  let txadmin = { found: false, profiles: [] };
  try {
    const det = await detectTxAdminEnvironment();
    txadmin = {
      found: det.found,
      hints: det.hints,
      profiles: det.profiles.map((p) => ({
        profile: p.profile,
        dataPath: p.dataPath,
        hostname: p.hostname,
        port: p.port,
        maxClients: p.maxClients,
        resourceCount: p.resourceCount,
        hasPlayersDb: p.hasPlayersDb,
      })),
      fxRoot: det.fxRoot,
      unitsActive: det.units.filter((u) => u.active).map((u) => u.unit),
      txAdminAdmins: det.txAdminAdmins,
    };
  } catch { /* Host ohne systemd */ }
  const readyArtifacts = installedArtifacts().filter((a) => a.ready);
  const fxRoot = settings.fxServerRoot || '';
  const hasFxBinary = Boolean(
    (fxRoot && fs.existsSync(path.join(fxRoot, 'alpine/opt/cfx-server/FXServer')))
    || readyArtifacts.length > 0,
  );
  return {
    paths,
    mysql,
    port: { ...portCheck, orbitConflict: orbitPortConflict(db, port) },
    artifact: hasFxBinary,
    artifactPath: fxRoot || readyArtifacts[0]?.path || '',
    serversRoot,
    defaultServersRoot: ORBIT_SERVERS_ROOT,
    txadmin,
  };
}
