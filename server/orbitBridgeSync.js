import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORT, FX_SERVER_ROOT } from './config.js';
import { setSetting, settingMap } from './db.js';
import { ensureOnce } from './cfgUpsert.js';
import { rootRunSync } from './rootExec.js';

const PANEL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_SRC = path.join(PANEL_ROOT, 'resources', 'orbit_bridge');

function rmRf(target) {
  if (!target || !fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'ENOTEMPTY') {
      rootRunSync(['rm', '-rf', target]);
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
    rootRunSync(['mkdir', '-p', dest]);
    rootRunSync(['cp', '-a', `${src}/.`, dest]);
  }
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
  ensureFxNodePackageSentinel(fxRoot, onLog);

  if (dataPath) {
    removeOrbitFromDataPath(dataPath, onLog);
    silenceNodePackageWalk(dataPath, onLog);
  }

  return { ok: true, systemPath: sysDest, dataPath: '' };
}

export function syncOrbitBridgeToDataPath(dataPath, onLog = () => {}) {
  return syncOrbitSystemResource(FX_SERVER_ROOT, dataPath, onLog);
}

/**
 * FX-Boot: Orbit als System-Resource VOR +exec (nicht in server.cfg, kein Konsolen-Befehl).
 * Aufrufer muss die Args vor `+exec server.cfg` einfügen.
 */
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
 * FX system_resources/yarn (und webpack) wandern von
 * …/alpine/opt/cfx-server/citizen/system_resources/yarn nach oben und treffen
 * sonst /opt/orbit/package.json ("type":"module") → yarn_cli.js crasht.
 * Sentinel OHNE type:module stoppt den Walk im Artifact.
 */
export function ensureFxNodePackageSentinel(fxServerRoot, onLog = () => {}) {
  const fxRoot = String(fxServerRoot || '').replace(/\/$/, '');
  if (!fxRoot || !fs.existsSync(fxRoot)) return { wrote: 0 };
  const body = `${JSON.stringify({ name: 'cfx-fxserver', private: true }, null, 2)}\n`;
  const targets = [
    fxRoot,
    path.join(fxRoot, 'alpine'),
    path.join(fxRoot, 'alpine/opt/cfx-server'),
    path.join(fxRoot, 'alpine/opt/cfx-server/citizen/system_resources'),
    path.join(fxRoot, 'alpine/opt/cfx-server/citizen/system_resources/yarn'),
    path.join(fxRoot, 'alpine/opt/cfx-server/citizen/system_resources/webpack'),
  ];
  let wrote = 0;
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    const pj = path.join(dir, 'package.json');
    let need = true;
    if (fs.existsSync(pj)) {
      try {
        const cur = JSON.parse(fs.readFileSync(pj, 'utf8'));
        // Nur überschreiben wenn type:module (oder kaputt) — echte package.json der Resource schonen
        if (cur && typeof cur === 'object' && cur.type !== 'module' && cur.name) need = false;
      } catch {
        need = true;
      }
    }
    if (!need) continue;
    try {
      fs.writeFileSync(pj, body);
      wrote += 1;
    } catch (err) {
      onLog(`package-sentinel fail ${dir}: ${err.message}`);
    }
  }
  if (wrote) onLog(`FX node package-sentinel: ${wrote} Datei(en) unter ${fxRoot}`);
  return { wrote };
}

/**
 * Node-Ressourcen ohne eigene package.json wandern die Ordnerkette hoch und
 * treffen die Panel-/opt/orbit/package.json → FX-Sandbox: "no device found".
 * Sentinel + .yarn.installed stoppt den Walk in der Resource (ohne yarn-Build).
 */
export function silenceNodePackageWalk(dataPath, onLog = () => {}) {
  if (!dataPath || !fs.existsSync(dataPath)) return { fixed: 0 };
  const resourcesRoot = path.join(dataPath, 'resources');
  if (!fs.existsSync(resourcesRoot)) return { fixed: 0 };

  let fixed = 0;
  const stack = [resourcesRoot];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const manifest = ents.find((e) => e.isFile() && /^fxmanifest\.lua$/i.test(e.name));
    if (manifest) {
      let raw = '';
      try {
        raw = fs.readFileSync(path.join(dir, manifest.name), 'utf8');
      } catch {
        raw = '';
      }
      const isNode = /\bnode_version\b/i.test(raw)
        || /server_script\s+['"][^'"]+\.js['"]/i.test(raw)
        || /server_scripts\s*\{[^}]*\.js/i.test(raw);
      if (isNode) {
        const pj = path.join(dir, 'package.json');
        const lock = path.join(dir, '.yarn.installed');
        if (!fs.existsSync(pj)) {
          const name = path.basename(dir).replace(/[^\w.-]+/g, '') || 'fx-node-resource';
          fs.writeFileSync(
            pj,
            `${JSON.stringify({ name, private: true }, null, 2)}\n`,
          );
          fs.writeFileSync(lock, '');
          const now = new Date();
          try { fs.utimesSync(lock, now, now); } catch { /* */ }
          fixed += 1;
          onLog(`node package-sentinel: ${path.relative(dataPath, dir)}`);
        } else if (!fs.existsSync(lock)) {
          fs.writeFileSync(lock, '');
          const now = new Date();
          try {
            const st = fs.statSync(pj);
            const t = new Date(Math.max(st.mtimeMs, Date.now()));
            fs.utimesSync(lock, t, t);
          } catch {
            try { fs.utimesSync(lock, now, now); } catch { /* */ }
          }
        }
      }
      continue;
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'cache') continue;
      stack.push(path.join(dir, ent.name));
    }
  }
  return { fixed };
}

export function hotDeployOrbit(db, sendCmd, fxRoot, dataPath, onLog = () => {}) {
  syncOrbitSystemResource(fxRoot || FX_SERVER_ROOT, dataPath, onLog);
  ensureFxNodePackageSentinel(fxRoot || FX_SERVER_ROOT, onLog);
  if (dataPath) silenceNodePackageWalk(dataPath, onLog);
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
