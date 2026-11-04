import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * Wichtige Server-Configs (Paper/Spigot/Bukkit/Purpur) mit kuratierten Feldern.
 * Felder werden nur angezeigt, wenn der Schlüssel in der Datei existiert — so bleibt
 * es über Versionen hinweg robust. Kommentare bleiben beim Speichern erhalten.
 */
export const CONFIG_FILES = [
  {
    id: 'paper-global',
    file: 'config/paper-global.yml',
    label: 'Paper · Global',
    hint: 'Gilt für den ganzen Server: Proxys, Chunk-Laden, Watchdog',
    types: ['paper', 'purpur'],
    groups: [
      {
        label: 'Proxy',
        fields: [
          { path: 'proxies.velocity.enabled', label: 'Velocity-Proxy', hint: 'Nur aktivieren, wenn der Server hinter Velocity läuft', type: 'bool' },
          { path: 'proxies.bungee-cord.online-mode', label: 'BungeeCord Online-Modus', type: 'bool' },
        ],
      },
      {
        label: 'Spieler & Chunks',
        fields: [
          { path: 'misc.max-joins-per-tick', label: 'Max. Logins pro Tick', hint: 'Bremst Join-Wellen nach einem Neustart', type: 'number' },
          { path: 'chunk-loading-basic.player-max-chunk-load-rate', label: 'Chunk-Laderate pro Spieler', hint: 'Chunks pro Sekunde (-1 = unbegrenzt)', type: 'number' },
          { path: 'chunk-loading-basic.player-max-chunk-send-rate', label: 'Chunk-Senderate pro Spieler', hint: 'Niedriger = weniger Bandbreite', type: 'number' },
          { path: 'collisions.enable-player-collisions', label: 'Spieler-Kollisionen', type: 'bool' },
        ],
      },
      {
        label: 'Stabilität & Schutz',
        fields: [
          { path: 'watchdog.early-warning-delay', label: 'Watchdog-Frühwarnung (ms)', type: 'number' },
          { path: 'spam-limiter.tab-spam-limit', label: 'Tab-Spam-Limit', type: 'number' },
          { path: 'item-validation.book-size.page-max', label: 'Max. Buchseitengröße', hint: 'Schutz vor Crash-Büchern', type: 'number' },
          { path: 'unsupported-settings.allow-permanent-block-break-exploits', label: 'Bedrock-Break-Exploits erlauben', hint: 'Unsupported — normalerweise aus lassen', type: 'bool' },
          { path: 'console.enable-brigadier-highlighting', label: 'Befehls-Hervorhebung in der Konsole', type: 'bool' },
        ],
      },
    ],
  },
  {
    id: 'paper-world',
    file: 'config/paper-world-defaults.yml',
    label: 'Paper · Welt-Standards',
    hint: 'Standard für alle Welten: Anti-Xray, Redstone, Spawning',
    types: ['paper', 'purpur'],
    groups: [
      {
        label: 'Anti-Xray',
        fields: [
          { path: 'anticheat.anti-xray.enabled', label: 'Anti-Xray', hint: 'Versteckt Erze vor Xray-Clients', type: 'bool' },
          { path: 'anticheat.anti-xray.engine-mode', label: 'Modus', type: 'select', options: [{ value: 1, label: '1 — Erze verstecken (schnell)' }, { value: 2, label: '2 — Fake-Erze einstreuen' }, { value: 3, label: '3 — Fake-Erze, sparsamer' }] },
        ],
      },
      {
        label: 'Spielmechanik',
        fields: [
          { path: 'misc.redstone-implementation', label: 'Redstone-Engine', hint: 'Alternate Current ist am schnellsten', type: 'select', options: [{ value: 'VANILLA', label: 'Vanilla' }, { value: 'EIGENCRAFT', label: 'Eigencraft' }, { value: 'ALTERNATE_CURRENT', label: 'Alternate Current' }] },
          { path: 'environment.optimize-explosions', label: 'Explosionen optimieren', type: 'bool' },
          { path: 'environment.treasure-maps.enabled', label: 'Schatzkarten', type: 'bool' },
          { path: 'hopper.cooldown-when-full', label: 'Trichter-Cooldown wenn voll', type: 'bool' },
          { path: 'entities.armor-stands.tick', label: 'Rüstungsständer ticken', hint: 'Aus spart Leistung', type: 'bool' },
        ],
      },
      {
        label: 'Leistung',
        fields: [
          { path: 'entities.spawning.per-player-mob-spawns', label: 'Mob-Spawns pro Spieler verteilen', type: 'bool' },
          { path: 'chunks.max-auto-save-chunks-per-tick', label: 'Auto-Save Chunks pro Tick', type: 'number' },
          { path: 'tick-rates.mob-spawner', label: 'Spawner-Tickrate', hint: 'Höher = Spawner seltener prüfen', type: 'number' },
        ],
      },
    ],
  },
  {
    id: 'spigot',
    file: 'spigot.yml',
    label: 'Spigot',
    hint: 'Aktivierungsweiten, Item-Merging, Neustart-Verhalten',
    types: ['paper', 'purpur'],
    groups: [
      {
        label: 'Server',
        fields: [
          { path: 'settings.restart-on-crash', label: 'Eigener Crash-Neustart von Spigot', hint: 'Orbit startet bereits neu — hier besser aus', type: 'bool' },
          { path: 'settings.bungeecord', label: 'BungeeCord-Modus', type: 'bool' },
          { path: 'commands.log', label: 'Befehle loggen', type: 'bool' },
        ],
      },
      {
        label: 'Welt',
        fields: [
          { path: 'world-settings.default.entity-activation-range.animals', label: 'Aktivierungsweite Tiere', type: 'number' },
          { path: 'world-settings.default.entity-activation-range.monsters', label: 'Aktivierungsweite Monster', type: 'number' },
          { path: 'world-settings.default.mob-spawn-range', label: 'Mob-Spawn-Radius (Chunks)', type: 'number' },
          { path: 'world-settings.default.merge-radius.item', label: 'Item-Merge-Radius', type: 'number', step: 0.1 },
          { path: 'world-settings.default.merge-radius.exp', label: 'XP-Merge-Radius (-1 = aus)', type: 'number', step: 0.1 },
          { path: 'world-settings.default.item-despawn-rate', label: 'Item-Despawn (Ticks)', hint: '6000 = 5 Minuten', type: 'number' },
        ],
      },
    ],
  },
  {
    id: 'bukkit',
    file: 'bukkit.yml',
    label: 'Bukkit',
    hint: 'Spawn-Limits, Autosave, End-Dimension',
    types: ['paper', 'purpur'],
    groups: [
      {
        label: 'Spawn-Limits pro Spieler',
        fields: [
          { path: 'spawn-limits.monsters', label: 'Monster', type: 'number' },
          { path: 'spawn-limits.animals', label: 'Tiere', type: 'number' },
          { path: 'spawn-limits.water-animals', label: 'Wassertiere', type: 'number' },
          { path: 'spawn-limits.ambient', label: 'Fledermäuse & Co.', type: 'number' },
        ],
      },
      {
        label: 'Allgemein',
        fields: [
          { path: 'settings.allow-end', label: 'End-Dimension', type: 'bool' },
          { path: 'ticks-per.autosave', label: 'Autosave-Intervall (Ticks)', hint: '6000 = 5 Minuten', type: 'number' },
          { path: 'settings.connection-throttle', label: 'Verbindungs-Drosselung (ms)', type: 'number' },
        ],
      },
    ],
  },
  {
    id: 'purpur',
    file: 'purpur.yml',
    label: 'Purpur',
    hint: 'Zusätzliche Purpur-Optionen',
    types: ['purpur'],
    groups: [
      {
        label: 'Allgemein',
        fields: [
          { path: 'settings.use-alternate-keepalive', label: 'Alternatives Keepalive', hint: 'Hilft bei Timeouts mit schlechter Verbindung', type: 'bool' },
          { path: 'world-settings.default.gameplay-mechanics.player.idle-timeout.kick-if-idle', label: 'AFK-Spieler kicken', type: 'bool' },
          { path: 'world-settings.default.gameplay-mechanics.player.idle-timeout.tick-nearby-entities', label: 'AFK: Umgebung weiter ticken', type: 'bool' },
        ],
      },
    ],
  },
];

function absFile(inst, def) {
  return path.join(inst.path, def.file);
}

/** Configs, die zu diesem Server-Typ passen (inkl. „existiert noch nicht“) */
export function listConfigs(inst) {
  return CONFIG_FILES.filter((c) => c.types.includes(inst.type)).map((c) => ({
    id: c.id,
    label: c.label,
    hint: c.hint,
    file: c.file,
    exists: fs.existsSync(absFile(inst, c)),
  }));
}

function getDef(inst, id) {
  const def = CONFIG_FILES.find((c) => c.id === id && c.types.includes(inst.type));
  if (!def) throw new Error('Unbekannte Konfiguration.');
  return def;
}

export function readConfig(inst, id) {
  const def = getDef(inst, id);
  const file = absFile(inst, def);
  if (!fs.existsSync(file)) return { id, file: def.file, exists: false, groups: [], raw: '' };
  const raw = fs.readFileSync(file, 'utf8');
  const doc = YAML.parseDocument(raw);
  const groups = def.groups.map((g) => ({
    label: g.label,
    fields: g.fields
      .filter((f) => doc.hasIn(f.path.split('.')))
      .map((f) => ({ ...f, value: doc.getIn(f.path.split('.')) })),
  })).filter((g) => g.fields.length);
  return { id, file: def.file, exists: true, groups, raw };
}

function coerce(field, value) {
  if (field.type === 'bool') return value === true || value === 'true';
  if (field.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${field.label}: keine Zahl.`);
    return n;
  }
  if (field.type === 'select') {
    const opt = field.options.find((o) => String(o.value) === String(value));
    if (!opt) throw new Error(`${field.label}: ungültiger Wert.`);
    return opt.value;
  }
  return String(value);
}

/** Einzelne Werte setzen — Kommentare/Formatierung bleiben erhalten */
export function writeConfigValues(inst, id, values) {
  const def = getDef(inst, id);
  const file = absFile(inst, def);
  if (!fs.existsSync(file)) throw new Error('Datei existiert noch nicht — Server einmal starten.');
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  const fields = new Map(def.groups.flatMap((g) => g.fields).map((f) => [f.path, f]));
  for (const [p, v] of Object.entries(values || {})) {
    const f = fields.get(p);
    if (!f || !doc.hasIn(p.split('.'))) continue;
    doc.setIn(p.split('.'), coerce(f, v));
  }
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }));
  return file;
}

/** Ganze Datei ersetzen (nur gültiges YAML) */
export function writeConfigRaw(inst, id, text) {
  const def = getDef(inst, id);
  const doc = YAML.parseDocument(String(text || ''));
  if (doc.errors.length) throw new Error(`YAML-Fehler: ${doc.errors[0].message.split('\n')[0]}`);
  const file = absFile(inst, def);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(text));
  return file;
}
