import fs from 'node:fs';
import path from 'node:path';

/*
 * Live-Konsole: Orbit folgt der Ausgabedatei des Servers (stdout → .orbit/console.log) dauerhaft.
 * Neue Zeilen gehen sofort an alle Zuschauer (SSE), die letzten Zeilen liegen im Speicher —
 * beim Öffnen der Seite ist die Konsole sofort da. Aus denselben Zeilen kommt die Online-Liste
 * (Login/Logout), ganz ohne RCON oder Status-Ping.
 */
export const consoleLog = (inst) => path.join(inst.path, '.orbit', 'console.log');

const RING = 1500;
const CHUNK = 4 * 1048576;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
/** „[19:27:17] [Server thread/INFO] [minecraft/MinecraftServer]: msg“ · „[19:27:17 INFO]: msg“ */
const MSG = /^(?:\[[^\]]*\]\s?)+:\s(.*)$/;
const JOIN_LOGIN = /^([A-Za-z0-9_]{1,16})\[\/([0-9a-fA-F:.]+):\d+\] logged in with entity id/;
const JOIN_MSG = /^([A-Za-z0-9_]{1,16}) joined the game$/;
const LEAVE = /^([A-Za-z0-9_]{1,16}) (?:lost connection: |left the game$)/;
const UUID_OF = /^UUID of player ([A-Za-z0-9_]{1,16}) is ([0-9a-fA-F-]{32,36})$/;
const SERVER_DOWN = /^(?:Stopping server|Stopping the server|\[Orbit\] ─── (?:Start|Prozess beendet))/;

export function lineLevel(t) {
  if (/\b(ERROR|FATAL|SEVERE)\b|Exception|Caused by/i.test(t)) return 'bad';
  if (/\bWARN(ING)?\b/.test(t)) return 'warn';
  if (/Done \(|\[Orbit\].*Start/.test(t)) return 'ok';
  return 'info';
}

class Tail {
  constructor(file) {
    this.file = file;
    this.ino = 0;
    this.pos = 0;
    this.carry = '';
    this.seq = 0;
    this.lines = [];
    this.subs = new Set();
    this.matchers = new Set();
    /** kleingeschriebener Name → { name, uuid, since } */
    this.online = new Map();
    this.uuids = new Map();
    this.ips = new Map();
    this.watcher = null;
    this.pending = null;
    this.timer = setInterval(() => this.read(), 1000);
    this.timer.unref?.();
    this.read();
  }

  watch() {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(path.dirname(this.file), { persistent: false }, (_ev, name) => {
        if (!name || name === 'console.log') this.schedule();
      });
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null; });
    } catch { this.watcher = null; }
  }

  schedule(ms = 15) {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = null; this.read(); }, ms);
  }

  read() {
    this.watch();
    let st;
    try { st = fs.statSync(this.file); } catch { return; }
    if (st.ino !== this.ino || st.size < this.pos) {
      const first = this.ino === 0;
      this.ino = st.ino;
      this.pos = 0;
      this.carry = '';
      if (!first) {
        this.lines = [];
        this.emit('reset', {});
      }
    }
    if (st.size <= this.pos) return;
    const fresh = [];
    let playersChanged = false;
    let fd;
    try {
      fd = fs.openSync(this.file, 'r');
      while (this.pos < st.size) {
        const len = Math.min(st.size - this.pos, CHUNK);
        const buf = Buffer.alloc(len);
        const got = fs.readSync(fd, buf, 0, len, this.pos);
        if (got <= 0) break;
        this.pos += got;
        const parts = (this.carry + buf.subarray(0, got).toString('utf8')).split('\n');
        this.carry = parts.pop();
        for (const raw of parts) {
          const t = raw.replace(ANSI, '').replace(/\r$/, '');
          if (!t) continue;
          if (this.consume(t)) continue;
          if (this.track(t)) playersChanged = true;
          const line = { id: ++this.seq, t, level: lineLevel(t) };
          this.lines.push(line);
          fresh.push(line);
        }
        if (this.lines.length > RING * 2) this.lines = this.lines.slice(-RING);
      }
    } catch { /* nächster Durchlauf */ } finally {
      if (fd != null) try { fs.closeSync(fd); } catch { /* */ }
    }
    if (this.lines.length > RING) this.lines = this.lines.slice(-RING);
    if (fresh.length) this.emit('lines', { lines: fresh.length > RING ? fresh.slice(-RING) : fresh });
    if (playersChanged) this.emit('players', { players: this.players() });
  }

  /** Antwort auf eine interne Orbit-Abfrage: abfangen statt anzeigen */
  consume(t) {
    for (const m of this.matchers) {
      const hit = t.match(m.re);
      if (hit) { this.matchers.delete(m); m.done(hit); return true; }
    }
    return false;
  }

  track(t) {
    if (SERVER_DOWN.test(t) || SERVER_DOWN.test(t.match(MSG)?.[1] || '')) {
      if (!this.online.size) return false;
      this.online.clear();
      return true;
    }
    const msg = t.match(MSG)?.[1];
    if (!msg) return false;
    let m = msg.match(UUID_OF);
    if (m) { this.uuids.set(m[1].toLowerCase(), dash(m[2])); return false; }
    m = msg.match(JOIN_LOGIN) || msg.match(JOIN_MSG);
    if (m) {
      const k = m[1].toLowerCase();
      if (m[2]) this.ips.set(k, m[2]);
      if (this.online.has(k)) return false;
      this.online.set(k, { name: m[1], since: Date.now() });
      return true;
    }
    m = msg.match(LEAVE);
    if (m && this.online.delete(m[1].toLowerCase())) return true;
    return false;
  }

  players() {
    return [...this.online.entries()].map(([k, p]) => ({ name: p.name, uuid: this.uuids.get(k) || null, since: p.since }));
  }

  emit(type, data) {
    for (const fn of this.subs) { try { fn(type, data); } catch { /* */ } }
  }

  close() {
    clearInterval(this.timer);
    clearTimeout(this.pending);
    try { this.watcher?.close(); } catch { /* */ }
    this.subs.clear();
    for (const m of this.matchers) m.done(null);
    this.matchers.clear();
  }
}

function dash(id) {
  const h = String(id).toLowerCase().replace(/-/g, '');
  return h.length === 32 ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null;
}

const tails = new Map();
function tail(inst) {
  const file = consoleLog(inst);
  let t = tails.get(inst.id);
  if (t && t.file !== file) { t.close(); t = null; }
  if (!t) { t = new Tail(file); tails.set(inst.id, t); }
  return t;
}

/** Konsole sofort nachlesen (z. B. nach eigenem appendLog) */
export function pokeConsole(inst) { tail(inst).schedule(0); }

/** Letzte Zeilen aus dem Speicher */
export function consoleSnapshot(inst, n = 600) {
  const t = tail(inst);
  t.read();
  return { seq: t.seq, lines: t.lines.slice(-n), players: t.players() };
}

/** Poll-Variante (Fallback ohne SSE): offset = Zeilen-Nummer */
export function readConsole(inst, offset) {
  const t = tail(inst);
  t.read();
  const after = Number(offset);
  const oldest = t.lines.length ? t.lines[0].id : t.seq + 1;
  if (!Number.isFinite(after) || after > t.seq || after < oldest - 1) {
    return { offset: t.seq, lines: t.lines.slice(-600), reset: true };
  }
  return { offset: t.seq, lines: t.lines.filter((l) => l.id > after), reset: false };
}

/** Live-Ereignisse: 'lines' | 'reset' | 'players' */
export function subscribeConsole(inst, fn) {
  const t = tail(inst);
  t.subs.add(fn);
  return () => t.subs.delete(fn);
}

/** Online-Spieler laut Log (Login/Logout seit dem letzten Start) */
export function logPlayers(inst) {
  const t = tail(inst);
  t.read();
  return t.players();
}

export function lastIp(inst, name) {
  return tail(inst).ips.get(String(name).toLowerCase()) || null;
}

/**
 * Auf die nächste passende Zeile warten (wird nicht in der Konsole angezeigt).
 * `send` schickt den Befehl erst, wenn der Wächter steht.
 */
export function awaitLine(inst, re, send, timeoutMs = 3000) {
  const t = tail(inst);
  t.read();
  return new Promise((resolve) => {
    let fast = null;
    const m = {
      re,
      done: (hit) => { clearTimeout(timer); clearInterval(fast); resolve(hit); },
    };
    const timer = setTimeout(() => { t.matchers.delete(m); clearInterval(fast); resolve(null); }, timeoutMs);
    t.matchers.add(m);
    // fs.watch kann je nach Dateisystem träge sein → während der Abfrage eng nachlesen
    fast = setInterval(() => t.read(), 25);
    try { send(); } catch (e) { m.done(null); }
  });
}

export function closeConsole(id) {
  tails.get(id)?.close();
  tails.delete(id);
}
