/**
 * Orbit System-Tools — Clean DB, Backup, Allowlist-Revoke (txAdmin-ähnlich).
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_PATH } from './config.js';

const DAY = 24 * 3600_000;

const PLAYER_OPTS = {
  none: null,
  '7d': 7 * DAY,
  '15d': 15 * DAY,
  '30d': 30 * DAY,
  '60d': 60 * DAY,
  '90d': 90 * DAY,
  '180d': 180 * DAY,
  '365d': 365 * DAY,
};

const BAN_OPTS = {
  none: null,
  expired: 'expired',
  revoked: 'revoked',
  both: 'both',
};

const WARN_OPTS = {
  none: null,
  '7d': 7 * DAY,
  '15d': 15 * DAY,
  '30d': 30 * DAY,
  '60d': 60 * DAY,
  '90d': 90 * DAY,
  all: 0,
};

export function cleanDatabaseOptions() {
  return {
    players: [
      { value: 'none', label: 'Keine' },
      { value: '7d', label: 'inaktiv über 7 Tage' },
      { value: '15d', label: 'inaktiv über 15 Tage' },
      { value: '30d', label: 'inaktiv über 30 Tage' },
      { value: '60d', label: 'inaktiv über 60 Tage' },
      { value: '90d', label: 'inaktiv über 90 Tage' },
      { value: '180d', label: 'inaktiv über 180 Tage' },
      { value: '365d', label: 'inaktiv über 1 Jahr' },
    ],
    bans: [
      { value: 'none', label: 'Keine' },
      { value: 'expired', label: 'abgelaufen' },
      { value: 'revoked', label: 'aufgehoben' },
      { value: 'both', label: 'abgelaufen oder aufgehoben' },
    ],
    warns: [
      { value: 'none', label: 'Keine' },
      { value: '7d', label: 'älter als 7 Tage' },
      { value: '15d', label: 'älter als 15 Tage' },
      { value: '30d', label: 'älter als 30 Tage' },
      { value: '60d', label: 'älter als 60 Tage' },
      { value: '90d', label: 'älter als 90 Tage' },
      { value: 'all', label: 'alle Warnungen' },
    ],
    hwids: [
      { value: 'none', label: 'Keine' },
      { value: 'wipe', label: 'alle Hardware-IDs aus Ban-Datensätzen entfernen' },
    ],
  };
}

function hasNotes(note) {
  return typeof note === 'string' && note.trim().length > 0;
}

/**
 * @returns {{ players: number, bans: number, warns: number, hwids: number }}
 */
export function cleanOrbitDatabase(db, {
  players = 'none',
  bans = 'none',
  warns = 'none',
  hwids = 'none',
} = {}) {
  const out = { players: 0, bans: 0, warns: 0, hwids: 0 };
  const now = Date.now();

  const playerMs = PLAYER_OPTS[players];
  if (playerMs != null) {
    const cutoff = now - playerMs;
    const rows = db.prepare('SELECT identifier, note FROM players WHERE last_seen < ?').all(cutoff);
    const del = db.prepare('DELETE FROM players WHERE identifier = ?');
    for (const row of rows) {
      if (hasNotes(row.note)) continue;
      // Spieler mit aktiven Bans/Warns behalten (Logs bleiben in bans/warns)
      out.players += del.run(row.identifier).changes;
    }
  }

  const banMode = BAN_OPTS[bans];
  if (banMode) {
    if (banMode === 'expired' || banMode === 'both') {
      out.bans += db.prepare(
        'DELETE FROM bans WHERE revoked = 0 AND expires IS NOT NULL AND expires < ?',
      ).run(now).changes;
    }
    if (banMode === 'revoked' || banMode === 'both') {
      out.bans += db.prepare('DELETE FROM bans WHERE revoked = 1').run().changes;
    }
  }

  const warnMs = WARN_OPTS[warns];
  if (warnMs != null) {
    if (warnMs === 0) {
      out.warns += db.prepare('DELETE FROM warns').run().changes;
    } else {
      out.warns += db.prepare('DELETE FROM warns WHERE created < ?').run(now - warnMs).changes;
    }
  }

  if (hwids === 'wipe') {
    const bansWithIds = db.prepare('SELECT id, ids FROM bans WHERE ids IS NOT NULL AND ids != \'\'').all();
    const upd = db.prepare('UPDATE bans SET ids = ? WHERE id = ?');
    for (const row of bansWithIds) {
      let arr;
      try { arr = JSON.parse(row.ids || '[]'); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      const next = arr.filter((id) => !String(id).startsWith('hardware:') && !String(id).startsWith('license2:'));
      // Nur HWID-Tokens (hardware:) entfernen — license behalten
      const filtered = arr.filter((id) => !/^hardware:/i.test(String(id)));
      if (filtered.length !== arr.length) {
        upd.run(JSON.stringify(filtered), row.id);
        out.hwids += 1;
      }
      void next;
    }
  }

  return out;
}

/** SQLite-Backup der Panel-DB (Spieler, Bans, Warns, Allowlist, Settings, …). */
export function backupOrbitDatabase() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `orbit-db-${stamp}.sqlite`);
  fs.copyFileSync(DB_PATH, dest);
  // Zusätzlich JSON-Export der Kern-Tabellen für Portabilität
  return { file: dest, filename: path.basename(dest), bytes: fs.statSync(dest).size };
}

export function exportPlayersJson(db) {
  const players = db.prepare('SELECT * FROM players ORDER BY last_seen DESC').all();
  const bans = db.prepare('SELECT * FROM bans ORDER BY id DESC').all();
  const warns = db.prepare('SELECT * FROM warns ORDER BY id DESC').all();
  const whitelist = db.prepare('SELECT * FROM whitelist ORDER BY id DESC').all();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players,
    actions: { bans, warns },
    whitelist,
  };
}

/** Entfernt Allowlist-Einträge (alle oder älter als X Tage). */
export function revokeAllowlists(db, { olderThanDays = null } = {}) {
  if (olderThanDays == null || olderThanDays === '' || olderThanDays === 'all') {
    const n = db.prepare('DELETE FROM whitelist').run().changes;
    return { removed: n };
  }
  const days = Math.max(1, Math.min(3650, Number(olderThanDays) || 0));
  const cutoff = Date.now() - days * DAY;
  const n = db.prepare('DELETE FROM whitelist WHERE created < ?').run(cutoff).changes;
  return { removed: n, olderThanDays: days };
}
