import fs from 'node:fs';
import path from 'node:path';

/** Wichtigste server.properties-Schlüssel mit Gruppe, Typ und deutscher Beschriftung. */
export const PROPERTY_SCHEMA = [
  { key: 'motd', group: 'Allgemein', label: 'Nachricht in der Serverliste (MOTD)', type: 'text' },
  { key: 'max-players', group: 'Allgemein', label: 'Maximale Spieler', type: 'number', min: 1, max: 1000 },
  { key: 'gamemode', group: 'Spiel', label: 'Spielmodus', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'difficulty', group: 'Spiel', label: 'Schwierigkeit', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'hardcore', group: 'Spiel', label: 'Hardcore', type: 'bool' },
  { key: 'pvp', group: 'Spiel', label: 'PvP', type: 'bool' },
  { key: 'force-gamemode', group: 'Spiel', label: 'Spielmodus beim Beitreten erzwingen', type: 'bool' },
  { key: 'allow-flight', group: 'Spiel', label: 'Fliegen erlauben (für Mods empfohlen)', type: 'bool' },
  { key: 'spawn-protection', group: 'Spiel', label: 'Spawn-Schutz (Radius)', type: 'number', min: 0, max: 256 },
  { key: 'level-name', group: 'Welt', label: 'Weltordner', type: 'text' },
  { key: 'level-seed', group: 'Welt', label: 'Seed', type: 'text' },
  { key: 'level-type', group: 'Welt', label: 'Welttyp', type: 'select', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified'] },
  { key: 'generate-structures', group: 'Welt', label: 'Strukturen generieren', type: 'bool' },
  { key: 'view-distance', group: 'Leistung', label: 'Sichtweite (Chunks)', type: 'number', min: 2, max: 32 },
  { key: 'simulation-distance', group: 'Leistung', label: 'Simulationsweite (Chunks)', type: 'number', min: 2, max: 32 },
  { key: 'max-tick-time', group: 'Leistung', label: 'Watchdog (ms, -1 = aus)', type: 'number', min: -1 },
  { key: 'online-mode', group: 'Zugang', label: 'Online-Modus (Mojang-Accounts prüfen)', type: 'bool' },
  { key: 'white-list', group: 'Zugang', label: 'Whitelist aktiv', type: 'bool' },
  { key: 'enforce-whitelist', group: 'Zugang', label: 'Whitelist durchsetzen (nicht gelistete kicken)', type: 'bool' },
  { key: 'enable-command-block', group: 'Zugang', label: 'Befehlsblöcke erlauben', type: 'bool' },
  { key: 'server-port', group: 'Netzwerk', label: 'Port', type: 'number', min: 1024, max: 65535, readonly: true },
  { key: 'enable-query', group: 'Netzwerk', label: 'Query aktivieren', type: 'bool' },
  { key: 'enable-status', group: 'Netzwerk', label: 'In Serverliste anzeigen', type: 'bool' },
];

export function propsFile(instPath) {
  return path.join(instPath, 'server.properties');
}

/** Properties-Format: Nicht-ASCII als \\uXXXX, damit §-Codes und Umlaute in jeder MC-Version ankommen */
function escapeValue(v) {
  return String(v ?? '').replace(/[\r\n]/g, ' ').replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function unescapeValue(v) {
  return String(v).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function parseProperties(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    values[line.slice(0, i).trim()] = unescapeValue(line.slice(i + 1));
  }
  return values;
}

export function readProperties(instPath) {
  try {
    return parseProperties(fs.readFileSync(propsFile(instPath), 'utf8'));
  } catch {
    return {};
  }
}

/** Werte setzen, Kommentare/Reihenfolge erhalten, neue Schlüssel anhängen */
export function writeProperties(instPath, patch) {
  const file = propsFile(instPath);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = '#Minecraft server properties\n'; }
  const pending = new Map(Object.entries(patch).map(([k, v]) => [k, escapeValue(v)]));
  const lines = text.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) return line;
    const i = line.indexOf('=');
    if (i < 0) return line;
    const k = line.slice(0, i).trim();
    if (!pending.has(k)) return line;
    const v = pending.get(k);
    pending.delete(k);
    return `${k}=${v}`;
  });
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of pending) lines.push(`${k}=${v}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return readProperties(instPath);
}
