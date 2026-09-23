/** Zentrale Modul-Navigation — eine Quelle für Sidebar + Mobile-Dock */

export const MODULES = [
  {
    id: 'ops',
    label: 'Betrieb',
    items: [
      { to: '/panel', end: true, label: 'Übersicht', short: 'Home', icon: 'home' },
      { to: '/players', label: 'Spieler', short: 'Spieler', icon: 'users' },
      { to: '/resources', label: 'Ressourcen', short: 'Scripts', icon: 'box' },
      { to: '/console', label: 'Konsole', short: 'Konsole', icon: 'term', consoleRoute: true },
      { to: '/monitoring', label: 'Monitoring', icon: 'chart' },
      { to: '/cfg', label: 'server.cfg', icon: 'cfg' },
      { to: '/schedule', label: 'Zeitpläne', icon: 'clock' },
    ],
  },
  {
    id: 'mod',
    label: 'Moderation',
    items: [
      { to: '/history', label: 'Verlauf', icon: 'list' },
      { to: '/drops', label: 'Player Drops', icon: 'drop' },
      { to: '/bans', label: 'Bans', icon: 'ban' },
      { to: '/whitelist', label: 'Allowlist', icon: 'wl' },
    ],
  },
  {
    id: 'sys',
    label: 'System',
    items: [
      { to: '/database', label: 'Datenbank', icon: 'db' },
      { to: '/server-log', label: 'Server Log', icon: 'log' },
      { to: '/audit', label: 'Audit', icon: 'audit' },
      { to: '/admins', label: 'Team', icon: 'team', owner: true },
      { to: '/settings', label: 'Einstellungen', icon: 'gear' },
      { to: '/setup', label: 'Einrichtung', icon: 'setup', owner: true },
    ],
  },
];

export const MOBILE_DOCK = [
  { to: '/players', label: 'Spieler', icon: 'users' },
  { to: '/console', label: 'Konsole', icon: 'term', toggleConsole: true },
  { to: '/panel', end: true, label: 'Home', icon: 'home', center: true },
  { to: '/resources', label: 'Scripts', icon: 'box', powerAdjacent: true },
  { to: '/more', label: 'Mehr', icon: 'more' },
];

export function flatModulePaths() {
  const paths = ['/more', '/ingame'];
  for (const g of MODULES) {
    for (const item of g.items) paths.push(item.to);
  }
  return paths;
}
