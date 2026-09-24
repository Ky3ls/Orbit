/**
 * Orbit Discord-Bot — Slash-Commands, Allowlist-Checks, Status-Embed, Warn-Kanal.
 */
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { ORIGIN } from './config.js';
import { DEFAULT_STATUS_CONFIG, DEFAULT_STATUS_EMBED } from './settingsSchema.js';

/** @type {Client | null} */
let client = null;
/** @type {ReturnType<typeof setInterval> | null} */
let statusTimer = null;
/** @type {string} */
let lastStatusFingerprint = '';

function deps() {
  return globalThis.__orbitDiscordDeps || null;
}

export function setDiscordBotDeps(d) {
  globalThis.__orbitDiscordDeps = d;
}

export function getDiscordClient() {
  return client;
}

function fmtUptime(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fillPlaceholders(text, map) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (
    map[key] !== undefined && map[key] !== null ? String(map[key]) : `{{${key}}}`
  ));
}

function parseJsonSafe(raw, fallback) {
  try {
    const v = JSON.parse(raw || '');
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

async function buildPlaceholderMap(settings) {
  const d = deps();
  const runtime = d?.getRuntime?.() || {};
  const port = Number(settings.fivemPort) || 30120;
  let probe = { online: false, clients: 0 };
  try {
    probe = await d.probeFiveM(settings.fivemHost || '127.0.0.1', port);
  } catch { /* */ }
  const max = Number(runtime.maxClients || settings.maxClients) || 48;
  const clients = Number(probe.clients ?? runtime.clients) || 0;
  const online = !!probe.online;
  const partial = online && clients > 0 && clients >= max * 0.9;
  const next = d?.nextRestartInfo?.() || { text: 'Kein Neustart geplant' };
  const uptimeMs = online && runtime.onlineSince ? Date.now() - runtime.onlineSince : 0;
  const joinHost = settings.fivemHost === '127.0.0.1'
    ? (process.env.ORBIT_PUBLIC_URL || ORIGIN || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    : settings.fivemHost;
  const joinUrl = joinHost && joinHost !== '127.0.0.1'
    ? `${joinHost}:${port}`
    : `127.0.0.1:${port}`;
  const cfg = parseJsonSafe(settings.discordStatusConfigJson, parseJsonSafe(DEFAULT_STATUS_CONFIG, {}));
  const statusString = !online
    ? (cfg.offlineString || '🔴 Offline')
    : partial
      ? (cfg.partialString || '🟡 Teilweise')
      : (cfg.onlineString || '🟢 Online');
  const statusColor = !online
    ? (cfg.offlineColor || '#A70B28')
    : partial
      ? (cfg.partialColor || '#FFFF00')
      : (cfg.onlineColor || '#0BA70B');
  return {
    serverName: settings.serverName || settings.serverLabel || settings.hostname || 'Server',
    statusString,
    statusColor,
    online,
    partial,
    serverClients: clients,
    serverMaxClients: max,
    uptime: fmtUptime(uptimeMs),
    nextScheduledRestart: next.text || '—',
    serverJoinUrl: joinUrl,
    panelUrl: ORIGIN,
    connectCommand: `connect ${joinUrl}`,
  };
}

function colorToInt(hex) {
  const h = String(hex || '#ff7a1a').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return Number.isFinite(n) ? n : 0xff7a1a;
}

function buildStatusPayload(settings, map) {
  const embedRaw = parseJsonSafe(settings.discordStatusEmbedJson, parseJsonSafe(DEFAULT_STATUS_EMBED, {}));
  const cfg = parseJsonSafe(settings.discordStatusConfigJson, parseJsonSafe(DEFAULT_STATUS_CONFIG, {}));
  const deepFill = (val) => {
    if (typeof val === 'string') return fillPlaceholders(val, map);
    if (Array.isArray(val)) return val.map(deepFill);
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = deepFill(v);
      return out;
    }
    return val;
  };
  const filled = deepFill(embedRaw);
  const embed = new EmbedBuilder()
    .setColor(colorToInt(map.statusColor || filled.color));
  if (filled.title) embed.setTitle(String(filled.title).slice(0, 256));
  if (filled.description) embed.setDescription(String(filled.description).slice(0, 4000));
  if (Array.isArray(filled.fields)) {
    embed.setFields(filled.fields.slice(0, 25).map((f) => ({
      name: String(f.name || '—').slice(0, 256),
      value: String(f.value || '—').slice(0, 1024),
      inline: !!f.inline,
    })));
  }
  if (filled.thumbnail?.url) embed.setThumbnail(String(filled.thumbnail.url));
  if (filled.image?.url) embed.setImage(String(filled.image.url));
  embed.setFooter({ text: `${map.statusString} · Orbit` });
  embed.setTimestamp(new Date());

  const row = new ActionRowBuilder();
  const buttons = Array.isArray(cfg.buttons) ? cfg.buttons.slice(0, 5) : [];
  for (const b of buttons) {
    let href = fillPlaceholders(b.url || '{{panelUrl}}', map);
    if (!href || href.includes('{{')) href = String(map.panelUrl || ORIGIN || '');
    // Discord Link-Buttons brauchen https://
    if (/^http:\/\//i.test(href)) href = href.replace(/^http:/i, 'https:');
    if (!/^https:\/\//i.test(href)) {
      href = String(ORIGIN || 'https://discord.com').replace(/\/$/, '');
      if (!/^https:\/\//i.test(href)) href = `https://${href.replace(/^\/\//, '')}`;
    }
    try {
      row.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(String(b.label || 'Connect').slice(0, 80))
          .setURL(href.slice(0, 512)),
      );
    } catch { /* ungültige URL überspringen */ }
  }
  const components = row.components.length ? [row] : [];
  return { embeds: [embed], components };
}

async function statusMessage() {
  const d = deps();
  if (!d) return 'Orbit nicht bereit.';
  const settings = d.settingMap();
  const map = await buildPlaceholderMap(settings);
  return [
    `**${map.serverName}**`,
    map.statusString,
    `Spieler: ${map.serverClients}/${map.serverMaxClients}`,
    `Uptime: ${map.uptime}`,
    `Neustart: ${map.nextScheduledRestart}`,
    ORIGIN,
  ].join('\n');
}

/**
 * Guild-Mitglied / Rollen prüfen (Server Members Intent nötig).
 * @returns {Promise<{ ok: boolean, member: boolean, roles: string[], reason?: string }>}
 */
export async function checkDiscordGuildAccess(discordUserId, {
  requireMember = true,
  requiredRoleIds = [],
} = {}) {
  const id = String(discordUserId || '').replace(/^discord:/, '').replace(/\D/g, '');
  if (!id) return { ok: false, member: false, roles: [], reason: 'Keine Discord-ID' };
  if (!client?.isReady()) {
    return { ok: false, member: false, roles: [], reason: 'Discord-Bot offline' };
  }
  const d = deps();
  const settings = d?.settingMap?.() || {};
  const guildId = String(settings.discordGuild || '').trim();
  if (!guildId) return { ok: false, member: false, roles: [], reason: 'Guild-ID fehlt' };

  try {
    const guild = await client.guilds.fetch(guildId);
    let member;
    try {
      member = await guild.members.fetch(id);
    } catch {
      return { ok: false, member: false, roles: [], reason: 'Kein Discord-Server-Mitglied' };
    }
    const roles = [...member.roles.cache.keys()].filter((r) => r !== guild.id);
    if (requireMember && requiredRoleIds.length === 0) {
      return { ok: true, member: true, roles };
    }
    if (requiredRoleIds.length) {
      const want = new Set(requiredRoleIds.map(String));
      const hit = roles.some((r) => want.has(r));
      if (!hit) {
        return { ok: false, member: true, roles, reason: 'Erforderliche Discord-Rolle fehlt' };
      }
    }
    return { ok: true, member: true, roles };
  } catch (err) {
    return { ok: false, member: false, roles: [], reason: err.message || 'Discord-Prüfung fehlgeschlagen' };
  }
}

/** Ankündigung in den Warnings-Kanal (Restarts etc.). */
export async function sendDiscordWarning(settings, text) {
  if (!client?.isReady()) return { skipped: true, reason: 'bot offline' };
  const channelId = String(settings.discordWarningsChannel || '').trim();
  if (!channelId) return { skipped: true, reason: 'kein Kanal' };
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased?.()) return { skipped: true, reason: 'Kanal ungültig' };
    await ch.send({ content: String(text || '').slice(0, 1900) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function pushStatusEmbed(force = false) {
  if (!client?.isReady()) return;
  const d = deps();
  if (!d) return;
  const settings = d.settingMap();
  const channelId = String(settings.discordStatusChannelId || settings.discordWarningsChannel || '').trim();
  const messageId = String(settings.discordStatusMessageId || '').trim();
  if (!channelId || !messageId) return;

  const map = await buildPlaceholderMap(settings);
  const fp = `${map.statusString}|${map.serverClients}|${map.serverMaxClients}|${map.uptime}|${map.nextScheduledRestart}`;
  if (!force && fp === lastStatusFingerprint) return;
  lastStatusFingerprint = fp;

  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased?.()) return;
    const msg = await ch.messages.fetch(messageId);
    const payload = buildStatusPayload(settings, map);
    await msg.edit(payload);
  } catch (err) {
    // Message gelöscht / Rechte — still weiterversuchen
    if (String(err.message || '').includes('Unknown Message')) {
      d.setSetting?.('discordStatusMessageId', '');
    }
  }
}

function startStatusLoop() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(() => {
    pushStatusEmbed(false).catch(() => {});
  }, 60_000);
  pushStatusEmbed(true).catch(() => {});
}

export async function stopDiscordBot() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  lastStatusFingerprint = '';
  if (!client) return;
  await client.destroy().catch(() => {});
  client = null;
}

export async function refreshDiscordBot(settings) {
  await stopDiscordBot();
  if (settings.discordBotEnabled !== '1') return { skipped: true };
  const token = String(settings.discordBotToken || '').trim();
  const guildId = String(settings.discordGuild || '').trim();
  if (!token || !guildId) return { skipped: true, reason: 'Bot-Token oder Guild-ID fehlt' };

  const commands = [
    new SlashCommandBuilder().setName('orbit-status').setDescription('Server-Status aus Orbit'),
    new SlashCommandBuilder().setName('orbit-players').setDescription('Aktuelle Spielerzahl'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Orbit Status-Embed')
      .addSubcommand((sc) => sc.setName('add').setDescription('Status-Embed in diesem Kanal posten und live halten'))
      .addSubcommand((sc) => sc.setName('refresh').setDescription('Status-Embed jetzt aktualisieren')),
  ].map((c) => c.toJSON());

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.GuildMember],
  });

  client.on('interactionCreate', async (ix) => {
    if (!ix.isChatInputCommand()) return;
    const d = deps();
    try {
      if (ix.commandName === 'orbit-status') {
        await ix.reply({ content: await statusMessage(), ephemeral: true });
      } else if (ix.commandName === 'orbit-players') {
        const s = d?.settingMap() || {};
        const probe = await d.probeFiveM(s.fivemHost || '127.0.0.1', Number(s.fivemPort) || 30120);
        await ix.reply({
          content: probe.online ? `${probe.clients} Spieler online` : 'Offline',
          ephemeral: true,
        });
      } else if (ix.commandName === 'status') {
        const sub = ix.options.getSubcommand();
        if (sub === 'add') {
          await ix.deferReply({ ephemeral: true });
          const s = d.settingMap();
          const map = await buildPlaceholderMap(s);
          const payload = buildStatusPayload(s, map);
          const posted = await ix.channel.send(payload);
          d.setSetting?.('discordStatusChannelId', ix.channelId);
          d.setSetting?.('discordStatusMessageId', posted.id);
          lastStatusFingerprint = '';
          startStatusLoop();
          await ix.editReply({ content: `Status-Embed gespeichert (Msg \`${posted.id}\`). Aktualisiert sich automatisch.` });
        } else if (sub === 'refresh') {
          await ix.deferReply({ ephemeral: true });
          await pushStatusEmbed(true);
          await ix.editReply({ content: 'Status-Embed aktualisiert.' });
        }
      }
    } catch (e) {
      const msg = e.message || 'Fehler';
      if (ix.deferred || ix.replied) await ix.editReply({ content: msg }).catch(() => {});
      else await ix.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  });

  client.on('error', () => {});

  await client.login(token);
  await new Promise((r) => {
    if (client?.isReady()) r();
    else client?.once('ready', r);
  });

  // Prefetch guild members für schnellere Allowlist (optional, kann bei großen Guilds dauern)
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.members.fetch().catch(() => {});
  } catch { /* Intent/Rechte */ }

  const appId = client.application?.id || (await client.application.fetch()).id;
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  console.log('[discord] Slash-Commands + Members-Intent bereit.');

  if (settings.discordStatusMessageId && (settings.discordStatusChannelId || settings.discordWarningsChannel)) {
    startStatusLoop();
  }
  return { ok: true };
}

export async function forceStatusRefresh() {
  return pushStatusEmbed(true);
}
