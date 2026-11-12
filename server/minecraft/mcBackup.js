import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config.js';
import { getMcInstance, listMcInstances } from './mcDb.js';
import { chownForRun, isRunning, mcStatus, sendMc, startMc, stopMc } from './mcProcess.js';
import { readProperties } from './mcProperties.js';
import { awaitLine } from './mcConsole.js';

/*
 * Backups pro Minecraft-Instanz.
 *  - Ablage: {DATA_DIR}/mc-backups/<id>-<created>/<stamp>-<scope>.tar.zst (+ .json mit Metadaten)
 *  - Laufender Server: save-off → save-all flush → Archiv → save-on (konsistente Welt ohne Stopp)
 *  - Umfang: full (alles), worlds (nur Welten), config (alles außer Welten/Bibliotheken)
 *  - Wiederherstellen: Server gestoppt, vorher automatisch ein Sicherheits-Backup,
 *    Austausch per rename (erst entpacken, dann tauschen — bei Fehler bleibt alles wie es war)
 */
const run = promisify(execFile);
export const BACKUP_ROOT = path.join(DATA_DIR, 'mc-backups');
export const SCOPES = {
  full: 'Komplett',
  worlds: 'Nur Welten',
  config: 'Ohne Welten',
};
const ALWAYS_EXCLUDE = ['.orbit', 'session.lock', '*.orbit-bak', '.orbit-restore-*'];
const SKIP_TOP = new Set(['.orbit', 'logs', 'crash-reports', 'cache', '.cache', 'debug']);
const EVERY_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 168];
const ARCHIVE_RE = /^[\w.-]+\.(tar\.zst|tar\.gz|tgz|tar)$/;
const MAX_UPLOAD = 64 * 1024 ** 3;

const jobs = new Map();
let jobSeq = 1;
let active = null; // nur ein Backup/Restore gleichzeitig (Platten-IO)

/* ── Pfade & Metadaten ── */
export function backupDir(inst) {
  const dir = path.join(BACKUP_ROOT, `${Number(inst.id)}-${Number(inst.created)}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function safeFile(inst, file) {
  const base = path.basename(String(file || ''));
  if (!ARCHIVE_RE.test(base)) throw new Error('Backup-Datei ungültig.');
  const abs = path.join(backupDir(inst), base);
  if (!fs.existsSync(abs)) throw new Error('Backup nicht gefunden.');
  return abs;
}

const metaPath = (abs) => `${abs}.json`;
function readMeta(abs) {
  try { return JSON.parse(fs.readFileSync(metaPath(abs), 'utf8')); } catch { return {}; }
}
function writeMeta(abs, meta) {
  fs.writeFileSync(`${metaPath(abs)}.tmp`, JSON.stringify(meta, null, 1));
  fs.renameSync(`${metaPath(abs)}.tmp`, metaPath(abs));
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function listBackups(inst) {
  const dir = backupDir(inst);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!ARCHIVE_RE.test(name)) continue;
    const abs = path.join(dir, name);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    const m = readMeta(abs);
    out.push({
      file: name,
      size: st.size,
      created: m.created || Math.floor(st.mtimeMs),
      scope: m.scope || 'upload',
      auto: !!m.auto,
      reason: m.reason || null,
      note: m.note || '',
      locked: !!m.locked,
      by: m.by || null,
      raw: m.raw || null,
      durationMs: m.durationMs || null,
      live: !!m.live,
      entries: m.entries || null,
      mcVersion: m.mcVersion || null,
      type: m.type || null,
    });
  }
  return out.sort((a, b) => b.created - a.created);
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}

/* ── Was gehört in welchen Umfang? ── */
function worldNames(inst) {
  const level = String(readProperties(inst.path)['level-name'] || 'world').replace(/[/\\]|\.\./g, '');
  const names = new Set();
  let top = [];
  try { top = fs.readdirSync(inst.path, { withFileTypes: true }); } catch { /* */ }
  for (const d of top) {
    if (!d.isDirectory()) continue;
    if (d.name === level || d.name === `${level}_nether` || d.name === `${level}_the_end`) names.add(d.name);
    else if (fs.existsSync(path.join(inst.path, d.name, 'level.dat'))) names.add(d.name); // Multiverse & Co.
  }
  return [...names];
}

function entriesFor(inst, scope) {
  let top = [];
  try { top = fs.readdirSync(inst.path); } catch { throw new Error('Instanz-Ordner nicht lesbar.'); }
  const worlds = new Set(worldNames(inst));
  if (scope === 'worlds') return [...worlds];
  const all = top.filter((n) => !SKIP_TOP.has(n) && !n.startsWith('.orbit'));
  if (scope === 'config') {
    // Welten, Bibliotheken und Server-JARs sind groß und kommen beim Neuinstallieren zurück
    return all.filter((n) => !worlds.has(n) && !['libraries', 'versions', 'bundler', '.fabric', 'mods/.cache'].includes(n) && !(/\.jar$/i.test(n)));
  }
  return all;
}

async function sizeOf(base, entries) {
  if (!entries.length) return 0;
  try {
    const { stdout } = await run('du', ['-sbc', '--', ...entries], { cwd: base, timeout: 120_000, maxBuffer: 4 << 20 });
    const last = stdout.trim().split('\n').pop();
    return Number(last.split(/\s/)[0]) || 0;
  } catch { return 0; }
}

/* ── Einstellungen (Zeitplan) ── */
export function ensureBackupTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS mc_backup_cfg (instance_id INTEGER PRIMARY KEY, cfg TEXT NOT NULL)');
}

const DEFAULT_CFG = { enabled: false, everyHours: 24, at: '04:00', scope: 'full', keep: 7, onlyActive: false, announce: true, since: 0, lastActive: 0, lastSkip: 0 };

export function getBackupCfg(db, inst) {
  const row = db.prepare('SELECT cfg FROM mc_backup_cfg WHERE instance_id = ?').get(Number(inst.id));
  let cfg = {};
  try { cfg = JSON.parse(row?.cfg || '{}'); } catch { /* */ }
  return { ...DEFAULT_CFG, ...cfg };
}

function saveCfg(db, inst, cfg) {
  db.prepare('INSERT INTO mc_backup_cfg (instance_id, cfg) VALUES (?, ?) ON CONFLICT(instance_id) DO UPDATE SET cfg = excluded.cfg')
    .run(Number(inst.id), JSON.stringify(cfg));
}

export function setBackupCfg(db, inst, patch = {}) {
  const cur = getBackupCfg(db, inst);
  const next = { ...cur };
  if (patch.enabled !== undefined) {
    next.enabled = !!patch.enabled;
    if (next.enabled && !cur.enabled) next.since = Date.now();
  }
  if (patch.everyHours !== undefined) {
    const n = Number(patch.everyHours);
    if (!EVERY_OPTIONS.includes(n)) throw new Error('Intervall ungültig.');
    next.everyHours = n;
  }
  if (patch.at !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.at))) throw new Error('Uhrzeit ungültig (HH:MM).');
    next.at = String(patch.at);
  }
  if (patch.scope !== undefined) {
    if (!SCOPES[patch.scope]) throw new Error('Umfang ungültig.');
    next.scope = patch.scope;
  }
  if (patch.keep !== undefined) next.keep = Math.max(1, Math.min(100, Math.round(Number(patch.keep) || 7)));
  if (patch.onlyActive !== undefined) next.onlyActive = !!patch.onlyActive;
  if (patch.announce !== undefined) next.announce = !!patch.announce;
  saveCfg(db, inst, next);
  return next;
}

function lastAuto(inst) {
  return listBackups(inst).filter((b) => b.auto && b.reason === 'schedule').reduce((m, b) => Math.max(m, b.created), 0);
}

/** Nächster geplanter Lauf (ms) */
export function nextRun(inst, cfg) {
  if (!cfg.enabled) return null;
  const last = Math.max(lastAuto(inst), cfg.lastSkip || 0);
  const base = Math.max(last, cfg.since || 0);
  const every = cfg.everyHours * 3600_000;
  if (cfg.everyHours < 24) return base + every;
  // Tägliche/wöchentliche Backups zur festen Uhrzeit — der erste Lauf beim nächsten Termin
  const [h, m] = cfg.at.split(':').map(Number);
  const from = new Date(last >= (cfg.since || 0) && last ? last + every - 3 * 3600_000 : base);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() < from.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/* ── Jobs ── */
export const getBackupJob = (id) => jobs.get(Number(id)) || null;
export function activeJob(inst) {
  for (const j of jobs.values()) if (j.instanceId === Number(inst.id) && !j.done) return j;
  return null;
}
export function busyInfo() { return active ? { ...active } : null; }

function newJob(inst, kind, label) {
  if (active) throw new Error(`Es läuft bereits ${active.kind === 'restore' ? 'eine Wiederherstellung' : 'ein Backup'} (${active.name}).`);
  const job = { id: jobSeq++, instanceId: Number(inst.id), kind, label, step: 'Vorbereiten', progress: 0, bytes: 0, total: 0, log: [], done: false, error: null, result: null, started: Date.now() };
  jobs.set(job.id, job);
  active = { kind, name: inst.name, instanceId: Number(inst.id), jobId: job.id };
  for (const [id, j] of jobs) if (j.done && Date.now() - j.started > 3600_000) jobs.delete(id);
  return job;
}
function jlog(job, level, text) { job.log.push({ t: Date.now(), level, text }); if (job.log.length > 300) job.log.shift(); }
function finish(job, err) {
  job.done = true;
  job.finished = Date.now();
  if (err) { job.error = err.message || String(err); jlog(job, 'err', job.error); } else { job.progress = 100; }
  if (active?.jobId === job.id) active = null;
}

async function tell(inst, text) {
  const msg = JSON.stringify(['', { text: '[Backup] ', color: 'aqua' }, { text, color: 'gray' }]);
  try { sendMc(inst, `tellraw @a ${msg}`); } catch { /* */ }
}

/**
 * Welt auf die Platte schreiben und Autosave pausieren — über die Server-Konsole.
 * Orbit wartet auf „Saved the game“ (bei großen Modpacks kann das dauern, daher kein kurzes RCON-Timeout).
 */
async function freezeWorld(inst, job) {
  if (!isRunning(inst.id)) return false;
  jlog(job, 'step', 'Welt speichern (save-all flush)');
  const t0 = Date.now();
  const hit = await awaitLine(inst, /\]: Saved the game$/, () => {
    sendMc(inst, 'save-off');
    sendMc(inst, 'save-all flush');
  }, 180_000);
  if (hit) jlog(job, 'info', `Welt gespeichert (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  else jlog(job, 'warn', 'Server hat das Speichern nach 3 Minuten nicht bestätigt — sichere trotzdem.');
  return true;
}
async function thawWorld(inst) {
  try { sendMc(inst, 'save-on'); } catch { /* */ }
}

/** tar → (Zähler) → zstd → Datei, mit Fortschritt */
function packTo(base, entries, dest, job, total) {
  return new Promise((resolve, reject) => {
    const excl = ALWAYS_EXCLUDE.map((e) => `--exclude=${e}`);
    const tar = spawn('nice', ['-n', '10', 'tar', '-cf', '-', '--warning=no-file-changed', '--warning=no-file-removed', ...excl, '--', ...entries], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
    const zstd = spawn('nice', ['-n', '10', 'zstd', '-T0', '-3', '-q', '-c'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(dest, { mode: 0o600 });
    let err = '';
    let tarCode = null;
    let zCode = null;
    let outDone = false;
    const check = () => {
      if (tarCode === null || zCode === null || !outDone) return;
      // tar: 1 = „Datei hat sich beim Lesen geändert“ — nur Warnung
      if (tarCode > 1) reject(new Error(`tar fehlgeschlagen (${tarCode}): ${err.trim().slice(-300)}`));
      else if (zCode !== 0) reject(new Error(`zstd fehlgeschlagen (${zCode}): ${err.trim().slice(-300)}`));
      else resolve();
    };
    tar.stdout.on('data', (c) => {
      job.bytes += c.length;
      if (total) job.progress = Math.min(97, 5 + Math.round((job.bytes / total) * 92));
    });
    tar.stdout.pipe(zstd.stdin);
    zstd.stdout.pipe(out);
    tar.stderr.on('data', (d) => { err += d; });
    zstd.stderr.on('data', (d) => { err += d; });
    tar.on('error', reject);
    zstd.on('error', reject);
    out.on('error', reject);
    tar.on('close', (c) => { tarCode = c ?? 2; check(); });
    zstd.on('close', (c) => { zCode = c ?? 1; check(); });
    out.on('finish', () => { outDone = true; check(); });
    job.cancel = () => { tar.kill('SIGTERM'); zstd.kill('SIGTERM'); };
  });
}

/**
 * Backup anlegen (läuft im Hintergrund, gibt den Job zurück)
 * @param {{scope?:string, note?:string, by?:string, auto?:boolean, reason?:string, announce?:boolean}} opts
 */
export function createBackup(db, inst, opts = {}) {
  const scope = SCOPES[opts.scope] ? opts.scope : 'full';
  const job = newJob(inst, 'backup', `${SCOPES[scope]}-Backup`);
  const p = (async () => {
    let frozen = false;
    const dir = backupDir(inst);
    const name = `${stamp()}-${scope}.tar.zst`;
    const dest = path.join(dir, name);
    const t0 = Date.now();
    try {
      const entries = entriesFor(inst, scope);
      if (!entries.length) throw new Error(scope === 'worlds' ? 'Keine Welt gefunden.' : 'Nichts zu sichern.');
      job.step = 'Größe berechnen';
      const total = await sizeOf(inst.path, entries);
      job.total = total;
      const free = freeBytes(dir);
      if (free != null && total && free < total * 0.8 + 1024 ** 3) {
        throw new Error(`Zu wenig Speicher: bis zu ${(total / 1024 ** 3).toFixed(1)} GB nötig, ${(free / 1024 ** 3).toFixed(1)} GB frei.`);
      }
      jlog(job, 'info', `${entries.length} Einträge, ${(total / 1024 ** 2).toFixed(0)} MB unkomprimiert`);
      if (opts.announce && isRunning(inst.id)) await tell(inst, 'Backup startet — kurzer Ruckler möglich.');
      job.step = 'Welt speichern';
      frozen = await freezeWorld(inst, job);
      job.step = 'Archiv schreiben';
      job.progress = 5;
      jlog(job, 'step', `Archiv schreiben → ${name}`);
      await packTo(inst.path, entries, `${dest}.part`, job, total);
      fs.renameSync(`${dest}.part`, dest);
      if (frozen) { await thawWorld(inst); frozen = false; }
      const meta = {
        created: t0,
        scope,
        auto: !!opts.auto,
        reason: opts.reason || 'manual',
        note: String(opts.note || '').slice(0, 120),
        by: opts.by || null,
        raw: total,
        durationMs: Date.now() - t0,
        live: isRunning(inst.id),
        entries,
        mcVersion: inst.mc_version,
        type: inst.type,
        locked: false,
      };
      writeMeta(dest, meta);
      const size = fs.statSync(dest).size;
      jlog(job, 'ok', `Fertig: ${(size / 1024 ** 2).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (opts.announce && isRunning(inst.id)) await tell(inst, `Backup fertig (${(size / 1024 ** 2).toFixed(0)} MB).`);
      job.result = { file: name, size };
      if (opts.auto && opts.reason === 'schedule') prune(inst, getBackupCfg(db, inst).keep, job);
      finish(job);
    } catch (e) {
      try { fs.rmSync(`${dest}.part`, { force: true }); } catch { /* */ }
      if (frozen) await thawWorld(inst);
      if (opts.announce && isRunning(inst.id)) await tell(inst, 'Backup fehlgeschlagen.');
      finish(job, e);
    }
  })();
  job.promise = p;
  return job;
}

/** Alte automatische Backups löschen (gesperrte bleiben) */
function prune(inst, keep, job) {
  const autos = listBackups(inst).filter((b) => b.auto && b.reason === 'schedule' && !b.locked);
  for (const b of autos.slice(keep)) {
    try {
      const abs = path.join(backupDir(inst), b.file);
      fs.rmSync(abs, { force: true });
      fs.rmSync(metaPath(abs), { force: true });
      if (job) jlog(job, 'info', `Altes Backup entfernt: ${b.file}`);
    } catch { /* */ }
  }
}

/* ── Wiederherstellen ── */
function unpackCmd(abs) {
  if (abs.endsWith('.tar.zst')) return ['-I', 'zstd -d -T0'];
  if (abs.endsWith('.tar.gz') || abs.endsWith('.tgz')) return ['-z'];
  return [];
}

/** Oberste Einträge eines Archivs (für hochgeladene Backups ohne Metadaten) */
export async function archiveEntries(abs) {
  const { stdout } = await run('tar', [...unpackCmd(abs), '-tf', abs], { timeout: 600_000, maxBuffer: 512 << 20 });
  const top = new Set();
  for (const line of stdout.split('\n')) {
    const p = line.replace(/^\.\//, '').split('/')[0];
    if (p && p !== '.' && p !== '..') top.add(p);
  }
  return [...top];
}

function unpackTo(abs, dest, job) {
  return new Promise((resolve, reject) => {
    const total = fs.statSync(abs).size;
    const tar = spawn('nice', ['-n', '10', 'tar', ...unpackCmd(abs), '-xf', '-', '--delay-directory-restore'], { cwd: dest, stdio: ['pipe', 'ignore', 'pipe'] });
    const inp = fs.createReadStream(abs);
    let read = 0;
    let err = '';
    inp.on('data', (c) => { read += c.length; job.progress = Math.min(85, 15 + Math.round((read / total) * 70)); });
    inp.pipe(tar.stdin);
    tar.stdin.on('error', () => { /* tar beendet sich früher */ });
    tar.stderr.on('data', (d) => { err += d; });
    tar.on('error', reject);
    inp.on('error', reject);
    tar.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`Entpacken fehlgeschlagen (${c}): ${err.trim().slice(-300)}`))));
  });
}

/**
 * @param {{file:string, entries?:string[], stop?:boolean, startAfter?:boolean, safety?:boolean, by?:string, log?:Function}} opts
 */
export function restoreBackup(db, inst, opts = {}) {
  const abs = safeFile(inst, opts.file);
  const meta = readMeta(abs);
  if (isRunning(inst.id) && !opts.stop) throw new Error('Server läuft — zuerst stoppen.');
  const job = newJob(inst, 'restore', 'Wiederherstellung');
  const p = (async () => {
    const parent = path.dirname(path.resolve(inst.path));
    const tag = `${inst.id}-${crypto.randomBytes(4).toString('hex')}`;
    const tmp = path.join(parent, `.orbit-restore-${tag}`);
    const trash = path.join(parent, `.orbit-restore-old-${tag}`);
    const moved = [];
    const placed = [];
    try {
      let all = meta.entries;
      if (!all?.length) { job.step = 'Archiv lesen'; all = await archiveEntries(abs); }
      const want = Array.isArray(opts.entries) && opts.entries.length ? all.filter((e) => opts.entries.includes(e)) : all;
      if (!want.length) throw new Error('Keine Einträge zum Wiederherstellen ausgewählt.');
      const fullScope = meta.scope === 'full' && want.length === all.length;

      if (isRunning(inst.id)) {
        job.step = 'Server stoppen';
        jlog(job, 'step', 'Server wird gestoppt');
        await tell(inst, 'Server wird für eine Wiederherstellung gestoppt.');
        await stopMc(db, inst.id, { log: opts.log });
      }
      if (opts.safety !== false) {
        job.step = 'Sicherheits-Backup';
        jlog(job, 'step', 'Sicherheits-Backup des aktuellen Stands');
        active = null; // Sicherheits-Backup darf trotz laufender Wiederherstellung starten
        const sj = createBackup(db, inst, { scope: meta.scope && SCOPES[meta.scope] ? meta.scope : 'full', auto: true, reason: 'pre-restore', note: `Vor Wiederherstellung von ${path.basename(abs)}`, by: opts.by });
        active = { kind: 'restore', name: inst.name, instanceId: Number(inst.id), jobId: job.id };
        const iv = setInterval(() => { job.progress = Math.round(sj.progress * 0.15); }, 300);
        await sj.promise;
        clearInterval(iv);
        active = { kind: 'restore', name: inst.name, instanceId: Number(inst.id), jobId: job.id };
        if (sj.error) throw new Error(`Sicherheits-Backup fehlgeschlagen: ${sj.error}`);
        jlog(job, 'ok', `Sicherheits-Backup: ${sj.result.file}`);
      }

      job.step = 'Entpacken';
      jlog(job, 'step', `Entpacke ${path.basename(abs)}`);
      fs.mkdirSync(tmp, { mode: 0o700 });
      await unpackTo(abs, tmp, job);

      job.step = 'Dateien tauschen';
      job.progress = 88;
      fs.mkdirSync(trash, { mode: 0o700 });
      const replace = new Set(want);
      if (fullScope) {
        // Kompletter Stand: auch Dinge entfernen, die nach dem Backup dazugekommen sind
        for (const n of fs.readdirSync(inst.path)) {
          if (!SKIP_TOP.has(n) && !n.startsWith('.orbit')) replace.add(n);
        }
      }
      for (const n of replace) {
        const cur = path.join(inst.path, n);
        if (fs.existsSync(cur)) { fs.renameSync(cur, path.join(trash, n)); moved.push(n); }
      }
      for (const n of want) {
        const src = path.join(tmp, n);
        if (!fs.existsSync(src)) continue;
        fs.renameSync(src, path.join(inst.path, n));
        placed.push(n);
      }
      jlog(job, 'ok', `${placed.length} Einträge wiederhergestellt: ${placed.slice(0, 12).join(', ')}${placed.length > 12 ? ' …' : ''}`);
      chownForRun(inst.path, true);
      fs.rmSync(trash, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
      job.result = { restored: placed };
      if (opts.startAfter) {
        job.step = 'Server starten';
        jlog(job, 'step', 'Server wird gestartet');
        await startMc(db, inst.id, opts.log);
      }
      finish(job);
    } catch (e) {
      // Zurückrollen: neue Einträge raus, alte zurück
      try {
        for (const n of placed) fs.rmSync(path.join(inst.path, n), { recursive: true, force: true });
        for (const n of moved) {
          const back = path.join(inst.path, n);
          if (!fs.existsSync(back)) fs.renameSync(path.join(trash, n), back);
        }
        if (moved.length || placed.length) jlog(job, 'warn', 'Änderungen zurückgerollt — der vorherige Stand ist unverändert.');
      } catch (re) { jlog(job, 'err', `Zurückrollen unvollständig (${re.message}) — alte Dateien liegen in ${trash}`); }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
      try { if (!fs.readdirSync(trash).length) fs.rmSync(trash, { recursive: true, force: true }); } catch { /* */ }
      finish(job, e);
    }
  })();
  job.promise = p;
  return job;
}

/* ── Verwaltung ── */
export function updateBackup(inst, file, patch = {}) {
  const abs = safeFile(inst, file);
  const meta = readMeta(abs);
  if (patch.locked !== undefined) meta.locked = !!patch.locked;
  if (patch.note !== undefined) meta.note = String(patch.note || '').slice(0, 120);
  if (!meta.created) meta.created = Math.floor(fs.statSync(abs).mtimeMs);
  writeMeta(abs, meta);
  return meta;
}

export function deleteBackup(inst, file) {
  const abs = safeFile(inst, file);
  if (active?.instanceId === Number(inst.id)) throw new Error('Während eines laufenden Backups nicht möglich.');
  fs.rmSync(abs, { force: true });
  fs.rmSync(metaPath(abs), { force: true });
}

export function streamBackup(inst, file, res) {
  const abs = safeFile(inst, file);
  const st = fs.statSync(abs);
  const name = `${inst.slug}-${path.basename(abs)}`.replace(/"/g, '');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(abs).pipe(res);
}

/** Eigenes Archiv hochladen (.tar.zst / .tar.gz / .tgz / .tar) */
export async function uploadBackup(inst, req, filename, by) {
  const raw = path.basename(String(filename || 'upload.tar.gz'));
  const m = raw.toLowerCase().match(/\.(tar\.zst|tar\.gz|tgz|tar)$/);
  if (!m) throw new Error('Nur .tar.zst, .tar.gz, .tgz oder .tar.');
  const dir = backupDir(inst);
  const name = `${stamp()}-upload.${m[1]}`;
  const dest = path.join(dir, name);
  await new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(`${dest}.part`, { mode: 0o600 });
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); reject(new Error('Datei zu groß.')); }
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  try {
    fs.renameSync(`${dest}.part`, dest);
    const entries = await archiveEntries(dest).catch(() => { throw new Error('Archiv ist beschädigt oder kein tar-Archiv.'); });
    if (!entries.length) throw new Error('Archiv ist leer.');
    if (entries.some((e) => e === '..' || e.startsWith('/'))) throw new Error('Archiv enthält ungültige Pfade.');
    writeMeta(dest, { created: Date.now(), scope: 'upload', auto: false, reason: 'upload', note: raw.slice(0, 120), by, entries, locked: true });
    return { file: name, entries };
  } catch (e) {
    fs.rmSync(`${dest}.part`, { force: true });
    fs.rmSync(dest, { force: true });
    throw e;
  }
}

export function backupOverview(db, inst) {
  const items = listBackups(inst);
  const cfg = getBackupCfg(db, inst);
  const dir = backupDir(inst);
  const job = activeJob(inst);
  return {
    items,
    totalSize: items.reduce((s, b) => s + b.size, 0),
    free: freeBytes(dir),
    dir,
    cfg,
    next: nextRun(inst, cfg),
    scopes: SCOPES,
    everyOptions: EVERY_OPTIONS,
    worlds: worldNames(inst),
    running: isRunning(inst.id),
    rcon: false,
    job: job ? publicJob(job) : null,
    busy: active && active.instanceId !== Number(inst.id) ? { name: active.name, kind: active.kind } : null,
  };
}

export function publicJob(job) {
  const { promise, cancel, ...rest } = job;
  return rest;
}

/* ── Zeitplan ── */
let timer = null;
export function initMcBackups(db, log = () => {}) {
  ensureBackupTable(db);
  // Reste abgebrochener Wiederherstellungen (Panel-Neustart mittendrin) nicht stillschweigend löschen
  clearInterval(timer);
  timer = setInterval(() => {
    for (const inst of listMcInstances(db)) {
      let cfg;
      try { cfg = getBackupCfg(db, inst); } catch { continue; }
      // Spieler-Aktivität merken (für „nur wenn gespielt wurde“)
      const st = mcStatus(inst);
      if (st.online && st.players > 0 && Date.now() - (cfg.lastActive || 0) > 60_000) {
        cfg.lastActive = Date.now();
        saveCfg(db, inst, cfg);
      }
      if (!cfg.enabled || inst.state !== 'ready' || active) continue;
      const due = nextRun(inst, cfg);
      if (!due || Date.now() < due) continue;
      const last = lastAuto(inst);
      if (cfg.onlyActive && last && (cfg.lastActive || 0) < last && !st.players) {
        cfg.lastSkip = Date.now();
        saveCfg(db, inst, cfg);
        log('info', `[MC:${inst.slug}] Geplantes Backup übersprungen — seit dem letzten Backup war niemand online`);
        continue;
      }
      try {
        const job = createBackup(db, inst, { scope: cfg.scope, auto: true, reason: 'schedule', announce: cfg.announce, by: 'Zeitplan' });
        job.promise.then(() => {
          if (job.error) {
            // nicht im Minutentakt erneut versuchen
            const c = getBackupCfg(db, getMcInstance(db, inst.id) || inst);
            c.lastSkip = Date.now();
            saveCfg(db, inst, c);
            log('warn', `[MC:${inst.slug}] Geplantes Backup fehlgeschlagen: ${job.error}`);
          } else log('ok', `[MC:${inst.slug}] Geplantes Backup: ${job.result.file}`);
        });
      } catch (e) { log('warn', `[MC:${inst.slug}] Geplantes Backup: ${e.message}`); }
      break; // eins nach dem anderen
    }
  }, 60_000);
  timer.unref?.();
}
