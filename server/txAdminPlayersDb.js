import fs from 'node:fs';

function pickIdentifier(ids) {
  const list = Array.isArray(ids) ? ids : [];
  const order = ['license:', 'steam:', 'discord:', 'fivem:', 'xbl:', 'live:'];
  for (const prefix of order) {
    const hit = list.find((id) => String(id).toLowerCase().startsWith(prefix));
    if (hit) return String(hit);
  }
  return list[0] ? String(list[0]) : '';
}

/**
 * @returns {null|{ actions: any[], whitelistApprovals: any[] }}
 */
export function loadTxAdminPlayersDb(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

export function playersDbPathForProfile(dataPath) {
  return `${String(dataPath).replace(/\/$/, '')}/data/playersDB.json`;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function importTxAdminModeration(db, playersDbPath, opts = {}) {
  const wantBans = opts.bans !== false;
  const wantWarns = opts.warns !== false;
  const wantWl = opts.whitelist !== false;
  const data = loadTxAdminPlayersDb(playersDbPath);
  if (!data) {
    return { bans: 0, warns: 0, whitelist: 0, skipped: 0, playersDbPath };
  }

  let bans = 0;
  let warns = 0;
  let whitelist = 0;
  let skipped = 0;

  const insBan = db.prepare(
    'INSERT INTO bans (identifier, name, reason, author, expires, created, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)',
  );
  const insWarn = db.prepare(
    'INSERT INTO warns (identifier, name, reason, author, created) VALUES (?, ?, ?, ?, ?)',
  );
  const insWl = db.prepare(
    'INSERT OR IGNORE INTO whitelist (identifier, note, author, created) VALUES (?, ?, ?, ?)',
  );

  const findBan = db.prepare('SELECT id FROM bans WHERE identifier = ? AND created = ? LIMIT 1');
  const findWarn = db.prepare('SELECT id FROM warns WHERE identifier = ? AND created = ? LIMIT 1');

  for (const action of data.actions || []) {
    if (!action || typeof action !== 'object') continue;
    if (action.revocation?.timestamp) {
      skipped += 1;
      continue;
    }
    const identifier = pickIdentifier(action.ids);
    if (!identifier) {
      skipped += 1;
      continue;
    }
    const created = Number(action.timestamp) || Date.now();
    const name = action.playerName && action.playerName !== false ? String(action.playerName) : '';
    const reason = String(action.reason || 'txAdmin').slice(0, 500);
    const author = String(action.author || 'txAdmin').slice(0, 80);

    if (action.type === 'ban' && wantBans) {
      const expires = action.expiration === false ? null : Number(action.expiration);
      if (expires && expires < Date.now()) {
        skipped += 1;
        continue;
      }
      if (findBan.get(identifier, created)) {
        skipped += 1;
        continue;
      }
      insBan.run(identifier, name, reason, author, expires, created);
      bans += 1;
    } else if (action.type === 'warn' && wantWarns) {
      if (findWarn.get(identifier, created)) {
        skipped += 1;
        continue;
      }
      insWarn.run(identifier, name, reason, author, created);
      warns += 1;
    }
  }

  if (wantWl) {
    for (const row of data.whitelistApprovals || []) {
      if (!row?.identifier) continue;
      const identifier = String(row.identifier);
      const note = `txAdmin · ${row.approvedBy || 'import'}`;
      const info = insWl.run(
        identifier,
        note.slice(0, 280),
        String(row.approvedBy || 'txAdmin').slice(0, 80),
        Number(row.tsApproved) || Date.now(),
      );
      if (info.changes) whitelist += 1;
      else skipped += 1;
    }
  }

  return { bans, warns, whitelist, skipped, playersDbPath };
}
