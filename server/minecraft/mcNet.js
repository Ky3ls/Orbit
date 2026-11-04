import dns from 'node:dns/promises';
import os from 'node:os';
import { setSetting, settingMap } from '../db.js';

/* Cloudflare-Proxy-Bereiche (IPv4) — Minecraft (TCP) kommt durch den Proxy nicht durch */
const CF_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

const ipNum = (ip) => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
function inCidr(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = 2 ** (32 - Number(bits));
  return Math.floor(ipNum(ip) / mask) === Math.floor(ipNum(base) / mask);
}
const isCloudflare = (ip) => CF_RANGES.some((c) => inCidr(ip, c));
function isPrivate(ip) {
  return /^(10\.|127\.|169\.254\.|192\.168\.)/.test(ip) || inCidr(ip, '172.16.0.0/12') || inCidr(ip, '100.64.0.0/10');
}

/** Öffentliche IPv4-Adressen der Netzwerkschnittstellen */
export function localPublicIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !isPrivate(a.address)) out.push(a.address);
    }
  }
  return out;
}

/** Adresse, die Spieler eintragen: Einstellung, sonst öffentliche IP */
export function publicHost(db) {
  const s = settingMap(db);
  return String(s.mcPublicHost || '').trim() || localPublicIps()[0] || '';
}

export function setPublicHost(db, host) {
  const h = String(host || '').trim().toLowerCase();
  if (h && !/^[a-z0-9.-]{1,253}$/.test(h)) throw new Error('Ungültige Adresse.');
  setSetting(db, 'mcPublicHost', h);
  return publicHost(db);
}

/** DNS-Check: zeigt die Adresse auf diesen Server und nicht auf den Cloudflare-Proxy? */
export async function checkHost(host) {
  const local = localPublicIps();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { host, ips: [host], cloudflare: false, pointsHere: !local.length || local.includes(host), isIp: true, local };
  }
  let ips = [];
  try { ips = await dns.resolve4(host); } catch { /* NXDOMAIN o. ä. */ }
  return {
    host,
    ips,
    resolves: ips.length > 0,
    cloudflare: ips.some(isCloudflare),
    pointsHere: !local.length || ips.some((ip) => local.includes(ip)),
    local,
  };
}

/** Optional: Erreichbarkeit von außen über mcsrvstat.us prüfen */
export async function externalCheck(host, port) {
  const res = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(`${host}:${port}`)}`, {
    headers: { 'User-Agent': 'Orbit-Panel' },
  });
  if (!res.ok) throw new Error(`Prüfdienst: HTTP ${res.status}`);
  const d = await res.json();
  return {
    online: !!d.online,
    version: d.version || null,
    players: d.players ? `${d.players.online}/${d.players.max}` : null,
    ip: d.ip || null,
    port: d.port || null,
  };
}
