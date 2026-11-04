import crypto from 'node:crypto';
import net from 'node:net';
import { readProperties, writeProperties } from './mcProperties.js';

/*
 * Minecraft-RCON mit dauerhafter Verbindung pro Instanz.
 * Antworten > 4 KB kommen in mehreren Paketen: ein volles Paket (≥ 4096 Byte) heißt „es folgt mehr“,
 * danach warten wir kurz auf den Rest. (Paper trennt die Verbindung bei unbekannten Pakettypen,
 * daher kein Marker-Paket.)
 */
const conns = new Map();
const AUTH = 3;
const EXEC = 2;
const IDLE_MS = 5 * 60_000;

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

class McRcon {
  constructor(port, password) {
    this.port = port;
    this.password = password;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.nextId = 10;
    this.waiters = new Map();
    this.queue = Promise.resolve();
    this.idle = null;
  }

  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: this.port });
      this.sock = sock;
      const fail = (e) => { this.close(); reject(e); };
      sock.setTimeout(6000, () => fail(new Error('RCON: Zeitüberschreitung')));
      sock.on('error', fail);
      sock.on('close', () => this.close());
      sock.on('data', (d) => this.onData(d));
      sock.on('connect', () => {
        this.waiters.set(1, {
          parts: [],
          done: (_txt, id) => {
            if (id === -1) fail(new Error('RCON: Passwort falsch'));
            else { sock.setTimeout(0); resolve(); }
          },
          auth: true,
        });
        sock.write(packet(1, AUTH, this.password));
      });
    });
    return this.ready;
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0);
      if (this.buf.length < len + 4) break;
      const id = this.buf.readInt32LE(4);
      const type = this.buf.readInt32LE(8);
      const body = this.buf.subarray(12, len + 2).toString('utf8');
      this.buf = this.buf.subarray(len + 4);
      if (type === 2 && (this.waiters.has(1) || id === -1)) {
        // Auth-Antwort (id -1 = abgelehnt)
        const w = this.waiters.get(1);
        this.waiters.delete(1);
        w?.done('', id);
        continue;
      }
      const w = this.waiters.get(id);
      if (!w) continue;
      w.parts.push(body);
      clearTimeout(w.more);
      if (Buffer.byteLength(body) < 4000) { this.waiters.delete(id); w.done(w.parts.join('')); }
      else w.more = setTimeout(() => { this.waiters.delete(id); w.done(w.parts.join('')); }, 250);
    }
  }

  async run(cmd) {
    await this.connect();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), IDLE_MS);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      if (this.nextId > 2_000_000_000) this.nextId = 10;
      const t = setTimeout(() => { this.waiters.delete(id); reject(new Error('RCON: keine Antwort')); }, 8000);
      this.waiters.set(id, { parts: [], done: (txt) => { clearTimeout(t); resolve(txt); } });
      this.sock.write(packet(id, EXEC, cmd));
    });
  }

  send(cmd) {
    const p = this.queue.then(() => this.run(cmd));
    this.queue = p.catch(() => {});
    return p;
  }

  close() {
    clearTimeout(this.idle);
    try { this.sock?.destroy(); } catch { /* */ }
    this.sock = null;
    this.ready = null;
    for (const w of this.waiters.values()) { if (!w.auth) w.done(''); }
    this.waiters.clear();
  }
}

/** RCON-Zugang aus server.properties (nur wenn aktiviert) */
export function rconConfig(inst) {
  const p = readProperties(inst.path);
  if (p['enable-rcon'] !== 'true' || !p['rcon.password']) return null;
  return { port: Number(p['rcon.port']) || 25575, password: p['rcon.password'] };
}

/** RCON in server.properties einschalten (greift beim nächsten Start) */
export function ensureRconProperties(inst) {
  const p = readProperties(inst.path);
  if (p['enable-rcon'] === 'true' && p['rcon.password'] && p['rcon.port']) return false;
  writeProperties(inst.path, {
    'enable-rcon': 'true',
    'rcon.port': String(p['rcon.port'] && p['rcon.port'] !== '25575' ? p['rcon.port'] : 35000 + Number(inst.id)),
    'rcon.password': p['rcon.password'] || crypto.randomBytes(24).toString('base64url'),
    'broadcast-rcon-to-ops': 'false',
  });
  return true;
}

export async function rcon(inst, cmd) {
  const cfg = rconConfig(inst);
  if (!cfg) throw new Error('RCON ist nicht aktiv — einmal neu starten.');
  const key = inst.id;
  let c = conns.get(key);
  if (!c || c.port !== cfg.port || c.password !== cfg.password) {
    c?.close();
    c = new McRcon(cfg.port, cfg.password);
    conns.set(key, c);
  }
  try {
    return (await c.send(cmd)).replace(/§[0-9a-fk-orx]/gi, '');
  } catch (e) {
    c.close();
    throw e;
  }
}

export function dropRcon(inst) {
  conns.get(inst.id)?.close();
  conns.delete(inst.id);
}
