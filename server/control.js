import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { orbitControlMode } from './fxLaunch.js';
import {
  restartFxProcess,
  resolveInstanceKey,
  startFxProcess,
  stopFxProcess,
  supervisorRunning,
} from './fxSupervisor.js';

const execFileAsync = promisify(execFile);

/** Hardcoded unit — never accept unit names from the client. */
export const FX_UNIT = 'fivem-txadmin.service';
const ALLOWED = new Set(['start', 'stop', 'restart']);

export async function unitActive() {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', FX_UNIT], {
      timeout: 5000,
      maxBuffer: 1024,
    });
    return String(stdout).trim() === 'active';
  } catch {
    return false;
  }
}

export async function fxProcessActive(settings) {
  if (orbitControlMode(settings) === 'orbit') return supervisorRunning(resolveInstanceKey(settings));
  return unitActive();
}

/**
 * @param {'start'|'stop'|'restart'} action
 * @param {Record<string, string>} settings
 * @param {(level: string, text: string) => void} logLine
 */
export async function controlFx(action, settings, logLine, opts = {}) {
  if (!ALLOWED.has(action)) {
    throw Object.assign(new Error('Ungültige Aktion.'), { status: 400 });
  }
  if (orbitControlMode(settings) === 'orbit') {
    const instOpts = { instanceId: opts.instanceId };
    if (action === 'start') return startFxProcess(settings, logLine, instOpts);
    if (action === 'stop') return stopFxProcess(settings, logLine, instOpts);
    return restartFxProcess(settings, logLine, instOpts);
  }
  await execFileAsync('systemctl', [action, FX_UNIT], {
    timeout: 120_000,
    maxBuffer: 4096,
  });
  return { ok: true, action, unit: FX_UNIT };
}
