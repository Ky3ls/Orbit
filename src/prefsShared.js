/** Geteilte Pref-Defaults (Node + Browser, ohne DOM). */

export const ACCENT_PRESETS = {
  /* Orbit Nebula Paletten — hex/hex2: Dark, light*: kontraststärkere Varianten, brandB: zweite Verlaufsfarbe */
  nebula: {
    id: 'nebula', label: 'Nebula',
    hex: '#7c6cff', hex2: '#a597ff', rgb: '124, 108, 255', brandB: '#3fd0ff',
    lightHex: '#5b49f0', lightHex2: '#7a6af5', lightRgb: '91, 73, 240', lightBrandB: '#0ea5e9',
  },
  aurora: {
    id: 'aurora', label: 'Aurora',
    hex: '#1fd1c1', hex2: '#62eadb', rgb: '31, 209, 193', brandB: '#7c6cff',
    lightHex: '#0d9488', lightHex2: '#14b8a6', lightRgb: '13, 148, 136', lightBrandB: '#6d5ae6',
  },
  ocean: {
    id: 'ocean', label: 'Ocean',
    hex: '#4c8dff', hex2: '#82b0ff', rgb: '76, 141, 255', brandB: '#22d3ee',
    lightHex: '#1d5fe0', lightHex2: '#3b7bf0', lightRgb: '29, 95, 224', lightBrandB: '#0891b2',
  },
  plasma: {
    id: 'plasma', label: 'Plasma',
    hex: '#d44bff', hex2: '#e48cff', rgb: '212, 75, 255', brandB: '#ff5fa2',
    lightHex: '#a21caf', lightHex2: '#c026d3', lightRgb: '162, 28, 175', lightBrandB: '#db2777',
  },
  rose: {
    id: 'rose', label: 'Rose',
    hex: '#ff4f7b', hex2: '#ff8aa6', rgb: '255, 79, 123', brandB: '#ffa34d',
    lightHex: '#d61f50', lightHex2: '#e8456f', lightRgb: '214, 31, 80', lightBrandB: '#ea7a12',
  },
  ember: {
    id: 'ember', label: 'Ember',
    hex: '#ff7a1a', hex2: '#ffa057', rgb: '255, 122, 26', brandB: '#ffcf4d',
    lightHex: '#c45a10', lightHex2: '#d97706', lightRgb: '196, 90, 16', lightBrandB: '#ca8a04',
  },
  solar: {
    id: 'solar', label: 'Solar',
    hex: '#f5b70a', hex2: '#ffd256', rgb: '245, 183, 10', brandB: '#ff7a1a',
    lightHex: '#a16207', lightHex2: '#b7791f', lightRgb: '161, 98, 7', lightBrandB: '#c2410c',
  },
  mint: {
    id: 'mint', label: 'Mint',
    hex: '#2ee59d', hex2: '#7ff0c2', rgb: '46, 229, 157', brandB: '#3fd0ff',
    lightHex: '#059669', lightHex2: '#10b981', lightRgb: '5, 150, 105', lightBrandB: '#0284c7',
  },
};

/** Prefs-Schema-Version — ältere Prefs (Schwarz/Orange-Ära) bekommen die neue Nebula-Palette. */
export const PREFS_VERSION = 3;

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
  accent: 'nebula',
  console: { ...CONSOLE_FILTER_DEFAULTS },
};

export function normalizePrefs(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  const fresh = Number(parsed.v) >= PREFS_VERSION;
  const accent = fresh && ACCENT_PRESETS[parsed.accent] ? parsed.accent : PREFS_DEFAULTS.accent;
  const c = parsed.console && typeof parsed.console === 'object' ? parsed.console : {};
  return {
    v: PREFS_VERSION,
    theme: parsed.theme === 'light' ? 'light' : 'dark',
    navLayout: 'sidebar',
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
