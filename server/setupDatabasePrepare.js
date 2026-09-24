import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { RECIPE_PACKS } from './recipeProfiles.js';
import { importResourceSqlFiles } from './recipeInstall.js';
import { ensureEsxAddonColumns, patchMysql8CompatInResources } from './mysqlCompat.js';
import mysql from 'mysql2/promise';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function rmRf(target) {
  if (!target || !fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    try {
      execFile('sudo', ['-n', 'rm', '-rf', target], { timeout: 120_000 });
    } catch { /* */ }
  }
}

async function gitClone(url, destDir, depth = 1) {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  if (fs.existsSync(path.join(destDir, '.git'))) return { skipped: true };
  if (fs.existsSync(destDir)) rmRf(destDir);
  await exec('git', ['clone', '--depth', String(depth), url, destDir], {
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { skipped: false };
}

/**
 * Clont Recipe-Repos nur für SQL-Import (ohne Server-Datenordner).
 * @param {string} recipeId
 * @param {string} dsn
 * @param {(msg: string) => void} onLog
 * @param {(pct: number, label: string) => void} onProgress
 */
export async function prepareRecipeSqlImport(recipeId, dsn, onLog = () => {}, onProgress = () => {}) {
  const id = String(recipeId || 'blank');
  const pack = RECIPE_PACKS[id] || RECIPE_PACKS.blank;
  onProgress(2, 'Vorbereitung…');

  if (!dsn || !String(dsn).includes('mysql://')) {
    throw new Error('Keine gültige MySQL-DSN.');
  }

  if (!pack.clones?.length) {
    onLog('Kein Framework-SQL für dieses Profil — DB ist bereit.');
    onProgress(100, 'Fertig');
    return { imported: 0, failed: 0, skipped: true, recipeId: id };
  }

  const staging = path.join(DATA_DIR, '.setup-sql', id);
  fs.mkdirSync(staging, { recursive: true });
  const sqlBucket = path.join(staging, '.orbit-sql');
  const resources = path.join(staging, 'resources');
  fs.mkdirSync(resources, { recursive: true });

  const clones = pack.clones || [];
  let done = 0;
  for (const job of clones) {
    const label = job.dest || job.url.split('/').pop();
    onProgress(5 + Math.round((done / Math.max(1, clones.length)) * 45), `Lade ${label}…`);
    onLog(`Clone ${job.url}`);
    const tmp = path.join(staging, `.clone_${Date.now()}_${done}`);
    try {
      await gitClone(job.url, tmp, job.depth || 1);
      // [SQL] aus Repo-Root
      const sqlSrc = path.join(tmp, '[SQL]');
      if (fs.existsSync(sqlSrc)) {
        fs.mkdirSync(sqlBucket, { recursive: true });
        for (const name of fs.readdirSync(sqlSrc)) {
          const to = path.join(sqlBucket, name);
          if (fs.existsSync(to)) rmRf(to);
          fs.renameSync(path.join(sqlSrc, name), to);
        }
        onLog(`SQL-Ordner übernommen (${label})`);
      }
      // Promote-Unterordner → resources/[core] etc.
      const srcRoot = job.promote ? path.join(tmp, job.promote) : tmp;
      const dest = path.join(resources, job.dest || 'pack');
      if (fs.existsSync(srcRoot)) {
        fs.mkdirSync(dest, { recursive: true });
        for (const name of fs.readdirSync(srcRoot)) {
          if (name.startsWith('.')) continue;
          const from = path.join(srcRoot, name);
          const to = path.join(dest, name);
          if (fs.existsSync(to)) rmRf(to);
          fs.renameSync(from, to);
        }
      }
    } finally {
      rmRf(tmp);
    }
    done += 1;
  }

  onProgress(52, 'MySQL8-Kompatibilität…');
  if (fs.existsSync(resources)) {
    const p = patchMysql8CompatInResources(resources, onLog);
    if (p.patched) onLog(`${p.patched} Datei(en) für MySQL 8 angepasst.`);
  }

  onProgress(55, 'SQL-Dateien importieren…');
  onLog('Importiere Tabellen in die Datenbank…');

  let imported = 0;
  let failed = 0;
  if (fs.existsSync(sqlBucket)) {
    const r = await importResourceSqlFiles(sqlBucket, dsn, (m) => {
      onLog(m);
    });
    imported += r.imported || 0;
    failed += r.failed || 0;
  }
  onProgress(75, 'Addon-SQL…');
  if (fs.existsSync(resources)) {
    const r = await importResourceSqlFiles(resources, dsn, (m) => {
      onLog(m);
    });
    imported += r.imported || 0;
    failed += r.failed || 0;
  }

  onProgress(90, 'Addon-Spalten prüfen…');
  try {
    const conn = await mysql.createConnection({ uri: dsn, multipleStatements: true });
    try {
      await ensureEsxAddonColumns(conn, onLog);
    } finally {
      await conn.end();
    }
  } catch (err) {
    onLog(`Spalten-Check: ${String(err.message || err).slice(0, 140)}`);
  }

  onProgress(95, 'Aufräumen…');
  // Staging behalten für schnellen Re-Import, aber große .git wegräumen
  try {
    for (const ent of fs.readdirSync(staging, { withFileTypes: true })) {
      if (ent.name.startsWith('.clone_')) rmRf(path.join(staging, ent.name));
    }
  } catch { /* */ }

  onProgress(100, 'Datenbank bereit');
  onLog(`Fertig: ${imported} SQL-Dateien ok${failed ? `, ${failed} Warnungen` : ''}.`);
  return { imported, failed, skipped: false, recipeId: id, staging };
}
