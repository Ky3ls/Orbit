/** Identifier-Reihenfolge für Primärschlüssel / Anzeige (txAdmin-ähnlich). */
const ID_PRIORITY = [
  'license:',
  'license2:',
  'fivem:',
  'discord:',
  'steam:',
  'xbl:',
  'live:',
  'hardware:',
];

/** Fake-/Test-Keys die nie persistiert werden. */
const FAKE_RE = /^(license:(abc123|deadbeef|livecheck|simjoin\d*|marker\d*|waitbridge)|netid:\d+)$/i;

export function normalizeIdentifiers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const id = String(x || '').trim().slice(0, 96);
    if (!id || seen.has(id) || id.startsWith('netid:')) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 24) break;
  }
  return out;
}

export function primaryId(identifiers) {
  const list = normalizeIdentifiers(identifiers);
  for (const prefix of ID_PRIORITY) {
    const hit = list.find((id) => id.startsWith(prefix));
    if (hit && !FAKE_RE.test(hit)) return hit;
  }
  return list.find((id) => !FAKE_RE.test(id) && !id.startsWith('ip:')) || '';
}

export function isFakeIdentifier(id) {
  return FAKE_RE.test(String(id || ''));
}

export function idKind(id) {
  const s = String(id || '');
  const i = s.indexOf(':');
  if (i <= 0) return 'id';
  return s.slice(0, i);
}

export function idLabel(id) {
  const kind = idKind(id);
  const map = {
    license: 'License',
    license2: 'License 2',
    discord: 'Discord',
    steam: 'Steam',
    fivem: 'Cfx.re',
    xbl: 'Xbox',
    live: 'Microsoft',
    ip: 'IP',
    hardware: 'HWID',
  };
  return map[kind] || kind;
}

/** Findet bestehenden DB-Eintrag über Primärkey oder überlappende ids. */
export function findPlayerRow(db, identifiers) {
  const ids = normalizeIdentifiers(identifiers);
  if (!ids.length) return null;
  for (const id of ids) {
    const row = db.prepare('SELECT rowid, * FROM players WHERE identifier = ?').get(id);
    if (row) return row;
  }
  for (const id of ids) {
    if (id.length < 8) continue;
    const safe = id.replace(/%/g, '');
    const row = db.prepare('SELECT rowid, * FROM players WHERE ids LIKE ? LIMIT 1').get(`%${safe}%`);
    if (row) {
      let parsed = [];
      try { parsed = JSON.parse(row.ids || '[]'); } catch { parsed = []; }
      if (parsed.includes(id) || row.identifier === id) return row;
    }
  }
  return null;
}

export function mergeIdLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const id of normalizeIdentifiers(list)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Persistiert einen Live-Spieler ohne Duplikate.
 * Spielzeit = echte Delta-Zeit seit last_seen (gedeckelt).
 */
export function upsertLivePlayer(db, { name, ping, identifiers }, now = Date.now()) {
  const ids = normalizeIdentifiers(identifiers);
  const preferred = primaryId(ids);
  if (!preferred || isFakeIdentifier(preferred)) return null;

  const existing = findPlayerRow(db, [preferred, ...ids]);
  const mergedIds = mergeIdLists(ids, (() => {
    try { return existing ? JSON.parse(existing.ids || '[]') : []; } catch { return []; }
  })());
  const key = existing?.identifier && !isFakeIdentifier(existing.identifier)
    ? existing.identifier
    : preferred;

  const delta = existing
    ? Math.max(0, Math.min(now - Number(existing.last_seen || now), 15_000))
    : 0;

  if (existing) {
    db.prepare(`
      UPDATE players SET
        identifier = ?,
        name = ?,
        ping = ?,
        ids = ?,
        last_seen = ?,
        play_ms = play_ms + ?
      WHERE rowid = ?
    `).run(key, name, ping, JSON.stringify(mergedIds), now, delta, existing.rowid);

    // Alte Fake-/Doppel-Keys mit überlappenden IDs entfernen
    for (const id of mergedIds) {
      if (id === key) continue;
      db.prepare('DELETE FROM players WHERE identifier = ? AND identifier != ?').run(id, key);
    }
  } else {
    db.prepare(`
      INSERT INTO players (identifier, name, ping, ids, first_seen, last_seen, play_ms)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(key, name, ping, JSON.stringify(mergedIds), now, now);
  }
  return key;
}

/** Löscht bekannte Test-/Fake-Spieler und dedupliziert nach License. */
export function cleanupPlayerDuplicates(db) {
  db.prepare(`
    DELETE FROM players WHERE
      identifier LIKE 'license:abc123%'
      OR identifier LIKE 'license:deadbeef%'
      OR identifier LIKE 'license:livecheck%'
      OR identifier LIKE 'license:simjoin%'
      OR identifier LIKE 'license:marker%'
      OR identifier LIKE 'license:waitbridge%'
      OR identifier LIKE 'netid:%'
  `).run();

  const rows = db.prepare('SELECT rowid, identifier, name, ids, play_ms, first_seen, last_seen, note, ping FROM players').all();
  const byLicense = new Map();
  const drop = [];

  for (const row of rows) {
    let ids = [];
    try { ids = JSON.parse(row.ids || '[]'); } catch { ids = []; }
    const license = primaryId([row.identifier, ...ids]) || row.identifier;
    if (!byLicense.has(license)) {
      byLicense.set(license, row);
      continue;
    }
    const keep = byLicense.get(license);
    const keepIds = mergeIdLists(
      (() => { try { return JSON.parse(keep.ids || '[]'); } catch { return []; } })(),
      ids,
      [keep.identifier, row.identifier],
    );
    const play = Math.max(Number(keep.play_ms || 0), Number(row.play_ms || 0));
    const first = Math.min(Number(keep.first_seen || Date.now()), Number(row.first_seen || Date.now()));
    const last = Math.max(Number(keep.last_seen || 0), Number(row.last_seen || 0));
    const name = (last === Number(row.last_seen) ? row.name : keep.name) || keep.name;
    const key = license.startsWith('license:') ? license : keep.identifier;
    db.prepare(`
      UPDATE players SET identifier = ?, name = ?, ids = ?, play_ms = ?, first_seen = ?, last_seen = ?,
        note = COALESCE(NULLIF(note, ''), ?), ping = ?
      WHERE rowid = ?
    `).run(
      key,
      name,
      JSON.stringify(keepIds),
      play,
      first,
      last,
      row.note || '',
      row.ping || keep.ping || 0,
      keep.rowid,
    );
    drop.push(row.rowid);
  }
  for (const id of drop) {
    db.prepare('DELETE FROM players WHERE rowid = ?').run(id);
  }
  return { kept: byLicense.size, removed: drop.length };
}
