import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { COOKIE, COOKIE_SECURE, IDLE_MS, SESSION_MS, TICKET_COOKIE } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function clientIp(req) {
  const raw = req.socket.remoteAddress || '';
  const local = raw === '127.0.0.1' || raw === '::1' || raw === '::ffff:127.0.0.1';
  if (local) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.length > 0 && real.length < 64) return real.trim();
  }
  return raw.replace(/^::ffff:/, '');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(hash).toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64url');
    expected = Buffer.from(hashB64, 'base64url');
  } catch {
    return false;
  }
  const actual = Buffer.from(await scrypt(password, salt, expected.length, SCRYPT));
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function passwordOk(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 6 || password.length > 128) return false;
  return true;
}

export function userOk(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9._-]{3,24}$/.test(username);
}

const PERMS = {
  owner: ['*'],
  admin: ['overview', 'monitor', 'console', 'control', 'players', 'history', 'bans', 'whitelist', 'resources', 'schedule', 'audit', 'settings', 'sessions', 'cfg', 'database'],
  moderator: ['overview', 'monitor', 'players', 'history', 'bans', 'whitelist'],
};

export function hasPerm(user, perm) {
  if (!user || user.disabled) return false;
  const list = PERMS[user.role] || [];
  return list.includes('*') || list.includes(perm);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function cookieHeader(name, value, maxAgeSec, sameSite = 'Strict') {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', `SameSite=${sameSite}`, 'Path=/'];
  if (COOKIE_SECURE) parts.push('Secure');
  if (maxAgeSec === 0) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${maxAgeSec}`);
  return parts.join('; ');
}

export function clearCookie(name) {
  return cookieHeader(name, '', 0);
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

export function publicUser(row) {
  let prefs = null;
  if (row.prefs != null && row.prefs !== '') {
    try {
      prefs = typeof row.prefs === 'string' ? JSON.parse(row.prefs) : row.prefs;
    } catch {
      prefs = null;
    }
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    totp: !!row.totp_enabled,
    mustChange: !!row.must_change,
    cfxName: row.cfx_name || '',
    prefs,
  };
}

export function loadSession(db, req) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length < 20) return null;
  const row = db.prepare(`
    SELECT s.id AS sid, s.created, s.last_seen, s.expires, s.ip, s.ua,
           u.id, u.username, u.role, u.disabled, u.totp_enabled, u.must_change, u.cfx_id, u.cfx_name, u.prefs
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked = 0
  `).get(sha256(token));
  if (!row) return null;
  const now = Date.now();
  if (row.expires < now || now - row.last_seen > IDLE_MS || row.disabled) return null;
  if (now - row.last_seen > 60_000) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, row.sid);
  }
  return row;
}

export function createSession(db, user, req) {
  const token = randomToken();
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, created, last_seen, expires, ip, ua, revoked)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(user.id, sha256(token), now, now, now + SESSION_MS, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 180));
  return token;
}

export { COOKIE, TICKET_COOKIE, SESSION_MS };

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secretB32, token) {
  const secret = base32Decode(secretB32);
  if (!secret || secret.length < 10) return false;
  const code = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 30_000);
  const given = Buffer.from(code);
  for (let w = -1; w <= 1; w++) {
    const expect = Buffer.from(hotp(secret, counter + w));
    if (crypto.timingSafeEqual(given, expect)) return true;
  }
  return false;
}

export function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
