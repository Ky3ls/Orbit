/** Horizontale Hauptnavigation + Dropdown-Gruppen (synchron zu layout/modules.js) */

import { MODULES } from '../layout/modules.js';

export const PRIMARY_DEFS = [
  { to: '/panel', end: true, labelKey: 'nav.command' },
  { to: '/players', labelKey: 'nav.players' },
  { to: '/resources', labelKey: 'nav.resources' },
  { to: '/monitoring', labelKey: 'nav.monitoring' },
];

/** @deprecated — nutze localizedPrimary(t) */
export const PRIMARY = PRIMARY_DEFS.map((i) => ({ ...i, label: i.labelKey }));

export function localizedPrimary(t) {
  return PRIMARY_DEFS.map((i) => ({ ...i, label: t(i.labelKey) }));
}

export function localizedGroups(t) {
  return [
    {
      id: 'server',
      label: t('nav.server'),
      items: [
        { to: '/cfg', label: t('nav.cfg') },
        { to: '/schedule', label: t('nav.schedule') },
        { to: '/server-log', label: t('nav.serverLog') },
        { to: '/ingame', label: t('nav.ingame') },
      ],
    },
    {
      id: 'system',
      label: t('nav.sys'),
      items: MODULES.find((m) => m.id === 'sys').items.map(({ to, labelKey, owner }) => ({
        to,
        label: t(labelKey),
        owner,
      })),
    },
  ];
}

/** @deprecated */
export const GROUPS = [
  {
    id: 'server',
    label: 'Server',
    items: [
      { to: '/cfg', label: 'CFG' },
      { to: '/schedule', label: 'Automationen' },
      { to: '/server-log', label: 'Server-/FX-Log' },
      { to: '/ingame', label: 'Ingame' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: MODULES.find((m) => m.id === 'sys').items.map(({ to, labelKey, owner }) => ({
      to,
      label: labelKey,
      owner,
    })),
  },
];

export function pathInGroup(pathname) {
  const groups = [
    { id: 'server', items: [{ to: '/cfg' }, { to: '/schedule' }, { to: '/server-log' }, { to: '/ingame' }] },
    { id: 'system', items: MODULES.find((m) => m.id === 'sys').items },
  ];
  for (const g of groups) {
    if (g.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))) return g.id;
  }
  return null;
}
