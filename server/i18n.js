/**
 * Server-seitige Kurztexte (Discord-Bot, Defaults).
 * Panel-UI nutzt src/i18n — hier nur Backend-Strings.
 */

const de = {
  'discord.playersOnline': '{n} Spieler online',
  'discord.offline': 'Offline',
  'discord.scheduledRestart': '⏰ Geplanter Neustart: **{label}** ({time})',
  'ban.defaultReject': 'Du kannst http://discord.gg/example joinieren, um gegen diesen Ban Einspruch einzulegen.',
  'allowlist.defaultInstructions': 'Bitte trete http://discord.gg/example bei und beantrage die Allowlist.',
  'status.online': '🟢 Online',
  'status.partial': '🟡 Teilweise',
  'status.offline': '🔴 Offline',
};

const en = {
  'discord.playersOnline': '{n} players online',
  'discord.offline': 'Offline',
  'discord.scheduledRestart': '⏰ Scheduled restart: **{label}** ({time})',
  'ban.defaultReject': 'You can join http://discord.gg/example to appeal this ban.',
  'allowlist.defaultInstructions': 'Please join http://discord.gg/example and request allowlist access.',
  'status.online': '🟢 Online',
  'status.partial': '🟡 Partial',
  'status.offline': '🔴 Offline',
};

const catalogs = { de, en };

export function normalizeServerLang(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v || v === 'custom') return 'en';
  if (v.startsWith('de')) return 'de';
  return 'en'; // fr/es/pt/nl → EN für Bot-Strings (Panel hat eigene Kataloge)
}

export function tServer(settingsOrLang, key, vars = {}) {
  const raw = typeof settingsOrLang === 'string'
    ? settingsOrLang
    : (settingsOrLang?.language || settingsOrLang?.locale || 'de');
  const lang = normalizeServerLang(raw);
  let text = catalogs[lang]?.[key] || catalogs.en[key] || catalogs.de[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function panelLangFromSettings(settings) {
  const raw = String(settings?.language || settings?.locale || 'de-DE');
  const lower = raw.toLowerCase();
  if (lower.startsWith('de')) return 'de';
  if (lower.startsWith('fr')) return 'fr';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('pt')) return 'pt';
  if (lower.startsWith('nl')) return 'nl';
  if (lower === 'custom') return 'en';
  return 'en';
}
