import fs from 'node:fs';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';
import { has } from './exec.js';

/*
 * Datenbank-Studio für MySQL/MariaDB (wie phpMyAdmin, direkt in Orbit).
 * Zugang als root über den Unix-Socket (auth_socket) — kein gespeichertes Passwort.
 * Systemdatenbanken sind nur lesbar. Fremde Datenbanken (nicht von Orbit angelegt) nur,
 * wenn der Aufruf ausdrücklich Schreibrechte anfordert (Freischalten in der Oberfläche).
 */
const SOCKETS = ['/var/run/mysqld/mysqld.sock', '/run/mysqld/mysqld.sock', '/var/lib/mysql/mysql.sock', '/tmp/mysql.sock'];
export const SYSTEM_DBS = new Set(['mysql', 'information_schema', 'performance_schema', 'sys']);
const IDENT_RE = /^[^`\0/\\]{1,64}$/;
const MAX_ROWS = 1000;

const pools = new Map();

function socketPath() {
  if (process.env.ORBIT_MYSQL_SOCKET) return process.env.ORBIT_MYSQL_SOCKET;
  return SOCKETS.find((p) => fs.existsSync(p)) || SOCKETS[0];
}

const baseOpts = () => ({
  socketPath: socketPath(),
  user: 'root',
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
  jsonStrings: true,
  charset: 'utf8mb4',
});

function pool(db) {
  let p = pools.get(db);
  if (!p) {
    p = { pool: mysql.createPool({ ...baseOpts(), database: db, connectionLimit: 4, waitForConnections: true, idleTimeout: 60_000 }), used: Date.now() };
    pools.set(db, p);
  }
  p.used = Date.now();
  return p.pool;
}
setInterval(() => {
  for (const [k, p] of pools) if (Date.now() - p.used > 10 * 60_000) { p.pool.end().catch(() => {}); pools.delete(k); }
}, 60_000).unref?.();

export function ident(name, what = 'Name') {
  const s = String(name ?? '');
  if (!IDENT_RE.test(s)) throw new Error(`${what} ungültig.`);
  return `\`${s}\``;
}
const esc = (v) => mysql.escape(v);

async function q(db, sql, params) {
  const [rows, fields] = await pool(db).query({ sql, timeout: 60_000 }, params);
  return { rows, fields };
}

async function dbExists(db) {
  const { rows } = await q('information_schema', 'SELECT SCHEMA_NAME FROM SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
  return rows.length > 0;
}

/** Schreibzugriff prüfen */
export function assertWritable(db, { managed, unlocked }) {
  if (SYSTEM_DBS.has(db)) throw new Error('Systemdatenbanken sind schreibgeschützt.');
  if (!managed && !unlocked) throw new Error('Diese Datenbank ist schreibgeschützt — oben „Bearbeiten freischalten“.');
}

/* ── Übersicht ── */
export async function dbOverview(db) {
  if (!(await dbExists(db))) throw new Error('Datenbank nicht gefunden.');
  const { rows: tables } = await q('information_schema', `
    SELECT TABLE_NAME name, TABLE_TYPE type, ENGINE engine, TABLE_ROWS approxRows, DATA_LENGTH dataLen, INDEX_LENGTH idxLen,
           DATA_FREE free, AUTO_INCREMENT autoInc, TABLE_COLLATION collation, CREATE_TIME created, UPDATE_TIME updated, TABLE_COMMENT comment
    FROM TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [db]);
  const { rows: [meta] } = await q('information_schema', 'SELECT DEFAULT_CHARACTER_SET_NAME charset, DEFAULT_COLLATION_NAME collation FROM SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
  const { rows: routines } = await q('information_schema', 'SELECT ROUTINE_NAME name, ROUTINE_TYPE type FROM ROUTINES WHERE ROUTINE_SCHEMA = ?', [db]);
  const { rows: triggers } = await q('information_schema', 'SELECT TRIGGER_NAME name, EVENT_OBJECT_TABLE tbl, EVENT_MANIPULATION ev, ACTION_TIMING timing FROM TRIGGERS WHERE TRIGGER_SCHEMA = ?', [db]);
  const { rows: fkRows } = await q('information_schema', 'SELECT COUNT(*) n FROM REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?', [db]);
  const list = tables.map((t) => ({
    name: t.name,
    view: t.type === 'VIEW',
    engine: t.engine,
    rows: Number(t.approxRows) || 0,
    size: (Number(t.dataLen) || 0) + (Number(t.idxLen) || 0),
    free: Number(t.free) || 0,
    autoInc: t.autoInc ? Number(t.autoInc) : null,
    collation: t.collation,
    created: t.created,
    updated: t.updated,
    comment: t.comment,
  }));
  // InnoDB schätzt TABLE_ROWS — kleine Tabellen exakt zählen
  await Promise.all(list.filter((t) => !t.view && t.rows < 50_000).slice(0, 80).map(async (t) => {
    try { const { rows } = await q(db, `SELECT COUNT(*) n FROM ${ident(t.name)}`); t.rows = Number(rows[0].n); t.exact = true; } catch { /* */ }
  }));
  return {
    db, charset: meta?.charset, collation: meta?.collation, system: SYSTEM_DBS.has(db),
    tables: list, size: list.reduce((s, t) => s + t.size, 0), rows: list.reduce((s, t) => s + t.rows, 0),
    routines, triggers, foreignKeys: Number(fkRows[0]?.n) || 0,
  };
}

/* ── Spalten / Struktur ── */
async function columnsOf(db, table) {
  const { rows } = await q('information_schema', `
    SELECT COLUMN_NAME name, COLUMN_TYPE type, DATA_TYPE dataType, IS_NULLABLE nullable, COLUMN_DEFAULT def, COLUMN_KEY ckey,
           EXTRA extra, COLUMN_COMMENT comment, CHARACTER_MAXIMUM_LENGTH maxLen, COLLATION_NAME collation, ORDINAL_POSITION pos, GENERATION_EXPRESSION gen
    FROM COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [db, table]);
  if (!rows.length) throw new Error('Tabelle nicht gefunden.');
  return rows.map((c) => ({
    name: c.name, type: c.type, dataType: c.dataType, nullable: c.nullable === 'YES', default: c.def, key: c.ckey,
    extra: c.extra, comment: c.comment, maxLen: c.maxLen != null ? Number(c.maxLen) : null, collation: c.collation,
    autoIncrement: /auto_increment/i.test(c.extra || ''), generated: !!c.gen,
  }));
}

async function primaryKey(db, table) {
  const { rows } = await q('information_schema', `SELECT COLUMN_NAME c FROM KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`, [db, table]);
  return rows.map((r) => r.c);
}

async function foreignKeys(db, table) {
  const { rows } = await q('information_schema', `
    SELECT k.CONSTRAINT_NAME name, k.COLUMN_NAME col, k.REFERENCED_TABLE_NAME refTable, k.REFERENCED_COLUMN_NAME refCol, r.UPDATE_RULE onUpdate, r.DELETE_RULE onDelete
    FROM KEY_COLUMN_USAGE k JOIN REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [db, table]);
  return rows;
}

export async function tableStructure(db, table) {
  const [columns, pk, fks] = await Promise.all([columnsOf(db, table), primaryKey(db, table), foreignKeys(db, table)]);
  const { rows: idx } = await q(db, `SHOW INDEX FROM ${ident(table)}`);
  const indexes = [];
  for (const r of idx) {
    let i = indexes.find((x) => x.name === r.Key_name);
    if (!i) { i = { name: r.Key_name, unique: !Number(r.Non_unique), type: r.Index_type, columns: [], cardinality: Number(r.Cardinality) || 0 }; indexes.push(i); }
    i.columns.push(r.Sub_part ? `${r.Column_name}(${r.Sub_part})` : r.Column_name);
  }
  let create = '';
  try { const { rows } = await q(db, `SHOW CREATE TABLE ${ident(table)}`); create = rows[0]['Create Table'] || rows[0]['Create View'] || ''; } catch { /* */ }
  const { rows: [st] } = await q('information_schema', 'SELECT ENGINE engine, TABLE_ROWS approxRows, DATA_LENGTH dataLen, INDEX_LENGTH idxLen, AUTO_INCREMENT autoInc, TABLE_COLLATION collation, TABLE_COMMENT comment, TABLE_TYPE type FROM TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [db, table]);
  // Wer verweist auf diese Tabelle?
  const { rows: refBy } = await q('information_schema', 'SELECT TABLE_NAME tbl, COLUMN_NAME col, REFERENCED_COLUMN_NAME refCol, CONSTRAINT_NAME name FROM KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?', [db, table]);
  return { columns, pk, indexes, foreignKeys: fks, referencedBy: refBy, create, status: st || {} };
}

/* ── Daten ── */
const OPS = { '=': '=', '!=': '<>', '<': '<', '>': '>', '<=': '<=', '>=': '>=', like: 'LIKE', 'not like': 'NOT LIKE', regexp: 'REGEXP', null: 'IS NULL', 'not null': 'IS NOT NULL', in: 'IN', contains: 'LIKE', starts: 'LIKE' };
const TEXTY = /char|text|enum|set|json/i;

function buildWhere(columns, { filters = [], q: search = '' }) {
  const names = new Set(columns.map((c) => c.name));
  const parts = [];
  for (const f of Array.isArray(filters) ? filters.slice(0, 20) : []) {
    if (!names.has(f.col)) continue;
    const op = OPS[String(f.op || '=').toLowerCase()];
    if (!op) continue;
    const col = ident(f.col);
    if (op === 'IS NULL' || op === 'IS NOT NULL') parts.push(`${col} ${op}`);
    else if (op === 'IN') {
      const vals = String(f.val ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
      if (vals.length) parts.push(`${col} IN (${vals.map(esc).join(',')})`);
    } else if (f.op === 'contains') parts.push(`${col} LIKE ${esc(`%${f.val ?? ''}%`)}`);
    else if (f.op === 'starts') parts.push(`${col} LIKE ${esc(`${f.val ?? ''}%`)}`);
    else parts.push(`${col} ${op} ${esc(f.val ?? '')}`);
  }
  const s = String(search || '').trim();
  if (s) {
    const tc = columns.filter((c) => TEXTY.test(c.dataType) || /int|decimal|float|double/.test(c.dataType));
    if (tc.length) parts.push(`(${tc.map((c) => `${ident(c.name)} LIKE ${esc(`%${s}%`)}`).join(' OR ')})`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

function cleanRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) {
      out[k] = v.length <= 64 && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(v.toString('latin1')) ? v.toString('utf8') : { __bin: true, length: v.length, hex: v.subarray(0, 32).toString('hex') };
    } else out[k] = v;
  }
  return out;
}

export async function browse(db, table, { offset = 0, limit = 50, sort = null, dir = 'asc', filters = [], q: search = '' } = {}) {
  const columns = await columnsOf(db, table);
  const pk = await primaryKey(db, table);
  const where = buildWhere(columns, { filters, q: search });
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const order = sort && columns.some((c) => c.name === sort) ? `ORDER BY ${ident(sort)} ${dir === 'desc' ? 'DESC' : 'ASC'}` : pk.length ? `ORDER BY ${pk.map(ident).join(', ')}` : '';
  const t0 = Date.now();
  const { rows } = await q(db, `SELECT * FROM ${ident(table)} ${where} ${order} LIMIT ${lim} OFFSET ${off}`);
  const ms = Date.now() - t0;
  let total = null;
  try {
    const { rows: c } = await q(db, `SELECT COUNT(*) n FROM ${ident(table)} ${where}`);
    total = Number(c[0].n);
  } catch { /* */ }
  const fks = await foreignKeys(db, table);
  return { columns, pk, foreignKeys: fks, rows: rows.map(cleanRow), total, offset: off, limit: lim, ms };
}

async function keyWhere(db, table, key) {
  const columns = await columnsOf(db, table);
  const pk = await primaryKey(db, table);
  const names = new Set(columns.map((c) => c.name));
  if (pk.length) {
    for (const c of pk) if (!(c in key)) throw new Error(`Primärschlüssel ${c} fehlt.`);
    return { where: pk.map((c) => `${ident(c)} <=> ${esc(key[c])}`).join(' AND '), limit: '', columns };
  }
  // Ohne Primärschlüssel: alle Werte vergleichen, nur eine Zeile ändern
  const cond = Object.entries(key).filter(([k, v]) => names.has(k) && !(v && typeof v === 'object')).map(([k, v]) => `${ident(k)} <=> ${esc(v)}`);
  if (!cond.length) throw new Error('Zeile lässt sich nicht eindeutig bestimmen.');
  return { where: cond.join(' AND '), limit: 'LIMIT 1', columns };
}

function valueSql(v, col) {
  if (v === null) return 'NULL';
  if (v && typeof v === 'object' && v.__expr) {
    const e = String(v.__expr).toUpperCase();
    if (['CURRENT_TIMESTAMP', 'NOW()', 'UUID()', 'CURDATE()', 'UNIX_TIMESTAMP()'].includes(e)) return e;
    throw new Error('Ausdruck nicht erlaubt.');
  }
  if (col && /json/i.test(col.dataType) && typeof v === 'object') return esc(JSON.stringify(v));
  return esc(v);
}

export async function updateRow(db, table, key, changes) {
  const { where, limit, columns } = await keyWhere(db, table, key);
  const byName = Object.fromEntries(columns.map((c) => [c.name, c]));
  const sets = Object.entries(changes || {}).filter(([k]) => byName[k] && !byName[k].generated).map(([k, v]) => `${ident(k)} = ${valueSql(v, byName[k])}`);
  if (!sets.length) throw new Error('Keine Änderungen.');
  const sql = `UPDATE ${ident(table)} SET ${sets.join(', ')} WHERE ${where} ${limit}`;
  const { rows } = await q(db, sql);
  return { affected: rows.affectedRows, sql };
}

export async function insertRow(db, table, values) {
  const columns = await columnsOf(db, table);
  const byName = Object.fromEntries(columns.map((c) => [c.name, c]));
  const entries = Object.entries(values || {}).filter(([k, v]) => byName[k] && !byName[k].generated && v !== undefined);
  const sql = entries.length
    ? `INSERT INTO ${ident(table)} (${entries.map(([k]) => ident(k)).join(', ')}) VALUES (${entries.map(([k, v]) => valueSql(v, byName[k])).join(', ')})`
    : `INSERT INTO ${ident(table)} () VALUES ()`;
  const { rows } = await q(db, sql);
  return { insertId: rows.insertId, affected: rows.affectedRows, sql };
}

export async function deleteRows(db, table, keys) {
  if (!Array.isArray(keys) || !keys.length) throw new Error('Keine Zeilen ausgewählt.');
  let affected = 0;
  const conn = await pool(db).getConnection();
  try {
    await conn.beginTransaction();
    for (const key of keys.slice(0, 1000)) {
      const { where, limit } = await keyWhere(db, table, key);
      const [r] = await conn.query(`DELETE FROM ${ident(table)} WHERE ${where} ${limit}`);
      affected += r.affectedRows;
    }
    await conn.commit();
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
  return { affected };
}

/* ── Struktur ändern ── */
const TYPE_RE = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|bit|bool|boolean|char|varchar|binary|varbinary|tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|enum|set|date|datetime|timestamp|time|year|json|uuid|point|geometry)(\((\d+(,\d+)?|('[^'\\]*'(,'[^'\\]*')*))\))?$/i;

export function columnDef(c) {
  const name = ident(c.name, 'Spaltenname');
  const type = String(c.type || '').trim().replace(/\s+/g, '');
  if (!TYPE_RE.test(type)) throw new Error(`Datentyp ungültig: ${c.type}`);
  const parts = [name, type.toUpperCase().replace(/\((.*)\)/, (m, inner) => `(${inner})`)];
  if (c.unsigned && /int|decimal|float|double/i.test(type)) parts.push('UNSIGNED');
  parts.push(c.nullable ? 'NULL' : 'NOT NULL');
  if (c.autoIncrement) parts.push('AUTO_INCREMENT');
  else if (c.default !== undefined && c.default !== null && c.default !== '') {
    const d = String(c.default);
    if (/^(CURRENT_TIMESTAMP|NULL|NOW\(\))$/i.test(d)) parts.push(`DEFAULT ${d.toUpperCase()}`);
    else parts.push(`DEFAULT ${esc(d)}`);
  } else if (c.default === null && c.nullable) parts.push('DEFAULT NULL');
  if (c.onUpdateNow && /timestamp|datetime/i.test(type)) parts.push('ON UPDATE CURRENT_TIMESTAMP');
  if (c.comment) parts.push(`COMMENT ${esc(String(c.comment).slice(0, 1024))}`);
  return parts.join(' ');
}

export async function alterTable(db, table, body) {
  const t = ident(table, 'Tabelle');
  let sql;
  switch (body.op) {
    case 'addColumn': sql = `ALTER TABLE ${t} ADD COLUMN ${columnDef(body.column)}${body.after === '__first' ? ' FIRST' : body.after ? ` AFTER ${ident(body.after)}` : ''}`; break;
    case 'modifyColumn': sql = `ALTER TABLE ${t} CHANGE COLUMN ${ident(body.from || body.column.name)} ${columnDef(body.column)}`; break;
    case 'dropColumn': sql = `ALTER TABLE ${t} DROP COLUMN ${ident(body.column)}`; break;
    case 'addIndex': {
      const cols = (body.columns || []).map((c) => ident(c)).join(', ');
      if (!cols) throw new Error('Spalten wählen.');
      const kind = { primary: 'PRIMARY KEY', unique: 'UNIQUE INDEX', fulltext: 'FULLTEXT INDEX', index: 'INDEX' }[body.kind || 'index'];
      if (!kind) throw new Error('Index-Typ ungültig.');
      sql = `ALTER TABLE ${t} ADD ${kind}${body.kind === 'primary' ? '' : ` ${ident(body.name || `idx_${(body.columns || []).join('_')}`.slice(0, 64))}`} (${cols})`;
      break;
    }
    case 'dropIndex': sql = body.name === 'PRIMARY' ? `ALTER TABLE ${t} DROP PRIMARY KEY` : `ALTER TABLE ${t} DROP INDEX ${ident(body.name)}`; break;
    case 'addForeignKey': {
      const rules = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];
      const onDel = rules.includes(body.onDelete) ? body.onDelete : 'RESTRICT';
      const onUpd = rules.includes(body.onUpdate) ? body.onUpdate : 'RESTRICT';
      sql = `ALTER TABLE ${t} ADD CONSTRAINT ${ident(body.name || `fk_${table}_${body.column}`.slice(0, 64))} FOREIGN KEY (${ident(body.column)}) REFERENCES ${ident(body.refTable)} (${ident(body.refCol)}) ON DELETE ${onDel} ON UPDATE ${onUpd}`;
      break;
    }
    case 'dropForeignKey': sql = `ALTER TABLE ${t} DROP FOREIGN KEY ${ident(body.name)}`; break;
    case 'rename': sql = `RENAME TABLE ${t} TO ${ident(body.to, 'Neuer Name')}`; break;
    case 'comment': sql = `ALTER TABLE ${t} COMMENT = ${esc(String(body.comment || '').slice(0, 2048))}`; break;
    case 'truncate': sql = `TRUNCATE TABLE ${t}`; break;
    case 'drop': sql = body.view ? `DROP VIEW ${t}` : `DROP TABLE ${t}`; break;
    case 'optimize': sql = `OPTIMIZE TABLE ${t}`; break;
    case 'analyze': sql = `ANALYZE TABLE ${t}`; break;
    case 'copy': {
      const to = ident(body.to, 'Neuer Name');
      await q(db, `CREATE TABLE ${to} LIKE ${t}`);
      if (body.withData !== false) await q(db, `INSERT INTO ${to} SELECT * FROM ${t}`);
      return { sql: `CREATE TABLE ${to} LIKE ${t}${body.withData !== false ? `; INSERT INTO ${to} SELECT * FROM ${t}` : ''}` };
    }
    case 'engine': {
      if (!['InnoDB', 'MyISAM', 'Aria', 'MEMORY'].includes(body.engine)) throw new Error('Engine ungültig.');
      sql = `ALTER TABLE ${t} ENGINE = ${body.engine}`;
      break;
    }
    default: throw new Error('Aktion unbekannt.');
  }
  const { rows } = await q(db, sql);
  return { sql, result: Array.isArray(rows) ? rows.map(cleanRow) : null };
}

export async function createTable(db, body) {
  const name = ident(body.name, 'Tabellenname');
  const cols = (body.columns || []).filter((c) => c.name);
  if (!cols.length) throw new Error('Mindestens eine Spalte.');
  const defs = cols.map(columnDef);
  const pk = cols.filter((c) => c.primary).map((c) => ident(c.name));
  if (pk.length) defs.push(`PRIMARY KEY (${pk.join(', ')})`);
  for (const c of cols.filter((x) => x.unique && !x.primary)) defs.push(`UNIQUE KEY ${ident(`uniq_${c.name}`.slice(0, 64))} (${ident(c.name)})`);
  for (const c of cols.filter((x) => x.index && !x.primary && !x.unique)) defs.push(`KEY ${ident(`idx_${c.name}`.slice(0, 64))} (${ident(c.name)})`);
  const engine = ['InnoDB', 'MyISAM', 'Aria'].includes(body.engine) ? body.engine : 'InnoDB';
  const sql = `CREATE TABLE ${name} (\n  ${defs.join(',\n  ')}\n) ENGINE=${engine} DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci${body.comment ? ` COMMENT=${esc(body.comment)}` : ''}`;
  await q(db, sql);
  return { sql };
}

/* ── SQL-Konsole ── */
const WRITE_RE = /^\s*(insert|update|delete|replace|create|alter|drop|truncate|rename|grant|revoke|set|lock|unlock|call|load|optimize|repair|analyze|flush|kill|handler|do)\b/i;

export function isWriteSql(sql) {
  return String(sql).split(/;\s*(?=(?:[^'"]|'[^']*'|"[^"]*")*$)/).some((s) => WRITE_RE.test(s.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, '')));
}

export async function runSql(db, sql, { maxRows = MAX_ROWS } = {}) {
  const text = String(sql || '').trim();
  if (!text) throw new Error('Keine Abfrage.');
  if (text.length > 2_000_000) throw new Error('Abfrage zu lang.');
  const conn = await mysql.createConnection({ ...baseOpts(), database: db, multipleStatements: true });
  const t0 = Date.now();
  try {
    const [res, fields] = await conn.query({ sql: text, timeout: 120_000, rowsAsArray: false });
    const ms = Date.now() - t0;
    // Mehrere Statements: res/fields sind Arrays pro Statement (fields[i] = Feldliste oder undefined)
    const multi = Array.isArray(fields) && fields.length > 0 && (Array.isArray(fields[0]) || fields[0] === undefined) && Array.isArray(res) && res.length === fields.length;
    const sets = multi ? res.map((r, i) => [r, fields[i]]) : [[res, fields]];
    const results = sets.map(([r, f]) => {
      if (Array.isArray(r)) {
        return {
          kind: 'rows',
          columns: (f || []).map((x) => ({ name: x.name, table: x.orgTable || x.table, type: x.columnType })),
          rows: r.slice(0, maxRows).map(cleanRow),
          total: r.length,
          truncated: r.length > maxRows,
        };
      }
      return { kind: 'ok', affected: r?.affectedRows ?? 0, insertId: r?.insertId || null, info: r?.info || '', warnings: r?.warningStatus || 0 };
    });
    return { results, ms };
  } finally {
    conn.end().catch(() => {});
  }
}

export async function explain(db, sql) {
  const s = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^\s*(select|with)\b/i.test(s)) throw new Error('EXPLAIN nur für SELECT.');
  const { rows } = await q(db, `EXPLAIN ${s}`);
  return rows.map(cleanRow);
}

/* ── Beziehungen (ER-Diagramm) ── */
export async function relations(db) {
  const { rows: cols } = await q('information_schema', 'SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE type, COLUMN_KEY k, IS_NULLABLE n FROM COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [db]);
  const { rows: fks } = await q('information_schema', 'SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc, CONSTRAINT_NAME name FROM KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL', [db]);
  const tables = {};
  for (const r of cols) {
    tables[r.t] = tables[r.t] || { name: r.t, columns: [] };
    tables[r.t].columns.push({ name: r.c, type: r.type, key: r.k, nullable: r.n === 'YES' });
  }
  // Implizite Beziehungen erraten (z. B. owner → users.identifier) wenn keine echten FKs existieren
  const guessed = [];
  if (!fks.length) {
    const pkOf = Object.fromEntries(Object.values(tables).map((t) => [t.name, t.columns.find((c) => c.key === 'PRI')?.name]));
    for (const t of Object.values(tables)) {
      for (const c of t.columns) {
        const m = c.name.match(/^(.+?)_?id$/i);
        if (!m || c.key === 'PRI') continue;
        const target = Object.keys(tables).find((n) => n !== t.name && (n === m[1] || n === `${m[1]}s` || n === `${m[1]}es`));
        if (target && pkOf[target]) guessed.push({ t: t.name, c: c.name, rt: target, rc: pkOf[target], guessed: true });
      }
    }
  }
  return { tables: Object.values(tables), relations: [...fks, ...guessed] };
}

/* ── Globale Suche ── */
export async function searchAll(db, term, { perTable = 5 } = {}) {
  const s = String(term || '').trim();
  if (s.length < 2) throw new Error('Mindestens 2 Zeichen.');
  const { rows: cols } = await q('information_schema', "SELECT c.TABLE_NAME t, c.COLUMN_NAME c, c.DATA_TYPE d FROM COLUMNS c JOIN TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME WHERE c.TABLE_SCHEMA = ? AND tb.TABLE_TYPE = 'BASE TABLE'", [db]);
  const byTable = {};
  for (const r of cols) if (TEXTY.test(r.d)) (byTable[r.t] = byTable[r.t] || []).push(r.c);
  const hits = [];
  const t0 = Date.now();
  for (const [t, cs] of Object.entries(byTable).slice(0, 150)) {
    if (Date.now() - t0 > 15_000) break;
    try {
      const where = cs.map((c) => `${ident(c)} LIKE ${esc(`%${s}%`)}`).join(' OR ');
      const { rows } = await q(db, `SELECT * FROM ${ident(t)} WHERE ${where} LIMIT ${perTable + 1}`);
      if (rows.length) {
        hits.push({
          table: t,
          more: rows.length > perTable,
          columns: cs.filter((c) => rows.some((r) => String(r[c] ?? '').toLowerCase().includes(s.toLowerCase()))),
          rows: rows.slice(0, perTable).map(cleanRow),
        });
      }
    } catch { /* Tabelle überspringen */ }
  }
  return { term: s, hits, ms: Date.now() - t0 };
}

/* ── Benutzer & Rechte auf dieser DB ── */
export async function dbUsers(db) {
  const { rows } = await q('mysql', `SELECT User user, Host host, Select_priv s, Insert_priv i, Update_priv u, Delete_priv d, Create_priv c, Drop_priv dr, Alter_priv a, Index_priv ix FROM db WHERE REPLACE(Db, '\\\\_', '_') = ?`, [db]);
  return rows.map((r) => ({ user: r.user, host: r.host, privileges: Object.entries({ SELECT: r.s, INSERT: r.i, UPDATE: r.u, DELETE: r.d, CREATE: r.c, DROP: r.dr, ALTER: r.a, INDEX: r.ix }).filter(([, v]) => v === 'Y').map(([k]) => k) }));
}

/* ── Export / Import ── */
export async function exportData(db, res, { table = null, format = 'sql', query = null } = {}) {
  const name = `${db}${table ? `-${table}` : ''}-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'sql') {
    const bin = (await has('mariadb-dump')) || (await has('mysqldump'));
    if (!bin) throw new Error('mysqldump fehlt.');
    const args = ['--protocol=socket', '-uroot', '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', '--', db];
    if (table) { ident(table); args.push(table); }
    res.writeHead(200, { 'Content-Type': 'application/sql; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.sql"`, 'Cache-Control': 'no-store' });
    const p = spawn(bin, args);
    p.stdout.pipe(res);
    p.on('error', () => res.end());
    return;
  }
  const sql = query ? String(query) : `SELECT * FROM ${ident(table, 'Tabelle')}`;
  if (query && isWriteSql(query)) throw new Error('Nur SELECT-Abfragen exportieren.');
  const conn = await mysql.createConnection({ ...baseOpts(), database: db });
  const stream = conn.connection.query(sql).stream({ highWaterMark: 200 });
  const ext = format === 'json' ? 'json' : 'csv';
  res.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.${ext}"`, 'Cache-Control': 'no-store' });
  let first = true;
  let header = null;
  const csvCell = (v) => {
    if (v === null || v === undefined) return '';
    const s = Buffer.isBuffer(v) ? v.toString('hex') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (format === 'json') res.write('[\n');
  else res.write('\ufeff');
  stream.on('data', (row) => {
    if (format === 'json') { res.write(`${first ? '' : ',\n'}${JSON.stringify(cleanRow(row))}`); first = false; return; }
    if (!header) { header = Object.keys(row); res.write(`${header.map(csvCell).join(',')}\n`); }
    res.write(`${header.map((k) => csvCell(row[k])).join(',')}\n`);
  });
  stream.on('end', () => { if (format === 'json') res.write('\n]\n'); res.end(); conn.end().catch(() => {}); });
  stream.on('error', (e) => { res.end(`\n-- Fehler: ${e.message}\n`); conn.end().catch(() => {}); });
}

/** SQL-Datei in eine Datenbank einspielen (Rohdaten aus dem Request, .sql oder .sql.gz) */
export async function importSql(db, req, { gz = false } = {}) {
  const cli = (await has('mariadb')) || (await has('mysql'));
  if (!cli) throw new Error('MySQL-Client fehlt.');
  return new Promise((resolve, reject) => {
    const p = spawn(cli, ['--protocol=socket', '-uroot', '--default-character-set=utf8mb4', '--max-allowed-packet=512M', db]);
    let err = '';
    let bytes = 0;
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ bytes }) : reject(new Error(err.trim().split('\n').slice(-4).join('\n') || `Import fehlgeschlagen (${code})`))));
    req.on('data', (c) => { bytes += c.length; if (bytes > 2 * 1024 ** 3) { req.destroy(); p.kill(); reject(new Error('Datei zu groß (max. 2 GB).')); } });
    if (gz) {
      import('node:zlib').then((z) => req.pipe(z.createGunzip()).on('error', (e) => { p.kill(); reject(e); }).pipe(p.stdin));
    } else req.pipe(p.stdin);
    p.stdin.on('error', () => {});
  });
}

/* ── Neue Datenbank ohne Benutzer, Löschen ── */
export async function serverInfo() {
  const { rows } = await q('information_schema', "SELECT VERSION() v, @@hostname h, @@character_set_server cs, @@collation_server co, @@max_connections mc, @@innodb_buffer_pool_size bp");
  const { rows: st } = await q('information_schema', "SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime','Threads_connected','Questions','Slow_queries','Bytes_received','Bytes_sent')");
  const status = Object.fromEntries(st.map((r) => [r.Variable_name, Number(r.Value)]));
  const { rows: proc } = await q('information_schema', 'SELECT ID id, USER user, HOST host, DB db, COMMAND cmd, TIME time, STATE state, LEFT(INFO, 300) info FROM PROCESSLIST ORDER BY TIME DESC LIMIT 50');
  return { version: rows[0].v, charset: rows[0].cs, collation: rows[0].co, maxConnections: Number(rows[0].mc), bufferPool: Number(rows[0].bp), status, processes: proc };
}

export async function killProcess(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Prozess-ID ungültig.');
  await q('information_schema', `KILL ${n}`);
}
