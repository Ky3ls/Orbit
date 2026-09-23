import fs from 'node:fs';
import path from 'node:path';
import { CFG_PATH, FX_DATA_PATH, FX_SERVER_ROOT } from './config.js';
import { orbitFxLaunchExtras } from './orbitBridgeSync.js';

/**
 * Pfade und Spawn-Argumente für einen Orbit-gestarteten FXServer (ohne txAdmin-Monitor).
 * @param {Record<string, string>} settings
 * @param {{ db?: import('node:sqlite').DatabaseSync }} [opts]
 */
export function resolveFxLaunch(settings, opts = {}) {
  const fxRoot = String(settings.fxServerRoot || FX_SERVER_ROOT).replace(/\/$/, '');
  const dataPath = String(settings.fxDataPath || FX_DATA_PATH || path.dirname(CFG_PATH)).replace(/\/$/, '');
  const cfgFile = path.join(dataPath, 'server.cfg');
  if (!fs.existsSync(cfgFile)) {
    throw new Error(`server.cfg fehlt: ${cfgFile}`);
  }

  const loader = path.join(fxRoot, 'alpine/opt/cfx-server/ld-musl-x86_64.so.1');
  const binary = path.join(fxRoot, 'alpine/opt/cfx-server/FXServer');
  const citizen = path.join(fxRoot, 'alpine/opt/cfx-server/citizen/');
  const libPath = [
    path.join(fxRoot, 'alpine/usr/lib/v8/'),
    path.join(fxRoot, 'alpine/lib/'),
    path.join(fxRoot, 'alpine/usr/lib/'),
  ].join(':');

  if (!fs.existsSync(loader) || !fs.existsSync(binary)) {
    throw new Error(`FXServer nicht gefunden unter ${fxRoot} (alpine/opt/cfx-server/).`);
  }

  const fxArgs = [
    '--library-path', libPath, '--',
    binary,
    '+set', 'citizen_dir', citizen,
    '+exec', 'server.cfg',
  ];

  if (opts.db) {
    fxArgs.push(...orbitFxLaunchExtras(opts.db));
  }

  const extra = String(settings.fxServerExtraArgs || '').trim();
  if (extra) {
    for (const token of extra.split(/\s+/).filter(Boolean)) fxArgs.push(token);
  }

  return {
    fxRoot,
    dataPath,
    cfgFile,
    command: loader,
    args: fxArgs,
  };
}

export function orbitControlMode(settings) {
  return settings.fxControlMode === 'orbit' ? 'orbit' : 'systemd';
}
