import { stripAnsi } from './ansi.js';

export const runtime = {
  online: false,
  hostname: '',
  maxClients: 48,
  clients: 0,
  players: [],
  /** Timestamp letzter Bridge-Sync (GetPlayers / playerJoining) */
  playersSyncedAt: 0,
  fxResources: [],
  host: { cpu: 0, ramPct: 0, ramUsed: 0, ramTotal: 0 },
  series: [],
  console: [],
  consoleSeq: 0,
  /** Letzte Clear-ID — Clients leeren bei console_clear */
  consoleClearId: 0,
  consoleClearedAt: 0,
  boot: Date.now(),
  onlineSince: null,
  /** @type {'idle'|'starting'|'stopping'|'restarting'} */
  controlPhase: 'idle',
  controlEnabled: false,
  unitActive: false,
  fxVersion: '',
  fxControlMode: 'systemd',
  fxCommandReady: false,
  supervisorPhase: 'idle',
  /** @type {Array<Record<string, unknown>>} */
  instances: [],
};

const MAX_SERIES = 180;
const MAX_CONSOLE = 2500;

/** @type {((level: string, text: string) => void) | null} */
let logHook = null;

/** @type {Set<() => void>} SSE / Live-Console Wakeups */
const consoleWake = new Set();

export function setLogHook(fn) {
  logHook = fn;
}

/** Sofort-Push bei neuer Konsolenzeile (SSE). */
export function onConsoleWake(fn) {
  consoleWake.add(fn);
  return () => consoleWake.delete(fn);
}

function notifyConsoleWake() {
  for (const fn of consoleWake) {
    try { fn(); } catch { /* */ }
  }
}

export function pushSeries(point) {
  runtime.series.push(point);
  if (runtime.series.length > MAX_SERIES) runtime.series.shift();
}

/** Orbit-Panel-Status — nicht in die Live-Konsole (Login, Boot-Monitor, Sync, Setup…). */
function isLiveConsoleNoise(text) {
  const t = String(text || '');
  if (/^(?:\[FX:\d+\]\s*)?(?:Boot OK|Boot-Monitor|Boot-Timeout|Start in |Stop…|Stop vor Start|Quiet Mode|chat:|Permissions in |Crash-Restart|Auto-Restart|Resource startete|beendet \()/i.test(t)) {
    return true;
  }
  if (/FiveM-Endpunkt (?:nicht )?erreichbar/i.test(t)) return true;
  if (/über Cfx\.re angemeldet$/i.test(t)) return true;
  if (/^[^\s]+ angemeldet$/i.test(t)) return true;
  if (/Cfx\.re verknüpft/i.test(t)) return true;
  if (/Master-Account .+ angelegt/i.test(t)) return true;
  // Setup / Artifact / Recipe-Fortschritt
  if (/^(?:Lade Artifact|Entpacke|Artifact bereit|Orbit-Server |mysql_connection_string|systemd orbit\.service\.d|Serverprofil |Lade |Clone |ZIP |Profil „|Permissions-Block|MySQL|FX Artifact|cfx-server-data|Bestehenden Server|SQL bereits|Vorhandener Server|ensureOnce|Altes public|Schreibzugriff|Lesezugriff|Traverse |Ordner angelegt|Ressourcen-Scan)/i.test(t)) {
    return true;
  }
  if (/unter \/opt\/orbit\/servers\//i.test(t)) return true;
  return false;
}

/**
 * @param {string} level
 * @param {string} text
 * @param {{ console?: boolean }} [opts] console:false = nur Hook/Audit, nicht Live-Konsole
 */
export function logLine(level, text, opts = {}) {
  runtime.consoleSeq += 1;
  const clean = stripAnsi(text).slice(0, 500);
  const toConsole = opts.console !== false && !isLiveConsoleNoise(clean);
  if (toConsole) {
    runtime.console.push({
      id: runtime.consoleSeq,
      t: Date.now(),
      level,
      text: clean,
    });
    if (runtime.console.length > MAX_CONSOLE) runtime.console.splice(0, runtime.console.length - MAX_CONSOLE);
    notifyConsoleWake();
  }
  try {
    logHook?.(level, clean);
  } catch { /* */ }
}

/** Explizit Panel-only (nie Live-Konsole). */
export function logPanel(level, text) {
  logLine(level, text, { console: false });
}

/** Panel-Konsole leeren (z. B. bei Server-Start). */
export function clearConsole() {
  runtime.console.length = 0;
  runtime.consoleSeq += 1;
  runtime.consoleClearedAt = Date.now();
  runtime.consoleClearId = runtime.consoleSeq;
  notifyConsoleWake();
}

export function snapshot() {
  const phase = runtime.controlPhase;
  let status = runtime.online ? 'online' : 'offline';
  if (phase === 'starting') status = 'starting';
  else if (phase === 'stopping') status = 'stopping';
  else if (phase === 'restarting') status = 'restarting';
  return {
    online: runtime.online,
    hostname: runtime.hostname,
    maxClients: runtime.maxClients,
    clients: runtime.clients,
    host: runtime.host,
    series: runtime.series,
    boot: runtime.boot,
    onlineSince: runtime.onlineSince,
    consoleSeq: runtime.consoleSeq,
    status,
    controlPhase: phase,
    controlEnabled: runtime.controlEnabled,
    unitActive: runtime.unitActive,
    processActive: runtime.unitActive,
    fxVersion: runtime.fxVersion,
    playerCount: runtime.clients,
    fxControlMode: runtime.fxControlMode,
    fxCommandReady: runtime.fxCommandReady,
    supervisorPhase: runtime.supervisorPhase,
    instances: runtime.instances,
  };
}
