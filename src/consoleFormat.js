/** FXServer/journald-Ausgabe für lesbare Anzeige bereinigen + Marker-Kategorien */

const ANSI_RE = /\x1b\[[0-9:;?]*[ -/]*[@-~]/g;
const ANSI_SIMPLE = /\x1b[@-Z\\-_]/g;

const FX_PREFIX_RE = /^\[FX:\d+\]\s*/;
/** Citizen-Channel-Tag in Klammern (nach optionalem FX-Prefix) */
const CHANNEL_TAG_RE = /^\[([^\]]+)\]\s*/;

/** @typedef {'system'|'cmd'|'resources'|'script'|'core'|'citizen'|'bad'|'warn'|'ok'|'default'} ConsoleMarker */

/**
 * @param {unknown} input
 * @returns {string}
 */
export function stripAnsi(input) {
  if (input == null) return '';
  return String(input)
    .replace(ANSI_RE, '')
    .replace(ANSI_SIMPLE, '')
    .replace(/\r/g, '');
}

/**
 * @param {string} tagLower
 * @returns {ConsoleMarker}
 */
function markerFromTag(tagLower) {
  if (!tagLower) return 'default';
  if (tagLower === 'txadmin' || tagLower === 'orbit') return 'system';
  if (tagLower === 'cmd' || tagLower === 'commands') return 'cmd';
  if (tagLower === 'resources' || tagLower === 'ensure') return 'resources';
  if (tagLower.startsWith('script:')) return 'script';
  if (
    tagLower === 'c-scripting-core'
    || tagLower === 'c-scripting-node'
    || tagLower.includes('scripting-core')
  ) {
    return 'core';
  }
  if (
    tagLower.includes('citizen')
    || tagLower === 'svadhesive'
    || tagLower.includes('adhesive')
  ) {
    return 'citizen';
  }
  return 'default';
}

/**
 * Klassifiziert eine Logzeile einmalig beim Line-Build (kein Regex pro Paint).
 * @param {string} text
 * @param {string} [level]
 * @returns {{
 *   clean: string,
 *   tag: string,
 *   body: string,
 *   marker: ConsoleMarker,
 *   markerClass: string,
 * }}
 */
export function classifyConsoleLine(text, level = 'info') {
  const clean = stripAnsi(text);
  const withoutFx = clean.replace(FX_PREFIX_RE, '');
  const m = CHANNEL_TAG_RE.exec(withoutFx);
  const tagRaw = m ? m[1].trim() : '';
  const body = m ? withoutFx.slice(m[0].length) : withoutFx;
  const lv = String(level || 'info').toLowerCase();

  /** @type {ConsoleMarker} */
  let marker = markerFromTag(tagRaw.toLowerCase());

  if (marker === 'default' && !tagRaw) {
    if (/^(?:TXADMIN|ORBIT)\b/i.test(withoutFx)) marker = 'system';
    else if (lv === 'ok') marker = 'ok';
  }

  // Severity überschreibt Marker-BG (Error/Warn wie tx)
  if (lv === 'bad') marker = 'bad';
  else if (lv === 'warn') marker = 'warn';

  return {
    clean,
    tag: tagRaw,
    body: body || withoutFx || clean,
    marker,
    markerClass: `lc-mk-${marker}`,
  };
}
