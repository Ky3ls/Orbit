import fs from 'node:fs';
import path from 'node:path';
import { parseDropFromLogLine, recordDrop } from './playerDrops.js';
import { notifyPlayerDrop } from './discord.js';

const offsets = new Map();

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
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} dataPath
 * @param {Record<string, string>} settings
 */
export function pollOrbitLogDrops(db, dataPath, settings) {
  const file = orbitLogFile(dataPath);
  if (!fs.existsSync(file)) return 0;
  const stat = fs.statSync(file);
  const key = file;
  let pos = offsets.get(key) ?? 0;
  if (pos > stat.size) pos = 0;
  if (stat.size <= pos) return 0;
  const fd = fs.openSync(file, 'r');
  const len = stat.size - pos;
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  fs.closeSync(fd);
  offsets.set(key, stat.size);
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
