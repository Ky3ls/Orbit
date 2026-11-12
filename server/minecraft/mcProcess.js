import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { awaitLine, consoleLog, logPlayers, pokeConsole, readConsole } from './mcConsole.js';
import { ensureRconProperties } from './mcRcon.js';
import { getMcInstance, listMcInstances, updateMcInstance } from './mcDb.js';
import { readProperties } from './mcProperties.js';
import { jvmFlags } from './mcRam.js';

const STATE_FILE = () => path.join(DATA_DIR, 'mc-supervisor.json');
const CRASH_DELAY_MS = 10_000;
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 10 * 60_000;

/** @type {Map<number, { pid: number|null, child: any, phase: string, startedAt: number, onlineAt: number, manualStop: boolean, crashes: number[], restartTimer: any, ping: any, cpu: { t: number, ticks: number, pct: number }, rssMb: number }>} */
const rt = new Map();

function r(id) {
  const k = Number(id);
  if (!rt.has(k)) {
    rt.set(k, { pid: null, child: null, phase: 'offline', startedAt: 0, onlineAt: 0, manualStop: false, crashes: [], restartTimer: null, ping: null, cpu: { t: 0, ticks: 0, pct: 0 }, rssMb: 0 });
  }
  return rt.get(k);
}

export const orbitDir = (inst) => path.join(inst.path, '.orbit');
export { consoleLog };
const stdinFifo = (inst) => path.join(orbitDir(inst), 'stdin.fifo');

function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 1) return false;
  try { process.kill(n, 0); return true; } catch { return false; }
}

/** Gehört die PID wirklich zu dieser Instanz? (PIDs werden nach Reboot neu vergeben) */
function pidBelongs(pid, inst) {
  try {
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    return path.resolve(cwd) === path.resolve(inst.path);
  } catch {
    return false;
  }
}

// Von Hand gestoppte Instanzen: Autostart greift für sie erst wieder nach einem Start
const held = new Set();

function persist() {
  try {
    const map = {};
    for (const [id, s] of rt) if (s.pid && pidAlive(s.pid)) map[id] = { pid: s.pid };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ v: 1, at: Date.now(), instances: map, held: [...held] }));
  } catch { /* */ }
}

function ensureFifo(inst) {
  const fifo = stdinFifo(inst);
  fs.mkdirSync(path.dirname(fifo), { recursive: true });
  try {
    if (fs.statSync(fifo).isFIFO()) return fifo;
    fs.unlinkSync(fifo);
  } catch { /* fehlt */ }
  execFileSync('mkfifo', ['-m', '600', fifo], { timeout: 3000 });
  return fifo;
}

function appendLog(inst, text) {
  try {
    fs.mkdirSync(orbitDir(inst), { recursive: true });
    fs.appendFileSync(consoleLog(inst), `${text}\n`);
    pokeConsole(inst);
  } catch { /* */ }
}

/** Log rotieren, damit er nicht endlos wächst (20 MB) */
function rotateLog(inst) {
  const file = consoleLog(inst);
  try {
    if (fs.statSync(file).size > 20 * 1048576) fs.renameSync(file, `${file}.1`);
  } catch { /* */ }
}

/**
 * Minecraft-Server nie als root: Plugins/Mods sind Fremdcode. Läuft Orbit als root,
 * bekommt jede Instanz den Systembenutzer „orbit-mc“ (ohne Login, ohne Home).
 */
const RUN_USER = process.env.ORBIT_MC_USER || 'orbit-mc';
let runIds = null;
function runAs() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  if (runIds) return runIds;
  const id = (flag) => Number(execFileSync('id', [flag, RUN_USER], { encoding: 'utf8', timeout: 3000 }).trim());
  try {
    runIds = { uid: id('-u'), gid: id('-g') };
  } catch {
    execFileSync('useradd', ['--system', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', RUN_USER], { timeout: 10_000 });
    runIds = { uid: id('-u'), gid: id('-g') };
  }
  return runIds;
}

/** Instanz-Ordner dem Laufzeit-Benutzer geben (nach Installer, Mod-Downloads, Uploads) */
function ownForRun(inst) {
  const ids = runAs();
  if (!ids) return null;
  // Jeder übergeordnete Ordner muss für den Laufzeit-Benutzer betretbar sein, sonst
  // findet Java die server.jar nicht („Could not find or load main class“).
  let dir = path.dirname(path.resolve(inst.path));
  while (dir && dir !== path.dirname(dir)) {
    const st = fs.statSync(dir);
    const ok = (st.mode & 0o001) || (st.uid === ids.uid && (st.mode & 0o100)) || (st.gid === ids.gid && (st.mode & 0o010));
    if (!ok) throw new Error(`Ordner ${dir} ist für den Benutzer ${RUN_USER} gesperrt — Instanzen müssen in einem lesbaren Ordner liegen (z. B. /opt/orbit/servers).`);
    dir = path.dirname(dir);
  }
  execFileSync('chown', ['-R', `${ids.uid}:${ids.gid}`, inst.path], { timeout: 60_000 });
  // Konsole/FIFO bleiben bei Orbit (root), der Server bekommt sie als geerbte FDs
  return ids;
}

/** Einzelne Datei/Ordner nach Bearbeitung im Panel dem Laufzeit-Benutzer zurückgeben */
export function chownForRun(absPath, recursive = false) {
  const ids = runAs();
  if (!ids) return;
  try {
    execFileSync('chown', [...(recursive ? ['-R'] : []), `${ids.uid}:${ids.gid}`, absPath], { timeout: 60_000 });
  } catch { /* nicht kritisch — beim nächsten Start wird ohnehin übernommen */ }
}

/** Launch-Argumente aus der gespeicherten Launch-Beschreibung */
export function launchArgs(inst) {
  let launch = {};
  try { launch = JSON.parse(inst.launch || '{}'); } catch { /* */ }
  const flags = jvmFlags(inst.ram_mb || 4096);
  if (launch.mode === 'args' && launch.argsFile) return [...flags, `@${launch.argsFile}`, 'nogui'];
  return [...flags, '-jar', launch.jar || 'server.jar', 'nogui'];
}

export function mcStatus(inst) {
  const s = r(inst.id);
  const alive = s.pid && pidAlive(s.pid);
  if (!alive && (s.phase === 'running' || s.phase === 'starting')) s.phase = 'offline';
  const phase = inst.state === 'installing' ? 'installing' : inst.state === 'failed' ? 'failed' : s.phase;
  const logged = alive ? logPlayers(inst) : [];
  return {
    phase,
    online: phase === 'running',
    pid: alive ? s.pid : null,
    startedAt: alive ? s.startedAt : null,
    onlineAt: phase === 'running' ? s.onlineAt : null,
    cpu: alive ? Math.round(s.cpu.pct) : 0,
    rssMb: alive ? s.rssMb : 0,
    // Online-Liste live aus der Konsole (Login/Logout) — nicht vom Status-Ping (max. 12 Namen, hängt bei Last)
    players: alive ? logged.length : null,
    maxPlayers: s.ping?.max ?? (alive ? Number(readProperties(inst.path)['max-players']) || null : null),
    sample: logged.map((p) => p.name),
    version: s.ping?.version || null,
    motd: s.ping?.motd || null,
  };
}

export async function startMc(db, id, log = () => {}) {
  const inst = getMcInstance(db, id);
  if (!inst) throw new Error('Instanz nicht gefunden.');
  if (inst.state !== 'ready') throw new Error('Instanz ist noch nicht fertig installiert.');
  const s = r(inst.id);
  if (s.pid && pidAlive(s.pid)) return { ok: true, already: true };
  if (!inst.java_path || !fs.existsSync(inst.java_path)) throw new Error('Java für diese Instanz fehlt — unter „Instanz“ neu wählen.');
  clearTimeout(s.restartTimer);
  rotateLog(inst);
  appendLog(inst, `[Orbit] ─── Start ${new Date().toLocaleString('de-DE')} · ${inst.ram_mb} MB RAM ───`);
  try {
    const others = listMcInstances(db).filter((o) => o.id !== inst.id);
    const reserved = others.flatMap((o) => [Number(o.port), Number(readProperties(o.path)['rcon.port']) || 0]);
    await ensureRconProperties(inst, reserved);
  } catch { /* RCON optional */ }
  const ids = ownForRun(inst);
  const logFd = fs.openSync(consoleLog(inst), 'a');
  const stdinFd = fs.openSync(ensureFifo(inst), fs.constants.O_RDWR);
  let child;
  try {
    child = spawn(inst.java_path, launchArgs(inst), {
      cwd: inst.path,
      env: {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        LANG: process.env.LANG || 'C.UTF-8',
        TZ: process.env.TZ || 'Europe/Berlin',
        HOME: inst.path,
      },
      stdio: [stdinFd, logFd, logFd],
      detached: true,
      ...(ids ? { uid: ids.uid, gid: ids.gid } : {}),
    });
  } finally {
    fs.closeSync(logFd);
    fs.closeSync(stdinFd);
  }
  child.unref();
  Object.assign(s, { pid: child.pid, child, phase: 'starting', startedAt: Date.now(), onlineAt: 0, manualStop: false, ping: null });
  held.delete(Number(inst.id));
  child.on('exit', (code, signal) => onExit(db, inst.id, code, signal, log));
  persist();
  log('info', `[MC:${inst.slug}] gestartet (pid ${child.pid})`);
  return { ok: true, pid: child.pid };
}

function onExit(db, id, code, signal, log) {
  const s = r(id);
  const inst = getMcInstance(db, id);
  s.pid = null;
  s.child = null;
  s.phase = 'offline';
  s.ping = null;
  persist();
  if (!inst) return;
  appendLog(inst, `[Orbit] ─── Prozess beendet (${signal ? `Signal ${signal}` : `Code ${code}`}) ───`);
  if (s.manualStop) { s.manualStop = false; return; }
  const crashed = !(code === 0 && !signal);
  if (!crashed || !inst.auto_restart) return;
  const now = Date.now();
  s.crashes = s.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  s.crashes.push(now);
  if (s.crashes.length > MAX_CRASHES) {
    appendLog(inst, `[Orbit] Zu viele Abstürze in 10 Minuten — kein automatischer Neustart.`);
    log('warn', `[MC:${inst.slug}] Crash-Schleife — Auto-Restart pausiert`);
    s.phase = 'crashed';
    return;
  }
  appendLog(inst, `[Orbit] Absturz erkannt — Neustart in ${CRASH_DELAY_MS / 1000}s`);
  s.phase = 'crashed';
  s.restartTimer = setTimeout(() => { startMc(db, id, log).catch((e) => appendLog(inst, `[Orbit] Neustart fehlgeschlagen: ${e.message}`)); }, CRASH_DELAY_MS);
}

/** Befehl in die Server-Konsole schreiben (FIFO — funktioniert auch nach Panel-Restart) */
export function sendMc(inst, command) {
  const line = String(command || '').replace(/[\r\n]/g, ' ').trim();
  if (!line) throw new Error('Leerer Befehl.');
  const s = r(inst.id);
  if (!s.pid || !pidAlive(s.pid)) throw new Error('Server läuft nicht.');
  const fd = fs.openSync(stdinFifo(inst), fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
  try { fs.writeSync(fd, `${line}\n`); } finally { fs.closeSync(fd); }
}

/* ── Ankündigung im Spiel vor Neustart/Stopp ── */
const NOTICE = {
  restart: { title: 'Neustart', chat: 'Server startet neu', kick: 'Server startet neu – in 1–2 Minuten wieder da!' },
  stop: { title: 'Server stoppt', chat: 'Server wird gestoppt', kick: 'Server wurde gestoppt – bis gleich!' },
  restore: { title: 'Backup', chat: 'Ein Backup wird eingespielt – Server stoppt', kick: 'Backup wird eingespielt – Server ist gleich wieder da!' },
};
const raw = (o) => JSON.stringify(o);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Countdown im Chat (+ Titel, Actionbar, Ton) und danach alle mit eigener Nachricht trennen */
async function announce(inst, kind, seconds = 10) {
  const n = NOTICE[kind] || NOTICE.stop;
  const s = r(inst.id);
  const alive = () => s.pid && pidAlive(s.pid);
  const send = (c) => { try { sendMc(inst, c); } catch { /* */ } };
  if (!logPlayers(inst).length) return;
  send(`tellraw @a ${raw(['', { text: '» ', color: 'dark_gray' }, { text: n.chat, color: 'gold', bold: true }, { text: ` in ${seconds} Sekunden.`, color: 'yellow' }, { text: ' Bring dich kurz in Sicherheit!', color: 'gray' }])}`);
  send(`title @a times 5 40 10`);
  send(`title @a subtitle ${raw({ text: `in ${seconds} Sekunden`, color: 'gray' })}`);
  send(`title @a title ${raw({ text: n.title, color: 'gold', bold: true })}`);
  send('execute as @a at @s run playsound minecraft:block.note_block.bell master @s ~ ~ ~ 1 1');
  for (let i = seconds - 1; i >= 1; i -= 1) {
    await sleep(1000);
    if (!alive()) return;
    const color = i <= 3 ? 'red' : i <= 5 ? 'gold' : 'yellow';
    send(`tellraw @a ${raw(['', { text: '» ', color: 'dark_gray' }, { text: n.title, color: 'gray' }, { text: ` in ${i}…`, color, bold: i <= 3 }])}`);
    send(`title @a actionbar ${raw({ text: `${n.title} in ${i}`, color, bold: true })}`);
    send(`execute as @a at @s run playsound minecraft:block.note_block.hat master @s ~ ~ ~ 1 ${i <= 3 ? 1.6 : 1.2}`);
  }
  await sleep(1000);
  if (!alive()) return;
  send(`kick @a ${n.kick}`);
  await sleep(400);
}

export async function stopMc(db, id, { kill = false, log = () => {}, reason = 'stop' } = {}) {
  const inst = getMcInstance(db, id);
  if (!inst) throw new Error('Instanz nicht gefunden.');
  const s = r(inst.id);
  clearTimeout(s.restartTimer);
  if (!s.pid || !pidAlive(s.pid)) { s.phase = 'offline'; return { ok: true }; }
  s.manualStop = true;
  s.phase = 'stopping';
  held.add(Number(inst.id));
  persist();
  const pid = s.pid;
  if (!kill) {
    if (reason) await announce(inst, reason);
    try { sendMc(inst, 'stop'); } catch { /* */ }
    for (let i = 0; i < 120 && pidAlive(pid); i += 1) await new Promise((res) => setTimeout(res, 500));
  }
  if (pidAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* */ }
    for (let i = 0; i < 20 && pidAlive(pid); i += 1) await new Promise((res) => setTimeout(res, 500));
  }
  if (pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* */ } }
  if (!s.child) { s.pid = null; s.phase = 'offline'; s.manualStop = false; persist(); }
  log('info', `[MC:${inst.slug}] gestoppt`);
  return { ok: true };
}

export async function restartMc(db, id, log) {
  await stopMc(db, id, { log, reason: 'restart' });
  await new Promise((res) => setTimeout(res, 1500));
  return startMc(db, id, log);
}

/* ── Interne Konsolen-Abfragen (z. B. Live-Inventar) ──
 * Die Konsole gibt `data get` ungekürzt aus (RCON kürzt auf ~150 Zeichen).
 * Der Live-Tail fängt die Antwortzeile ab, sie erscheint nicht in der Konsolen-Ansicht. */
const queryChain = new Map();
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Befehl über die Konsole schicken und die Antwortzeile zurückgeben.
 * @returns {Promise<string|null>} Text nach „…entity data: “ oder null (nicht gefunden / Zeitüberschreitung)
 */
export function consoleQuery(inst, command, name, timeoutMs = 3000) {
  const prev = queryChain.get(inst.id) || Promise.resolve();
  const re = new RegExp(`(?:System chat: )?(?:${escRe(name)} has the following entity data: (.*)|Found no elements matching .*|No entity was found|No player was found)$`);
  const job = prev.then(async () => {
    if (!isRunning(inst.id)) return null;
    const hit = await awaitLine(inst, re, () => sendMc(inst, command), timeoutMs);
    return hit ? (hit[1] ?? null) : null;
  });
  queryChain.set(inst.id, job.catch(() => {}));
  return job;
}

export { readConsole };

/* ── Server List Ping (Status-Protokoll) ── */
function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}
function readVarint(buf, off) {
  let n = 0;
  let shift = 0;
  for (let i = 0; i < 5; i += 1) {
    if (off + i >= buf.length) return null;
    const b = buf[off + i];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: n, size: i + 1 };
    shift += 7;
  }
  return null;
}

export function pingMc(port, host = '127.0.0.1', timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let data = Buffer.alloc(0);
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(null));
    sock.on('error', () => done(null));
    sock.on('connect', () => {
      const hostBuf = Buffer.from(host);
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      const hs = Buffer.concat([varint(0), varint(767), varint(hostBuf.length), hostBuf, portBuf, varint(1)]);
      sock.write(Buffer.concat([varint(hs.length), hs, varint(1), varint(0)]));
    });
    sock.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const len = readVarint(data, 0);
      if (!len || data.length < len.size + len.value) return;
      let off = len.size;
      const id = readVarint(data, off); off += id.size;
      const sl = readVarint(data, off); off += sl.size;
      try {
        const j = JSON.parse(data.subarray(off, off + sl.value).toString('utf8'));
        const motd = typeof j.description === 'string' ? j.description : (j.description?.text || (j.description?.extra || []).map((x) => x.text || '').join(''));
        done({
          players: j.players?.online ?? 0,
          max: j.players?.max ?? 0,
          sample: (j.players?.sample || []).map((p) => p.name).slice(0, 20),
          version: j.version?.name || null,
          motd: String(motd || '').replace(/§./g, ''),
        });
      } catch {
        done(null);
      }
    });
  });
}

/* ── Metriken + Status-Schleife ── */
const CLK = 100;
function sampleProc(s) {
  try {
    const stat = fs.readFileSync(`/proc/${s.pid}/stat`, 'utf8');
    const parts = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(parts[11]) + Number(parts[12]);
    const now = Date.now();
    if (s.cpu.t) s.cpu.pct = ((ticks - s.cpu.ticks) / CLK) / ((now - s.cpu.t) / 1000) * 100;
    s.cpu.t = now;
    s.cpu.ticks = ticks;
    const st = fs.readFileSync(`/proc/${s.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/);
    s.rssMb = st ? Math.round(Number(st[1]) / 1024) : 0;
  } catch { /* */ }
}

let loopTimer = null;
export function initMinecraft(db, log = () => {}) {
  // Nach Panel-Restart: laufende Server wieder einhängen
  let saved = {};
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    saved = st.instances || {};
    for (const id of st.held || []) held.add(Number(id));
  } catch { /* */ }
  for (const inst of listMcInstances(db)) {
    if (inst.state === 'installing') updateMcInstance(db, inst.id, { state: 'failed' });
    const pid = Number(saved[inst.id]?.pid);
    if (pid && pidAlive(pid) && pidBelongs(pid, inst)) {
      Object.assign(r(inst.id), { pid, phase: 'starting', startedAt: Date.now() });
      log('ok', `[MC:${inst.slug}] laufenden Server übernommen (pid ${pid})`);
    } else if (inst.autostart && inst.state === 'ready' && held.has(Number(inst.id))) {
      log('info', `[MC:${inst.slug}] Autostart übersprungen — wurde von Hand gestoppt`);
    } else if (inst.autostart && inst.state === 'ready') {
      startMc(db, inst.id, log).catch((e) => log('warn', `[MC:${inst.slug}] Autostart: ${e.message}`));
    }
  }
  persist();
  clearInterval(loopTimer);
  let tick = 0;
  loopTimer = setInterval(async () => {
    tick += 1;
    for (const inst of listMcInstances(db)) {
      const s = r(inst.id);
      if (!s.pid) continue;
      if (!pidAlive(s.pid)) {
        // adoptierter Prozess ohne child-Handle: Ende selbst erkennen
        if (!s.child) onExit(db, inst.id, null, 'unbekannt', log);
        continue;
      }
      sampleProc(s);
      if (tick % 2 === 0 || s.phase === 'starting') {
        const p = await pingMc(inst.port);
        if (p) {
          s.ping = p;
          if (s.phase !== 'running') { s.phase = 'running'; s.onlineAt = Date.now(); }
        } else if (s.phase === 'running') {
          s.ping = null;
        }
      }
    }
  }, 2500);
  loopTimer.unref?.();
}

/** Belegter RAM aller laufenden MC-Instanzen (für die Empfehlung) */
export function runningRamMb(db, exceptId) {
  let sum = 0;
  for (const inst of listMcInstances(db)) {
    if (Number(inst.id) === Number(exceptId)) continue;
    const s = r(inst.id);
    if (s.pid && pidAlive(s.pid)) sum += inst.ram_mb || 0;
  }
  return sum;
}

export function isRunning(id) {
  const s = r(id);
  return !!(s.pid && pidAlive(s.pid));
}
