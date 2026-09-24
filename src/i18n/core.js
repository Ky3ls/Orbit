/** Leichtgewichtige Panel-i18n — kein externes Paket. */

export const STORAGE_KEY = 'orbit.language';

export const SUPPORTED = ['de', 'en', 'fr', 'es', 'pt', 'nl'];

/** Settings-Select-Werte → Sprachcode */
export function normalizeLang(raw) {
  const v = String(raw || '').trim();
  if (!v || v === 'custom') return 'en';
  const lower = v.toLowerCase();
  if (lower.startsWith('de')) return 'de';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('fr')) return 'fr';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('pt')) return 'pt';
  if (lower.startsWith('nl')) return 'nl';
  const base = lower.split(/[-_]/)[0];
  return SUPPORTED.includes(base) ? base : 'en';
}

/** Panel-Sprache → BCP-47 für Intl / FiveM locale */
export function toBcp47(lang) {
  switch (normalizeLang(lang)) {
    case 'de': return 'de-DE';
    case 'fr': return 'fr-FR';
    case 'es': return 'es-ES';
    case 'pt': return 'pt-BR';
    case 'nl': return 'nl-NL';
    default: return 'en-US';
  }
}

/** Wert für Settings-Select (de-DE | en | fr | … | custom) */
export function toSettingsValue(lang) {
  const v = String(lang || '').trim();
  if (v === 'custom') return 'custom';
  const n = normalizeLang(lang);
  return n === 'de' ? 'de-DE' : n;
}

let current = 'de';

export function getLang() {
  return current;
}

export function readStoredLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return normalizeLang(v);
  } catch { /* */ }
  return null;
}

export function writeStoredLang(lang) {
  const n = normalizeLang(lang);
  try {
    localStorage.setItem(STORAGE_KEY, n);
  } catch { /* */ }
  return n;
}

/**
 * @param {Record<string, Record<string, string>>} catalog
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>=} vars
 */
export function translate(catalog, lang, key, vars) {
  const code = normalizeLang(lang);
  const dict = catalog[code] || catalog.en || catalog.de || {};
  const fallback = catalog.en || catalog.de || {};
  let text = dict[key] ?? fallback[key] ?? catalog.de?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function applyDocumentLang(lang) {
  current = normalizeLang(lang);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
  }
  return current;
}
