/**
 * Backup-Store: Pfade, Liste, Retention, sichere Dateinamen.
 * Ablage: {DATA_DIR}/backups/{server|database}/
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { isBlockedPath, normalizeServerPath } from '../serverPathPolicy.js';

export const BACKUP_TYPES = Object.freeze(['server', 'database']);
export const RETENTION_OPTIONS = Object.freeze([5, 10]);
export const DEFAULT_RETENTION = 5;
/** Upload-Limit: 512 MiB — große Resource-ZIPs, aber kein freier Disk-Flood. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

const TYPE_EXT = {
  server: ['.tar.gz', '.tgz', '.tar', '.zip'],
  database: ['.sql', '.sql.gz', '.gz'],
};

export function assertBackupType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (!BACKUP_TYPES.includes(t)) throw new Error('Backup-Typ ungültig (server|database).');
  return t;
}

export function normalizeRetention(value, fallback = DEFAULT_RETENTION) {
  const n = Number(value);
  if (RETENTION_OPTIONS.includes(n)) return n;
  return RETENTION_OPTIONS.includes(fallback) ? fallback : DEFAULT_RETENTION;
}

export function backupsRoot() {
  return path.join(DATA_DIR, 'backups');
}

export function typeDir(type) {
  const t = assertBackupType(type);
  const dir = path.join(backupsRoot(), t);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Nur sichere Basenames — kein Path-Traversal. */
export function sanitizeBackupBasename(name, type) {
  const t = assertBackupType(type);
  const base = path.basename(String(name || '').trim());
  if (!base || base === '.' || base === '..') throw new Error('Dateiname ungültig.');
  if (base.includes('\0') || /[\\/]/.test(base)) throw new Error('Dateiname ungültig.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(base)) {
    throw new Error('Dateiname enthält ungültige Zeichen.');
  }
  const lower = base.toLowerCase();
  const allowed = TYPE_EXT[t] || [];
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    throw new Error(`Erwartete Endung: ${allowed.join(', ')}`);
  }
  return base;
}

export function resolveBackupPath(type, filename) {
  const dir = typeDir(type);
  const base = sanitizeBackupBasename(filename, type);
  const full = normalizeServerPath(path.join(dir, base));
  const root = normalizeServerPath(dir);
  if (full !== root && !full.startsWith(`${root}/`)) {
    throw new Error('Pfad außerhalb des Backup-Ordners.');
  }
  if (isBlockedPath(full)) throw new Error('Pfad nicht erlaubt.');
  return full;
}

/** Stabile ID für API: type/filename (URL-sicher encoden beim Client). */
export function backupId(type, filename) {
  return `${assertBackupType(type)}/${sanitizeBackupBasename(filename, type)}`;
}

export function parseBackupId(id) {
  const raw = decodeURIComponent(String(id || ''));
  const slash = raw.indexOf('/');
  if (slash <= 0) throw new Error('Backup-ID ungültig.');
  const type = assertBackupType(raw.slice(0, slash));
  const filename = sanitizeBackupBasename(raw.slice(slash + 1), type);
  return { type, filename, path: resolveBackupPath(type, filename) };
}

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function listBackups(type) {
  const t = assertBackupType(type);
  const dir = typeDir(t);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    try {
      const full = resolveBackupPath(t, name);
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      out.push({
        id: backupId(t, name),
        type: t,
        name,
        size: st.size,
        sizeLabel: formatBytes(st.size),
        created: Math.floor(st.mtimeMs),
      });
    } catch {
      /* ungültige/fremde Dateien überspringen */
    }
  }
  out.sort((a, b) => b.created - a.created);
  return out;
}

/** Nach neuem Backup: älteste löschen bis ≤ max. */
export function enforceRetention(type, maxKeep) {
  const keep = normalizeRetention(maxKeep);
  const list = listBackups(type);
  if (list.length <= keep) return { kept: list.length, removed: 0 };
  let removed = 0;
  for (const item of list.slice(keep)) {
    try {
      fs.unlinkSync(resolveBackupPath(type, item.name));
      removed += 1;
    } catch { /* ignore */ }
  }
  return { kept: keep, removed };
}

export function deleteBackup(id) {
  const { path: full, type, filename } = parseBackupId(id);
  if (!fs.existsSync(full)) throw new Error('Backup nicht gefunden.');
  fs.unlinkSync(full);
  return { ok: true, type, name: filename };
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
