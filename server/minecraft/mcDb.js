import fs from 'node:fs';
import path from 'node:path';
import { ORBIT_SERVERS_ROOT } from '../config.js';

/** Minecraft-Instanzen — getrennt von orbit_servers (FiveM), damit die FX-Logik unberührt bleibt. */
export function ensureMcTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mc_instances (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      mc_version TEXT NOT NULL,
      loader_version TEXT,
      path TEXT NOT NULL,
      port INTEGER NOT NULL,
      ram_mb INTEGER NOT NULL DEFAULT 4096,
      java_major INTEGER,
      java_path TEXT,
      launch TEXT,
      autostart INTEGER NOT NULL DEFAULT 0,
      auto_restart INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'installing',
      created INTEGER NOT NULL
    );
  `);
}

export const MC_ROOT = path.join(ORBIT_SERVERS_ROOT, 'minecraft');

export function listMcInstances(db) {
  return db.prepare('SELECT * FROM mc_instances ORDER BY created').all();
}

export function getMcInstance(db, id) {
  return db.prepare('SELECT * FROM mc_instances WHERE id = ?').get(Number(id)) || null;
}

export function slugify(name) {
  const base = String(name || 'minecraft')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'minecraft';
  return base;
}

export function uniqueSlug(db, name) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (
    db.prepare('SELECT 1 FROM mc_instances WHERE slug = ?').get(slug)
    || fs.existsSync(path.join(MC_ROOT, slug))
  ) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function insertMcInstance(db, row) {
  const info = db.prepare(`
    INSERT INTO mc_instances (slug, name, type, mc_version, loader_version, path, port, ram_mb, autostart, auto_restart, state, created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'installing', ?)
  `).run(
    row.slug, row.name, row.type, row.mcVersion, row.loaderVersion || null, row.path,
    row.port, row.ramMb, row.autostart ? 1 : 0, row.autoRestart === false ? 0 : 1, Date.now(),
  );
  return getMcInstance(db, info.lastInsertRowid);
}

export function updateMcInstance(db, id, patch) {
  const allowed = ['name', 'loader_version', 'port', 'ram_mb', 'java_major', 'java_path', 'launch', 'autostart', 'auto_restart', 'state'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getMcInstance(db, id);
  db.prepare(`UPDATE mc_instances SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), Number(id));
  return getMcInstance(db, id);
}

export function deleteMcInstanceRow(db, id) {
  db.prepare('DELETE FROM mc_instances WHERE id = ?').run(Number(id));
}
