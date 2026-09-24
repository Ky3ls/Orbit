/** Zentrale Modul-Navigation — eine Quelle für Sidebar + Mobile-Dock */

export const MODULES = [
  {
    id: 'ops',
    label: 'Betrieb',
    items: [
      { to: '/panel', end: true, label: 'Übersicht', short: 'Home', icon: 'home' },
      { to: '/players', label: 'Spieler', short: 'Spieler', icon: 'users' },
      { to: '/resources', label: 'Ressourcen', short: 'Scripts', icon: 'box' },
      { to: '/monitoring', label: 'Monitoring', icon: 'chart' },
      { to: '/cfg', label: 'CFG', icon: 'cfg' },
      { to: '/schedule', label: 'Zeitpläne', icon: 'clock' },
    ],
  },
  {
    id: 'sys',
    label: 'System',
    items: [
      { to: '/database', label: 'Datenbank', icon: 'db' },
      { to: '/server-log', label: 'Server-/FX-Log', icon: 'log' },
      { to: '/audit', label: 'Admin-Aktionen', icon: 'audit' },
      { to: '/admins', label: 'Team', icon: 'team', owner: true },
      { to: '/settings', label: 'Einstellungen', icon: 'gear' },
    ],
  },
];

export const MOBILE_DOCK = [
  { to: '/players', label: 'Spieler', icon: 'users' },
  { to: '/resources', label: 'Scripts', icon: 'box' },
  { to: '/panel', end: true, label: 'Home', icon: 'home', center: true },
  { to: '/monitoring', label: 'Monitor', icon: 'chart', powerAdjacent: true },
  { to: '/more', label: 'Mehr', icon: 'more' },
];

export function flatModulePaths() {
  const paths = ['/more', '/ingame'];
  for (const g of MODULES) {
    for (const item of g.items) paths.push(item.to);
  }
  return paths;
}
