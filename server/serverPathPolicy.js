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

export function isBlockedPath(absPath) {
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
  if (isBlockedPath(root)) throw new Error('Dieser Pfad ist nicht erlaubt.');
  return root;
}

export function resolveCustomDataPath(custom) {
  const trimmed = String(custom || '').trim();
  if (!trimmed) return '';
  const dataPath = normalizeServerPath(trimmed);
  if (!path.isAbsolute(dataPath)) throw new Error('Server-Datenordner muss ein absoluter Pfad sein.');
  if (isBlockedPath(dataPath)) throw new Error('Dieser Pfad ist nicht erlaubt.');
  return dataPath;
}

function canWrite(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prüft Pfad für Setup-UI.
 * Fehlende Schreibrechte sind kein Hard-Error, wenn sudo/ACL eingerichtet werden kann.
 */
export function probeServerPath({ serversRoot = '', dataPath = '', defaultRoot = '', canElevate = false }) {
  const issues = [];
  const warnings = [];
  let resolvedRoot = '';
  let resolvedData = '';

  try {
    if (dataPath) {
      resolvedData = resolveCustomDataPath(dataPath);
      const cfg = path.join(resolvedData, 'server.cfg');
      if (fs.existsSync(cfg)) {
        warnings.push('server.cfg vorhanden — Ordner wird übernommen (kein Neu-Anlegen).');
      } else if (fs.existsSync(resolvedData)) {
        warnings.push('Ordner existiert — wird mit server.cfg und resources ergänzt.');
      } else {
        warnings.push('Ordner wird beim Setup angelegt.');
      }
      noteAccess(resolvedData, issues, warnings, canElevate);
    } else if (serversRoot) {
      resolvedRoot = resolveOrbitServersRoot(serversRoot, defaultRoot);
      if (!fs.existsSync(resolvedRoot)) {
        warnings.push('Basisordner wird beim Setup angelegt.');
      }
      noteAccess(resolvedRoot, issues, warnings, canElevate);
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

function noteAccess(target, issues, warnings, canElevate) {
  if (!target) return;
  if (fs.existsSync(target)) {
    if (canWrite(target)) return;
    if (canElevate) {
      warnings.push(`Schreibrechte für User orbit werden beim Abschluss eingerichtet (${target}).`);
      return;
    }
    issues.push(`Keine Schreibrechte auf ${target}.`);
    return;
  }
  let cur = path.dirname(target);
  while (cur && cur !== '/' && !fs.existsSync(cur)) cur = path.dirname(cur);
  if (!cur || cur === '/') {
    if (canElevate) {
      warnings.push('Ordner wird mit sudo angelegt.');
      return;
    }
    issues.push(`Elternordner nicht erreichbar für ${target}.`);
    return;
  }
  if (canWrite(cur)) return;
  if (canElevate) {
    warnings.push(`Zugriff auf ${cur} wird beim Abschluss freigeschaltet.`);
    return;
  }
  issues.push(`Keine Schreibrechte auf ${cur}.`);
}
