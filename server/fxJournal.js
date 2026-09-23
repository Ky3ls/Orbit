import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FX_UNIT } from './control.js';
import { orbitControlMode } from './fxLaunch.js';
import { supervisorRunning } from './fxSupervisor.js';

const exec = promisify(execFile);
let seen = new Set();
let boot = true;

/**
 * FXServer-Logs aus systemd/journal — unabhängig von txAdmin.
 * @param {Record<string, string>} [settings]
 */
export async function pollFxJournal(logLine, settings) {
  if (settings && orbitControlMode(settings) === 'orbit' && supervisorRunning()) {
    return;
  }
  try {
    const { stdout } = await exec('journalctl', [
      '-u', FX_UNIT,
      '-n', '60',
      '--no-pager',
      '-o', 'cat',
    ], { timeout: 5000, maxBuffer: 512 * 1024 });
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    if (boot) {
      lines.forEach((l) => seen.add(l));
      boot = false;
      return;
    }
    for (const line of lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      if (seen.size > 2000) {
        seen = new Set(lines.slice(-400));
      }
      const level = /(error|failed|fatal)/i.test(line) ? 'bad' : /(warn|warning)/i.test(line) ? 'warn' : 'info';
      logLine(level, line.slice(0, 500));
    }
  } catch {
    /* journal nicht verfügbar */
  }
}
