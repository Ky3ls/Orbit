import fs from 'node:fs';
import path from 'node:path';

/** Gesperrte Pfade (case-insensitive, inkl. Unterordner). */
const BLOCKED_PREFIXES = [
  '/root/rechnungen',
  '/root/rechnung',
  '/root/telegram',
];

export function normalizeServerPath(p) {
  const raw = String(p || '').trim();
  if (!raw) return '';
  const resolved = path.resolve(raw);
  return resolved.replace(/\/+$/, '') || '/';
}

function isBlocked(absPath) {
  const low = normalizeServerPath(absPath).toLowerCase();
  for (const prefix of BLOCKED_PREFIXES) {
    if (low === prefix || low.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function resolveOrbitServersRoot(custom, fallback) {
  const trimmed = String(custom || '').trim();
  if (!trimmed) return String(fallback || '').replace(/\/$/, '');
  const root = normalizeServerPath(trimmed);
  if (!path.isAbsolute(root)) throw new Error('Server-Basisordner muss ein absoluter Pfad sein.');
  if (isBlocked(root)) throw new Error('Dieser Pfad ist nicht erlaubt.');
  return root;
}

export function resolveCustomDataPath(custom) {
  const trimmed = String(custom || '').trim();
  if (!trimmed) return '';
  const dataPath = normalizeServerPath(trimmed);
  if (!path.isAbsolute(dataPath)) throw new Error('Server-Datenordner muss ein absoluter Pfad sein.');
  if (isBlocked(dataPath)) throw new Error('Dieser Pfad ist nicht erlaubt.');
  return dataPath;
}

/**
 * Prüft Schreibbarkeit / Belegung für Setup-UI.
 */
export function probeServerPath({ serversRoot = '', dataPath = '', defaultRoot = '' }) {
  const issues = [];
  const warnings = [];
  let resolvedRoot = '';
  let resolvedData = '';

  try {
    if (dataPath) {
      resolvedData = resolveCustomDataPath(dataPath);
      const cfg = path.join(resolvedData, 'server.cfg');
      if (fs.existsSync(cfg)) {
        issues.push('Unter diesem Pfad liegt bereits eine server.cfg.');
      } else if (fs.existsSync(resolvedData)) {
        warnings.push('Ordner existiert — wird mit server.cfg und resources ergänzt.');
      } else {
        warnings.push('Ordner wird beim Setup angelegt.');
      }
      const parent = path.dirname(resolvedData);
      ensureWritable(parent, issues);
      if (fs.existsSync(resolvedData)) ensureWritable(resolvedData, issues);
    } else if (serversRoot) {
      resolvedRoot = resolveOrbitServersRoot(serversRoot, defaultRoot);
      if (!fs.existsSync(resolvedRoot)) {
        warnings.push('Basisordner wird beim Setup angelegt.');
      }
      ensureWritable(resolvedRoot, issues, true);
    }
  } catch (err) {
    issues.push(err.message);
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    serversRoot: resolvedRoot,
    dataPath: resolvedData,
  };
}

function ensureWritable(dir, issues, allowMissing = false) {
  if (!dir) return;
  if (!fs.existsSync(dir)) {
    if (!allowMissing) {
      const parent = path.dirname(dir);
      if (fs.existsSync(parent)) {
        try {
          fs.accessSync(parent, fs.constants.W_OK);
        } catch {
          issues.push(`Keine Schreibrechte auf ${parent}.`);
        }
      }
    }
    return;
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    issues.push(`Keine Schreibrechte auf ${dir}.`);
  }
}
