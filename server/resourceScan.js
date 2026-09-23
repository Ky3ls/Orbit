import fs from 'node:fs';
import path from 'node:path';
import { activeResourcesRoot } from './fivem.js';

const MANIFESTS = ['fxmanifest.lua', '__resource.lua'];

function isResourceDir(absPath) {
  return MANIFESTS.some((file) => fs.existsSync(path.join(absPath, file)));
}

/**
 * Rekursiver Scan wie txAdmin: jede Resource = Ordner mit fxmanifest.
 * Gruppe = erstes Verzeichnis unter resources/ (z. B. [core], [esx_addons]).
 * @returns {Array<{ name: string, folder: string, relpath: string }>}
 */
export function scanResourceTree(root = activeResourcesRoot()) {
  const found = [];
  if (!fs.existsSync(root)) return found;

  function walk(absDir, parts) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const abs = path.join(absDir, ent.name);
      const nextParts = [...parts, ent.name];
      if (isResourceDir(abs)) {
        const folder = parts[0] || 'Sonstige';
        found.push({
          name: ent.name,
          folder,
          relpath: nextParts.join('/'),
        });
        continue;
      }
      walk(abs, nextParts);
    }
  }

  walk(root, []);
  found.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  return found;
}

function folderSortKey(folder) {
  if (folder === '_disabled') return 9000;
  if (folder === 'Sonstige') return 9001;
  return 0;
}

export function syncResourcesFromDisk(db) {
  const scanned = scanResourceTree();
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO resources (name, folder, actual, updated)
    VALUES (?, ?, 'unknown', ?)
    ON CONFLICT(name) DO UPDATE SET folder = excluded.folder, updated = excluded.updated
  `);
  for (const row of scanned) upsert.run(row.name, row.folder, now);
  return scanned.length;
}

/**
 * @param {{ name: string }} row
 * @param {{ serverOnline: boolean, liveStarted: Set<string>|null }} ctx
 */
export function resolveResourceActual(row, ctx) {
  const { serverOnline, liveStarted } = ctx;
  if (!serverOnline) return 'offline';
  if (liveStarted && liveStarted.size > 0) {
    return liveStarted.has(row.name) ? 'started' : 'stopped';
  }
  const cached = row.actual;
  if (cached === 'started' || cached === 'stopped') return cached;
  return 'unknown';
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Set<string>|null} liveStarted
 * @param {boolean} [serverOnline]
 */
export function buildResourceGroups(db, liveStarted, serverOnline = true) {
  const rows = db.prepare('SELECT name, folder, actual, desired, updated FROM resources ORDER BY folder, name').all();
  const ctx = { serverOnline, liveStarted };
  const byFolder = new Map();
  for (const row of rows) {
    const folder = row.folder || 'Sonstige';
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    const actual = resolveResourceActual(row, ctx);
    byFolder.get(folder).push({ ...row, actual });
  }
  const groups = [...byFolder.entries()].map(([folder, resources]) => ({
    folder,
    count: resources.length,
    started: resources.filter((r) => r.actual === 'started').length,
    resources,
  }));
  groups.sort((a, b) => {
    const d = folderSortKey(a.folder) - folderSortKey(b.folder);
    if (d !== 0) return d;
    return a.folder.localeCompare(b.folder, 'de');
  });
  return groups;
}
