/**
 * Globale Navigation (spielunabhängig). Die Seiten eines einzelnen Servers kommen aus
 * games.js → serverNav(), damit jedes Spiel denselben Aufbau bekommt.
 */
import { navMatches, serverKeyForPath, serverNav } from '../games.js';

export const GLOBAL_NAV = [
  { to: '/home', end: true, labelKey: 'nav.overview', icon: 'dashboard', key: 'h', kw: 'home dashboard übersicht alle server host' },
];

export const HOST_NAV = [
  { to: '/host/databases', label: 'Datenbanken', icon: 'db', key: 'q', admin: true, kw: 'datenbank database mysql mariadb postgres postgresql redis benutzer passwort' },
  { to: '/host/web', label: 'Domains & Web', icon: 'globe', key: 'w', admin: true, kw: 'domain domains web nginx apache caddy ssl zertifikat lets encrypt cloudflare dns website proxy' },
  { to: '/host/services', label: 'Dienste', icon: 'cpu', key: 'y', admin: true, kw: 'dienste services system neustart restart log systemd' },
];

export const MANAGE_NAV = [
  { to: '/admins', labelKey: 'nav.admins', icon: 'team', owner: true, key: 't', kw: 'team admins rollen rechte' },
  { to: '/audit', labelKey: 'nav.audit', icon: 'audit', key: 'u', kw: 'audit aktionen protokoll' },
  { to: '/settings', labelKey: 'nav.settings', icon: 'gear', key: 's', kw: 'einstellungen settings discord aussehen' },
];

export const navLabel = (t, item) => (item.labelKey ? t(item.labelKey) : item.label);

/** Navigation als Gruppen (für Tastenkürzel-Hilfe und Befehlspalette) */
export function navGroups(t, server) {
  const groups = [{ id: 'global', label: 'Orbit', items: GLOBAL_NAV.map((i) => ({ ...i, label: navLabel(t, i) })) }];
  const sn = serverNav(server);
  if (sn.length) groups.push({ id: 'server', label: server.name, items: sn });
  groups.push({ id: 'host', label: 'Host', items: HOST_NAV });
  groups.push({ id: 'manage', label: t('nav.manage'), items: MANAGE_NAV.map((i) => ({ ...i, label: navLabel(t, i) })) });
  return groups;
}

/** Wo bin ich? → { scope, key, server, item } */
export function locate(pathname, search, servers) {
  const key = serverKeyForPath(pathname);
  if (key) {
    const server = servers.find((s) => s.key === key) || null;
    const item = server ? serverNav(server).find((i) => navMatches(i, pathname, search)) : null;
    return { scope: 'server', key, server, item };
  }
  const all = [...GLOBAL_NAV, ...HOST_NAV, ...MANAGE_NAV];
  let item = all.find((i) => navMatches(i, pathname, search)) || null;
  if (!item && pathname.startsWith('/instances')) {
    item = { to: pathname, label: pathname.includes('import') ? 'Server importieren' : 'Neuer Server', icon: 'plus' };
  }
  return { scope: 'global', key: null, server: null, item };
}
