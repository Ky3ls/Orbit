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
