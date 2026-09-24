/** Granulare Panel-Rechte — Rolle = Vorlage, `permissions` JSON = individuelle Rechte. */

export const PERMISSION_GROUPS = [
  {
    id: 'cockpit',
    label: 'Cockpit',
    permissions: [
      { id: 'overview', label: 'Übersicht & Command' },
      { id: 'monitor', label: 'Monitoring' },
      { id: 'console', label: 'Live-Konsole' },
      { id: 'control', label: 'Server Start/Stop/Restart' },
    ],
  },
  {
    id: 'players',
    label: 'Spieler',
    permissions: [
      { id: 'players', label: 'Spieler-Hub (Liste, Drops, Aktionen)' },
      { id: 'history', label: 'Erweiterte Spielerdaten / Drops' },
    ],
  },
  {
    id: 'mod',
    label: 'Moderation',
    permissions: [
      { id: 'bans', label: 'Bans setzen & ansehen' },
      { id: 'bans.revoke', label: 'Bans aufheben' },
      { id: 'whitelist', label: 'Allowlist ansehen' },
      { id: 'whitelist.write', label: 'Allowlist pflegen' },
    ],
  },
  {
    id: 'server',
    label: 'Server',
    permissions: [
      { id: 'resources', label: 'Ressourcen' },
      { id: 'schedule', label: 'Automationen' },
      { id: 'cfg', label: 'server.cfg bearbeiten' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    permissions: [
      { id: 'settings', label: 'Einstellungen' },
      { id: 'database', label: 'Datenbank-Tool' },
      { id: 'audit', label: 'Admin-Aktionen (Audit)' },
      { id: 'sessions', label: 'Eigene Sitzungen' },
    ],
  },
];

export const ALL_PERMISSION_IDS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.id));

export const ROLE_TEMPLATES = {
  moderator: ['overview', 'monitor', 'players', 'history', 'bans', 'whitelist'],
  admin: [
    'overview', 'monitor', 'console', 'control', 'players', 'history',
    'bans', 'bans.revoke', 'whitelist', 'whitelist.write',
    'resources', 'schedule', 'cfg', 'settings', 'database', 'audit', 'sessions',
  ],
  custom: [],
};

export function permissionsCatalog() {
  return { groups: PERMISSION_GROUPS, templates: ROLE_TEMPLATES, all: ALL_PERMISSION_IDS };
}

export function normalizePermissionList(list) {
  if (!Array.isArray(list)) return [];
  const set = new Set();
  for (const p of list) {
    const id = String(p || '').trim();
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

export function resolveUserPermissions(user) {
  if (!user || user.disabled) return [];
  if (user.role === 'owner') return ['*'];
  const custom = parseStoredPermissions(user.permissions);
  if (custom) return custom;
  if (user.role === 'custom') return [];
  return ROLE_TEMPLATES[user.role] || ROLE_TEMPLATES.moderator;
}

export function hasPermission(user, perm) {
  const list = resolveUserPermissions(user);
  return list.includes('*') || list.includes(perm);
}

export function serializePermissions(list) {
  const norm = normalizePermissionList(list);
  return norm.length ? JSON.stringify(norm) : '';
}
