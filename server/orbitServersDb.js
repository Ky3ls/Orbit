import { provisionOrbitServer } from './orbitServer.js';
import { setSetting, settingMap } from './db.js';
import { syncActiveCfgPath } from './fivem.js';

export function ensureOrbitServersTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orbit_servers (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      data_path TEXT NOT NULL,
      fx_root TEXT,
      port INTEGER NOT NULL DEFAULT 30120,
      max_clients INTEGER NOT NULL DEFAULT 48,
      is_active INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    );
  `);
}

export function listOrbitServers(db) {
  return db.prepare('SELECT * FROM orbit_servers ORDER BY name').all();
}

export function getActiveOrbitServer(db) {
  const row = db.prepare('SELECT * FROM orbit_servers WHERE is_active = 1 LIMIT 1').get();
  if (row) return row;
  const settings = db.prepare('SELECT v FROM settings WHERE k = ?').get('fxDataPath');
  if (settings?.v) {
    return db.prepare('SELECT * FROM orbit_servers WHERE data_path = ?').get(settings.v);
  }
  return null;
}

export function activateOrbitServer(db, id) {
  const row = db.prepare('SELECT * FROM orbit_servers WHERE id = ?').get(id);
  if (!row) throw new Error('Server nicht gefunden.');
  db.prepare('UPDATE orbit_servers SET is_active = 0').run();
  db.prepare('UPDATE orbit_servers SET is_active = 1 WHERE id = ?').run(id);
  applyServerToSettings(db, row);
  return row;
}

export function applyServerToSettings(db, row) {
  setSetting(db, 'orbitServerName', row.name);
  setSetting(db, 'orbitServerSlug', row.slug);
  setSetting(db, 'serverLabel', row.name);
  setSetting(db, 'fxDataPath', row.data_path);
  setSetting(db, 'hostname', row.name);
  setSetting(db, 'fivemPort', String(row.port));
  setSetting(db, 'maxClients', String(row.max_clients));
  setSetting(db, 'activeOrbitServerId', String(row.id));
  if (row.fx_root) setSetting(db, 'fxServerRoot', row.fx_root);
  setSetting(db, 'fxControlMode', 'orbit');
  syncActiveCfgPath(settingMap(db));
}

export function insertOrbitServer(db, result) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO orbit_servers (slug, name, data_path, fx_root, port, max_clients, is_active, created)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    result.orbitServerSlug,
    result.orbitServerName,
    result.fxDataPath,
    result.fxServerRoot || '',
    Number(result.settings.fivemPort) || 30120,
    Number(result.settings.maxClients) || 48,
    now,
  );
  const row = db.prepare('SELECT * FROM orbit_servers WHERE id = ?').get(info.lastInsertRowid);
  return row;
}

/** Vorhandenen Server per data_path finden oder neu anlegen. */
export function upsertOrbitServerByPath(db, result) {
  const dataPath = String(result.fxDataPath || '').replace(/\/$/, '');
  let row = db.prepare('SELECT * FROM orbit_servers WHERE data_path = ? OR data_path = ?')
    .get(dataPath, `${dataPath}/`);
  if (!row) {
    // slug-Kollision vermeiden
    let slug = result.orbitServerSlug;
    let n = 2;
    while (db.prepare('SELECT id FROM orbit_servers WHERE slug = ?').get(slug)) {
      slug = `${result.orbitServerSlug}-${n}`;
      n += 1;
    }
    result.orbitServerSlug = slug;
    if (result.settings) result.settings.orbitServerSlug = slug;
    row = insertOrbitServer(db, result);
  } else {
    db.prepare(`
      UPDATE orbit_servers SET name = ?, fx_root = ?, port = ?, max_clients = ?, slug = COALESCE(slug, ?)
      WHERE id = ?
    `).run(
      result.orbitServerName,
      result.fxServerRoot || row.fx_root || '',
      Number(result.settings?.fivemPort) || row.port,
      Number(result.settings?.maxClients) || row.max_clients,
      result.orbitServerSlug,
      row.id,
    );
    row = db.prepare('SELECT * FROM orbit_servers WHERE id = ?').get(row.id);
  }
  return row;
}

export function getOrbitServerById(db, id) {
  return db.prepare('SELECT * FROM orbit_servers WHERE id = ?').get(Number(id));
}

/** Settings-Objekt für Supervisor/Start einer bestimmten Instanz. */
export function buildSettingsForServer(db, row) {
  const global = settingMap(db);
  return {
    ...global,
    orbitServerName: row.name,
    orbitServerSlug: row.slug,
    serverLabel: row.name,
    fxDataPath: row.data_path,
    hostname: row.name,
    fivemPort: String(row.port),
    maxClients: String(row.max_clients),
    activeOrbitServerId: String(row.id),
    fxServerRoot: row.fx_root || global.fxServerRoot || '',
    fxControlMode: 'orbit',
  };
}

export function createAndActivateOrbitServer(db, opts) {
  const result = provisionOrbitServer(opts);
  const row = upsertOrbitServerByPath(db, result);
  for (const [k, v] of Object.entries(result.settings)) setSetting(db, k, v);
  activateOrbitServer(db, row.id);
  return { result, row };
}
