import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { CFG_PATH } from './config.js';

let activeCfgPath = CFG_PATH;

export function resolveCfgPath(settings) {
  const dp = String(settings?.fxDataPath || '').trim();
  if (dp) return path.join(dp.replace(/\/$/, ''), 'server.cfg');
  return CFG_PATH;
}

export function syncActiveCfgPath(settings) {
  activeCfgPath = resolveCfgPath(settings);
  return activeCfgPath;
}

export function activeResourcesRoot() {
  return path.join(path.dirname(activeCfgPath), 'resources');
}
import { parseGameBuildFromCfg, parseOnesyncFromCfg } from './cfgPatch.js';

export function parseCfgIntegrations(text) {
  let rconPassword = '';
  let mysqlDsn = '';
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const rcon = t.match(/^rcon_password\s+["']([^"']+)["']/i);
    if (rcon) rconPassword = rcon[1];
    const mysql = t.match(/^set\s+mysql_connection_string\s+"([^"]+)"/i);
    if (mysql) mysqlDsn = mysql[1];
  }
  return { rconPassword, mysqlDsn };
}

export function parseServerCfg(text) {
  const resources = [];
  const pub = { hostname: '', maxClients: 48, project: '', tags: '', locale: 'de-DE', onesync: 'on', gameBuild: '' };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const ensured = t.match(/^(?:ensure|start)\s+("?)([^"\s]+)\1/i);
    if (ensured) {
      resources.push(ensured[2]);
      continue;
    }
    const host = t.match(/^sv_hostname\s+"([^"]+)"/i);
    if (host) pub.hostname = host[1];
    const max = t.match(/^sv_maxclients\s+(\d+)/i);
    if (max) pub.maxClients = Number(max[1]);
    const project = t.match(/^sets\s+sv_projectName\s+"([^"]+)"/i);
    if (project) pub.project = project[1];
    const tags = t.match(/^sets\s+tags\s+"([^"]+)"/i);
    if (tags) pub.tags = tags[1];
    const locale = t.match(/^sets\s+locale\s+"([^"]+)"/i);
    if (locale) pub.locale = locale[1];
    const os = t.match(/^set\s+onesync\s+(on|legacy|off)/i);
    if (os) pub.onesync = os[1].toLowerCase();
    const gb = t.match(/^(?:set\s+)?sv_enforceGameBuild\s+(\d+)/i);
    if (gb) pub.gameBuild = gb[1];
  }
  pub.onesync = parseOnesyncFromCfg(text);
  if (!pub.gameBuild) pub.gameBuild = parseGameBuildFromCfg(text);
  return { resources, pub };
}

export function readCfg() {
  const text = fs.readFileSync(activeCfgPath, 'utf8');
  const root = getCfgRoot();
  return {
    ...parseServerCfg(text),
    raw: text,
    path: activeCfgPath,
    rel: path.relative(root, activeCfgPath).replace(/\\/g, '/') || path.basename(activeCfgPath),
    primary: true,
  };
}

const CFG_SKIP_DIRS = new Set([
  'cache', 'db', '.orbit', '.orbit-sql', '.git', 'node_modules',
  'stream', 'browser_download', 'yarn_cache', 'citizen',
]);

/** Datenverzeichnis der aktiven Instanz (Ordner der server.cfg). */
export function getCfgRoot() {
  return path.resolve(path.dirname(activeCfgPath));
}

/**
 * Relativen .cfg-Pfad unter dem Server-Root auflösen.
 * Verhindert Path-Traversal und Nicht-.cfg-Dateien.
 */
export function resolveSafeCfgPath(relOrName) {
  const root = getCfgRoot();
  let cleaned = String(relOrName || '').trim().replace(/\\/g, '/');
  if (!cleaned) cleaned = path.basename(activeCfgPath) || 'server.cfg';
  if (
    cleaned.includes('\0')
    || cleaned.includes('..')
    || cleaned.startsWith('/')
    || path.isAbsolute(cleaned)
    || /^[a-zA-Z]:/.test(cleaned)
  ) {
    throw new Error('Ungültiger CFG-Pfad.');
  }
  cleaned = cleaned.replace(/^(\.\/)+/, '');
  if (!cleaned || cleaned.includes('..')) throw new Error('Ungültiger CFG-Pfad.');
  if (!/\.cfg$/i.test(cleaned)) throw new Error('Nur .cfg-Dateien erlaubt.');
  if (cleaned.length > 240) throw new Error('Pfad zu lang.');
  const full = path.resolve(root, cleaned);
  const relCheck = path.relative(root, full);
  if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error('Pfad außerhalb des Server-Verzeichnisses.');
  }
  return full;
}

export function listCfgFiles(opts = {}) {
  const root = getCfgRoot();
  const maxDepth = Math.min(6, Number(opts.maxDepth) || 4);
  const maxFiles = Math.min(500, Number(opts.maxFiles) || 200);
  const out = [];
  const primaryResolved = path.resolve(activeCfgPath);

  function walk(dir, depth) {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const name = ent.name;
      if (!name || name === '.' || name === '..') continue;
      if (name.startsWith('.') && name !== '.') continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        if (CFG_SKIP_DIRS.has(name.toLowerCase()) || CFG_SKIP_DIRS.has(name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile() || !/\.cfg$/i.test(name)) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.size > 512_000) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      out.push({
        rel,
        name,
        size: st.size,
        mtime: st.mtimeMs,
        primary: path.resolve(full) === primaryResolved,
      });
    }
  }

  if (fs.existsSync(root)) walk(root, 0);
  // Fallback: aktive server.cfg immer listen, auch wenn Scan leer
  if (!out.some((f) => f.primary) && fs.existsSync(activeCfgPath)) {
    try {
      const st = fs.statSync(activeCfgPath);
      out.unshift({
        rel: path.relative(root, activeCfgPath).replace(/\\/g, '/') || path.basename(activeCfgPath),
        name: path.basename(activeCfgPath),
        size: st.size,
        mtime: st.mtimeMs,
        primary: true,
      });
    } catch { /* ignore */ }
  }
  out.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    if (a.rel.includes('/') !== b.rel.includes('/')) return a.rel.includes('/') ? 1 : -1;
    return a.rel.localeCompare(b.rel, 'de');
  });
  return { root, files: out, truncated: out.length >= maxFiles };
}

export function readCfgFile(rel) {
  const full = resolveSafeCfgPath(rel || path.basename(activeCfgPath) || 'server.cfg');
  if (!fs.existsSync(full)) throw new Error('CFG-Datei nicht gefunden.');
  const text = fs.readFileSync(full, 'utf8');
  const parsed = parseServerCfg(text);
  const root = getCfgRoot();
  return {
    ...parsed,
    raw: text,
    path: full,
    rel: path.relative(root, full).replace(/\\/g, '/'),
    primary: path.resolve(full) === path.resolve(activeCfgPath),
  };
}

export function writeCfgFile(rel, text) {
  const full = resolveSafeCfgPath(rel || path.basename(activeCfgPath) || 'server.cfg');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, { encoding: 'utf8', mode: 0o644 });
  return full;
}

const SECRET_RE = /^(sv_licenseKey|set\s+steam_webApiKey|set\s+mysql_connection_string|rcon_password|set\s+sv_tebexSecret)\b/i;

export function redactCfg(text) {
  return String(text || '').split('\n').map((line) => {
    const t = line.trim();
    if (SECRET_RE.test(t)) {
      const key = t.split(/\s+/)[0] === 'set' ? t.split(/\s+/).slice(0, 2).join(' ') : t.split(/\s+/)[0];
      return `${key} "••••••••"`;
    }
    return line;
  }).join('\n');
}

export function mergeCfgSecrets(original, edited) {
  const origLines = String(original || '').split('\n');
  const editLines = String(edited || '').split('\n');
  const secretByPrefix = new Map();
  for (const line of origLines) {
    const t = line.trim();
    if (SECRET_RE.test(t)) {
      const prefix = t.split(/\s+/)[0] === 'set' ? t.split(/\s+/).slice(0, 2).join(' ').toLowerCase() : t.split(/\s+/)[0].toLowerCase();
      secretByPrefix.set(prefix, line);
    }
  }
  return editLines.map((line) => {
    const t = line.trim();
    if (!SECRET_RE.test(t) && !/••••/.test(t)) return line;
    const prefix = t.split(/\s+/)[0] === 'set' ? t.split(/\s+/).slice(0, 2).join(' ').toLowerCase() : t.split(/\s+/)[0].toLowerCase();
    return secretByPrefix.get(prefix) || line.replace(/••••+/g, 'REMOVED');
  }).join('\n');
}

export function validateCfg(text, opts = {}) {
  const requireEndpoints = opts.requireEndpoints !== false;
  const errors = [];
  if (typeof text !== 'string') return ['Inhalt fehlt.'];
  if (text.length > 512_000) return ['CFG zu groß (max. 512 KB).'];
  if (text.includes('\0')) return ['Ungültige Zeichen.'];
  const lines = text.split('\n');
  if (lines.length > 8000) return ['Zu viele Zeilen.'];
  let hasEndpoint = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    if (/^endpoint_add_(tcp|udp)\b/i.test(t)) hasEndpoint = true;
    if (/^(exec|load_server_icon)\s+/i.test(t) && /\.\.|\/etc\/|\/root\//i.test(t)) {
      errors.push(`Zeile ${i + 1}: verdächtiger Pfad.`);
    }
  }
  if (requireEndpoints && !hasEndpoint) {
    errors.push('Mindestens ein endpoint_add_tcp/udp empfohlen.');
  }
  return errors;
}

export function writeCfg(text) {
  fs.mkdirSync(path.dirname(activeCfgPath), { recursive: true });
  fs.writeFileSync(activeCfgPath, text, { encoding: 'utf8', mode: 0o644 });
}

export function portOpen(host, port, timeout = 450) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeFiveM(host, port) {
  const open = await portOpen(host, port);
  if (!open) return { online: false, players: [], resources: [], hostname: '', maxClients: null, clients: 0 };
  const base = `http://${host}:${port}`;
  const [info, dynamic, players] = await Promise.all([
    fetchJson(`${base}/info.json`, 900),
    fetchJson(`${base}/dynamic.json`, 900),
    fetchJson(`${base}/players.json`, 900),
  ]);
  const list = (Array.isArray(players) ? players : [])
    // Ghosts ohne Identifier (z. B. Name „Player“, leere IDs) ausblenden
    .filter((p) => Array.isArray(p.identifiers) && p.identifiers.length > 0);
  return {
    online: true,
    players: list.map((p) => ({
      id: p.id,
      name: String(p.name || 'Unbekannt').slice(0, 64),
      ping: Number(p.ping) || 0,
      identifiers: p.identifiers.map((x) => String(x).slice(0, 80)).slice(0, 12),
    })),
    resources: Array.isArray(info?.resources) ? info.resources.map((r) => String(r).slice(0, 64)) : [],
    hostname: String(dynamic?.hostname || info?.vars?.sv_projectName || '').slice(0, 120),
    maxClients: Number(dynamic?.sv_maxclients) || null,
    clients: Number(dynamic?.clients) || list.length,
  };
}

export function readHost() {
  const mem = fs.readFileSync('/proc/meminfo', 'utf8');
  const total = Number(mem.match(/MemTotal:\s+(\d+)/)?.[1] || 0);
  const avail = Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1] || 0);
  const cpu = readCpu();
  return {
    ramTotal: total * 1024,
    ramUsed: Math.max(0, (total - avail) * 1024),
    ramPct: total ? Math.round(((total - avail) / total) * 1000) / 10 : 0,
    cpu,
  };
}

let lastCpu = null;
function readCpu() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  if (!lastCpu) {
    lastCpu = { idle, total };
    return 0;
  }
  const dIdle = idle - lastCpu.idle;
  const dTotal = total - lastCpu.total;
  lastCpu = { idle, total };
  if (dTotal <= 0) return 0;
  return Math.round((1 - dIdle / dTotal) * 1000) / 10;
}
