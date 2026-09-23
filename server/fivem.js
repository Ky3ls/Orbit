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
  const rcon = String(text || '').match(/^\s*rcon_password\s+["']([^"']+)["']/im);
  const mysql = String(text || '').match(/set\s+mysql_connection_string\s+"([^"]+)"/i);
  return {
    rconPassword: rcon?.[1] || '',
    mysqlDsn: mysql?.[1] || '',
  };
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
  return { ...parseServerCfg(text), raw: text, path: activeCfgPath };
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

export function validateCfg(text) {
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
  if (!hasEndpoint) errors.push('Mindestens ein endpoint_add_tcp/udp empfohlen.');
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
  const list = Array.isArray(players) ? players : [];
  return {
    online: true,
    players: list.map((p) => ({
      id: p.id,
      name: String(p.name || 'Unbekannt').slice(0, 64),
      ping: Number(p.ping) || 0,
      identifiers: Array.isArray(p.identifiers) ? p.identifiers.map((x) => String(x).slice(0, 80)).slice(0, 12) : [],
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
