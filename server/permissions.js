/** Granulare Panel-Rechte — txAdmin-ähnlich, mit Alias auf Legacy-IDs. */

export const PERMISSION_GROUPS = [
  {
    id: 'panel',
    label: 'Panel & System',
    permissions: [
      { id: 'all_permissions', label: 'Alle Rechte', sensitive: true },
      { id: 'manage.admins', label: 'Team verwalten', sensitive: true },
      { id: 'settings', label: 'Einstellungen: Ansehen', sensitive: false },
      { id: 'settings.write', label: 'Einstellungen: Ändern', sensitive: true },
      { id: 'console', label: 'Konsole: Lesen' },
      { id: 'console.write', label: 'Konsole: Schreiben', sensitive: true },
      { id: 'control', label: 'Server Start/Stop + Automationen', sensitive: true },
      { id: 'announcement', label: 'Ankündigungen senden' },
      { id: 'resources', label: 'Ressourcen Start/Stop' },
      { id: 'cfg', label: 'server.cfg lesen/schreiben', sensitive: true },
      { id: 'audit', label: 'System-Logs / Audit' },
      { id: 'server.log', label: 'Server-Logs' },
      { id: 'database', label: 'Datenbank-Tool', sensitive: true },
      { id: 'sessions', label: 'Eigene Sitzungen' },
      { id: 'system', label: 'System-Tools (Clean/Backup)', sensitive: true },
    ],
  },
  {
    id: 'cockpit',
    label: 'Cockpit',
    permissions: [
      { id: 'overview', label: 'Übersicht & Command' },
      { id: 'monitor', label: 'Monitoring' },
      { id: 'schedule', label: 'Automationen (Zeitplan)' },
    ],
  },
  {
    id: 'players',
    label: 'Spieler & Moderation',
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
    label: 'Ingame-Menü',
    permissions: [
      { id: 'menu.vehicle', label: 'Fahrzeuge spawnen/reparieren' },
      { id: 'menu.clear_area', label: 'Weltbereich zurücksetzen' },
      { id: 'menu.viewids', label: 'Spieler-IDs im Spiel' },
    ],
  },
];

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
};

export const ROLE_TEMPLATES = {
  moderator: [
    'overview', 'monitor', 'players', 'history',
    'bans', 'whitelist', 'whitelist.write',
    'players.warn', 'players.kick', 'players.dm', 'players.freeze',
    'players.heal', 'players.spectate', 'players.teleport',
    'menu.viewids', 'sessions',
  ],
  admin: [
    'overview', 'monitor', 'console', 'console.write', 'control', 'announcement',
    'players', 'history', 'bans', 'bans.revoke', 'whitelist', 'whitelist.write',
    'players.warn', 'players.kick', 'players.dm', 'players.freeze',
    'players.heal', 'players.playermode', 'players.spectate', 'players.teleport', 'players.troll',
    'menu.vehicle', 'menu.clear_area', 'menu.viewids',
    'resources', 'schedule', 'cfg', 'settings', 'settings.write',
    'database', 'audit', 'server.log', 'sessions', 'system',
  ],
  custom: [],
};

export function permissionsCatalog() {
  return { groups: PERMISSION_GROUPS, templates: ROLE_TEMPLATES, all: ALL_PERMISSION_IDS };
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
    if (ALL_PERMISSION_IDS.includes(id)) set.add(id);
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
    if (expanded.includes('*') || custom.includes('all_permissions')) return ['*'];
    return expanded;
  }
  if (user.role === 'custom') return [];
  return expandImplied(ROLE_TEMPLATES[user.role] || ROLE_TEMPLATES.moderator);
}

export function hasPermission(user, perm) {
  const want = canonicalize(perm);
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
