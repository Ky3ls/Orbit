/** Granulare Panel-Rechte — txAdmin-ähnlich, mit Alias auf Legacy-IDs. */

export const PERMISSION_GROUPS = [
  {
    id: 'panel',
    label: 'Panel & Team',
    icon: 'dashboard',
    permissions: [
      { id: 'all_permissions', label: 'Alle Rechte', sensitive: true },
      { id: 'overview', label: 'Übersicht & Live-Statistik' },
      { id: 'audit', label: 'Audit-Log ansehen' },
      { id: 'manage.admins', label: 'Team verwalten', sensitive: true },
      { id: 'settings', label: 'Einstellungen: Ansehen' },
      { id: 'settings.write', label: 'Einstellungen: Ändern', sensitive: true },
      { id: 'sessions', label: 'Eigene Sitzungen' },
      { id: 'system', label: 'Panel-Wartung (Backup, Bereinigen)', sensitive: true },
    ],
  },
  {
    id: 'host',
    label: 'Host',
    icon: 'cpu',
    permissions: [
      { id: 'host.view', label: 'Host-Seiten ansehen (Dienste, Datenbanken, Domains)' },
      { id: 'host.services', label: 'Dienste starten / stoppen / neu laden', sensitive: true },
      { id: 'host.db', label: 'Datenbanken & Benutzer verwalten', sensitive: true },
      { id: 'host.db.studio', label: 'Datenbank-Studio: Daten & Struktur bearbeiten', sensitive: true },
      { id: 'host.web', label: 'Domains & Webserver verwalten', sensitive: true },
      { id: 'host.install', label: 'Software installieren (Datenbanken, Webserver)', sensitive: true },
    ],
  },
  {
    id: 'servers',
    label: 'Gameserver',
    icon: 'layers',
    permissions: [
      { id: 'servers.create', label: 'Server anlegen, importieren und löschen', sensitive: true },
    ],
  },
  {
    id: 'minecraft',
    label: 'Minecraft',
    icon: 'cube',
    game: 'minecraft',
    permissions: [
      { id: 'mc.view', label: 'Server sehen & Konsole lesen' },
      { id: 'mc.control', label: 'Starten / Stoppen / Neustart' },
      { id: 'mc.console', label: 'Konsolenbefehle ausführen', sensitive: true },
      { id: 'mc.players', label: 'Spieler: Whitelist, OP, Kick, Bann, Teleport' },
      { id: 'mc.inventory', label: 'Inventare bearbeiten & Items geben' },
      { id: 'mc.files', label: 'Dateien & Konfiguration bearbeiten', sensitive: true },
      { id: 'mc.mods', label: 'Mods / Plugins verwalten' },
      { id: 'mc.backups', label: 'Backups erstellen & herunterladen' },
      { id: 'mc.backups.restore', label: 'Backups wiederherstellen & löschen', sensitive: true },
      { id: 'mc.settings', label: 'Instanz-Einstellungen (RAM, Port, Java)', sensitive: true },
    ],
  },
  {
    id: 'fivem',
    label: 'FiveM-Server',
    icon: 'power',
    game: 'fivem',
    permissions: [
      { id: 'console', label: 'Konsole lesen' },
      { id: 'console.write', label: 'Konsole schreiben', sensitive: true },
      { id: 'control', label: 'Start / Stop / Neustart', sensitive: true },
      { id: 'monitor', label: 'Monitoring' },
      { id: 'schedule', label: 'Automationen (Zeitplan)' },
      { id: 'announcement', label: 'Ankündigungen senden' },
      { id: 'resources', label: 'Ressourcen starten / stoppen' },
      { id: 'cfg', label: 'server.cfg lesen / schreiben', sensitive: true },
      { id: 'server.log', label: 'Server-Log' },
      { id: 'database', label: 'Datenbank-Tool (FiveM)', sensitive: true },
    ],
  },
  {
    id: 'players',
    label: 'FiveM: Spieler & Moderation',
    icon: 'users',
    game: 'fivem',
    permissions: [
      { id: 'players', label: 'Spieler-Hub' },
      { id: 'history', label: 'Historie / Drops' },
      { id: 'players.remove_ids', label: 'Spieler-IDs entfernen', sensitive: true },
      { id: 'bans', label: 'Bannen' },
      { id: 'bans.revoke', label: 'Bans aufheben' },
      { id: 'whitelist', label: 'Allowlist ansehen' },
      { id: 'whitelist.write', label: 'Allowlist pflegen' },
      { id: 'players.warn', label: 'Verwarnen' },
      { id: 'players.kick', label: 'Kicken' },
      { id: 'players.dm', label: 'Direktnachricht' },
      { id: 'players.freeze', label: 'Einfrieren' },
      { id: 'players.heal', label: 'Heilen' },
      { id: 'players.playermode', label: 'NoClip / God Mode' },
      { id: 'players.spectate', label: 'Spectate' },
      { id: 'players.teleport', label: 'Teleport' },
      { id: 'players.troll', label: 'Troll-Aktionen' },
    ],
  },
  {
    id: 'menu',
    label: 'FiveM: Ingame-Menü',
    icon: 'gamepad',
    game: 'fivem',
    permissions: [
      { id: 'menu.vehicle', label: 'Fahrzeuge spawnen/reparieren' },
      { id: 'menu.clear_area', label: 'Weltbereich zurücksetzen' },
      { id: 'menu.viewids', label: 'Spieler-IDs im Spiel' },
      { id: 'menu.money', label: 'Geld geben (Spieler)' },
      { id: 'menu.money_all', label: 'Geld geben (alle)', sensitive: true },
      { id: 'menu.giveaway', label: 'Gewinnspiel starten' },
      { id: 'menu.npc', label: 'NPCs an/aus' },
      { id: 'menu.weather', label: 'Wetter & Zeit' },
    ],
  },
];

/** Rechte, die zum FiveM-Server gehören (für die Server-Beschränkung) */
export const FIVEM_PERMISSION_IDS = new Set(PERMISSION_GROUPS.filter((g) => g.game === 'fivem').flatMap((g) => g.permissions.map((p) => p.id)));
const SCOPE_RE = /^server:(minecraft:\d+|fivem:[\w-]+)$/;

export const ALL_PERMISSION_IDS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.id));

/** Legacy → kanonisch (und umgekehrt für Checks) */
const ALIASES = {
  'settings.view': 'settings',
  'settings.change': 'settings.write',
  'console.view': 'console',
  'control.server': 'control',
  'commands.resources': 'resources',
  'server.cfg.editor': 'cfg',
  'txadmin.log.view': 'audit',
  'server.log.view': 'server.log',
  'players.direct_message': 'players.dm',
  'players.whitelist': 'whitelist.write',
  'players.ban': 'bans',
  'players.whitelist.view': 'whitelist',
};

/** Wenn jemand X hat, gilt auch Y als erfüllt */
const IMPLIES = {
  all_permissions: ['*'],
  'settings.write': ['settings'],
  'console.write': ['console'],
  'whitelist.write': ['whitelist'],
  'bans.revoke': ['bans'],
  // Alte grobe Rechte implizieren neue Feingranulare
  players: [
    'players.warn', 'players.kick', 'players.dm', 'players.freeze',
    'players.heal', 'players.spectate', 'players.teleport', 'menu.viewids',
  ],
  bans: ['players.ban'],
  control: ['announcement', 'schedule'],
  'mc.control': ['mc.view'],
  'mc.console': ['mc.view'],
  'mc.players': ['mc.view'],
  'mc.inventory': ['mc.players'],
  'mc.files': ['mc.view'],
  'mc.mods': ['mc.view'],
  'mc.backups': ['mc.view'],
  'mc.backups.restore': ['mc.backups'],
  'mc.settings': ['mc.view'],
  'host.services': ['host.view'],
  'host.db': ['host.view'],
  'host.db.studio': ['host.db'],
  'host.web': ['host.view'],
  'host.install': ['host.view'],
};

export const ROLE_TEMPLATES = {
  moderator: [
    'overview', 'monitor', 'players', 'history',
    'bans', 'whitelist', 'whitelist.write',
    'players.warn', 'players.kick', 'players.dm', 'players.freeze',
    'players.heal', 'players.spectate', 'players.teleport',
    'menu.viewids', 'sessions',
    'mc.view', 'mc.players',
  ],
  admin: [
    'overview', 'monitor', 'console', 'console.write', 'control', 'announcement',
    'players', 'history', 'bans', 'bans.revoke', 'whitelist', 'whitelist.write',
    'players.warn', 'players.kick', 'players.dm', 'players.freeze',
    'players.heal', 'players.playermode', 'players.spectate', 'players.teleport', 'players.troll',
    'menu.vehicle', 'menu.clear_area', 'menu.viewids',
    'menu.money', 'menu.money_all', 'menu.giveaway', 'menu.npc', 'menu.weather',
    'resources', 'schedule', 'cfg', 'settings', 'settings.write',
    'database', 'audit', 'server.log', 'sessions', 'system',
    'mc.view', 'mc.control', 'mc.console', 'mc.players', 'mc.inventory', 'mc.files', 'mc.mods',
    'mc.backups', 'mc.backups.restore', 'mc.settings', 'servers.create', 'host.view',
  ],
  custom: [],
};

const BUILTIN_LABELS = {
  moderator: 'Moderator',
  admin: 'Admin',
};

export function defaultRoleTemplateList() {
  return [
    {
      id: 'moderator',
      label: BUILTIN_LABELS.moderator,
      permissions: [...ROLE_TEMPLATES.moderator],
      builtin: true,
    },
    {
      id: 'admin',
      label: BUILTIN_LABELS.admin,
      permissions: [...ROLE_TEMPLATES.admin],
      builtin: true,
    },
  ];
}

/** Gespeicherte Vorlagen aus Settings (Fallback: Defaults). */
export function loadRoleTemplates(db) {
  let raw = null;
  try {
    raw = db.prepare('SELECT v FROM settings WHERE k = ?').get('roleTemplates')?.v;
  } catch { /* ignore */ }
  if (!raw) return defaultRoleTemplateList();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return defaultRoleTemplateList();
    const out = [];
    for (const item of parsed) {
      const id = String(item?.id || '').trim().slice(0, 32);
      if (!id || id === 'custom' || id === 'owner') continue;
      const label = String(item?.label || id).trim().slice(0, 48) || id;
      const permissions = normalizePermissionList(item?.permissions || []);
      const builtin = id === 'moderator' || id === 'admin' || !!item?.builtin;
      out.push({ id, label, permissions, builtin });
    }
    // Builtins immer vorhanden
    for (const def of defaultRoleTemplateList()) {
      if (!out.some((t) => t.id === def.id)) out.unshift(def);
    }
    return out;
  } catch {
    return defaultRoleTemplateList();
  }
}

let roleTemplateCache = null;

export function saveRoleTemplates(db, list) {
  const cleaned = [];
  for (const item of list || []) {
    const id = String(item?.id || '').trim().slice(0, 32);
    if (!id || id === 'custom' || id === 'owner') continue;
    cleaned.push({
      id,
      label: String(item?.label || id).trim().slice(0, 48) || id,
      permissions: normalizePermissionList(item?.permissions || []),
      builtin: id === 'moderator' || id === 'admin',
    });
  }
  for (const def of defaultRoleTemplateList()) {
    if (!cleaned.some((t) => t.id === def.id)) cleaned.unshift(def);
  }
  const payload = JSON.stringify(cleaned);
  db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .run('roleTemplates', payload);
  roleTemplateCache = templatesMapFromList(cleaned);
  return cleaned;
}

export function templatesMapFromList(list) {
  const map = { custom: [] };
  for (const t of list || []) map[t.id] = [...(t.permissions || [])];
  return map;
}

export function permissionsCatalog(db) {
  const list = db ? loadRoleTemplates(db) : defaultRoleTemplateList();
  const templates = templatesMapFromList(list);
  roleTemplateCache = templates;
  return {
    groups: PERMISSION_GROUPS,
    scopeHint: 'server:minecraft:<id> oder server:fivem:active',
    templates,
    templateList: list,
    all: ALL_PERMISSION_IDS,
  };
}

function templatePermsForRole(role) {
  const map = roleTemplateCache || ROLE_TEMPLATES;
  return map[role] || ROLE_TEMPLATES[role] || ROLE_TEMPLATES.moderator;
}

function canonicalize(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  return ALIASES[raw] || raw;
}

export function normalizePermissionList(list) {
  if (!Array.isArray(list)) return [];
  const set = new Set();
  for (const p of list) {
    const id = canonicalize(p);
    if (id === 'all_permissions' || id === '*') {
      set.add('all_permissions');
      continue;
    }
    if (ALL_PERMISSION_IDS.includes(id) || SCOPE_RE.test(id)) set.add(id);
  }
  return [...set];
}

export function parseStoredPermissions(raw) {
  if (!raw || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw);
    const norm = normalizePermissionList(parsed);
    return norm.length ? norm : null;
  } catch {
    return null;
  }
}

function expandImplied(list) {
  const set = new Set(list);
  if (set.has('all_permissions')) return ['*'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set]) {
      const extra = IMPLIES[id];
      if (!extra) continue;
      for (const e of extra) {
        if (e === '*') return ['*'];
        if (!set.has(e)) {
          set.add(e);
          changed = true;
        }
      }
    }
  }
  return [...set];
}

export function resolveUserPermissions(user) {
  if (!user || user.disabled) return [];
  if (user.role === 'owner') return ['*'];
  const custom = parseStoredPermissions(user.permissions);
  if (custom) {
    const expanded = expandImplied(custom);
    if (custom.includes('all_permissions')) return ['*', ...custom.filter((x) => SCOPE_RE.test(x))];
    if (expanded.includes('*')) return ['*'];
    return expanded;
  }
  if (user.role === 'custom') return [];
  return expandImplied(templatePermsForRole(user.role));
}

/** Server-Beschränkung: ohne server:-Einträge gilt der Zugriff für alle Server */
export function serverScopes(user) {
  if (!user || user.role === 'owner') return null;
  const list = parseStoredPermissions(user.permissions) || [];
  const scopes = list.filter((x) => SCOPE_RE.test(x)).map((x) => x.slice(7));
  return scopes.length ? scopes : null;
}

export function canAccessServer(user, key) {
  const scopes = serverScopes(user);
  if (!scopes) return true;
  if (String(key).startsWith('fivem')) return scopes.some((s) => s.startsWith('fivem'));
  return scopes.includes(key);
}

export function hasPermission(user, perm) {
  const want = canonicalize(perm);
  // FiveM-Rechte greifen nur, wenn der FiveM-Server im Zugriff liegt
  if (FIVEM_PERMISSION_IDS.has(want) && !canAccessServer(user, 'fivem:active')) return false;
  const list = resolveUserPermissions(user);
  if (list.includes('*')) return true;
  if (list.includes(want)) return true;
  // direkte Alias-Treffer in der gespeicherten Liste
  if (list.includes(ALIASES[want])) return true;
  return false;
}

export function serializePermissions(list) {
  const norm = normalizePermissionList(list);
  return norm.length ? JSON.stringify(norm) : '';
}

/**
 * Einmalige Umstellung auf spielunabhängige Rechte: bestehende Konten und gespeicherte
 * Vorlagen bekommen Minecraft-/Host-Rechte passend zu ihren bisherigen FiveM-Rechten,
 * damit niemand Zugriff verliert.
 */
export function migratePermissionsV2(db) {
  try {
    if (db.prepare("SELECT v FROM settings WHERE k = 'permsV2'").get()?.v === '1') return 0;
  } catch { return 0; }
  const map = (list) => {
    const set = new Set(list);
    const has = (x) => set.has(x);
    if (has('overview') || has('console') || has('control')) set.add('mc.view');
    if (has('control')) { set.add('mc.control'); set.add('mc.backups'); }
    if (has('console.write')) set.add('mc.console');
    if (has('players')) set.add('mc.players');
    if (has('players.troll') || has('menu.money')) set.add('mc.inventory');
    if (has('cfg')) { set.add('mc.files'); set.add('mc.mods'); set.add('mc.settings'); }
    if (has('control') && has('cfg')) { set.add('servers.create'); set.add('mc.backups.restore'); }
    if (has('settings.write') || has('system')) set.add('host.view');
    return [...set];
  };
  let n = 0;
  for (const u of db.prepare("SELECT id, permissions FROM users WHERE role != 'owner' AND permissions IS NOT NULL AND permissions != ''").all()) {
    const cur = parseStoredPermissions(u.permissions);
    if (!cur || cur.includes('all_permissions')) continue;
    const next = map(cur);
    if (next.length !== cur.length) { db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify(next), u.id); n += 1; }
  }
  try {
    const raw = db.prepare("SELECT v FROM settings WHERE k = 'roleTemplates'").get()?.v;
    if (raw) {
      const list = JSON.parse(raw).map((t) => ({ ...t, permissions: map(t.permissions || []) }));
      db.prepare("UPDATE settings SET v = ? WHERE k = 'roleTemplates'").run(JSON.stringify(list));
      roleTemplateCache = null;
    }
  } catch { /* */ }
  db.prepare("INSERT INTO settings (k, v) VALUES ('permsV2', '1') ON CONFLICT(k) DO UPDATE SET v = excluded.v").run();
  return n;
}
