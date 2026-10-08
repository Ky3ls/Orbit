import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Orbit läuft wie txAdmin als root (systemd ohne User=). */
export function isRoot() {
  try {
    return typeof process.getuid === 'function' && process.getuid() === 0;
  } catch {
    return false;
  }
}

/**
 * Befehl als root ausführen. Unter root direkt, sonst sudo -n (Dev).
 * @param {string[]} args z. B. ['mkdir', '-p', '/path']
 */
export async function rootRun(args, opts = {}) {
  const timeout = opts.timeout ?? 120_000;
  const maxBuffer = opts.maxBuffer ?? 2 * 1024 * 1024;
  if (isRoot()) {
    const [cmd, ...rest] = args;
    return execFileAsync(cmd, rest, { timeout, maxBuffer });
  }
  return execFileAsync('sudo', ['-n', ...args], { timeout, maxBuffer });
}

export function rootRunSync(args, opts = {}) {
  const timeout = opts.timeout ?? 120_000;
  if (isRoot()) {
    const [cmd, ...rest] = args;
    return execFileSync(cmd, rest, { timeout, stdio: opts.stdio ?? 'pipe' });
  }
  return execFileSync('sudo', ['-n', ...args], { timeout, stdio: opts.stdio ?? 'pipe' });
}
