import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { isBlockedPath, normalizeServerPath } from './serverPathPolicy.js';

const exec = promisify(execFile);
export const PANEL_USER = process.env.ORBIT_USER || 'orbit';

export function canListDirectory(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

export function canWriteDirectory(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function sudo(...args) {
  await exec('sudo', ['-n', ...args], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
}

/**
 * Traverse-ACL (nur x) auf Zwischenordner unter /root — ohne Lesezugriff auf Geschwister.
 * Gesperrte Pfade (Rechnungen/Telegram) werden nie angefasst.
 */
async function ensureTraverseParents(absPath, logLine = () => {}) {
  const parts = normalizeServerPath(absPath).split('/').filter(Boolean);
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur += `/${parts[i]}`;
    if (isBlockedPath(cur)) throw new Error(`Pfad nicht erlaubt: ${cur}`);
    if (canListDirectory(cur) || canWriteDirectory(cur)) continue;
    // Nur execute zum Traversieren (z. B. /root)
    try {
      await sudo('setfacl', '-m', `u:${PANEL_USER}:x`, cur);
      logLine('info', `Traverse für ${PANEL_USER}: ${cur}`);
    } catch (err) {
      logLine('warn', `Traverse ${cur}: ${err.message}`);
    }
  }
}

/**
 * Legt Datenordner an und gibt orbit rwx (sudo setfacl/chown).
 */
export async function prepareServerDataPath(rawPath, logLine = () => {}) {
  const dataPath = normalizeServerPath(rawPath);
  if (!dataPath || dataPath === '/') throw new Error('Ungültiger Datenordner.');
  if (isBlockedPath(dataPath)) throw new Error('Dieser Pfad ist nicht erlaubt.');

  await ensureTraverseParents(dataPath, logLine);

  if (!fs.existsSync(dataPath)) {
    try {
      fs.mkdirSync(dataPath, { recursive: true });
    } catch {
      await sudo('mkdir', '-p', dataPath);
      logLine('info', `Ordner angelegt: ${dataPath}`);
    }
  }

  if (!canWriteDirectory(dataPath)) {
    try {
      await sudo('chown', '-R', `${PANEL_USER}:${PANEL_USER}`, dataPath);
    } catch {
      /* ACL fallback */
    }
    try {
      await sudo('setfacl', '-R', '-m', `u:${PANEL_USER}:rwx`, dataPath);
      await sudo('setfacl', '-R', '-d', '-m', `u:${PANEL_USER}:rwx`, dataPath);
      logLine('info', `Schreibzugriff für ${PANEL_USER}: ${dataPath}`);
    } catch (err) {
      if (!canWriteDirectory(dataPath)) {
        throw new Error(`Kein Schreibzugriff auf ${dataPath} (sudo/ACL für User ${PANEL_USER} fehlt).`);
      }
      logLine('warn', `ACL ${dataPath}: ${err.message}`);
    }
  }

  if (!canWriteDirectory(dataPath)) {
    throw new Error(`Keine Schreibrechte auf ${dataPath}.`);
  }
  return dataPath;
}

/**
 * Orbit-Panel läuft als eigener Systemuser (nicht root). Unter /root/… braucht es POSIX-ACLs:
 * - rx auf txData-Root (Profile auflisten)
 * - rwx auf Server-Datenordner (server.cfg, resources, logs)
 * - rx auf FX-Artifact-Root
 */
export async function ensurePanelPathAccess(
  { dataPaths = [], fxRoot = '', txDataRoots = [] },
  logLine = () => {},
) {
  const listDirs = new Set();
  for (const root of txDataRoots) {
    if (root) listDirs.add(path.resolve(root));
  }
  for (const dp of dataPaths) {
    if (dp) listDirs.add(path.dirname(path.resolve(dp)));
  }

  for (const dir of listDirs) {
    if (!fs.existsSync(dir)) continue;
    if (isBlockedPath(dir)) continue;
    if (canListDirectory(dir)) continue;
    try {
      await sudo('setfacl', '-m', `u:${PANEL_USER}:rx`, dir);
      logLine('info', `Lesezugriff für ${PANEL_USER}: ${dir}`);
    } catch (err) {
      logLine('warn', `ACL ${dir}: ${err.message}`);
    }
  }

  const uniqueData = [...new Set(dataPaths.map((p) => path.resolve(p)).filter((p) => p && fs.existsSync(p)))];
  for (const dp of uniqueData) {
    if (isBlockedPath(dp)) continue;
    try {
      await sudo('setfacl', '-R', '-m', `u:${PANEL_USER}:rwx`, dp);
      await sudo('setfacl', '-R', '-d', '-m', `u:${PANEL_USER}:rwx`, dp);
      logLine('info', `Schreibzugriff für ${PANEL_USER}: ${dp}`);
    } catch (err) {
      logLine('warn', `ACL Datenpfad ${dp}: ${err.message}`);
    }
  }

  const root = String(fxRoot || '').replace(/\/$/, '');
  if (root && fs.existsSync(root) && !isBlockedPath(root)) {
    try {
      await sudo('setfacl', '-m', `u:${PANEL_USER}:rx`, root);
      const alpine = path.join(root, 'alpine');
      if (fs.existsSync(alpine)) {
        await sudo('setfacl', '-R', '-m', `u:${PANEL_USER}:rx`, alpine);
      }
    } catch (err) {
      logLine('warn', `ACL FX-Root: ${err.message}`);
    }
  }
}

export function pathAccessHint(dir) {
  if (!dir || canListDirectory(dir)) return '';
  return `Kein Lesezugriff auf ${dir}. User „${PANEL_USER}“ braucht ACL (rx auf txData, rwx auf Server-Ordner) — Einstellungen → Host → „Zugriff reparieren“.`;
}

export async function sudoAvailable() {
  try {
    await exec('sudo', ['-n', '/usr/bin/setfacl', '-h'], { timeout: 5000 });
    return true;
  } catch {
    try {
      await exec('sudo', ['-n', '/usr/bin/mkdir', '--help'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
