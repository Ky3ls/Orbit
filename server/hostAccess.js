import fs from 'node:fs';
import path from 'node:path';
import { isBlockedPath, normalizeServerPath } from './serverPathPolicy.js';
import { isRoot, rootRun } from './rootExec.js';

/** @deprecated Panel läuft als root — kein eigener Systemuser mehr. */
export const PANEL_USER = process.env.ORBIT_USER || 'root';

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

/**
 * Legt Datenordner an. Als root (Standard) reicht mkdir — wie txAdmin.
 */
export async function prepareServerDataPath(rawPath, logLine = () => {}) {
  const dataPath = normalizeServerPath(rawPath);
  if (!dataPath || dataPath === '/') throw new Error('Ungültiger Datenordner.');
  if (isBlockedPath(dataPath)) throw new Error('Dieser Pfad ist nicht erlaubt.');

  if (!fs.existsSync(dataPath)) {
    try {
      fs.mkdirSync(dataPath, { recursive: true });
      logLine('info', `Ordner angelegt: ${dataPath}`);
    } catch {
      await rootRun(['mkdir', '-p', dataPath]);
      logLine('info', `Ordner angelegt: ${dataPath}`);
    }
  }

  if (!canWriteDirectory(dataPath)) {
    throw new Error(`Keine Schreibrechte auf ${dataPath}.`);
  }
  return dataPath;
}

/**
 * Früher: ACLs für Systemuser orbit. Als root unnötig — No-Op mit kurzem Check.
 */
export async function ensurePanelPathAccess(
  { dataPaths = [], fxRoot = '', txDataRoots = [] },
  logLine = () => {},
) {
  if (isRoot()) {
    logLine('info', 'Panel läuft als root — Host-Zugriff ok.');
    return;
  }
  // Legacy/Dev ohne root: Versuche trotzdem Lesbarkeit zu prüfen
  for (const root of txDataRoots) {
    if (root && !canListDirectory(root)) {
      logLine('warn', `Kein Lesezugriff auf ${root} (Panel nicht root).`);
    }
  }
  for (const dp of dataPaths) {
    if (dp && fs.existsSync(dp) && !canWriteDirectory(dp)) {
      logLine('warn', `Kein Schreibzugriff auf ${dp} (Panel nicht root).`);
    }
  }
  if (fxRoot && !canListDirectory(fxRoot)) {
    logLine('warn', `Kein Lesezugriff auf FX-Root ${fxRoot}.`);
  }
}

export function pathAccessHint(dir) {
  if (!dir || canListDirectory(dir)) return '';
  return `Kein Lesezugriff auf ${dir}. Orbit muss als root (systemd) laufen.`;
}

export async function sudoAvailable() {
  if (isRoot()) return true;
  try {
    await rootRun(['/usr/bin/mkdir', '--help'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
