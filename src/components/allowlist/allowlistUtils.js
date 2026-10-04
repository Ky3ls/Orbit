/**
 * Allowlist-Modi (Settings-Key `allowlistMode`).
 *
 * Live-Pfad beim Connect:
 *   resources/orbit_bridge → POST /api/ingame/check-join
 *   → server/ingameApi.js + server/moderation.js (checkPlayerJoin)
 *
 * Was greift je Modus:
 *   disabled / external     — kein Allowlist-Block (external = fremde Resource)
 *   admin_only              — nur Panel-Admins (Identifier in Team)
 *   approved_license        — SQLite-Tabelle `whitelist` (Identifier-Allowlist)
 *   discord_member          — Discord-Bot + Guild-Mitgliedschaft
 *   discord_roles           — wie Member, plus Rollen-Schnittmenge mit
 *                             Setting `allowlistDiscordRoles` (CSV von Snowflake-IDs)
 *
 * Discord braucht: Bot-Token, Guild-ID, Intent „Server Members“.
 */

export const ALLOWLIST_MODE_VALUES = [
  'disabled',
  'admin_only',
  'approved_license',
  'discord_member',
  'discord_roles',
  'external',
];

export const ALLOWLIST_MODE_KEYS = {
  disabled: 'settings.allowlist.mode.disabled',
  admin_only: 'settings.allowlist.mode.admin_only',
  discord_member: 'settings.allowlist.mode.discord_member',
  discord_roles: 'settings.allowlist.mode.discord_roles',
  approved_license: 'settings.allowlist.mode.approved_license',
  external: 'settings.allowlist.mode.external',
};

export const ALLOWLIST_MODE_HINT_KEYS = {
  disabled: 'settings.allowlist.modeHint.disabled',
  admin_only: 'settings.allowlist.modeHint.admin_only',
  discord_member: 'settings.allowlist.modeHint.discord_member',
  discord_roles: 'settings.allowlist.modeHint.discord_roles',
  approved_license: 'settings.allowlist.modeHint.approved_license',
  external: 'settings.allowlist.modeHint.external',
};

/**
 * CSV / Whitespace → Ziffern-IDs.
 * @param {string} raw
 * @param {{ strict?: boolean }} [opts] strict=true → nur Snowflake (≥16 Ziffern)
 */
export function parseDiscordRoleIds(raw, { strict = false } = {}) {
  return String(raw || '')
    .split(/[,\s;]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => (strict ? s.length >= 16 : s.length > 0));
}

/**
 * Zeilen-Array → CSV für Setting `allowlistDiscordRoles`.
 * Beim Tippen strict=false, damit unvollständige IDs nicht verschwinden.
 */
export function serializeDiscordRoleIds(ids, { strict = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    const clean = String(id || '').replace(/\D/g, '');
    if (!clean || seen.has(clean)) continue;
    if (strict && clean.length < 16) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.join(', ');
}

export function rolesNeedPanel(mode) {
  return mode === 'discord_roles';
}

export function instructionsDisabled(mode) {
  return mode === 'disabled' || mode === 'admin_only';
}
