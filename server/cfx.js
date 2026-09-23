import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ORIGIN } from './config.js';

const KEY_PATH = path.join(DATA_DIR, 'cfx-private.pem');
export const CFX_REDIRECT = `${ORIGIN}/api/auth/cfx/callback`;

export function ensureCfxKeys() {
  if (!fs.existsSync(KEY_PATH)) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });
  }
  const privateKey = fs.readFileSync(KEY_PATH, 'utf8');
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  return { privateKey, publicKey };
}

export function cfxAuthorizeUrl({ clientId, nonce, publicKey }) {
  const url = new URL('https://forum.cfx.re/user-api-key/new');
  url.searchParams.set('scopes', 'session_info');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('auth_redirect', CFX_REDIRECT);
  url.searchParams.set('application_name', 'Orbit');
  url.searchParams.set('public_key', publicKey);
  url.searchParams.set('padding', 'pkcs1');
  return url.toString();
}

export function decryptPayload(privateKey, payload) {
  const clean = String(payload || '').replace(/\s/g, '');
  if (clean.length < 32 || clean.length > 8000) throw new Error('payload');
  const buf = Buffer.from(clean, 'base64');
  const decrypted = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    buf,
  );
  const data = JSON.parse(decrypted.toString('utf8'));
  if (!data || typeof data.key !== 'string' || typeof data.nonce !== 'string') throw new Error('payload');
  return data;
}

export async function fetchCfxUser(apiKey) {
  const res = await fetch('https://forum.cfx.re/session/current.json', {
    headers: {
      'User-Api-Key': apiKey,
      'User-Agent': 'TX2 (tx2.ky3ls.space)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error('cfx-profile');
  const body = await res.json();
  const user = body?.current_user;
  if (!user?.id) throw new Error('cfx-profile');
  return {
    id: String(user.id).slice(0, 24),
    username: String(user.username || user.name || 'cfx').slice(0, 48),
  };
}
