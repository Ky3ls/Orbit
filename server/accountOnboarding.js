/** Erstlogin: Passwort ändern, danach Cfx.re + Discord verknüpfen (Team, nicht Inhaber). */

export function discordOAuthReady(settings) {
  return Boolean(settings.discordOAuthClientId && settings.discordOAuthClientSecret);
}

export function needsAccountLinks(user, settings) {
  if (!user || user.role === 'owner' || user.disabled) return false;
  if (user.must_change) return false;
  const needCfx = !user.cfx_id;
  const needDiscord = discordOAuthReady(settings) && !user.discord_id;
  return needCfx || needDiscord;
}

export function onboardingActive(user, settings) {
  return !!user?.must_change || needsAccountLinks(user, settings);
}

const ALLOW = new Set([
  'GET /api/auth/me',
  'GET /api/auth/linking',
  'POST /api/auth/password',
  'POST /api/auth/logout',
  'POST /api/auth/cfx/unlink',
  'POST /api/auth/discord/unlink',
]);

export function onboardingApiAllowed(method, pathname) {
  return ALLOW.has(`${method} ${pathname}`);
}
