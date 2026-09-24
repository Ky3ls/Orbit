import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PORT, FX_SERVER_ROOT } from './config.js';
import { setSetting, settingMap } from './db.js';
import { ensureOnce } from './cfgUpsert.js';

const PANEL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_SRC = path.join(PANEL_ROOT, 'resources', 'orbit_bridge');
const PANEL_USER = process.env.ORBIT_USER || 'orbit';

function sudoRun(args) {
  execFileSync('sudo', ['-n', ...args], { timeout: 120_000, stdio: 'pipe' });
}

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

export function orbitPanelLocalUrl() {
  return `http://127.0.0.1:${PORT}`;
}

export function ensureIngameToken(db) {
  const cur = settingMap(db).ingameToken;
  if (cur && String(cur).length >= 24) return String(cur);
  const token = crypto.randomBytes(32).toString('base64url');
  setSetting(db, 'ingameToken', token);
  return token;
}

/**
 * Entfernt alte Datadir-Kopie + ensure orbit aus server.cfg
 * (Orbit liegt nur noch in citizen/system_resources wie txAdmin monitor).
 */
export function removeOrbitFromDataPath(dataPath, onLog = () => {}) {
  if (!dataPath) return;
  const root = String(dataPath).replace(/\/$/, '');
  const legacy = [
    path.join(root, 'resources', '[orbit]', 'orbit'),
    path.join(root, 'resources', 'orbit'),
    path.join(root, 'resources', '[local]', 'orbit'),
  ];
  for (const p of legacy) {
    if (fs.existsSync(p)) {
      rmRf(p);
      onLog(`orbit Datadir-Kopie entfernt: ${p}`);
    }
  }
  const cfg = path.join(root, 'server.cfg');
  if (!fs.existsSync(cfg)) return;
  try {
    let text = fs.readFileSync(cfg, 'utf8');
    const next = text
      .replace(/^\s*ensure\s+orbit\s*$/gim, '')
      .replace(/^\s*start\s+orbit\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n');
    if (next !== text) {
      fs.writeFileSync(cfg, next);
      onLog('ensure orbit aus server.cfg entfernt (system_resources).');
    }
  } catch (err) {
    onLog(`server.cfg cleanup: ${err.message}`);
  }
}

/**
 * Installiert Orbit NUR in FX system_resources (wie txAdmin monitor).
 * Keine Kopie ins Server-Datadir.
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

  if (dataPath) removeOrbitFromDataPath(dataPath, onLog);

  return { ok: true, systemPath: sysDest, dataPath: '' };
}

export function syncOrbitBridgeToDataPath(dataPath, onLog = () => {}) {
  return syncOrbitSystemResource(FX_SERVER_ROOT, dataPath, onLog);
}

/** FX-Launch: Convars + ensure (ohne server.cfg). */
export function orbitFxLaunchExtras(db) {
  const token = ensureIngameToken(db);
  const panel = orbitPanelLocalUrl();
  return [
    '+set', 'orbit_panelUrl', panel,
    '+set', 'orbit_luaComToken', token,
    '+ensure', 'orbit',
  ];
}

export function hotDeployOrbit(db, sendCmd, fxRoot, dataPath, onLog = () => {}) {
  syncOrbitSystemResource(fxRoot || FX_SERVER_ROOT, dataPath, onLog);
  const token = ensureIngameToken(db);
  const panel = orbitPanelLocalUrl();
  sendCmd(`set orbit_panelUrl "${panel}"`);
  sendCmd(`set orbit_luaComToken "${token}"`);
  sendCmd('ensure orbit');
  onLog('orbit hot-deployed (system_resources + ensure)');
  return { panel, tokenSet: true };
}

/** @deprecated — ensure orbit kommt nur noch aus Launch-Args */
export function ensureOrbitInServerCfg(_dataPath, _onLog = () => {}) {
  return false;
}

// keep ensureOnce import unused-safe if tree-shaken elsewhere
void ensureOnce;
