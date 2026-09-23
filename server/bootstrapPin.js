import crypto from 'node:crypto';
import { DATA_DIR, ORIGIN, PORT } from './config.js';
import { detectPublicIpv4 } from './panelAccess.js';
import { sha256 } from './auth.js';

const PIN_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 30 * 60 * 1000;

/** @type {{ pin: string, hash: string, expires: number } | null} */
let livePin = null;

export function hasUsers(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
}

export function ensureBootstrapPin(db) {
  if (hasUsers(db)) {
    livePin = null;
    return null;
  }
  const now = Date.now();
  if (livePin && livePin.expires > now) return livePin;
  const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  livePin = {
    pin,
    hash: sha256(pin),
    expires: now + PIN_TTL_MS,
  };
  return livePin;
}

export function peekBootstrapPin() {
  return livePin;
}

export function verifyBootstrapPin(pin) {
  if (!livePin || livePin.expires < Date.now()) return false;
  const given = String(pin || '').replace(/\D/g, '').slice(0, 4);
  if (given.length !== 4) return false;
  const a = Buffer.from(sha256(given));
  const b = Buffer.from(livePin.hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function clearBootstrapPin() {
  livePin = null;
}

export function storePendingCfxClaim(db, profile) {
  const token = crypto.randomBytes(32).toString('base64url');
  const payload = JSON.stringify({
    tokenHash: sha256(token),
    cfxId: String(profile.id),
    cfxName: String(profile.username || 'cfx').slice(0, 48),
    expires: Date.now() + CLAIM_TTL_MS,
  });
  db.prepare(`INSERT INTO settings (k, v) VALUES ('pendingCfxClaim', ?)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(payload);
  return token;
}

export function readPendingCfxClaim(db, token) {
  const raw = db.prepare('SELECT v FROM settings WHERE k = ?').get('pendingCfxClaim')?.v;
  if (!raw || !token) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data?.tokenHash || data.expires < Date.now()) return null;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(data.tokenHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { cfxId: data.cfxId, cfxName: data.cfxName };
}

export function clearPendingCfxClaim(db) {
  db.prepare('DELETE FROM settings WHERE k = ?').run('pendingCfxClaim');
}

export async function printBootstrapBanner(db) {
  if (hasUsers(db)) return;
  const pinState = ensureBootstrapPin(db);
  if (!pinState) return;
  let host = '127.0.0.1';
  try {
    host = await detectPublicIpv4();
  } catch { /* */ }
  const envUrl = String(process.env.ORBIT_PUBLIC_URL || '').replace(/\/$/, '');
  const panelUrl = envUrl || (ORIGIN.includes('127.0.0.1')
    ? `http://${host}:${PORT}`
    : ORIGIN);
  const link = `${panelUrl}/install?pin=${pinState.pin}`;
  const line = '='.repeat(52);
  console.log(`\n${line}`);
  console.log('  Orbit · Ersteinrichtung');
  console.log(line);
  console.log(`  PIN:     ${pinState.pin}`);
  console.log(`  Panel:   ${panelUrl}`);
  console.log(`  Link:    ${link}`);
  console.log('  → PIN im Browser eingeben → Cfx.re verknüpfen');
  console.log(`${line}\n`);
}
