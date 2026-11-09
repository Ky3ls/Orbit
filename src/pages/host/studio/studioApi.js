/** API für das Datenbank-Studio — mit optionaler Schreib-Freischaltung (X-Orbit-Unlock) */
export function studioPath(db, rest = '') {
  return `/api/host/studio/${encodeURIComponent(db)}${rest}`;
}

export async function sapi(path, { method = 'GET', body, unlock = false, raw = null, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-TX2-Client': '1',
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }),
      ...(unlock ? { 'X-Orbit-Unlock': '1' } : {}),
      ...headers,
    },
    body: raw || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Fehler ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString('de-DE');
}

/** Filter-Kurzschrift: ">5", "<=3", "=abc", "!=x", "~text", "^start", "null", "!null", "a,b,c" (IN) */
export function parseFilter(col, raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^null$/i.test(s)) return { col, op: 'null' };
  if (/^!null$/i.test(s)) return { col, op: 'not null' };
  let m = s.match(/^(>=|<=|!=|>|<|=)(.*)$/);
  if (m) return { col, op: m[1], val: m[2].trim() };
  if (s.startsWith('~')) return { col, op: 'regexp', val: s.slice(1) };
  if (s.startsWith('^')) return { col, op: 'starts', val: s.slice(1) };
  if (s.includes(',') && !/\s/.test(s)) return { col, op: 'in', val: s };
  return { col, op: 'contains', val: s };
}

export function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.__bin) return `0x${v.hex}${v.length > 32 ? '…' : ''} (${v.length} B)`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function keyOf(row, pk) {
  if (pk?.length) return Object.fromEntries(pk.map((c) => [c, row[c]]));
  return Object.fromEntries(Object.entries(row).filter(([, v]) => !(v && typeof v === 'object')));
}

export const TYPE_GROUPS = [
  ['Zahlen', ['INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'DECIMAL(10,2)', 'FLOAT', 'DOUBLE', 'BOOLEAN']],
  ['Text', ['VARCHAR(255)', 'VARCHAR(64)', 'CHAR(36)', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'JSON']],
  ['Datum', ['DATETIME', 'TIMESTAMP', 'DATE', 'TIME', 'YEAR']],
  ['Sonstiges', ['BLOB', 'LONGBLOB', "ENUM('a','b')", 'BINARY(16)']],
];

export function typeTone(t) {
  const s = String(t || '').toLowerCase();
  if (/int|decimal|float|double|bit|bool/.test(s)) return 'num';
  if (/date|time|year/.test(s)) return 'date';
  if (/json/.test(s)) return 'json';
  if (/blob|binary/.test(s)) return 'bin';
  if (/enum|set/.test(s)) return 'enum';
  return 'text';
}
