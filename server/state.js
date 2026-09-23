import { stripAnsi } from './ansi.js';

export const runtime = {
  online: false,
  hostname: '',
  maxClients: 48,
  clients: 0,
  players: [],
  fxResources: [],
  host: { cpu: 0, ramPct: 0, ramUsed: 0, ramTotal: 0 },
  series: [],
  console: [],
  consoleSeq: 0,
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

export function setLogHook(fn) {
  logHook = fn;
}

export function pushSeries(point) {
  runtime.series.push(point);
  if (runtime.series.length > MAX_SERIES) runtime.series.shift();
}

export function logLine(level, text) {
  runtime.consoleSeq += 1;
  const clean = stripAnsi(text).slice(0, 500);
  runtime.console.push({
    id: runtime.consoleSeq,
    t: Date.now(),
    level,
    text: clean,
  });
  if (runtime.console.length > MAX_CONSOLE) runtime.console.splice(0, runtime.console.length - MAX_CONSOLE);
  try {
    logHook?.(level, clean);
  } catch { /* */ }
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
