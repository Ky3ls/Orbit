import { ORIGIN } from './config.js';

export const DISCORD_REDIRECT = `${ORIGIN}/api/auth/discord/callback`;

export function discordAuthorizeUrl({ clientId, state }) {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function exchangeDiscordCode({ clientId, clientSecret, code }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: DISCORD_REDIRECT,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('discord-token');
  const data = await res.json();
  if (!data.access_token) throw new Error('discord-token');
  return data.access_token;
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('discord-profile');
  const user = await res.json();
  if (!user?.id) throw new Error('discord-profile');
  const tag = user.global_name || user.username || 'discord';
  return {
    id: String(user.id).slice(0, 32),
    username: String(tag).slice(0, 48),
  };
}
