import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RECIPE_PACKS, renderProfileCfgBlock } from './recipeProfiles.js';
import { syncOrbitBridgeToDataPath } from './orbitBridgeSync.js';

const exec = promisify(execFile);

export { RECIPE_PACKS } from './recipeProfiles.js';

async function gitClone(url, destDir, depth = 1) {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  if (fs.existsSync(path.join(destDir, '.git'))) return { skipped: true };
  await exec('git', ['clone', '--depth', String(depth), url, destDir], { timeout: 300_000 });
  return { skipped: false };
}

async function downloadZip(url, destDir, onLog) {
  fs.mkdirSync(destDir, { recursive: true });
  if (fs.existsSync(path.join(destDir, 'fxmanifest.lua'))) return { skipped: true };
  const zipPath = path.join(destDir, '_orbit_dl.zip');
  onLog(`Lade ${path.basename(destDir)}…`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Download ${res.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  await exec('unzip', ['-o', zipPath, '-d', destDir], { timeout: 120_000 });
  fs.unlinkSync(zipPath);
  return { skipped: false };
}

function mergeCfgProfile(cfg, profileBlock, marker) {
  const tag = `# --- Orbit Profil: ${marker} ---`;
  if (cfg.includes(tag)) {
    return cfg.replace(
      new RegExp(`${tag}[\\s\\S]*?# --- Ende Orbit Profil ---`, 'm'),
      `${profileBlock}\n# --- Ende Orbit Profil ---`,
    );
  }
  const block = `${profileBlock}\n# --- Ende Orbit Profil ---`;
  return `${cfg.trim()}\n\n${block}\n`;
}

/**
 * @param {string} recipeId
 * @param {string} dataPath
 * @param {{ mysqlConnection?: string, panelUrl?: string, ingameToken?: string }} opts
 */
export async function runRecipeInstall(recipeId, dataPath, onLog = () => {}, opts = {}) {
  const pack = RECIPE_PACKS[recipeId] || RECIPE_PACKS.blank;
  const resources = path.join(dataPath, 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const results = {
    recipeId,
    profile: pack.profile,
    clones: [],
    zips: [],
    ensures: pack.ensures,
  };

  for (const job of pack.zips || []) {
    const dest = path.join(resources, job.dest);
    try {
      const r = await downloadZip(job.url, dest, onLog);
      results.zips.push({ ...job, ok: true, skipped: r.skipped });
    } catch (err) {
      onLog(`ZIP ${job.name}: ${err.message}`);
      results.zips.push({ ...job, ok: false, error: err.message });
    }
  }

  for (const job of pack.clones) {
    const dest = path.join(resources, job.dest);
    onLog(`Clone ${job.url} → ${job.dest}`);
    try {
      const r = await gitClone(job.url, dest, job.depth || 1);
      results.clones.push({ ...job, ok: true, skipped: r.skipped });
    } catch (err) {
      onLog(`Clone fehlgeschlagen: ${err.message}`);
      results.clones.push({ ...job, ok: false, error: err.message });
    }
  }

  syncOrbitBridgeToDataPath(dataPath, onLog);

  const cfgPath = path.join(dataPath, 'server.cfg');
  let cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
  const profileBlock = renderProfileCfgBlock(pack, opts);
  if (profileBlock) {
    cfg = mergeCfgProfile(cfg, profileBlock, pack.profile || recipeId);
  }
  for (const res of pack.ensures) {
    const line = `ensure ${res}`;
    if (!cfg.includes(line)) cfg += `\n${line}`;
  }
  if (!/^\s*ensure\s+orbit\b/mi.test(cfg)) cfg += '\nensure orbit';
  // Panel-Convars kommen vom Orbit-FX-Start (+set), CFG-Fallback optional
  fs.writeFileSync(cfgPath, cfg.trim() + '\n', 'utf8');
  onLog(`Profil „${pack.title}“ + CFG-Vorlage angewendet.`);
  return results;
}
