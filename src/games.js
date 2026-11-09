/**
 * Spiele-Registry — alles Spielspezifische (Farbe, Name, Navigation, Status) hängt hier dran,
 * damit die Oberfläche für jedes Spiel gleich aufgebaut ist.
 */
export const GAMES = {
  minecraft: { id: 'minecraft', label: 'Minecraft', color: '#7fb238', ready: true, blurb: 'Vanilla, Paper, Purpur, Fabric, Forge, NeoForge' },
  fivem: { id: 'fivem', label: 'FiveM', color: '#f97316', ready: true, blurb: 'FXServer mit Recipes (ESX, QBCore, Minimal)' },
  terraria: { id: 'terraria', label: 'Terraria', color: '#38bdf8', ready: false, blurb: 'Vanilla und tModLoader' },
  rust: { id: 'rust', label: 'Rust', color: '#ce422b', ready: false, blurb: 'Rust Dedicated mit Oxide/uMod' },
};

export const GAME_ORDER = ['minecraft', 'fivem', 'terraria', 'rust'];

export const PHASE_TONE = {
  running: 'ok', online: 'ok', starting: 'warn', stopping: 'warn', restarting: 'warn',
  installing: 'warn', crashed: 'bad', failed: 'bad', offline: 'idle', stopped: 'idle',
};
export const PHASE_LABEL = {
  running: 'Online', online: 'Online', starting: 'Startet', stopping: 'Stoppt', restarting: 'Neustart',
  installing: 'Installiert', crashed: 'Abgestürzt', failed: 'Fehler', offline: 'Offline', stopped: 'Offline',
};

/** Seiten-Navigation pro Spiel. `path` relativ zur Server-Basis. */
export function serverNav(server) {
  if (!server) return [];
  if (server.game === 'fivem') {
    if (!server.active) return [{ id: 'manage', label: 'Verwalten', icon: 'gear', to: '/settings?section=host&tab=servers' }];
    return [
      { id: 'overview', label: 'Übersicht', icon: 'dashboard', to: '/panel', end: true, key: 'd' },
      { id: 'players', label: 'Spieler', icon: 'users', to: '/players', key: 'p', count: true },
      { id: 'resources', label: 'Ressourcen', icon: 'box', to: '/resources', key: 'r' },
      { id: 'cfg', label: 'Konfiguration', icon: 'cfg', to: '/cfg', key: 'c' },
      { id: 'log', label: 'Server-Log', icon: 'log', to: '/server-log', key: 'l' },
      { id: 'database', label: 'Datenbank', icon: 'db', to: '/database', key: 'b' },
      { id: 'monitoring', label: 'Monitoring', icon: 'activity', to: '/monitoring', key: 'm' },
      { id: 'schedule', label: 'Automationen', icon: 'calendar', to: '/schedule', key: 'a' },
      { id: 'ingame', label: 'Ingame-Menü', icon: 'gamepad', to: '/ingame' },
    ];
  }
  if (server.game === 'minecraft') {
    const b = `/mc/${server.id}`;
    const items = [
      { id: 'console', label: 'Übersicht', icon: 'dashboard', to: b, end: true, key: 'd' },
      { id: 'players', label: 'Spieler', icon: 'users', to: `${b}/players`, key: 'p', count: true },
    ];
    if (server.modKind) items.push({ id: 'mods', label: server.modKind, icon: 'box', to: `${b}/mods`, key: 'r' });
    items.push(
      { id: 'settings', label: 'Konfiguration', icon: 'cfg', to: `${b}/settings`, key: 'c' },
      { id: 'files', label: 'Dateien', icon: 'folder', to: `${b}/files`, key: 'f' },
      { id: 'backups', label: 'Backups', icon: 'archive', to: `${b}/backups`, key: 'k' },
      { id: 'instance', label: 'Instanz', icon: 'gear', to: `${b}/instance` },
    );
    return items;
  }
  return [];
}

export function navMatches(item, pathname, search = '') {
  const [p, q] = item.to.split('?');
  if (q) return pathname === p && search.includes(q.split('&')[0]);
  return item.end ? pathname === p : pathname === p || pathname.startsWith(`${p}/`);
}

const FX_PATHS = ['/panel', '/players', '/resources', '/cfg', '/server-log', '/database', '/monitoring', '/schedule', '/ingame'];

/** Welcher Server gehört zu dieser URL? */
export function serverKeyForPath(pathname) {
  const m = pathname.match(/^\/mc\/(\d+)/);
  if (m) return `minecraft:${m[1]}`;
  if (FX_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'fivem:active';
  return null;
}
