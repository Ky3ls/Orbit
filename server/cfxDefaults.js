/**
 * cfx-server-data Defaults (wie txAdmin-Recipes) + Basis-Ensures + Framework-ACE.
 * chat: aus Artifact system_resources (liegt nicht mehr in cfx-server-data).
 * mapmanager/spawnmanager: nur Blank — ESX bricht sonst ab.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureOnce } from './cfgUpsert.js';
import { FX_SERVER_ROOT } from './config.js';

const exec = promisify(execFile);

const CFX_DATA_URL = 'https://github.com/citizenfx/cfx-server-data.git';
/** Letzter Commit mit hardcap + sessionmanager (danach aus master entfernt) */
const CFX_LEGACY_SHA = 'e265cb251c88260533c847d4a1a2838c7d828a66';

const SKIP_TOP = new Set(['[test]', '[local]']);

/** Blank / Minimal */
export const CFX_BLANK_ENSURES = [
  'mapmanager',
  'chat',
  'spawnmanager',
  'sessionmanager',
  'hardcap',
  'baseevents',
  'basic-gamemode',
];

/** ESX / QB — kein mapmanager (ESX stoppt ihn und wirft Fehler) */
export const CFX_FRAMEWORK_ENSURES = [
  'chat',
  'sessionmanager',
  'hardcap',
  'baseevents',
];

export function baseEnsuresFor(profile) {
  if (profile === 'esx' || profile === 'qb') return [...CFX_FRAMEWORK_ENSURES];
  return [...CFX_BLANK_ENSURES];
}

function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

/** chat aus FX Artifact → resources/[system]/chat */
export function syncChatFromArtifact(dataPath, fxRoot = FX_SERVER_ROOT, onLog = () => {}) {
  const resources = path.join(String(dataPath).replace(/\/$/, ''), 'resources');
  const dest = path.join(resources, '[system]', 'chat');
  if (fs.existsSync(path.join(dest, 'fxmanifest.lua'))) {
    onLog('chat: bereits in resources/[system]');
    return { ok: true, skipped: true };
  }
  const root = String(fxRoot || FX_SERVER_ROOT).replace(/\/$/, '');
  const src = path.join(root, 'alpine/opt/cfx-server/citizen/system_resources/chat');
  if (!fs.existsSync(path.join(src, 'fxmanifest.lua'))) {
    onLog('chat: Artifact system_resources/chat fehlt');
    return { ok: false };
  }
  copyDir(src, dest);
  onLog('chat → resources/[system]/chat (aus Artifact)');
  return { ok: true, skipped: false };
}

/**
 * hardcap + sessionmanager aus älterem cfx-server-data Commit (nicht mehr im master).
 */
export async function installLegacySystemResources(dataPath, onLog = () => {}) {
  const resources = path.join(String(dataPath).replace(/\/$/, ''), 'resources');
  const systemDir = path.join(resources, '[system]');
  fs.mkdirSync(systemDir, { recursive: true });

  const need = ['hardcap', 'sessionmanager'].filter(
    (n) => !fs.existsSync(path.join(systemDir, n, 'fxmanifest.lua')),
  );
  if (!need.length) {
    onLog('hardcap/sessionmanager: bereits vorhanden');
    return { ok: true, skipped: true };
  }

  const tmp = path.join(resources, `.orbit_cfx_legacy_${Date.now()}`);
  const zip = path.join(tmp, 'cfx.zip');
  try {
    fs.mkdirSync(tmp, { recursive: true });
    onLog('Lade hardcap/sessionmanager (Legacy cfx-server-data)…');
    const res = await fetch(
      `https://codeload.github.com/citizenfx/cfx-server-data/zip/${CFX_LEGACY_SHA}`,
      { signal: AbortSignal.timeout(120_000), redirect: 'follow' },
    );
    if (!res.ok) throw new Error(`Legacy-ZIP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zip, buf);
    await exec('unzip', ['-o', zip, '-d', tmp], { timeout: 60_000 });
    const extracted = fs.readdirSync(tmp).find((n) => n.startsWith('cfx-server-data'));
    if (!extracted) throw new Error('ZIP-Inhalt unerwartet');
    const sysSrc = path.join(tmp, extracted, 'resources', '[system]');
    for (const name of need) {
      const from = path.join(sysSrc, name);
      if (!fs.existsSync(from)) {
        onLog(`${name}: nicht im Legacy-ZIP`);
        continue;
      }
      copyDir(from, path.join(systemDir, name));
      onLog(`${name} → resources/[system]/${name}`);
    }
    return { ok: true, skipped: false };
  } catch (err) {
    onLog(`Legacy-System-Resources: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  }
}

/**
 * Clont aktuelles cfx-server-data/resources (Manager, Gamemodes, …).
 */
export async function installCfxServerData(dataPath, onLog = () => {}, { profile = 'blank', fxRoot } = {}) {
  const resources = path.join(String(dataPath).replace(/\/$/, ''), 'resources');
  fs.mkdirSync(resources, { recursive: true });

  syncChatFromArtifact(dataPath, fxRoot || FX_SERVER_ROOT, onLog);
  await installLegacySystemResources(dataPath, onLog);

  const managers = path.join(resources, '[managers]', 'mapmanager', 'fxmanifest.lua');
  if (!fs.existsSync(managers)) {
    const tmp = path.join(resources, `.orbit_cfx_data_${Date.now()}`);
    try {
      onLog('Lade cfx-server-data (Defaults)…');
      await exec('git', ['clone', '--depth', '1', CFX_DATA_URL, tmp], { timeout: 180_000 });
      const srcRoot = path.join(tmp, 'resources');
      if (!fs.existsSync(srcRoot)) throw new Error('cfx-server-data/resources fehlt');

      for (const name of fs.readdirSync(srcRoot)) {
        if (name.startsWith('.') || SKIP_TOP.has(name)) continue;
        // Framework: kein basic-gamemode / maps erzwingen — nur Manager + System/baseevents
        if ((profile === 'esx' || profile === 'qb') && name === '[gamemodes]') continue;
        const from = path.join(srcRoot, name);
        const to = path.join(resources, name);
        if (!fs.statSync(from).isDirectory()) continue;
        if (fs.existsSync(to)) {
          // merge missing children for [system]
          if (name === '[system]') {
            for (const child of fs.readdirSync(from)) {
              const cFrom = path.join(from, child);
              const cTo = path.join(to, child);
              if (!fs.existsSync(cTo) && fs.statSync(cFrom).isDirectory()) {
                copyDir(cFrom, cTo);
                onLog(`cfx-server-data → resources/${name}/${child}`);
              }
            }
          } else {
            onLog(`cfx-server-data: ${name} existiert — behalten`);
          }
          continue;
        }
        fs.renameSync(from, to);
        onLog(`cfx-server-data → resources/${name}`);
      }
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    }
  } else {
    onLog('cfx-server-data: bereits vorhanden — übersprungen');
  }

  return { ok: true };
}

/** ACE damit Frameworks add_principal / add_ace ausführen dürfen. */
export function applyFrameworkAce(cfg, profile = '') {
  let out = String(cfg || '');
  const lines = [];
  if (profile === 'esx' || /ensure\s+\[core\]/i.test(out) || /es_extended/i.test(out)) {
    lines.push('add_ace resource.es_extended command allow');
    lines.push('add_ace resource.es_extended command.quit allow');
  }
  if (profile === 'qb' || /qb-core/i.test(out)) {
    lines.push('add_ace resource.qb-core command allow');
  }
  if (/ox_lib|ensure\s+ox_lib/i.test(out) || profile === 'esx') {
    lines.push('add_ace resource.ox_lib command allow');
  }
  for (const line of lines) {
    const re = new RegExp(`^\\s*${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
    if (!re.test(out)) out = `${line}\n${out.trimStart()}`;
  }
  return out;
}

/**
 * Basis-Ensures + ACE in server.cfg schreiben.
 * @param {string} profile blank|esx|qb
 */
export function applyCfxBaseCfg(cfg, profile = 'blank') {
  let out = String(cfg || '');
  // Alten / neuen Block ersetzen
  out = out.replace(/# --- Orbit CFX Defaults ---[\s\S]*?# --- Ende CFX Defaults ---\n?/m, '');
  out = out.replace(/^# Basis-Ressourcen\n(?:ensure [^\n]+\n)*/m, '');
  // Framework: mapmanager-ensure entfernen falls manuell gesetzt
  if (profile === 'esx' || profile === 'qb') {
    out = out.replace(/^\s*ensure\s+mapmanager\s*$/gmi, '');
    out = out.replace(/^\s*ensure\s+basic-gamemode\s*$/gmi, '');
  }

  const ensures = baseEnsuresFor(profile);
  const baseBlock = `${['# Basis-Ressourcen', ...ensures.map((r) => `ensure ${r}`)].join('\n')}\n`;

  // Nach endpoints / vor anderen ensures
  if (/^ensure\s+/m.test(out)) {
    out = out.replace(/^ensure\s+/m, `${baseBlock}\nensure `);
  } else {
    out = `${out.trimEnd()}\n\n${baseBlock}\n`;
  }
  out = applyFrameworkAce(out, profile);
  return out;
}
