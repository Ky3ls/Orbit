/** Horizontale Hauptnavigation + Dropdown-Gruppen (synchron zu layout/modules.js) */

import { MODULES } from '../layout/modules.js';

export const PRIMARY = [
  { to: '/panel', end: true, label: 'Command' },
  { to: '/players', label: 'Spieler' },
  { to: '/resources', label: 'Ressourcen' },
  { to: '/monitoring', label: 'Monitoring' },
];

/** System-Dropdown aus zentraler Modulliste — kein doppeltes „Plattform“ mehr. */
export const GROUPS = [
  {
    id: 'mod',
    label: 'Moderation',
    items: MODULES.find((m) => m.id === 'mod').items.map(({ to, label, owner }) => ({ to, label, owner })),
  },
  {
    id: 'server',
    label: 'Server',
    items: [
      { to: '/cfg', label: 'CFG' },
      { to: '/schedule', label: 'Zeitpläne' },
      { to: '/server-log', label: 'Server-Log' },
      { to: '/ingame', label: 'Ingame' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: MODULES.find((m) => m.id === 'sys').items.map(({ to, label, owner }) => ({ to, label, owner })),
  },
];

export function pathInGroup(pathname) {
  for (const g of GROUPS) {
    if (g.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))) return g.id;
  }
  return null;
}
