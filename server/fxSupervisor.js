import { spawn } from 'node:child_process';
import path from 'node:path';
import { orbitControlMode, resolveFxLaunch } from './fxLaunch.js';
import { emitFxConsoleLine, markFxConsoleEof, resetFxConsoleLog } from './fxLogTail.js';
import { clearConsole } from './state.js';

const MAX_BACKOFF_SEC = 120;
/** Nach so vielen Sekunden stabil → Crash-Zähler zurücksetzen */
const STABLE_MS = 90_000;

/** @typedef {{ child: import('node:child_process').ChildProcess | null, phase: 'idle'|'starting'|'running'|'stopping', lastSettings: Record<string, string> | null, restartAttempt: number, manualStop: boolean, startedAt: number, restartTimer: ReturnType<typeof setTimeout> | null }} Inst */

/** @type {Map<string, Inst>} */
const instances = new Map();

function emptyInst() {
  return {
    child: null,
    phase: 'idle',
    lastSettings: null,
    restartAttempt: 0,
    manualStop: false,
    startedAt: 0,
    restartTimer: null,
    bootTimer: null,
    bootResourceFail: false,
  };
}

function getInst(key) {
  const k = String(key || 'default');
  if (!instances.has(k)) instances.set(k, emptyInst());
  return instances.get(k);
}

export function resolveInstanceKey(settings, instanceId) {
  if (instanceId !== undefined && instanceId !== null && instanceId !== '') {
    return String(instanceId);
  }
  return String(settings?.activeOrbitServerId || settings?.orbitServerSlug || 'default');
}

export function listSupervisorInstances() {
  const out = [];
  for (const [id, inst] of instances) {
    out.push({
      id,
      phase: inst.phase,
      pid: inst.child?.pid ?? null,
      dataPath: inst.lastSettings?.fxDataPath || '',
    });
  }
  return out;
}

export function supervisorPhase(instanceKey) {
  if (instanceKey === undefined) {
    for (const inst of instances.values()) {
      if (inst.phase === 'running' || inst.phase === 'starting') return inst.phase;
    }
    return 'idle';
  }
  return getInst(instanceKey).phase;
}

export function supervisorRunning(instanceKey) {
  if (instanceKey === undefined) {
    return instances.values().some((i) => i.phase === 'running' || i.phase === 'starting');
  }
  const p = getInst(instanceKey).phase;
  return p === 'running' || p === 'starting';
}

export function supervisorConsoleReady(settings) {
  const tryKey = (key) => {
    const inst = getInst(key);
    return !!(inst.phase === 'running' && inst.child?.stdin && !inst.child.stdin.destroyed);
  };
  if (settings) {
    if (tryKey(resolveInstanceKey(settings))) return true;
  }
  // Fallback: irgendeine laufende Instanz (verhindert „Konsole offline“ bei Key-Mismatch)
  for (const [key] of instances) {
    if (tryKey(key)) return true;
  }
  return false;
}

function settingsKey(settings) {
  return `${settings.fxServerRoot || ''}|${settings.fxDataPath || ''}`;
}

function attachStreams(proc, logLine, key, dataPath, settings) {
  const prefix = `[FX:${key}] `;
  const quiet = settings?.quietMode === '1' || settings?.quietMode === true;
  // Quiet: Live-Konsole + Logdatei weiter; kein Mirror auf process.stdout (systemd/Terminal)
  const onData = (chunk) => {
    const text = String(chunk);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      const out = `${prefix}${trimmed.slice(0, 480)}`;
      if (dataPath) emitFxConsoleLine(dataPath, out, logLine);
      else logLine('info', out);
      if (!quiet) {
        try {
          process.stdout.write(`${out}\n`);
        } catch { /* */ }
      }
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);

  // Boot-Monitor: „failed to start in time“ → Fail-Flag
  const onBootHint = (chunk) => {
    const t = String(chunk);
    if (/failed to start in time/i.test(t) || /Couldn't start resource/i.test(t)) {
      const inst = getInst(key);
      inst.bootResourceFail = true;
    }
  };
  proc.stdout?.on('data', onBootHint);
  proc.stderr?.on('data', onBootHint);
}

/**
 * @param {Record<string, string>} settings
 * @param {(level: string, text: string) => void} logLine
 * @param {{ instanceId?: string|number }} [opts]
 */
export async function startFxProcess(settings, logLine, opts = {}) {
  if (orbitControlMode(settings) !== 'orbit') {
    throw new Error('Orbit-Prozessmodus ist in den Einstellungen nicht aktiv.');
  }
  const key = resolveInstanceKey(settings, opts.instanceId);
  const inst = getInst(key);
  const port = Number(settings?.fivemPort) || 30120;
  const launch = resolveFxLaunch(settings, { db: opts.db });

  // Sofort leeren — Live-Konsole zeigt danach nur Start-/Stop-vor-Start-Logs
  clearConsole();
  resetFxConsoleLog(launch.dataPath);
  markFxConsoleEof(launch.dataPath);

  // Wenn noch etwas läuft / Port belegt → zuerst stoppen (kein EADDRINUSE)
  const { unitActive, FX_UNIT } = await import('./control.js');
  const systemdBusy = await unitActive();
  const orbitBusy = inst.phase === 'running' || inst.phase === 'starting' || !!inst.child;
  let portBusy = false;
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('ss', ['-tlnH', `sport = :${port}`], { encoding: 'utf8', timeout: 2000 });
    portBusy = !!String(out || '').trim();
  } catch { /* ss fehlt → ignorieren */ }

  if (orbitBusy || systemdBusy || portBusy) {
    logLine('info', `[FX:${key}] Stop vor Start (Prozess/Port belegt)…`);
    try {
      await forceFreeGamePort(settings, logLine, port);
    } catch (err) {
      logLine('warn', `[FX:${key}] Stop vor Start: ${err.message}`);
    }
    for (let i = 0; i < 20; i += 1) {
      try {
        const { execFileSync } = await import('node:child_process');
        const out = execFileSync('ss', ['-tlnH', `sport = :${port}`], { encoding: 'utf8', timeout: 2000 });
        if (!String(out || '').trim()) break;
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (await unitActive()) {
      throw new Error(`${FX_UNIT} läuft noch — manuell stoppen.`);
    }
  }
  // System-Resource vor Start syncen
  try {
    const { getDb, auditLogger } = await import('./db.js');
    const { syncOrbitSystemResource, ensureIngameToken } = await import('./orbitBridgeSync.js');
    const { syncChatFromArtifact } = await import('./cfxDefaults.js');
    const { syncOrbitPermissionsFile, loadMasterIdentity } = await import('./cfgPermissions.js');
    const database = opts.db || getDb();
    ensureIngameToken(database);
    syncOrbitSystemResource(launch.fxRoot, launch.dataPath, auditLogger(database, 'orbit.sync'));
    if (launch.dataPath) {
      syncChatFromArtifact(launch.dataPath, launch.fxRoot, (m) => logLine('info', `[FX:${key}] ${m}`));
      const cfgName = String(settings.fxCfgPath || 'server.cfg').replace(/^\/+/, '') || 'server.cfg';
      const cfgFile = path.join(launch.dataPath, cfgName);
      const synced = syncOrbitPermissionsFile(cfgFile, { db: database, master: loadMasterIdentity(database) });
      if (synced.changed) logLine('info', `[FX:${key}] Orbit Permissions in ${cfgName} aktualisiert (Dateiende).`);
    }
    // Launch-Args mit Token nachreichen falls resolve ohne db lief
    if (!opts.db) {
      const { orbitFxLaunchExtras } = await import('./orbitBridgeSync.js');
      launch.args.push(...orbitFxLaunchExtras(database));
    }
  } catch (err) {
    try {
      const { getDb, auditSystem } = await import('./db.js');
      auditSystem(opts.db || getDb(), 'orbit.sync.fail', err.message);
    } catch { /* */ }
  }
  inst.phase = 'starting';
  inst.lastSettings = { ...settings };
  inst.bootResourceFail = false;
  if (inst.bootTimer) {
    clearTimeout(inst.bootTimer);
    inst.bootTimer = null;
  }
  logLine('info', `[FX:${key}] Start in ${launch.dataPath}`);
  if (settings.quietMode === '1') {
    logLine('info', `[FX:${key}] Quiet Mode — FX-Ausgabe nur in Live-Konsole, nicht im Terminal.`);
  }

  const proc = spawn(launch.command, launch.args, {
    cwd: launch.dataPath,
    env: { ...process.env, TZ: process.env.TZ || 'Europe/Berlin' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });
  inst.child = proc;
  attachStreams(proc, logLine, key, launch.dataPath, settings);

  proc.on('error', (err) => {
    logLine('bad', `[FX:${key}] ${err.message}`);
    inst.child = null;
    inst.phase = 'idle';
    scheduleCrashRestart(inst, key, logLine, 'spawn-error');
  });

  proc.on('exit', (code, signal) => {
    const msg = signal ? `Signal ${signal}` : `Exit ${code}`;
    const crashed = !(code === 0 && !signal);
    logLine(crashed ? 'warn' : 'info', `[FX:${key}] beendet (${msg}).`);
    inst.child = null;
    inst.phase = 'idle';
    if (inst.bootTimer) {
      clearTimeout(inst.bootTimer);
      inst.bootTimer = null;
    }

    if (inst.manualStop) {
      inst.manualStop = false;
      inst.restartAttempt = 0;
      if (inst.restartTimer) {
        clearTimeout(inst.restartTimer);
        inst.restartTimer = null;
      }
      return;
    }

    // Sauberes quit (exit 0) → kein Auto-Restart
    if (!crashed) {
      inst.restartAttempt = 0;
      return;
    }

    scheduleCrashRestart(inst, key, logLine, msg);
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (proc.exitCode === null) {
        inst.phase = 'running';
        inst.startedAt = Date.now();
        resolve();
      }
    }, 800);
    proc.once('spawn', () => {
      clearTimeout(t);
      inst.phase = 'running';
      inst.startedAt = Date.now();
      resolve();
    });
    proc.once('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

  // Resource Starting Tolerance — Boot-Monitor (Probe muss online werden)
  const tolSec = Math.max(30, Number(settings.resourceStartingTolerance) || 90);
  scheduleBootMonitor(inst, key, logLine, settings, tolSec);

  return { ok: true, pid: proc.pid, instanceId: key };
}

/**
 * Wartet bis FiveM-HTTP online; bei Timeout oder Resource-Fail → Kill + Restart.
 */
function scheduleBootMonitor(inst, key, logLine, settings, tolSec) {
  if (inst.bootTimer) clearTimeout(inst.bootTimer);
  const port = Number(settings.fivemPort) || 30120;
  const host = settings.fivemHost || '127.0.0.1';
  const deadline = Date.now() + tolSec * 1000;
  logLine('info', `[FX:${key}] Boot-Monitor ${tolSec}s (Resource Starting Tolerance).`);

  const tick = async () => {
    const cur = getInst(key);
    if (cur.manualStop || !cur.child || cur.child.exitCode !== null) return;
    if (cur.bootResourceFail) {
      logLine('bad', `[FX:${key}] Resource startete nicht rechtzeitig — Neustart.`);
      cur.manualStop = false;
      try { cur.child.kill('SIGTERM'); } catch { /* */ }
      return;
    }
    try {
      const { probeFiveM } = await import('./fivem.js');
      const probe = await probeFiveM(host, port);
      if (probe.online) {
        logLine('ok', `[FX:${key}] Boot OK (Endpunkt online, Toleranz ${tolSec}s).`);
        cur.bootTimer = null;
        return;
      }
    } catch { /* */ }
    if (Date.now() >= deadline) {
      logLine('bad', `[FX:${key}] Boot-Timeout nach ${tolSec}s — Server wird neu gestartet.`);
      cur.manualStop = false;
      try {
        if (cur.child && cur.child.exitCode === null) cur.child.kill('SIGTERM');
      } catch { /* */ }
      // exit-Handler triggert Crash-Restart
      cur.bootTimer = null;
      return;
    }
    cur.bootTimer = setTimeout(tick, 3000);
  };
  inst.bootTimer = setTimeout(tick, 4000);
}

/**
 * Unbegrenzt neu starten mit Backoff; Zähler reset nach stabilem Lauf.
 * @param {Inst} inst
 * @param {string} key
 * @param {(level: string, text: string) => void} logLine
 * @param {string} reason
 */
function scheduleCrashRestart(inst, key, logLine, reason) {
  const auto = inst.lastSettings?.autoRestartEnabled !== '0';
  if (!auto || !inst.lastSettings) {
    logLine('warn', `[FX:${key}] Auto-Restart aus (${reason}).`);
    return;
  }

  // Lief lange stabil → Zähler zurück
  if (inst.startedAt && Date.now() - inst.startedAt >= STABLE_MS) {
    inst.restartAttempt = 0;
  }

  inst.restartAttempt += 1;
  const delaySec = Math.min(MAX_BACKOFF_SEC, 3 * (2 ** Math.min(inst.restartAttempt - 1, 5)));
  logLine('info', `[FX:${key}] Crash-Restart #${inst.restartAttempt} in ${delaySec}s… (${reason})`);

  if (inst.restartTimer) clearTimeout(inst.restartTimer);
  const snap = inst.lastSettings;
  const snapKey = key;
  const attempt = inst.restartAttempt;
  inst.restartTimer = setTimeout(() => {
    inst.restartTimer = null;
    const cur = getInst(snapKey);
    if (cur.manualStop || cur.phase === 'running' || cur.phase === 'starting') return;
    if (!snap) return;
    startFxProcess(snap, logLine, { instanceId: snapKey }).then(() => {
      // Erfolgreicher Spawn behält attempt bis STABLE_MS
      cur.restartAttempt = attempt;
    }).catch((err) => {
      logLine('bad', `[FX:${snapKey}] Auto-Restart fehlgeschlagen: ${err.message}`);
      // Sofort erneut einplanen
      scheduleCrashRestart(cur, snapKey, logLine, err.message);
    });
  }, delaySec * 1000);
}

/**
 * @param {Record<string, string>} settings
 * @param {(level: string, text: string) => void} logLine
 * @param {{ instanceId?: string|number, stopAll?: boolean }} [opts]
 */
export async function stopFxProcess(settings, logLine, opts = {}) {
  if (opts.stopAll) {
    const keys = [...instances.keys()];
    for (const k of keys) {
      await stopFxProcess(settings, logLine, { instanceId: k, killOrphans: false });
    }
    const port = Number(settings?.fivemPort) || 30120;
    await killOrphanFxServers(logLine, port);
    return { ok: true };
  }
  const key = resolveInstanceKey(settings, opts.instanceId);
  const inst = getInst(key);
  if (!inst.child || inst.child.exitCode !== null) {
    inst.child = null;
    inst.phase = 'idle';
    if (opts.killOrphans !== false) await killOrphanFxServers(logLine);
    return { ok: true, instanceId: key };
  }
  inst.phase = 'stopping';
  inst.manualStop = true;
  inst.restartAttempt = 0;
  inst.bootResourceFail = false;
  if (inst.restartTimer) {
    clearTimeout(inst.restartTimer);
    inst.restartTimer = null;
  }
  if (inst.bootTimer) {
    clearTimeout(inst.bootTimer);
    inst.bootTimer = null;
  }
  logLine('info', `[FX:${key}] Stop…`);
  const proc = inst.child;
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* */ }
      resolve();
    }, 12_000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    proc.kill('SIGTERM');
  } catch (err) {
    logLine('warn', `[FX:${key}] Stop: ${err.message}`);
  }
  await done;
  inst.child = null;
  inst.phase = 'idle';
  if (opts.killOrphans !== false) await killOrphanFxServers(logLine);
  return { ok: true, instanceId: key };
}

/** FXServer-Prozesse die nicht mehr im Supervisor hängen (nach Panel-Restart / Wipe). */
export async function killOrphanFxServers(logLine = () => {}, portHint = 0) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const tryExec = async (bin, args) => {
    try {
      await exec(bin, args, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  };

  // 1) direkte PIDs
  let pids = [];
  try {
    const { stdout } = await exec('pgrep', ['-f', 'cfx-server/FXServer'], { timeout: 5000 });
    pids = String(stdout || '').trim().split(/\s+/).filter(Boolean);
  } catch { /* keine */ }
  for (const pid of pids) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 1) continue;
    try {
      process.kill(n, 'SIGTERM');
      logLine('info', `FX SIGTERM pid=${n}`);
    } catch { /* */ }
  }
  if (pids.length) await new Promise((r) => setTimeout(r, 800));
  for (const pid of pids) {
    const n = Number(pid);
    try {
      process.kill(n, 0);
      process.kill(n, 'SIGKILL');
      logLine('warn', `FX SIGKILL pid=${n}`);
    } catch { /* tot */ }
  }

  // 2) sudo pkill (falls Rechte/User anders)
  await tryExec('sudo', ['-n', 'pkill', '-f', 'cfx-server/FXServer']);
  await new Promise((r) => setTimeout(r, 400));
  await tryExec('sudo', ['-n', 'pkill', '-9', '-f', 'cfx-server/FXServer']);

  // 3) Port freischießen
  const port = Number(portHint) || 30120;
  if (port > 0 && port < 65536) {
    await tryExec('sudo', ['-n', 'fuser', '-k', `${port}/tcp`]);
    await tryExec('sudo', ['-n', 'fuser', '-k', `${port}/udp`]);
  }
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Stoppt alle FX-Instanzen + Orphans. Optional Port erzwingen.
 */
export async function forceFreeGamePort(settings, logLine = () => {}, port = 30120) {
  await stopFxProcess(settings, logLine, { stopAll: true });
  await killOrphanFxServers(logLine, port);
  // nochmal Port
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  try {
    await exec('sudo', ['-n', 'fuser', '-k', `${Number(port) || 30120}/tcp`], { timeout: 10_000 });
  } catch { /* */ }
  await new Promise((r) => setTimeout(r, 600));
}

export async function restartFxProcess(settings, logLine, opts = {}) {
  // Wie txAdmin: zuerst alle Spieler kicken, dann stoppen, dann starten
  try {
    const { dispatchFxCommand } = await import('./fxCommand.js');
    const { orbitEventCommand } = await import('./orbitEvents.js');
    await dispatchFxCommand(settings, orbitEventCommand('serverShuttingDown', {
      message: 'Server wird neu gestartet…',
    }));
    await new Promise((r) => setTimeout(r, 800));
  } catch (err) {
    logLine('warn', `Kick vor Restart: ${err.message}`);
  }
  await stopFxProcess(settings, logLine, opts);
  await new Promise((r) => setTimeout(r, 500));
  return startFxProcess(settings, logLine, opts);
}

/**
 * @param {Record<string, string>} settings
 * @param {string} command
 */
export function sendSupervisorCommand(settings, command) {
  const line = String(command || '').trim();
  if (!line) throw new Error('Leerer Konsolenbefehl.');
  const pick = () => {
    if (settings) {
      const key = resolveInstanceKey(settings);
      const inst = getInst(key);
      if (inst.phase === 'running' && inst.child?.stdin && !inst.child.stdin.destroyed) {
        return { key, inst };
      }
    }
    for (const [key, inst] of instances) {
      if (inst.phase === 'running' && inst.child?.stdin && !inst.child.stdin.destroyed) {
        return { key, inst };
      }
    }
    return null;
  };
  const hit = pick();
  if (!hit) throw new Error('FXServer-Konsole nicht verbunden.');
  hit.inst.child.stdin.write(`${line}\n`);
  return '';
}
