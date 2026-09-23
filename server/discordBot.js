import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { ORIGIN } from './config.js';

/** @type {Client | null} */
let client = null;

function deps() {
  return globalThis.__orbitDiscordDeps || null;
}

export function setDiscordBotDeps(d) {
  globalThis.__orbitDiscordDeps = d;
}

async function statusMessage() {
  const d = deps();
  if (!d) return 'Orbit nicht bereit.';
  const settings = d.settingMap();
  const runtime = d.getRuntime();
  const port = Number(settings.fivemPort) || 30120;
  const probe = await d.probeFiveM(settings.fivemHost || '127.0.0.1', port);
  return [
    `**${settings.hostname || 'Server'}**`,
    probe.online ? '🟢 Online' : '🔴 Offline',
    `Spieler: ${probe.clients}/${runtime.maxClients || settings.maxClients || '?'}`,
    ORIGIN,
  ].join('\n');
}

export async function stopDiscordBot() {
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
  ].map((c) => c.toJSON());

  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on('interactionCreate', async (ix) => {
    if (!ix.isChatInputCommand()) return;
    try {
      if (ix.commandName === 'orbit-status') {
        await ix.reply({ content: await statusMessage(), ephemeral: true });
      } else if (ix.commandName === 'orbit-players') {
        const d = deps();
        const s = d?.settingMap() || {};
        const probe = await d.probeFiveM(s.fivemHost || '127.0.0.1', Number(s.fivemPort) || 30120);
        await ix.reply({
          content: probe.online ? `${probe.clients} Spieler online` : 'Offline',
          ephemeral: true,
        });
      }
    } catch (e) {
      await ix.reply({ content: e.message, ephemeral: true }).catch(() => {});
    }
  });

  await client.login(token);
  await new Promise((r) => {
    if (client?.isReady()) r();
    else client?.once('ready', r);
  });
  const appId = client.application?.id || (await client.application.fetch()).id;
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  console.log('[discord] Slash-Commands registriert.');
  return { ok: true };
}
