/** Zentrale Modul-Navigation — Labels via i18n labelKey, `kw` für die Befehlspalette */

export const MODULES = [
  {
    id: 'live',
    labelKey: 'nav.live',
    items: [
      { to: '/panel', end: true, labelKey: 'nav.overview', icon: 'dashboard', key: 'd', kw: 'dashboard home cockpit übersicht start' },
      { to: '/players', labelKey: 'nav.players', icon: 'users', key: 'p', kw: 'spieler players bans kick allowlist whitelist' },
      { to: '/resources', labelKey: 'nav.resources', icon: 'box', key: 'r', kw: 'scripts ressourcen resources ensure' },
      { to: '/monitoring', labelKey: 'nav.monitoring', icon: 'activity', key: 'm', kw: 'cpu ram auslastung performance' },
    ],
  },
  {
    id: 'server',
    labelKey: 'nav.server',
    items: [
      { to: '/cfg', labelKey: 'nav.cfg', icon: 'cfg', key: 'c', kw: 'server.cfg config konfiguration editor' },
      { to: '/schedule', labelKey: 'nav.schedule', icon: 'calendar', key: 'a', kw: 'restart backup zeitplan cron automation' },
      { to: '/server-log', labelKey: 'nav.serverLog', icon: 'log', key: 'l', kw: 'log fx konsole fehler errors' },
      { to: '/database', labelKey: 'nav.database', icon: 'db', key: 'b', kw: 'mysql sql tabellen database' },
      { to: '/ingame', labelKey: 'nav.ingame', icon: 'gamepad', kw: 'ingame menü noclip orbitmenu' },
    ],
  },
  {
    id: 'manage',
    labelKey: 'nav.manage',
    items: [
      { to: '/admins', labelKey: 'nav.admins', icon: 'team', owner: true, key: 't', kw: 'team admins rollen rechte' },
      { to: '/audit', labelKey: 'nav.audit', icon: 'audit', key: 'u', kw: 'audit aktionen protokoll' },
      { to: '/settings', labelKey: 'nav.settings', icon: 'gear', key: 's', kw: 'einstellungen settings discord aussehen' },
    ],
  },
];

/** Mobile Tab-Bar (unten) */
export const MOBILE_TABS = [
  { to: '/panel', end: true, labelKey: 'nav.home', icon: 'dashboard' },
  { to: '/players', labelKey: 'nav.players', icon: 'users' },
  { to: '/resources', labelKey: 'nav.scripts', icon: 'box' },
  { to: '/monitoring', labelKey: 'nav.monitoring', icon: 'activity' },
];

export function allModuleItems() {
  return MODULES.flatMap((g) => g.items.map((i) => ({ ...i, group: g.id, groupKey: g.labelKey })));
}

/** MODULES mit übersetzten Labels */
export function localizedModules(t) {
  return MODULES.map((group) => ({
    ...group,
    label: t(group.labelKey),
    items: group.items.map((item) => ({ ...item, label: t(item.labelKey) })),
  }));
}

/** Aktuelles Modul inkl. Gruppe zu einem Pfad */
export function moduleForPath(pathname) {
  for (const g of MODULES) {
    for (const item of g.items) {
      if (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)) {
        return { group: g, item };
      }
    }
  }
  return null;
}
