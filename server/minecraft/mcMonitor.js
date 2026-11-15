import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { mcAlert } from './mcAlerts.js';
import { awaitLine, lagEvents, logPlayers, muteLines, recentLines, subscribeConsole } from './mcConsole.js';
import { listMcInstances, getMcInstance } from './mcDb.js';
import { isRunning, mcStatus, sendMc, setMcExitHook } from './mcProcess.js';

/*
 * Minecraft-Überwachung:
 *  - Verlauf (Spieler, CPU, RAM, TPS) minütlich in SQLite, 8 Tage
 *  - TPS/MSPT live über die Konsole (forge tps · tps · tick query) — Antwortzeilen ausgeblendet
 *  - Spieler-Sitzungen aus Login/Logout
 *  - Absturzbericht (crash-reports/ + letzte Konsolenzeilen, vermutlicher Mod)
 *  - Benachrichtigungen: Absturz, Crash-Schleife, nicht erreichbar, starker Lag, Speicher knapp
 */
let DB = null;
const lagState = new Map(); // id → { tps, mspt, at, low }
const unreach = new Map(); // id → Fehlversuche in Folge
const subs = new Map(); // id → unsubscribe

const crashDir = () => path.join(DATA_DIR, 'mc-crash');
const crashFile = (id) => path.join(crashDir(), `${Number(id)}.json`);

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mc_metrics (
      instance_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      players INTEGER, cpu REAL, ram INTEGER, tps REAL, mspt REAL
    );
    CREATE INDEX IF NOT EXISTS idx_mc_metrics ON mc_metrics(instance_id, t);
    CREATE TABLE IF NOT EXISTS mc_sessions (
      id INTEGER PRIMARY KEY,
      instance_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      uuid TEXT,
      joined INTEGER NOT NULL,
      left INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mc_sessions ON mc_sessions(instance_id, joined);
  `);
}

/* ── TPS ── */
function versionAtLeast(v, want) {
  const a = String(v || '').split('.').map(Number);
  const b = want.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function tpsProbe(inst) {
  const t = inst.type;
  if (t === 'forge') return { cmd: 'forge tps', mute: /Mean tick time: .*Mean TPS:/, re: /Overall\s*:\s*Mean tick time:\s*([\d.]+)\s*ms\.\s*Mean TPS:\s*([\d.]+)/, parse: (m) => ({ mspt: +m[1], tps: +m[2] }) };
  if (t === 'neoforge') return { cmd: 'neoforge tps', mute: /Mean tick time: .*Mean TPS:/, re: /Overall\s*:\s*Mean tick time:\s*([\d.]+)\s*ms\.\s*Mean TPS:\s*([\d.]+)/, parse: (m) => ({ mspt: +m[1], tps: +m[2] }) };
  if (t === 'paper' || t === 'purpur') return { cmd: 'tps', mute: /TPS from last 1m/, re: /TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)/, parse: (m) => ({ tps: Math.min(20, +m[1]), mspt: null }) };
  if (versionAtLeast(inst.mc_version, '1.20.3')) {
    return {
      cmd: 'tick query',
      mute: /(The game is running normally|The game is (?:frozen|sprinting)|Target tick rate|Percentiles: P50|Average time per tick)/,
      re: /Average time per tick:\s*([\d.]+)\s*ms/,
      parse: (m) => ({ mspt: +m[1], tps: Math.min(20, 1000 / Math.max(50, +m[1])) }),
    };
  }
  return null;
}

async function measureTps(inst) {
  const probe = tpsProbe(inst);
  if (!probe) return null;
  muteLines(inst, probe.mute, 6000);
  const hit = await awaitLine(inst, probe.re, () => sendMc(inst, probe.cmd), 5000);
  return hit ? probe.parse(hit) : null;
}

/** Aktueller Lag-Zustand: TPS/MSPT (falls messbar) + „Can't keep up“ der letzten 10 Minuten */
export function mcLag(inst) {
  const st = lagState.get(Number(inst.id)) || {};
  const ev = lagEvents(inst, Date.now() - 10 * 60_000);
  return {
    tps: st.tps ?? null,
    mspt: st.mspt ?? null,
    at: st.at || null,
    measurable: !!tpsProbe(inst),
    behind10m: ev.length,
    behindMs10m: ev.reduce((a, e) => a + e.ms, 0),
    worstMs: ev.reduce((a, e) => Math.max(a, e.ms), 0),
  };
}

/* ── Verlauf ── */
export function mcHistory(inst, hours = 24) {
  const since = Date.now() - hours * 3_600_000;
  const rows = DB.prepare('SELECT t, players, cpu, ram, tps, mspt FROM mc_metrics WHERE instance_id = ? AND t >= ? ORDER BY t').all(Number(inst.id), since);
  // auf 5-Minuten-Schritte verdichten
  const bucket = 5 * 60_000;
  const out = [];
  let cur = null;
  for (const r of rows) {
    const b = Math.floor(r.t / bucket) * bucket;
    if (!cur || cur.t !== b) { cur = { t: b, n: 0, players: 0, cpu: 0, ram: 0, tps: 0, tn: 0 }; out.push(cur); }
    cur.n += 1;
    cur.players = Math.max(cur.players, r.players || 0);
    cur.cpu += r.cpu || 0;
    cur.ram += r.ram || 0;
    if (r.tps != null) { cur.tps += r.tps; cur.tn += 1; }
  }
  return out.map((c) => ({ t: c.t, players: c.players, cpu: Math.round(c.cpu / c.n), ram: Math.round(c.ram / c.n), tps: c.tn ? +(c.tps / c.tn).toFixed(1) : null }));
}

/* ── Spieler-Sitzungen ── */
function onSessions(inst, events) {
  for (const e of events) {
    if (e.type === 'join') {
      DB.prepare('INSERT INTO mc_sessions (instance_id, name, uuid, joined) VALUES (?, ?, ?, ?)').run(Number(inst.id), e.name, e.uuid, e.at);
    } else {
      DB.prepare(`UPDATE mc_sessions SET left = ? WHERE id = (
        SELECT id FROM mc_sessions WHERE instance_id = ? AND lower(name) = lower(?) AND left IS NULL ORDER BY joined DESC LIMIT 1)`).run(e.at, Number(inst.id), e.name);
    }
  }
}

export function playerHistory(inst, days = 7) {
  const id = Number(inst.id);
  const since = Date.now() - days * 86_400_000;
  const rows = DB.prepare('SELECT name, uuid, joined, left FROM mc_sessions WHERE instance_id = ? AND (left IS NULL OR left >= ?) ORDER BY joined DESC LIMIT 2000').all(id, since);
  const now = Date.now();
  const dayKey = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i -= 1) byDay.set(dayKey(now - i * 86_400_000), { day: dayKey(now - i * 86_400_000), players: new Set(), minutes: 0, peak: 0, peakAt: null });
  for (const r of rows) {
    const d = byDay.get(dayKey(r.joined));
    if (!d) continue;
    d.players.add(r.name.toLowerCase());
    d.minutes += Math.max(0, ((r.left || now) - r.joined) / 60_000);
  }
  // Peak pro Tag aus dem minütlichen Verlauf
  const peaks = DB.prepare('SELECT t, players FROM mc_metrics WHERE instance_id = ? AND t >= ? AND players > 0').all(id, since);
  for (const p of peaks) {
    const d = byDay.get(dayKey(p.t));
    if (d && p.players > d.peak) { d.peak = p.players; d.peakAt = p.t; }
  }
  const total = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    const cur = total.get(k) || { name: r.name, uuid: r.uuid, minutes: 0, sessions: 0, last: 0 };
    cur.minutes += Math.max(0, ((r.left || now) - r.joined) / 60_000);
    cur.sessions += 1;
    cur.last = Math.max(cur.last, r.left || now);
    if (r.uuid) cur.uuid = r.uuid;
    total.set(k, cur);
  }
  const closed = rows.filter((r) => r.left);
  return {
    days: [...byDay.values()].map((d) => ({ day: d.day, players: d.players.size, minutes: Math.round(d.minutes), peak: d.peak, peakAt: d.peakAt })),
    sessions: rows.slice(0, 25).map((r) => ({ name: r.name, uuid: r.uuid, joined: r.joined, left: r.left })),
    players: [...total.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 10).map((p) => ({ ...p, minutes: Math.round(p.minutes) })),
    avgMinutes: closed.length ? Math.round(closed.reduce((a, r) => a + (r.left - r.joined), 0) / closed.length / 60_000) : null,
  };
}

/* ── Absturzbericht ── */
const SKIP_PKG = /^(java|javax|jdk|sun|com\.sun|net\.minecraft|com\.mojang|cpw|net\.minecraftforge|net\.neoforged|org\.spongepowered|org\.objectweb|io\.netty|it\.unimi|com\.google|org\.apache|org\.slf4j|org\.lwjgl|MC-BOOTSTRAP|net\.fabricmc|org\.quiltmc|io\.papermc|org\.bukkit|org\.spigotmc|com\.destroystokyo|TRANSFORMER|kotlin|scala)\b/;
const COMMON = new Set(['com', 'net', 'org', 'io', 'dev', 'me', 'github', 'mod', 'mods', 'api', 'common', 'core', 'util', 'utils', 'mixin', 'mixins', 'client', 'server', 'impl', 'forge', 'fabric', 'main', 'lib', 'entity', 'world', 'block', 'item']);

function modFiles(inst) {
  for (const dir of ['mods', 'plugins']) {
    try { return fs.readdirSync(path.join(inst.path, dir)).filter((f) => f.endsWith('.jar')); } catch { /* */ }
  }
  return [];
}

function guessMods(inst, text) {
  const jars = modFiles(inst);
  const hits = new Map();
  for (const m of text.matchAll(/\bat ([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*){2,})/g)) {
    const pkg = m[1];
    if (SKIP_PKG.test(pkg)) continue;
    for (const seg of pkg.split('.').slice(0, 4)) {
      const s = seg.toLowerCase();
      if (s.length < 4 || COMMON.has(s)) continue;
      const jar = jars.find((j) => j.toLowerCase().replace(/[^a-z0-9]/g, '').includes(s));
      if (jar) { hits.set(jar, (hits.get(jar) || 0) + 1); break; }
    }
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([jar]) => jar);
}

function readCrashReport(inst, startedAt) {
  const dir = path.join(inst.path, 'crash-reports');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })); } catch { return null; }
  const fresh = files.filter((x) => x.m >= (startedAt || 0) - 60_000 && x.m >= Date.now() - 15 * 60_000).sort((a, b) => b.m - a.m)[0];
  if (!fresh) return null;
  const text = fs.readFileSync(path.join(dir, fresh.f), 'utf8').slice(0, 400_000);
  const desc = text.match(/^Description:\s*(.*)$/m)?.[1]?.trim() || null;
  const afterDesc = desc ? text.slice(text.indexOf(desc) + desc.length).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('at ')) : null;
  const suspects = [];
  const sm = text.match(/Suspected Mods?:\s*([^\n]*)((?:\n[ \t]+[^\n]+)*)/);
  if (sm) {
    const first = sm[1].trim();
    if (first && !/^NONE$/i.test(first)) suspects.push(first);
    for (const l of sm[2].split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (/^(Issue tracker URL|Mod File):/i.test(l)) continue;
      suspects.push(l);
    }
  }
  return { file: `crash-reports/${fresh.f}`, description: desc, exception: afterDesc || null, suspects: suspects.slice(0, 4), text };
}

export function buildCrash(inst, info) {
  const lines = recentLines(inst, 600);
  // nur Zeilen seit dem letzten Start
  let from = 0;
  lines.forEach((l, i) => { if (/^\[Orbit\] ─── Start/.test(l)) from = i; });
  const run = lines.slice(from);
  const errIdx = [];
  run.forEach((l, i) => { if (/\b(ERROR|FATAL|SEVERE)\b|Exception|Caused by|^\s+at /.test(l)) errIdx.push(i); });
  const tailLines = run.filter((l) => !/^\[Orbit\]/.test(l)).slice(-25);
  const errors = errIdx.slice(-40).map((i) => run[i]);
  const report = readCrashReport(inst, info.startedAt);
  const stackText = `${report?.text || ''}\n${errors.join('\n')}`;
  const guessed = guessMods(inst, stackText);
  const exception = report?.exception || [...run].reverse().find((l) => /Exception|Error:/.test(l) && !/^\s+at /.test(l)) || null;
  return {
    at: Date.now(),
    code: info.code,
    signal: info.signal,
    loop: !!info.loop,
    uptimeMs: info.startedAt ? Date.now() - info.startedAt : null,
    description: report?.description || null,
    exception: exception ? exception.slice(0, 400) : null,
    suspects: report?.suspects?.length ? report.suspects : guessed,
    suspectSource: report?.suspects?.length ? 'report' : guessed.length ? 'stacktrace' : null,
    report: report?.file || null,
    errors: errors.slice(-20),
    lines: tailLines,
  };
}

export function lastCrash(inst) {
  try { return JSON.parse(fs.readFileSync(crashFile(inst.id), 'utf8')); } catch { return null; }
}
export function dismissCrash(inst) {
  try { fs.rmSync(crashFile(inst.id), { force: true }); } catch { /* */ }
}

function onExit(inst, info) {
  if (!info.crashed) return;
  let c;
  try { c = buildCrash(inst, info); } catch (e) { c = { at: Date.now(), code: info.code, signal: info.signal, loop: !!info.loop, exception: e.message, suspects: [], errors: [], lines: [] }; }
  try {
    fs.mkdirSync(crashDir(), { recursive: true });
    fs.writeFileSync(crashFile(inst.id), JSON.stringify(c));
  } catch { /* */ }
  const sus = c.suspects?.length ? c.suspects.join(', ') : 'unklar';
  if (info.loop) {
    mcAlert('crashloop', inst, 'Crash-Schleife — kein automatischer Neustart mehr', `Der Server ist in 10 Minuten mehrfach abgestürzt. Orbit startet ihn erst wieder, wenn du ihn startest.\n**Verdacht:** ${sus}`, { minGapMs: 10 * 60_000 });
  } else {
    mcAlert('crash', inst, 'Server abgestürzt', `${c.description ? `**${c.description}**\n` : ''}${c.exception ? `\`${c.exception.slice(0, 300)}\`\n` : ''}**Verdacht:** ${sus}${inst.auto_restart ? '\nOrbit startet ihn automatisch neu.' : ''}`, { minGapMs: 5 * 60_000 });
  }
}

/* ── Speicherplatz ── */
export function diskFree(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { return null; }
}

/* ── Schleifen ── */
function subscribeAll() {
  for (const inst of listMcInstances(DB)) {
    if (subs.has(inst.id)) continue;
    subs.set(inst.id, subscribeConsole(inst, (type, data) => {
      if (type === 'session') onSessions(getMcInstance(DB, inst.id) || inst, data.events);
    }));
  }
}

function closeStaleSessions() {
  const now = Date.now();
  for (const inst of listMcInstances(DB)) {
    const online = isRunning(inst.id) ? new Set(logPlayers(inst).map((p) => p.name.toLowerCase())) : new Set();
    for (const r of DB.prepare('SELECT id, name FROM mc_sessions WHERE instance_id = ? AND left IS NULL').all(inst.id)) {
      if (!online.has(r.name.toLowerCase())) DB.prepare('UPDATE mc_sessions SET left = ? WHERE id = ?').run(now, r.id);
    }
    // Spieler, die online sind, aber keine offene Sitzung haben (z. B. nach Panel-Update)
    for (const p of logPlayers(inst)) {
      if (!isRunning(inst.id)) break;
      const open = DB.prepare('SELECT 1 FROM mc_sessions WHERE instance_id = ? AND lower(name) = lower(?) AND left IS NULL').get(inst.id, p.name);
      if (!open) DB.prepare('INSERT INTO mc_sessions (instance_id, name, uuid, joined) VALUES (?, ?, ?, ?)').run(inst.id, p.name, p.uuid, now);
    }
  }
}

async function tick15() {
  for (const inst of listMcInstances(DB)) {
    const st = mcStatus(inst);
    if (!st.online) { lagState.delete(Number(inst.id)); continue; }
    const r = await measureTps(inst).catch(() => null);
    const prev = lagState.get(Number(inst.id)) || {};
    if (r) {
      const low = r.tps < 12 ? (prev.low || 0) + 1 : 0;
      lagState.set(Number(inst.id), { ...r, at: Date.now(), low });
      if (low >= 4) mcAlert('lag', inst, 'Starker Lag', `Seit 2 Minuten nur **${r.tps.toFixed(1)} TPS**${r.mspt ? ` (${r.mspt.toFixed(0)} ms pro Tick)` : ''}. Spieler merken das deutlich.`, { minGapMs: 60 * 60_000 });
    } else {
      // ohne messbare TPS: aus „Can't keep up“ schätzen
      const ev = lagEvents(inst, Date.now() - 5 * 60_000);
      const behind = ev.reduce((a, e) => a + e.ms, 0);
      if (behind > 60_000) mcAlert('lag', inst, 'Starker Lag', `In 5 Minuten ${ev.length}× „Can't keep up“ — der Server hing insgesamt ${(behind / 1000).toFixed(0)} s hinterher.`, { minGapMs: 60 * 60_000 });
    }
  }
}

function tick60() {
  const now = Date.now();
  subscribeAll();
  for (const inst of listMcInstances(DB)) {
    const st = mcStatus(inst);
    if (!st.pid) { unreach.delete(inst.id); continue; }
    const lag = lagState.get(Number(inst.id));
    DB.prepare('INSERT INTO mc_metrics (instance_id, t, players, cpu, ram, tps, mspt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(inst.id, now, st.players ?? 0, st.cpu ?? 0, st.rssMb ?? 0, lag && now - lag.at < 120_000 ? lag.tps : null, lag && now - lag.at < 120_000 ? lag.mspt : null);
    // Erreichbarkeit: läuft, war online, aber Status-Ping schlägt fehl
    if (st.onlineAt && !st.version) {
      const n = (unreach.get(inst.id) || 0) + 1;
      unreach.set(inst.id, n);
      if (n === 3) mcAlert('unreachable', inst, 'Server nicht erreichbar', 'Der Prozess läuft, antwortet aber seit 3 Minuten nicht auf Verbindungen. Spieler kommen nicht drauf — evtl. hängt der Server.', { minGapMs: 30 * 60_000 });
    } else unreach.delete(inst.id);
  }
}

function tick10m() {
  DB.prepare('DELETE FROM mc_metrics WHERE t < ?').run(Date.now() - 8 * 86_400_000);
  DB.prepare('DELETE FROM mc_sessions WHERE joined < ?').run(Date.now() - 90 * 86_400_000);
  const seen = new Set();
  for (const inst of listMcInstances(DB)) {
    for (const dir of [inst.path, path.join(DATA_DIR, 'mc-backups')]) {
      const d = diskFree(dir);
      if (!d) continue;
      const key = `${d.total}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (d.free < 15 * 1024 ** 3 || d.free / d.total < 0.05) {
        mcAlert('disk', inst, 'Speicherplatz knapp', `Nur noch **${(d.free / 1024 ** 3).toFixed(1)} GB** frei (${((d.free / d.total) * 100).toFixed(1)} %). Backups und Welt-Speichern können fehlschlagen.`, { minGapMs: 6 * 3_600_000 });
      }
    }
  }
}

let timers = [];
export function initMcMonitor(db) {
  DB = db;
  ensureTables(db);
  setMcExitHook(onExit);
  subscribeAll();
  closeStaleSessions();
  for (const t of timers) clearInterval(t);
  let busy = false;
  timers = [
    setInterval(() => { if (busy) return; busy = true; tick15().finally(() => { busy = false; }); }, 30_000),
    setInterval(tick60, 60_000),
    setInterval(tick10m, 10 * 60_000),
  ];
  for (const t of timers) t.unref?.();
  setTimeout(tick10m, 30_000).unref?.();
}
