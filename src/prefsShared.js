/** Geteilte Pref-Defaults (Node + Browser, ohne DOM). */

export const ACCENT_PRESETS = {
  orange: { id: 'orange', label: 'Orange', hex: '#ff7a1a', hex2: '#ff9a4d', rgb: '255, 122, 26' },
  red: { id: 'red', label: 'Rot', hex: '#ef4444', hex2: '#f87171', rgb: '239, 68, 68' },
  rose: { id: 'rose', label: 'Rosa', hex: '#f43f5e', hex2: '#fb7185', rgb: '244, 63, 94' },
  amber: { id: 'amber', label: 'Bernstein', hex: '#f59e0b', hex2: '#fbbf24', rgb: '245, 158, 11' },
  lime: { id: 'lime', label: 'Limette', hex: '#84cc16', hex2: '#a3e635', rgb: '132, 204, 22' },
  green: { id: 'green', label: 'Grün', hex: '#22c55e', hex2: '#4ade80', rgb: '34, 197, 94' },
  teal: { id: 'teal', label: 'Teal', hex: '#14b8a6', hex2: '#2dd4bf', rgb: '20, 184, 166' },
  cyan: { id: 'cyan', label: 'Cyan', hex: '#06b6d4', hex2: '#22d3ee', rgb: '6, 182, 212' },
  blue: { id: 'blue', label: 'Blau', hex: '#3b82f6', hex2: '#60a5fa', rgb: '59, 130, 246' },
  violet: { id: 'violet', label: 'Violett', hex: '#8b5cf6', hex2: '#a78bfa', rgb: '139, 92, 246' },
};

export const CONSOLE_FILTER_DEFAULTS = {
  showInfo: true,
  showWarn: true,
  showBad: true,
  showOk: true,
  /** Oversized-Asset / Streaming-Spam ausblenden */
  hideAssetSpam: true,
};

export const PREFS_DEFAULTS = {
  theme: 'dark',
  navLayout: 'sidebar',
  sidebarCollapsed: false,
  accent: 'orange',
  console: { ...CONSOLE_FILTER_DEFAULTS },
};

export function normalizePrefs(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  const accent = ACCENT_PRESETS[parsed.accent] ? parsed.accent : PREFS_DEFAULTS.accent;
  const c = parsed.console && typeof parsed.console === 'object' ? parsed.console : {};
  return {
    theme: parsed.theme === 'light' ? 'light' : 'dark',
    navLayout: parsed.navLayout === 'dock' ? 'dock' : 'sidebar',
    sidebarCollapsed: !!parsed.sidebarCollapsed,
    accent,
    console: {
      showInfo: c.showInfo !== false,
      showWarn: c.showWarn !== false,
      showBad: c.showBad !== false,
      showOk: c.showOk !== false,
      hideAssetSpam: c.hideAssetSpam !== false,
    },
  };
}

/** Asset-/Streaming-Spam (FiveM Oversized YTD etc.) */
export function isAssetSpamLine(text) {
  const t = String(text || '');
  return /Oversized assets/i.test(t)
    || /uses [\d.]+ MiB of physical memory/i.test(t)
    || /Asset .+\.ytd/i.test(t)
    || /streaming issues \(such as models not loading/i.test(t);
}

export function consoleLineVisible(line, consolePrefs) {
  const c = { ...CONSOLE_FILTER_DEFAULTS, ...(consolePrefs || {}) };
  const level = line?.level || 'info';
  if (level === 'info' && !c.showInfo) return false;
  if (level === 'warn' && !c.showWarn) return false;
  if (level === 'bad' && !c.showBad) return false;
  if (level === 'ok' && !c.showOk) return false;
  if (c.hideAssetSpam && isAssetSpamLine(line?.text)) return false;
  return true;
}
