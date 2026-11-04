/** Gemeinsame Helfer für die Minecraft-Seiten */

export const TYPE_META = {
  vanilla: { label: 'Vanilla', group: 'Vanilla', color: '#7fb238', short: 'VAN' },
  paper: { label: 'Paper', group: 'Plugins', color: '#4b8bf5', short: 'PAP' },
  purpur: { label: 'Purpur', group: 'Plugins', color: '#a855f7', short: 'PUR' },
  fabric: { label: 'Fabric', group: 'Mods', color: '#dbb98a', short: 'FAB' },
  forge: { label: 'Forge', group: 'Mods', color: '#e0692e', short: 'FOR' },
  neoforge: { label: 'NeoForge', group: 'Mods', color: '#d8763a', short: 'NEO' },
};

export const PHASE = {
  running: { label: 'Online', tone: 'ok' },
  starting: { label: 'Startet…', tone: 'warn' },
  stopping: { label: 'Stoppt…', tone: 'warn' },
  crashed: { label: 'Abgestürzt', tone: 'bad' },
  offline: { label: 'Offline', tone: 'idle' },
  installing: { label: 'Installiert…', tone: 'warn' },
  failed: { label: 'Installation fehlgeschlagen', tone: 'bad' },
};

export function phaseOf(inst) {
  return PHASE[inst?.status?.phase] || PHASE.offline;
}

export function fmtMb(mb) {
  if (!mb && mb !== 0) return '–';
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`;
}

export function fmtDur(ms) {
  if (!ms || ms < 0) return '–';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} Std. ${m % 60} Min.`;
  return `${Math.floor(h / 24)} Tage`;
}

export function serverAddress(inst) {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return inst.port === 25565 ? host : `${host}:${inst.port}`;
}
