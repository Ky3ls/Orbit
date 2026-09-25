/**
 * Server-Datei-Backup (tar.gz) des aktiven FX-Datenordners.
 *
 * Enthalten:
 *  - alle .cfg im Server-Root (server.cfg, permissions.cfg, …)
 *  - resources/ (Spiel-Ressourcen)
 *
 * Explizit ausgelassen (Performance / Größe):
 *  - .git, node_modules, cache, .cache, stream_cache
 *  - *.log, crash-Dumps, Yarn/npm Caches
 *  - FX-Artifact / alpine / Panel-data (liegen außerhalb des Data-Pfads)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isBlockedPath, normalizeServerPath } from '../serverPathPolicy.js';
import {
  assertBackupType,
  backupId,
  enforceRetention,
  normalizeRetention,
  resolveBackupPath,
  stamp,
  typeDir,
} from './store.js';

const exec = promisify(execFile);

const EXCLUDES = [
  '--exclude=.git',
  '--exclude=node_modules',
  '--exclude=cache',
  '--exclude=.cache',
  '--exclude=stream_cache',
  '--exclude=*.log',
  '--exclude=*.dmp',
  '--exclude=.yarn',
  '--exclude=yarn-error.log',
  '--exclude=.npm',
  '--exclude=__pycache__',
];

export const SERVER_BACKUP_CONTENTS = {
  includes: ['.cfg (Server-Root)', 'resources/'],
  excludes: [
    '.git', 'node_modules', 'cache', '.cache', 'stream_cache',
    '*.log', '*.dmp', '.yarn', '.npm', '__pycache__',
  ],
};

function resolveFxDataPath(settings = {}) {
  const raw = String(settings.fxDataPath || '').trim();
  if (!raw) throw new Error('Kein Server-Datenpfad konfiguriert (fxDataPath).');
  const dataPath = normalizeServerPath(raw);
  if (!path.isAbsolute(dataPath)) throw new Error('Server-Datenpfad muss absolut sein.');
  if (isBlockedPath(dataPath)) throw new Error('Server-Datenpfad nicht erlaubt.');
  if (!fs.existsSync(dataPath)) throw new Error(`Server-Datenpfad fehlt: ${dataPath}`);
  return dataPath;
}

/**
 * @param {{ settings: Record<string,string>, retention?: number }} opts
 */
export async function createServerBackup(opts = {}) {
  assertBackupType('server');
  const dataPath = resolveFxDataPath(opts.settings || {});
  const retention = normalizeRetention(opts.retention);
  const filename = `server-${stamp()}.tar.gz`;
  const dest = resolveBackupPath('server', filename);
  typeDir('server');

  const entries = [];
  for (const name of fs.readdirSync(dataPath)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dataPath, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isFile() && /\.cfg$/i.test(name)) entries.push(name);
    else if (st.isDirectory() && name === 'resources') entries.push(name);
  }
  if (!entries.length) {
    throw new Error('Nichts zu sichern (keine .cfg / resources im Datenordner).');
  }

  // tar -czf dest -C dataPath entries… mit Excludes
  await exec('tar', ['-czf', dest, '-C', dataPath, ...EXCLUDES, ...entries], {
    timeout: 600_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  const st = fs.statSync(dest);
  const retentionResult = enforceRetention('server', retention);
  return {
    id: backupId('server', filename),
    type: 'server',
    name: filename,
    size: st.size,
    created: Math.floor(st.mtimeMs),
    path: dest,
    retention: retentionResult,
    contents: SERVER_BACKUP_CONTENTS,
  };
}
