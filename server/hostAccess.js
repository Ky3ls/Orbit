import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const PANEL_USER = process.env.ORBIT_USER || 'tx2';

export function canListDirectory(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
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
    if (canListDirectory(dir)) continue;
    try {
      await exec('sudo', ['-n', 'setfacl', '-m', `u:${PANEL_USER}:rx`, dir], { timeout: 30_000 });
      logLine('info', `Lesezugriff für ${PANEL_USER}: ${dir}`);
    } catch (err) {
      logLine('warn', `ACL ${dir}: ${err.message}`);
    }
  }

  const uniqueData = [...new Set(dataPaths.map((p) => path.resolve(p)).filter((p) => p && fs.existsSync(p)))];
  for (const dp of uniqueData) {
    try {
      await exec('sudo', ['-n', 'setfacl', '-R', '-m', `u:${PANEL_USER}:rwx`, dp], { timeout: 120_000 });
      await exec('sudo', ['-n', 'setfacl', '-R', '-d', '-m', `u:${PANEL_USER}:rwx`, dp], { timeout: 120_000 });
      logLine('info', `Schreibzugriff für ${PANEL_USER}: ${dp}`);
    } catch (err) {
      logLine('warn', `ACL Datenpfad ${dp}: ${err.message}`);
    }
  }

  const root = String(fxRoot || '').replace(/\/$/, '');
  if (root && fs.existsSync(root)) {
    try {
      await exec('sudo', ['-n', 'setfacl', '-m', `u:${PANEL_USER}:rx`, root], { timeout: 30_000 });
      const alpine = path.join(root, 'alpine');
      if (fs.existsSync(alpine)) {
        await exec('sudo', ['-n', 'setfacl', '-R', '-m', `u:${PANEL_USER}:rx`, alpine], { timeout: 120_000 });
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
