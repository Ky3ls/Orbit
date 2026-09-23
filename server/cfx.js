import { ORIGIN } from './config.js';

/** Offizieller Cfx/FiveM Identity Provider — wie txAdmin (nicht Discourse User-API-Keys). */
const IDMS = {
  authorize: 'https://idms.fivem.net/connect/authorize',
  token: 'https://idms.fivem.net/connect/token',
  userinfo: 'https://idms.fivem.net/connect/userinfo',
  // Öffentlicher Client, den auch txAdmin nutzt
  clientId: 'txadmin_test',
  clientSecret: 'txadmin_test',
};

export const CFX_REDIRECT = `${ORIGIN}/api/auth/cfx/callback`;

export function cfxAuthorizeUrl({ redirectUri, state }) {
  const url = new URL(IDMS.authorize);
  url.searchParams.set('client_id', IDMS.clientId);
  url.searchParams.set('redirect_uri', redirectUri || CFX_REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid identify');
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * nameid z. B. https://forum.cfx.re/internal/user/271816 → fivem:271816
 */
export function fivemIdFromNameid(nameid) {
  const m = /\/user\/(\d{1,12})/.exec(String(nameid || ''));
  return m ? `fivem:${m[1]}` : null;
}

export async function exchangeCfxCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: redirectUri || CFX_REDIRECT,
    client_id: IDMS.clientId,
    client_secret: IDMS.clientSecret,
  });
  const res = await fetch(IDMS.token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'Orbit Panel',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`cfx-token: ${detail}`);
  }
  return data;
}

export async function fetchCfxUserInfo(accessToken) {
  const res = await fetch(IDMS.userinfo, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'Orbit Panel',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error('cfx-userinfo');
  const user = await res.json();
  const fivem = fivemIdFromNameid(user.nameid);
  if (!fivem) throw new Error('cfx-nameid');
  const id = fivem.slice('fivem:'.length);
  return {
    id,
    fivem,
    username: String(user.name || user.preferred_username || `cfx${id}`).slice(0, 48),
    picture: typeof user.picture === 'string' && user.picture.startsWith('https://')
      ? user.picture
      : '',
    profile: typeof user.profile === 'string' ? user.profile : '',
  };
}

/** @deprecated RSA/Discourse-Flow — nur noch Stub für alte Imports */
export function ensureCfxKeys() {
  return { privateKey: '', publicKey: '' };
}

export function decryptPayload() {
  throw new Error('Discourse User-API-Keys werden nicht mehr genutzt. Bitte Orbit aktualisieren.');
}

export async function fetchCfxUser() {
  throw new Error('fetchCfxUser entfällt — nutze fetchCfxUserInfo.');
}
