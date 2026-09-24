import fs from 'node:fs';
import path from 'node:path';
import { parseDropFromLogLine, recordDrop } from './playerDrops.js';
import { notifyPlayerDrop } from './discord.js';

const dropOffsets = new Map();
/** @type {Map<string, number>} byte-offset für Panel-Konsole */
const consoleOffsets = new Map();

export function orbitLogDir(dataPath) {
  return path.join(dataPath, '.orbit');
}

export function orbitLogFile(dataPath) {
  return path.join(orbitLogDir(dataPath), 'fx-console.log');
}

export function appendOrbitFxLog(dataPath, line) {
  if (!dataPath) return;
  const dir = orbitLogDir(dataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(orbitLogFile(dataPath), `${line}\n`, 'utf8');
}

/**
 * Live: Datei + Panel-Konsole gleichzeitig, Offset vorschieben (kein Doppel-Dump per poll).
 * @param {string} dataPath
 * @param {string} line
 * @param {(level: string, text: string) => void} [logLine]
 */
export function emitFxConsoleLine(dataPath, line, logLine) {
  const trimmed = String(line || '').trimEnd();
  if (!trimmed) return;
  if (dataPath) {
    appendOrbitFxLog(dataPath, trimmed);
    const file = orbitLogFile(dataPath);
    try {
      consoleOffsets.set(file, fs.statSync(file).size);
    } catch { /* */ }
  }
  if (!logLine) return;
  const lv = /(error|failed|fatal)/i.test(trimmed) ? 'bad' : /(warn|warning)/i.test(trimmed) ? 'warn' : 'info';
  logLine(lv, trimmed.slice(0, 500));
}

/** Offset auf Dateiende — danach nur noch neue Zeilen (kein Dump). */
export function markFxConsoleEof(dataPath) {
  if (!dataPath) return;
  const file = orbitLogFile(dataPath);
  try {
    consoleOffsets.set(file, fs.existsSync(file) ? fs.statSync(file).size : 0);
  } catch {
    consoleOffsets.set(file, 0);
  }
}

/** Log-Datei leeren (bei Server-Start). */
export function resetFxConsoleLog(dataPath) {
  if (!dataPath) return;
  const file = orbitLogFile(dataPath);
  try {
    fs.mkdirSync(orbitLogDir(dataPath), { recursive: true });
    fs.writeFileSync(file, '', 'utf8');
    consoleOffsets.set(file, 0);
  } catch { /* */ }
}

/**
 * Einmalig letzte N Zeilen laden, Offset danach auf EOF (kein erneuter Dump).
 */
export function backfillFxConsole(dataPath, logLine, maxLines = 120) {
  if (!dataPath || !logLine) return 0;
  const file = orbitLogFile(dataPath);
  if (!fs.existsSync(file)) {
    consoleOffsets.set(file, 0);
    return 0;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split(/\n/).filter(Boolean);
    const slice = lines.slice(-Math.max(20, maxLines));
    for (const line of slice) {
      const lv = /(error|failed|fatal)/i.test(line) ? 'bad' : /(warn|warning)/i.test(line) ? 'warn' : 'info';
      logLine(lv, line.slice(0, 500));
    }
    consoleOffsets.set(file, fs.statSync(file).size);
    return slice.length;
  } catch {
    return 0;
  }
}

/**
 * Neue FX-Logzeilen → Panel-Konsole (live, auch nach Orbit-Restart).
 */
export function pollFxConsole(dataPath, logLine) {
  if (!dataPath || !logLine) return 0;
  const file = orbitLogFile(dataPath);
  if (!fs.existsSync(file)) return 0;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return 0;
  }
  let pos = consoleOffsets.has(file) ? consoleOffsets.get(file) : stat.size;
  if (pos > stat.size) pos = 0;
  // Erster Lauf ohne Backfill: ab EOF (kein Historien-Dump)
  if (!consoleOffsets.has(file)) {
    consoleOffsets.set(file, stat.size);
    return 0;
  }
  if (stat.size <= pos) return 0;
  const fd = fs.openSync(file, 'r');
  const len = stat.size - pos;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  fs.closeSync(fd);
  consoleOffsets.set(file, stat.size);
  let n = 0;
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const lv = /(error|failed|fatal)/i.test(trimmed) ? 'bad' : /(warn|warning)/i.test(trimmed) ? 'warn' : 'info';
    logLine(lv, trimmed.slice(0, 500));
    n += 1;
  }
  return n;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dataPath
 * @param {Record<string, string>} settings
 */
export function pollOrbitLogDrops(db, dataPath, settings) {
  const file = orbitLogFile(dataPath);
  if (!fs.existsSync(file)) return 0;
  const stat = fs.statSync(file);
  const key = file;
  let pos = dropOffsets.get(key) ?? 0;
  if (pos > stat.size) pos = 0;
  if (stat.size <= pos) return 0;
  const fd = fs.openSync(file, 'r');
  const len = stat.size - pos;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  fs.closeSync(fd);
  dropOffsets.set(key, stat.size);
  let n = 0;
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    const drop = parseDropFromLogLine(line);
    if (!drop) continue;
    recordDrop(db, drop);
    notifyPlayerDrop(settings, drop).catch(() => {});
    n += 1;
  }
  return n;
}
