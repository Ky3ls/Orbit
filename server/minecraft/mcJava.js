import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ORBIT_ARTIFACTS_ROOT } from '../config.js';
import { UA } from './mcSources.js';

/** Eigene JREs (Temurin) neben den FX-Artifacts */
export const RUNTIMES_ROOT = path.join(path.dirname(ORBIT_ARTIFACTS_ROOT), 'runtimes');

/** Datei mit Fortschritt herunterladen (atomar über .part) */
export async function download(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let done = 0;
  let lastPct = -1;
  const src = Readable.fromWeb(res.body);
  src.on('data', (chunk) => {
    done += chunk.length;
    if (total && onProgress) {
      const pct = Math.floor((done / total) * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        onProgress(pct, done, total);
      }
    }
  });
  await pipeline(src, fs.createWriteStream(part));
  fs.renameSync(part, dest);
  return { bytes: done };
}

function readRelease(home) {
  try {
    const txt = fs.readFileSync(path.join(home, 'release'), 'utf8');
    const m = txt.match(/JAVA_VERSION="([^"]+)"/);
    if (!m) return null;
    const v = m[1];
    const major = v.startsWith('1.') ? Number(v.split('.')[1]) : Number(v.split(/[.+]/)[0]);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

/** Alle lokalen Java-Installationen (System + Orbit-Runtimes) */
export function listJavas() {
  const out = [];
  const seen = new Set();
  for (const root of ['/usr/lib/jvm', RUNTIMES_ROOT]) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const home = path.join(root, e.name);
      const bin = path.join(home, 'bin', 'java');
      if (!fs.existsSync(bin)) continue;
      let real = bin;
      try { real = fs.realpathSync(bin); } catch { /* */ }
      if (seen.has(real)) continue;
      seen.add(real);
      const major = readRelease(home);
      if (major) out.push({ major, bin, home, managed: root === RUNTIMES_ROOT });
    }
  }
  return out.sort((a, b) => a.major - b.major);
}

/**
 * Passende Java finden: exakt bevorzugt, sonst die kleinste neuere (außer Java 8 — alte
 * Forge-Versionen laufen nur mit genau 8).
 */
export function pickJava(required) {
  const all = listJavas();
  const exact = all.find((j) => j.major === required);
  if (exact) return exact;
  if (required <= 8) return null;
  return all.find((j) => j.major > required) || null;
}

/** Fehlende Java-Version als Temurin-JRE laden */
export async function ensureJava(required, log = () => {}) {
  const have = pickJava(required);
  if (have) {
    log('info', `Java ${have.major} gefunden (${have.bin})`);
    return have;
  }
  log('info', `Java ${required} fehlt — lade Eclipse Temurin ${required}…`);
  const url = `https://api.adoptium.net/v3/binary/latest/${required}/ga/linux/x64/jre/hotspot/normal/eclipse`;
  const dir = path.join(RUNTIMES_ROOT, `temurin-${required}`);
  const tgz = path.join(RUNTIMES_ROOT, `temurin-${required}.tar.gz`);
  await download(url, tgz, (pct) => log('info', `Java ${required}: ${pct}%`));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1'], { timeout: 120_000 });
  fs.rmSync(tgz, { force: true });
  const j = pickJava(required);
  if (!j) throw new Error(`Java ${required} konnte nicht installiert werden.`);
  log('ok', `Java ${j.major} installiert (${j.home})`);
  return j;
}
