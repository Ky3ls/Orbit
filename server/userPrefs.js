import { normalizePrefs, PREFS_DEFAULTS } from '../src/prefsShared.js';

export { normalizePrefs, PREFS_DEFAULTS };

export function getUserPrefs(db, userId) {
  const row = db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId);
  const empty = row?.prefs == null || row.prefs === '';
  return { prefs: normalizePrefs(row?.prefs || null), isDefault: empty };
}

export function setUserPrefs(db, userId, partial) {
  const { prefs: current } = getUserPrefs(db, userId);
  const next = normalizePrefs({
    ...current,
    ...partial,
    console: { ...current.console, ...(partial.console || {}) },
  });
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(next), userId);
  return next;
}
