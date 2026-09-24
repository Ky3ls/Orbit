/**
 * Erweiterte Orbit-Settings (txAdmin-Capabilities, Orbit-Keys).
 */

import { panelLangFromSettings, tServer } from './i18n.js';

export const ALLOWLIST_MODES = [
  { value: 'disabled', label: 'Deaktiviert (öffentlich)' },
  { value: 'admin_only', label: 'Nur Admins (Wartung)' },
  { value: 'discord_member', label: 'Discord-Server-Mitglied' },
  { value: 'discord_roles', label: 'Discord-Rollen' },
  { value: 'approved_license', label: 'Freigeschaltete License' },
  { value: 'external', label: 'Externe Allowlist-Resource' },
];

export const DEFAULT_STATUS_EMBED = JSON.stringify({
  title: '{{serverName}}',
  description: 'Status via Orbit',
  fields: [
    { name: '> CONNECT', value: '`connect {{serverJoinUrl}}`', inline: true },
    { name: '> NEXT RESTART', value: '{{nextScheduledRestart}}', inline: true },
    { name: '> UPTIME', value: '{{uptime}}', inline: true },
  ],
}, null, 2);

export const DEFAULT_STATUS_CONFIG = JSON.stringify({
  onlineString: '🟢 Online',
  partialString: '🟡 Partial',
  offlineString: '🔴 Offline',
  onlineColor: '#0BA70B',
  partialColor: '#FFFF00',
  offlineColor: '#A70B28',
  buttons: [
    { label: 'Panel', url: '{{panelUrl}}' },
  ],
}, null, 2);

const BOOL01 = (v, fallback = false) => {
  if (v === true || v === '1' || v === 1) return true;
  if (v === false || v === '0' || v === 0) return false;
  return fallback;
};

export function resolveAllowlistMode(settings) {
  const mode = String(settings.allowlistMode || '').trim();
  if (ALLOWLIST_MODES.some((m) => m.value === mode)) return mode;
  // Legacy: allowlistEnabled / whitelistEnabled
  if (settings.allowlistEnabled === '1' || settings.whitelistEnabled === '1') return 'approved_license';
  return 'disabled';
}

/** Öffentliche Settings-Payload für Panel GET */
export function publicSettingsPayload(settings, { isOwner = false } = {}) {
  const allowlistMode = resolveAllowlistMode(settings);
  return {
    // General
    serverName: String(settings.serverName || settings.serverLabel || settings.orbitServerName || '').slice(0, 18),
    language: settings.language || settings.locale || 'de-DE',
    hostname: settings.hostname || '',
    project: settings.project || '',
    maxClients: settings.maxClients || '48',
    tags: settings.tags || '',
    locale: settings.locale || 'de-DE',
    gameBuild: settings.gameBuild || '',
    fivemHost: settings.fivemHost || '127.0.0.1',
    fivemPort: settings.fivemPort || '30120',
    controlEnabled: settings.controlEnabled !== '0',

    // FXServer
    onesync: settings.onesync === 'off' || settings.onesync === 'legacy' ? settings.onesync : 'on',
    quietMode: BOOL01(settings.quietMode, false),
    fxCfgPath: settings.fxCfgPath || 'server.cfg',
    resourceStartingTolerance: settings.resourceStartingTolerance || '90',
    fxAutostart: settings.fxAutostart !== '0',
    autoRestartEnabled: settings.autoRestartEnabled !== '0',
    fxControlMode: settings.fxControlMode === 'orbit' ? 'orbit' : 'systemd',
    fxServerRoot: isOwner ? (settings.fxServerRoot || '') : '',
    fxDataPath: isOwner ? (settings.fxDataPath || '') : '',
    fxServerExtraArgs: isOwner ? (settings.fxServerExtraArgs || '') : '',

    // Bans
    banChecking: settings.banChecking !== '0',
    banRejectionMessage: settings.banRejectionMessage || tServer(settings, 'ban.defaultReject'),
    requiredHwidMatches: String(settings.requiredHwidMatches ?? '1'),

    // Allowlist
    allowlistMode,
    allowlistEnabled: allowlistMode !== 'disabled' && allowlistMode !== 'external',
    allowlistInstructions: settings.allowlistInstructions
      || tServer(settings, 'allowlist.defaultInstructions'),
    allowlistDiscordRoles: settings.allowlistDiscordRoles || '',

    // Discord
    discordEnabled: BOOL01(settings.discordEnabled, false),
    discordNotifyDrops: BOOL01(settings.discordNotifyDrops, false),
    discordBotEnabled: BOOL01(settings.discordBotEnabled, false),
    discordBotConfigured: Boolean(settings.discordBotToken),
    discordWebhook: isOwner ? (settings.discordWebhook || '') : '',
    discordGuild: settings.discordGuild || '',
    discordWarningsChannel: settings.discordWarningsChannel || '',
    discordStatusChannelId: settings.discordStatusChannelId || '',
    discordStatusMessageId: settings.discordStatusMessageId || '',
    discordStatusEmbedJson: settings.discordStatusEmbedJson || DEFAULT_STATUS_EMBED,
    discordStatusConfigJson: settings.discordStatusConfigJson || DEFAULT_STATUS_CONFIG,

    // Game / Menu
    gameMenuEnabled: settings.gameMenuEnabled !== '0',
    gameMenuAlignRight: BOOL01(settings.gameMenuAlignRight, false),
    gameMenuPageKey: settings.gameMenuPageKey || 'Tab',
    hideAdminInPunishments: settings.hideAdminInPunishments !== '0',
    hideAdminInMessages: BOOL01(settings.hideAdminInMessages, false),
    hideAnnouncementNotif: BOOL01(settings.hideAnnouncementNotif, false),
    hideDmNotif: BOOL01(settings.hideDmNotif, false),
    hideWarnNotif: BOOL01(settings.hideWarnNotif, false),
    hideRestartWarnNotif: BOOL01(settings.hideRestartWarnNotif, false),

    // Meta / Orbit
    ipAllowlist: isOwner ? (settings.ipAllowlist || '') : '',
    rconConfigured: Boolean(settings.rconPassword),
    // 0 / leer = optional (Laufzeit nutzt dann fivemPort)
    rconPort: (() => {
      const n = Number(settings.rconPort);
      return Number.isInteger(n) && n >= 1 && n <= 65535 ? String(n) : '';
    })(),
    orbitServerName: settings.orbitServerName || '',
    orbitServerSlug: settings.orbitServerSlug || '',
    serverLabel: settings.serverLabel || settings.hostname || '',
    orbitServersRoot: isOwner ? (settings.orbitServersRoot || '') : '',
    consoleTargetServerId: isOwner ? (settings.consoleTargetServerId || '') : '',
  };
}

/** Settings die das Ingame-Menü braucht */
export function gameSettingsForBridge(settings) {
  return {
    menuEnabled: settings.gameMenuEnabled !== '0',
    alignRight: BOOL01(settings.gameMenuAlignRight, false),
    pageKey: settings.gameMenuPageKey || 'Tab',
    hideAdminInPunishments: settings.hideAdminInPunishments !== '0',
    hideAdminInMessages: BOOL01(settings.hideAdminInMessages, false),
    hideAnnouncementNotif: BOOL01(settings.hideAnnouncementNotif, false),
    hideDmNotif: BOOL01(settings.hideDmNotif, false),
    hideWarnNotif: BOOL01(settings.hideWarnNotif, false),
    hideRestartWarnNotif: BOOL01(settings.hideRestartWarnNotif, false),
    language: panelLangFromSettings(settings),
  };
}
