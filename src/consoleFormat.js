/** FXServer/journald-Ausgabe für lesbare Anzeige bereinigen */

const ANSI_RE = /\x1b\[[0-9:;?]*[ -/]*[@-~]/g;
const ANSI_SIMPLE = /\x1b[@-Z\\-_]/g;

export function stripAnsi(input) {
  if (input == null) return '';
  return String(input)
    .replace(ANSI_RE, '')
    .replace(ANSI_SIMPLE, '')
    .replace(/\r/g, '');
}

/**
 * Schnell-Parse nur für Orbit Connect/Online/Offline-Zeilen.
 * @returns {null | { before: string, linkText: string, after: string, name: string|null, serverId: number|null }}
 */
export function splitOrbitPlayerLine(raw) {
  const text = stripAnsi(raw);
  // Fast reject — kein Regex auf jeder Chat-/Resource-Zeile
  if (
    !text.includes('Connecting:')
    && !text.includes('Spieler offline:')
    && !text.includes('Spieler online:')
  ) {
    return null;
  }

  let m = text.match(/^(.*?Connecting:\s*)(.+?)\s*$/);
  if (m) {
    const name = m[2].trim();
    if (!name) return null;
    return { before: m[1], linkText: name, after: '', name, serverId: null };
  }

  m = text.match(/^(.*?Spieler (?:offline|online):\s*)(.+?)\s*$/);
  if (!m) return null;
  const before = m[1];
  const rest = m[2].trim();

  const named = rest.match(/^(.+?)\s*\(#(\d+)\)$/);
  if (named) {
    return {
      before,
      linkText: named[1],
      after: ` (#${named[2]})`,
      name: named[1],
      serverId: Number(named[2]),
    };
  }

  const idOnly = rest.match(/^#(\d+)$/);
  if (idOnly) {
    return {
      before,
      linkText: rest,
      after: '',
      name: null,
      serverId: Number(idOnly[1]),
    };
  }

  return { before, linkText: rest, after: '', name: rest, serverId: null };
}
