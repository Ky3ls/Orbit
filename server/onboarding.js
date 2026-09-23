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

export function orbitPortConflict(db, port) {
  const row = listOrbitServers(db).find((s) => Number(s.port) === Number(port));
  return row ? { id: row.id, name: row.name } : null;
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

export async function installMysql(logLine = () => {}) {
  logLine('info', 'MySQL/MariaDB Installation (apt)…');
  await exec('sudo', ['-n', 'apt-get', 'update', '-qq'], { timeout: 180_000 });
  await exec('sudo', [
    '-n', 'env', 'DEBIAN_FRONTEND=noninteractive',
    'apt-get', 'install', '-y', '-qq', 'mariadb-server',
  ], { timeout: 600_000 });
  await exec('sudo', ['-n', 'systemctl', 'enable', '--now', 'mariadb'], { timeout: 60_000 });
  const st = await detectMysqlService();
  if (!st.running) throw new Error('MariaDB installiert, Dienst läuft nicht.');
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
 * Legt DB + App-User an (root-Passwort oder sudo mysql).
 */
export async function provisionMysqlDatabase(opts) {
  const dbName = safeIdent(opts.dbName);
  const appUser = safeIdent(opts.appUser || 'orbit');
  const appPass = String(opts.appPassword || randomBytes(10).toString('base64url'));
  const sql = [
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `CREATE USER IF NOT EXISTS '${appUser}'@'localhost' IDENTIFIED BY '${appPass.replace(/'/g, "''")}';`,
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${appUser}'@'localhost';`,
    'FLUSH PRIVILEGES;',
  ].join(' ');

  if (opts.rootPassword !== undefined && opts.rootPassword !== null) {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: String(opts.rootPassword),
    });
    for (const stmt of sql.split(';').filter(Boolean)) {
      await conn.query(stmt);
    }
    await conn.end();
  } else {
    await exec('sudo', ['-n', 'mysql', '-e', sql], { timeout: 30_000 });
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
