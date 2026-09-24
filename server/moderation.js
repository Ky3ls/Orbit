/**
 * Orbit Moderation — Ban/Warn/Whitelist wie txAdmin (Panel-seitig, nicht als Server-Script).
 */
import { normalizeIdentifiers, primaryId, mergeIdLists } from './playerIdentity.js';

const DURATION_PRESETS = [
  { id: '2h', label: '2 Stunden', ms: 2 * 3600_000 },
  { id: '8h', label: '8 Stunden', ms: 8 * 3600_000 },
  { id: '1d', label: '1 Tag', ms: 24 * 3600_000 },
  { id: '2d', label: '2 Tage', ms: 2 * 24 * 3600_000 },
  { id: '7d', label: '7 Tage', ms: 7 * 24 * 3600_000 },
  { id: '14d', label: '14 Tage', ms: 14 * 24 * 3600_000 },
  { id: '30d', label: '30 Tage', ms: 30 * 24 * 3600_000 },
  { id: 'perm', label: 'Permanent', ms: 0 },
];

export function banDurationPresets() {
  return DURATION_PRESETS;
}

export function resolveBanExpiry(durationId, customAmount, customUnit) {
  const preset = DURATION_PRESETS.find((p) => p.id === durationId);
  if (preset) {
    return preset.ms === 0 ? null : Date.now() + preset.ms;
  }
  const amount = Math.max(1, Math.min(9999, Number(customAmount) || 0));
  const unit = String(customUnit || 'days').toLowerCase();
  const mult = unit === 'hours' || unit === 'h' ? 3600_000
    : unit === 'weeks' || unit === 'w' ? 7 * 24 * 3600_000
    : 24 * 3600_000;
  return Date.now() + amount * mult;
}

/** Aktiver Ban, der einen der Identifier trifft. */
export function findActiveBan(db, identifiers) {
  const ids = normalizeIdentifiers(identifiers);
  if (!ids.length) return null;
  const bans = db.prepare(`
    SELECT * FROM bans WHERE revoked = 0
      AND (expires IS NULL OR expires > ?)
    ORDER BY id DESC LIMIT 200
  `).all(Date.now());
  for (const ban of bans) {
    const banIds = new Set([ban.identifier, ...parseIdsJson(ban.ids)]);
    if (ids.some((id) => banIds.has(id))) return ban;
  }
  return null;
}

function parseIdsJson(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function isWhitelisted(db, identifiers) {
  const ids = normalizeIdentifiers(identifiers);
  if (!ids.length) return false;
  for (const id of ids) {
    const row = db.prepare('SELECT id FROM whitelist WHERE identifier = ?').get(id);
    if (row) return true;
  }
  return false;
}

/**
 * txAdmin-Style checkJoin: Ban + optional Whitelist.
 * @returns {{ allow: boolean, reason?: string }}
 */
export function checkPlayerJoin(db, settings, { playerIds = [], playerHwids = [], playerName = '' } = {}) {
  const ids = normalizeIdentifiers([...playerIds, ...playerHwids.map((t) => (String(t).includes(':') ? t : `hardware:${t}`))]);
  const ban = findActiveBan(db, ids);
  if (ban) {
    const until = ban.expires
      ? new Date(ban.expires).toLocaleString('de-DE')
      : 'permanent';
    return {
      allow: false,
      reason: `[Orbit] Du bist gebannt.\nGrund: ${ban.reason}\nBis: ${until}\nBan-ID: #${ban.id}`,
    };
  }
  if (settings.whitelistEnabled === '1') {
    if (!isWhitelisted(db, ids)) {
      return {
        allow: false,
        reason: `[Orbit] Dieser Server nutzt eine Allowlist.\nDein Account (${playerName || 'unbekannt'}) ist noch nicht freigeschaltet.`,
      };
    }
  }
  return { allow: true };
}

export function createBan(db, {
  identifiers,
  name = '',
  reason,
  author,
  expires = null,
}) {
  const ids = normalizeIdentifiers(identifiers);
  const primary = primaryId(ids) || ids[0];
  if (!primary || !reason) throw new Error('Ban-Daten unvollständig.');
  const info = db.prepare(`
    INSERT INTO bans (identifier, name, reason, author, expires, created, revoked, ids)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(primary, String(name || '').slice(0, 64), String(reason).slice(0, 280), author, expires, Date.now(), JSON.stringify(ids));
  return {
    id: Number(info.lastInsertRowid),
    identifier: primary,
    identifiers: ids,
    name,
    reason,
    author,
    expires,
  };
}

export function createWarn(db, { identifiers, name = '', reason, author }) {
  const ids = normalizeIdentifiers(identifiers);
  const primary = primaryId(ids) || ids[0];
  if (!primary || !reason) throw new Error('Warn-Daten unvollständig.');
  const info = db.prepare(`
    INSERT INTO warns (identifier, name, reason, author, created)
    VALUES (?, ?, ?, ?, ?)
  `).run(primary, String(name || '').slice(0, 64), String(reason).slice(0, 280), author, Date.now());
  return { id: Number(info.lastInsertRowid), identifier: primary, identifiers: ids, name, reason, author };
}

export function playerHistory(db, identifiers) {
  const ids = normalizeIdentifiers(identifiers);
  if (!ids.length) return { bans: [], warns: [] };
  const bans = db.prepare('SELECT * FROM bans ORDER BY id DESC LIMIT 200').all()
    .filter((b) => {
      const set = new Set([b.identifier, ...parseIdsJson(b.ids)]);
      return ids.some((id) => set.has(id));
    });
  const warns = db.prepare('SELECT * FROM warns ORDER BY id DESC LIMIT 200').all()
    .filter((w) => ids.includes(w.identifier) || ids.some((id) => w.identifier === id));
  return { bans, warns };
}

export function listBanTemplates(db) {
  try {
    return db.prepare('SELECT * FROM ban_templates ORDER BY sort ASC, id ASC').all();
  } catch {
    return [];
  }
}

export function createBanTemplate(db, { reason, durationId = '2d', sort = 0 }) {
  const r = String(reason || '').trim().slice(0, 280);
  if (r.length < 3) throw new Error('Vorlagen-Grund mind. 3 Zeichen.');
  const dur = String(durationId || '2d').slice(0, 16);
  const info = db.prepare(`
    INSERT INTO ban_templates (reason, duration_id, sort, created)
    VALUES (?, ?, ?, ?)
  `).run(r, dur, Number(sort) || 0, Date.now());
  return db.prepare('SELECT * FROM ban_templates WHERE id = ?').get(info.lastInsertRowid);
}

export function updateBanTemplate(db, id, { reason, durationId, sort }) {
  const row = db.prepare('SELECT * FROM ban_templates WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Vorlage nicht gefunden.');
  const r = reason !== undefined ? String(reason).trim().slice(0, 280) : row.reason;
  if (r.length < 3) throw new Error('Vorlagen-Grund mind. 3 Zeichen.');
  const dur = durationId !== undefined ? String(durationId).slice(0, 16) : row.duration_id;
  const s = sort !== undefined ? Number(sort) || 0 : row.sort;
  db.prepare('UPDATE ban_templates SET reason = ?, duration_id = ?, sort = ? WHERE id = ?')
    .run(r, dur, s, Number(id));
  return db.prepare('SELECT * FROM ban_templates WHERE id = ?').get(Number(id));
}

export function deleteBanTemplate(db, id) {
  const n = db.prepare('DELETE FROM ban_templates WHERE id = ?').run(Number(id)).changes;
  if (!n) throw new Error('Vorlage nicht gefunden.');
  return true;
}

export function ensureModerationSchema(db) {
  for (const sql of [
    'ALTER TABLE bans ADD COLUMN ids TEXT',
    'ALTER TABLE users ADD COLUMN discord_id TEXT',
    `CREATE TABLE IF NOT EXISTS ban_templates (
      id INTEGER PRIMARY KEY,
      reason TEXT NOT NULL,
      duration_id TEXT NOT NULL DEFAULT '2d',
      sort INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    )`,
  ]) {
    try { db.exec(sql); } catch (err) {
      if (!String(err.message).includes('duplicate column') && !String(err.message).includes('already exists')) {
        /* ignore */
      }
    }
  }
}

/** Findet Online-Spieler (runtime) die von einem Ban/Warn betroffen sind. */
export function matchingOnlinePlayers(runtimePlayers, identifiers) {
  const want = new Set(normalizeIdentifiers(identifiers));
  if (!want.size) return [];
  return (runtimePlayers || []).filter((p) => {
    const ids = normalizeIdentifiers(p.identifiers);
    return ids.some((id) => want.has(id));
  });
}

export function mergePlayerIdentifiers(playerRow, live) {
  let ids = [];
  try { ids = JSON.parse(playerRow?.ids || '[]'); } catch { ids = []; }
  return mergeIdLists(ids, playerRow?.identifier ? [playerRow.identifier] : [], live?.identifiers || []);
}
