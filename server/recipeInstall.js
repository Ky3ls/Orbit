import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import { RECIPE_PACKS, renderProfileCfgBlock } from './recipeProfiles.js';
import { syncOrbitBridgeToDataPath } from './orbitBridgeSync.js';
import { ensureOnce } from './cfgUpsert.js';
import { ensureEsxAddonColumns, patchMysql8CompatInResources } from './mysqlCompat.js';
import { applyCfxBaseCfg, installCfxServerData } from './cfxDefaults.js';

const exec = promisify(execFile);

export { RECIPE_PACKS } from './recipeProfiles.js';

function rmRfSafe(target) {
  if (!target || !fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    try {
      execFileSync('sudo', ['-n', 'rm', '-rf', target], { timeout: 120_000 });
    } catch { /* ignore */ }
  }
}

async function gitClone(url, destDir, depth = 1) {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  if (fs.existsSync(path.join(destDir, '.git'))) return { skipped: true };
  if (fs.existsSync(destDir)) rmRfSafe(destDir);
  await exec('git', ['clone', '--depth', String(depth), url, destDir], { timeout: 300_000 });
  return { skipped: false };
}

/** Zip-Inhalt eine Ebene hochziehen, bis fxmanifest.lua im Ziel liegt. */
function flattenResourceDir(dest) {
  for (let i = 0; i < 4; i += 1) {
    if (fs.existsSync(path.join(dest, 'fxmanifest.lua')) || fs.existsSync(path.join(dest, '__resource.lua'))) {
      return;
    }
    const kids = fs.readdirSync(dest).filter((n) => !n.startsWith('.') && n !== '_orbit_dl.zip');
    if (kids.length !== 1) return;
    const only = path.join(dest, kids[0]);
    if (!fs.statSync(only).isDirectory()) return;
    const tmp = `${dest}.__hoist_${Date.now()}`;
    fs.renameSync(only, tmp);
    for (const name of fs.readdirSync(tmp)) {
      fs.renameSync(path.join(tmp, name), path.join(dest, name));
    }
    rmRfSafe(tmp);
  }
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
  flattenResourceDir(destDir);
  if (!fs.existsSync(path.join(destDir, 'fxmanifest.lua'))) {
    throw new Error(`${path.basename(destDir)}: fxmanifest.lua fehlt nach Entpacken`);
  }
  return { skipped: false };
}

/**
 * Clone Repo und hebt Unterordner (z. B. [core]/*) nach resources/[core]/.
 */
async function clonePromote(url, resourcesRoot, destGroup, promoteSubdir, depth, onLog) {
  const dest = path.join(resourcesRoot, destGroup);
  // schon korrekt befüllt?
  const sample = path.join(dest, 'es_extended', 'fxmanifest.lua');
  const sampleAlt = fs.existsSync(dest)
    && fs.readdirSync(dest).some((n) => fs.existsSync(path.join(dest, n, 'fxmanifest.lua')));
  if (sampleAlt || fs.existsSync(sample)) {
    onLog(`${destGroup}: bereits vorhanden — übersprungen`);
    return { skipped: true };
  }

  const tmp = path.join(resourcesRoot, `.orbit_clone_${Date.now()}`);
  onLog(`Clone ${url} → ${destGroup}`);
  await gitClone(url, tmp, depth);
  const srcRoot = promoteSubdir ? path.join(tmp, promoteSubdir) : tmp;
  if (!fs.existsSync(srcRoot)) {
    rmRfSafe(tmp);
    throw new Error(`Repo ohne Ordner ${promoteSubdir || '/'}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(srcRoot)) {
    if (name.startsWith('.')) continue;
    const from = path.join(srcRoot, name);
    const to = path.join(dest, name);
    if (fs.existsSync(to)) rmRfSafe(to);
    fs.renameSync(from, to);
  }
  // SQL-Ordner aus Repo-Root neben resources ablegen (nicht als Resource scannen)
  const sqlSrc = path.join(tmp, '[SQL]');
  if (fs.existsSync(sqlSrc)) {
    const sqlDest = path.join(resourcesRoot, '..', '.orbit-sql');
    fs.mkdirSync(sqlDest, { recursive: true });
    for (const name of fs.readdirSync(sqlSrc)) {
      const to = path.join(sqlDest, name);
      if (fs.existsSync(to)) rmRfSafe(to);
      fs.renameSync(path.join(sqlSrc, name), to);
    }
  }
  rmRfSafe(tmp);
  return { skipped: false };
}

function collectSqlFiles(rootDir) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      // Sprach-Duplikate überspringen
      if (ent.isDirectory() && /^(localization|locale|locales|lang|languages)$/i.test(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.toLowerCase().endsWith('.sql')) {
        // de_*.sql / fr_*.sql im gleichen Ordner ignorieren
        if (/^[a-z]{2}_/i.test(ent.name) && ent.name.toLowerCase() !== 'legacy.sql') continue;
        files.push(p);
      }
    }
  };
  walk(rootDir);
  files.sort((a, b) => {
    const score = (f) => {
      const base = path.basename(f).toLowerCase();
      const norm = f.replace(/\\/g, '/');
      // Core-Schema zuerst — sonst scheitert legacy.sql an schon angelegten Addon-Tabellen
      if (base === 'legacy.sql' || base === 'esx.sql') return 0;
      if (norm.includes('/.orbit-sql/') || norm.includes('/[sql]/')) return 0;
      if (base === 'es_extended.sql') return 1;
      if (base.includes('legacy')) return 2;
      if (/\/esx_(identity|multicharacter|skin)\.sql$/i.test(norm)) return 3;
      return 10;
    };
    return score(a) - score(b) || a.localeCompare(b);
  });
  return files;
}

/** CREATE/ALTER/USE-DB entfernen — Import immer in die Orbit-DSN-DB. */
function sanitizeSqlForImport(sql) {
  return String(sql || '')
    .replace(/^\s*CREATE\s+DATABASE\b[^;]*;/gim, '')
    .replace(/^\s*ALTER\s+DATABASE\b[^;]*;/gim, '')
    .replace(/^\s*USE\s+[`'"]?[\w-]+[`'"]?\s*;/gim, '')
    .trim();
}

/**
 * Importiert alle .sql unter resources (Core + Addons) in die angegebene DB.
 */
export async function importResourceSqlFiles(resourcesRoot, dsn, onLog = () => {}) {
  if (!dsn || !String(dsn).includes('mysql://')) {
    onLog('SQL-Import übersprungen (keine MySQL-DSN).');
    return { imported: 0, failed: 0 };
  }
  const files = collectSqlFiles(resourcesRoot);
  if (!files.length) {
    onLog('Keine .sql-Dateien gefunden.');
    return { imported: 0, failed: 0 };
  }
  const conn = await mysql.createConnection({
    uri: dsn,
    multipleStatements: true,
    connectTimeout: 15_000,
  });
  let imported = 0;
  let failed = 0;
  try {
    for (const file of files) {
      const rel = path.relative(resourcesRoot, file);
      const sql = sanitizeSqlForImport(fs.readFileSync(file, 'utf8'));
      if (!sql) continue;
      try {
        await conn.query(sql);
        imported += 1;
        onLog(`SQL OK: ${rel}`);
      } catch (err) {
        const msg = String(err.message || err);
        // Nach legacy.sql sind Core-Tabellen schon da — Addon/es_extended-Duplikate ok
        if (/already exists|Duplicate|ER_TABLE_EXISTS/i.test(msg)) {
          imported += 1;
          onLog(`SQL Skip (bereits vorhanden): ${rel}`);
        } else {
          failed += 1;
          onLog(`SQL Warnung (${rel}): ${msg.slice(0, 160)}`);
        }
      }
    }
  } finally {
    await conn.end();
  }
  onLog(`SQL-Import: ${imported} ok, ${failed} mit Warnung`);
  return { imported, failed };
}

function mergeCfgProfile(cfg, profileBlock) {
  // Marker in CFG ist „ESX Legacy“ etc., pack.profile nur „esx“ → immer generisch mergen
  const ende = '# --- Ende Orbit Profil ---';
  const block = `${profileBlock}\n${ende}`;
  if (/# --- Orbit Profil:[\s\S]*?# --- Ende Orbit Profil ---/m.test(cfg)) {
    return cfg.replace(/# --- Orbit Profil:[\s\S]*?# --- Ende Orbit Profil ---/m, block);
  }
  return `${cfg.trim()}\n\n${block}\n`;
}

/**
 * @param {string} recipeId
 * @param {string} dataPath
 * @param {{ mysqlConnection?: string, panelUrl?: string, ingameToken?: string, importSql?: boolean }} opts
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
    sql: null,
    cfxDefaults: null,
  };

  // txAdmin-Style: cfx-server-data (mapmanager, spawnmanager, baseevents, …)
  try {
    results.cfxDefaults = await installCfxServerData(dataPath, onLog, {
      profile: pack.profile || recipeId,
      fxRoot: opts.fxServerRoot,
    });
  } catch (err) {
    onLog(`cfx-server-data: ${err.message}`);
    results.cfxDefaults = { ok: false, error: err.message };
  }

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

  for (const job of pack.clones || []) {
    try {
      let r;
      if (job.promote) {
        r = await clonePromote(job.url, resources, job.dest, job.promote, job.depth || 1, onLog);
      } else {
        const dest = path.join(resources, job.dest);
        onLog(`Clone ${job.url} → ${job.dest}`);
        r = await gitClone(job.url, dest, job.depth || 1);
      }
      results.clones.push({ ...job, ok: true, skipped: r.skipped });
    } catch (err) {
      onLog(`Clone fehlgeschlagen: ${err.message}`);
      results.clones.push({ ...job, ok: false, error: err.message });
    }
  }

  // MySQL 8: ADD COLUMN IF NOT EXISTS (MariaDB) in ESX-Addons patchen
  try {
    const p = patchMysql8CompatInResources(resources, onLog);
    if (p.patched) onLog(`MySQL8-Kompatibilität: ${p.patched} Datei(en) angepasst.`);
  } catch (err) {
    onLog(`MySQL8-Patch: ${err.message}`);
  }

  if (opts.importSql !== false && opts.mysqlConnection) {
    try {
      // .orbit-sql (legacy.sql) VOR resources — Core-Tabellen zuerst
      const sqlRoots = [];
      const sideSql = path.join(dataPath, '.orbit-sql');
      if (fs.existsSync(sideSql)) sqlRoots.push(sideSql);
      sqlRoots.push(resources);
      let imported = 0;
      let failed = 0;
      for (const root of sqlRoots) {
        const r = await importResourceSqlFiles(root, opts.mysqlConnection, onLog);
        imported += r.imported || 0;
        failed += r.failed || 0;
      }
      results.sql = { imported, failed };
    } catch (err) {
      onLog(`SQL-Import fehlgeschlagen: ${err.message}`);
      results.sql = { imported: 0, failed: 1, error: err.message };
    }
  }

  if (opts.mysqlConnection) {
    try {
      const conn = await mysql.createConnection(opts.mysqlConnection);
      try {
        await ensureEsxAddonColumns(conn, onLog);
      } finally {
        await conn.end();
      }
    } catch (err) {
      onLog(`Addon-Spalten: ${String(err.message || err).slice(0, 120)}`);
    }
  }

  // Temp-Clones + Ownership aufräumen
  try {
    for (const name of fs.readdirSync(resources)) {
      if (name.startsWith('.orbit_clone_') || name.endsWith('.__hoist')) {
        rmRfSafe(path.join(resources, name));
      }
    }
  } catch { /* */ }
  try {
    execFileSync('sudo', ['-n', 'chown', '-R', 'orbit:orbit', resources], { timeout: 60_000 });
  } catch { /* */ }

  syncOrbitBridgeToDataPath(dataPath, onLog);

  const cfgPath = path.join(dataPath, 'server.cfg');
  let cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
  cfg = applyCfxBaseCfg(cfg, pack.profile || recipeId);
  const profileBlock = renderProfileCfgBlock(pack);
  if (profileBlock) {
    cfg = mergeCfgProfile(cfg, profileBlock);
  }
  // Ensures nur einmal (auch [core] / [esx_addons])
  for (const res of pack.ensures) {
    cfg = ensureOnce(cfg, res);
  }
  cfg = ensureOnce(cfg, 'orbit');
  fs.writeFileSync(cfgPath, cfg.trim() + '\n', 'utf8');
  onLog(`Profil „${pack.title}“ + CFX-Defaults + CFG angewendet.`);
  return results;
}
