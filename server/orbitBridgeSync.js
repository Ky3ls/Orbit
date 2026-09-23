import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOST, PORT, FX_SERVER_ROOT } from './config.js';
import { setSetting, settingMap } from './db.js';

const PANEL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_SRC = path.join(PANEL_ROOT, 'resources', 'orbit_bridge');
const PANEL_USER = process.env.ORBIT_USER || 'orbit';

function sudoRun(args) {
  execFileSync('sudo', ['-n', ...args], { timeout: 120_000, stdio: 'pipe' });
}

/** Löschen — bei EACCES per sudo (root-owned Reste). */
function rmRf(target) {
  if (!target || !fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOTEMPTY') {
      sudoRun(['rm', '-rf', target]);
      return;
    }
    throw err;
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.' || ent.name === '..') continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** Kopie inkl. Fallback sudo cp -a + chown orbit. */
function installDir(src, dest) {
  rmRf(dest);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyDir(src, dest);
  } catch (err) {
    if (err.code !== 'EACCES' && err.code !== 'EPERM') throw err;
    sudoRun(['mkdir', '-p', dest]);
    sudoRun(['cp', '-a', `${src}/.`, dest]);
    sudoRun(['chown', '-R', `${PANEL_USER}:${PANEL_USER}`, dest]);
  }
  try {
    sudoRun(['chown', '-R', `${PANEL_USER}:${PANEL_USER}`, dest]);
  } catch { /* optional */ }
}

/** Interner HTTP-Endpunkt, den FX immer erreichen kann. */
export function orbitPanelLocalUrl() {
  return `http://127.0.0.1:${PORT}`;
}

/** Stellt sicher, dass ein Pipe-Token existiert (wie txAdmin luaComToken). */
export function ensureIngameToken(db) {
  const cur = settingMap(db).ingameToken;
  if (cur && String(cur).length >= 24) return String(cur);
  const token = crypto.randomBytes(32).toString('base64url');
  setSetting(db, 'ingameToken', token);
  return token;
}

/**
 * Stellt sicher, dass server.cfg `ensure orbit` hat (idempotent).
 */
export function ensureOrbitInServerCfg(dataPath, onLog = () => {}) {
  if (!dataPath) return false;
  const cfg = path.join(String(dataPath).replace(/\/$/, ''), 'server.cfg');
  if (!fs.existsSync(cfg)) return false;
  let raw = fs.readFileSync(cfg, 'utf8');
  if (/^\s*ensure\s+orbit\b/mi.test(raw)) return false;
  raw = `${raw.trimEnd()}\n\n## Orbit Admin-Menü (system_resources — auto)\nensure orbit\n`;
  try {
    fs.writeFileSync(cfg, raw);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      const tmp = `/tmp/orbit-cfg-${Date.now()}.cfg`;
      fs.writeFileSync(tmp, raw);
      sudoRun(['cp', tmp, cfg]);
      sudoRun(['chown', `${PANEL_USER}:${PANEL_USER}`, cfg]);
    } else throw err;
  }
  onLog(`ensure orbit → ${cfg}`);
  return true;
}

/**
 * Kopiert Bridge als System-Resource `orbit` (citizen/system_resources/orbit)
 * und optional ins Datadir.
 */
export function syncOrbitSystemResource(fxServerRoot, dataPath, onLog = () => {}) {
  if (!fs.existsSync(BRIDGE_SRC)) {
    onLog('orbit_bridge Quelle fehlt — übersprungen.');
    return { ok: false, skipped: true };
  }
  const fxRoot = String(fxServerRoot || FX_SERVER_ROOT).replace(/\/$/, '');
  const sysDest = path.join(fxRoot, 'alpine/opt/cfx-server/citizen/system_resources/orbit');
  installDir(BRIDGE_SRC, sysDest);
  onLog(`orbit → system_resources (${sysDest})`);

  let dataDest = '';
  if (dataPath) {
    dataDest = path.join(String(dataPath).replace(/\/$/, ''), 'resources', '[orbit]', 'orbit');
    installDir(BRIDGE_SRC, dataDest);
    onLog(`orbit → datadir (${dataDest})`);
    ensureOrbitInServerCfg(dataPath, onLog);
  }
  return { ok: true, systemPath: sysDest, dataPath: dataDest };
}

/** @deprecated Alias */
export function syncOrbitBridgeToDataPath(dataPath, onLog = () => {}) {
  return syncOrbitSystemResource(FX_SERVER_ROOT, dataPath, onLog);
}

/** FX-Launch-Args: Convars + ensure (ohne manuelle server.cfg). */
export function orbitFxLaunchExtras(db) {
  const token = ensureIngameToken(db);
  const panel = orbitPanelLocalUrl();
  return [
    '+set', 'orbit_panelUrl', panel,
    '+set', 'orbit_luaComToken', token,
    '+ensure', 'orbit',
  ];
}

/**
 * Laufenden FX hot-deployen: Convars setzen + ensure (kein Neustart).
 * @param {(cmd: string) => void} sendCmd
 */
export function hotDeployOrbit(db, sendCmd, fxRoot, dataPath, onLog = () => {}) {
  syncOrbitSystemResource(fxRoot || FX_SERVER_ROOT, dataPath, onLog);
  const token = ensureIngameToken(db);
  const panel = orbitPanelLocalUrl();
  sendCmd(`set orbit_panelUrl "${panel}"`);
  sendCmd(`set orbit_luaComToken "${token}"`);
  sendCmd('ensure orbit');
  onLog('orbit hot-deployed (ensure orbit)');
  return { panel, tokenSet: true };
}
