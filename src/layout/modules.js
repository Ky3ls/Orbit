/** Zentrale Modul-Navigation — Labels via i18n labelKey */

export const MODULES = [
  {
    id: 'ops',
    labelKey: 'nav.ops',
    items: [
      { to: '/panel', end: true, labelKey: 'nav.overview', shortKey: 'nav.home', icon: 'home' },
      { to: '/players', labelKey: 'nav.players', shortKey: 'nav.players', icon: 'users' },
      { to: '/resources', labelKey: 'nav.resources', shortKey: 'nav.scripts', icon: 'box' },
      { to: '/monitoring', labelKey: 'nav.monitoring', icon: 'chart' },
      { to: '/cfg', labelKey: 'nav.cfg', icon: 'cfg' },
      { to: '/schedule', labelKey: 'nav.schedule', icon: 'clock' },
    ],
  },
  {
    id: 'sys',
    labelKey: 'nav.sys',
    items: [
      { to: '/database', labelKey: 'nav.database', icon: 'db' },
      { to: '/server-log', labelKey: 'nav.serverLog', icon: 'log' },
      { to: '/audit', labelKey: 'nav.audit', icon: 'audit' },
      { to: '/admins', labelKey: 'nav.admins', icon: 'team', owner: true },
      { to: '/settings', labelKey: 'nav.settings', icon: 'gear' },
    ],
  },
];

export const MOBILE_DOCK = [
  { to: '/players', labelKey: 'nav.players', icon: 'users' },
  { to: '/resources', labelKey: 'nav.scripts', icon: 'box' },
  { to: '/panel', end: true, labelKey: 'nav.home', icon: 'home', center: true },
  { to: '/monitoring', labelKey: 'nav.monitoring', icon: 'chart', powerAdjacent: true },
  { to: '/more', labelKey: 'nav.more', icon: 'more' },
];

export function flatModulePaths() {
  const paths = ['/more', '/ingame'];
  for (const g of MODULES) {
    for (const item of g.items) paths.push(item.to);
  }
  return paths;
}

/** MODULES mit übersetzten Labels */
export function localizedModules(t) {
  return MODULES.map((group) => ({
    ...group,
    label: t(group.labelKey),
    items: group.items.map((item) => ({
      ...item,
      label: t(item.labelKey),
      short: item.shortKey ? t(item.shortKey) : undefined,
    })),
  }));
}
