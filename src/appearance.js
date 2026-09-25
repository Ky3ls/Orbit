import {
  ACCENT_PRESETS,
  PREFS_DEFAULTS,
  normalizePrefs,
  consoleLineVisible,
} from './prefsShared.js';

const KEY = 'orbit.appearance';

export { ACCENT_PRESETS, PREFS_DEFAULTS, consoleLineVisible };
export const APPEARANCE_DEFAULTS = PREFS_DEFAULTS;

function storageKey(userId) {
  return userId ? `${KEY}.u${userId}` : KEY;
}

export function readAppearance(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId)) || localStorage.getItem(KEY);
    if (!raw) return { ...PREFS_DEFAULTS, console: { ...PREFS_DEFAULTS.console } };
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...PREFS_DEFAULTS, console: { ...PREFS_DEFAULTS.console } };
  }
}

export function writeAppearance(partial, userId) {
  const cur = readAppearance(userId);
  const next = normalizePrefs({
    ...cur,
    ...partial,
    console: { ...cur.console, ...(partial.console || {}) },
  });
  localStorage.setItem(storageKey(userId), JSON.stringify(next));
  if (userId) localStorage.setItem(KEY, JSON.stringify(next));
  applyAppearance(next);
  window.dispatchEvent(new CustomEvent('orbit:appearance', { detail: next }));
  return next;
}

let _prefsUserId = null;
export function setAppearanceUserId(id) {
  _prefsUserId = id || null;
}
export function getAppearanceUserId() {
  return _prefsUserId;
}

export function applyAccentVars(accentId, root = document.documentElement) {
  const a = ACCENT_PRESETS[accentId] || ACCENT_PRESETS.orange;
  root.style.setProperty('--accent', a.hex);
  root.style.setProperty('--accent-2', a.hex2);
  root.style.setProperty('--accent-rgb', a.rgb);
  root.style.setProperty('--accent-dim', `rgba(${a.rgb}, 0.14)`);
  root.style.setProperty('--line-strong', `rgba(${a.rgb}, 0.45)`);
  root.dataset.accent = a.id;
}

export function applyAppearance(prefs = readAppearance()) {
  const root = document.documentElement;
  const p = normalizePrefs(prefs);
  root.dataset.theme = p.theme;
  root.dataset.nav = p.navLayout;
  root.dataset.sidebar = p.sidebarCollapsed ? 'collapsed' : 'expanded';
  applyAccentVars(p.accent, root);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', p.theme === 'light' ? '#7a7a82' : '#000000');
}

export function initAppearance() {
  applyAppearance(readAppearance());
}

/** Server-Prefs laden und lokal spiegeln. Bootstrap-Prefs: null = noch nie gespeichert. */
export async function hydrateAppearanceFromServer(apiFn, userId, bootstrapPrefs) {
  setAppearanceUserId(userId);
  try {
    let prefs;
    let isDefault = false;
    if (bootstrapPrefs != null && typeof bootstrapPrefs === 'object') {
      prefs = normalizePrefs(bootstrapPrefs);
    } else {
      const d = await apiFn('/api/prefs');
      prefs = normalizePrefs(d.prefs);
      isDefault = !!d.isDefault;
    }
    if (isDefault) {
      const local = readAppearance(userId);
      const seeded = normalizePrefs(local);
      localStorage.setItem(storageKey(userId), JSON.stringify(seeded));
      localStorage.setItem(KEY, JSON.stringify(seeded));
      applyAppearance(seeded);
      window.dispatchEvent(new CustomEvent('orbit:appearance', { detail: seeded }));
      try { await apiFn('/api/prefs', { method: 'PUT', body: seeded }); } catch { /* */ }
      return seeded;
    }
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
    localStorage.setItem(KEY, JSON.stringify(prefs));
    applyAppearance(prefs);
    window.dispatchEvent(new CustomEvent('orbit:appearance', { detail: prefs }));
    return prefs;
  } catch {
    return readAppearance(userId);
  }
}

/** Prefs speichern (lokal + Server). */
export async function persistAppearance(partial, apiFn, userId) {
  const uid = userId ?? getAppearanceUserId();
  const next = writeAppearance(partial, uid);
  if (apiFn && uid) {
    try {
      await apiFn('/api/prefs', { method: 'PUT', body: next });
    } catch { /* offline */ }
  }
  return next;
}
