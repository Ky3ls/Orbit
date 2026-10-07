import mysql from 'mysql2/promise';

export function mysqlReady(settings) {
  return Boolean(String(settings.mysqlDsn || '').includes('mysql://'));
}

function poolFor(dsn) {
  const url = new URL(dsn);
  return mysql.createPool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 2,
    waitForConnections: true,
    charset: 'utf8mb4',
  });
}

let pool;
let poolDsn = '';

export function getMysqlPool(settings) {
  const dsn = settings.mysqlDsn;
  if (!mysqlReady(settings)) {
    throw new Error('MySQL-DSN fehlt (mysql_connection_string in server.cfg).');
  }
  if (!pool || poolDsn !== dsn) {
    pool?.end?.().catch(() => {});
    pool = poolFor(dsn);
    poolDsn = dsn;
  }
  return pool;
}

export function assertTableName(name) {
  const t = String(name || '').trim();
  if (!/^[a-zA-Z0-9_$]+$/.test(t)) throw new Error('Ungültiger Tabellenname.');
  return t;
}

export function databaseNameFromSettings(settings) {
  const dsn = settings.mysqlDsn;
  if (!dsn) return '';
  try {
    return new URL(dsn).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

export function assertSelectOnly(sql) {
  const q = String(sql || '').trim();
  if (!q) throw new Error('Leere Abfrage.');
  if (q.includes(';')) throw new Error('Nur eine Anweisung, ohne Semikolon.');
  if (!/^select\s/i.test(q)) throw new Error('Nur SELECT-Abfragen erlaubt.');
  if (/\b(insert|update|delete|drop|alter|create|grant|truncate|replace|call)\b/i.test(q)) {
    throw new Error('Nur SELECT-Abfragen erlaubt.');
  }
  return q;
}

export function assertSingleStatement(sql) {
  const q = String(sql || '').trim();
  if (!q) throw new Error('Leere Abfrage.');
  if (q.includes(';')) throw new Error('Nur eine Anweisung, ohne Semikolon.');
  return q;
}

/** SQL-Dump in Einzelstatements splitten (Strings/Kommentare beachten). */
export function splitSqlStatements(sql) {
  const src = String(sql || '');
  const out = [];
  let buf = '';
  let i = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  const flush = () => {
    const stmt = buf.replace(/^\s+|\s+$/g, '');
    buf = '';
    if (!stmt) return;
    const withoutComments = stmt
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
      .replace(/#[^\n]*/g, ' ')
      .trim();
    if (withoutComments) out.push(stmt);
  };

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];

    if (lineComment) {
      buf += c;
      if (c === '\n') lineComment = false;
      i += 1;
      continue;
    }
    if (blockComment) {
      buf += c;
      if (c === '*' && n === '/') {
        buf += '/';
        i += 2;
        blockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (quote) {
      buf += c;
      if (c === '\\' && quote !== '`') {
        if (n != null) {
          buf += n;
          i += 2;
          continue;
        }
      }
      if (c === quote) {
        if ((quote === "'" || quote === '"') && n === quote) {
          buf += n;
          i += 2;
          continue;
        }
        quote = null;
      }
      i += 1;
      continue;
    }

    if (c === '-' && n === '-') {
      lineComment = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '#') {
      lineComment = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      blockComment = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ';') {
      flush();
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  flush();
  return out;
}

function assertScriptStatementAllowed(stmt) {
  const head = String(stmt || '').replace(/^\s+/, '').slice(0, 80);
  if (/\b(drop\s+database|create\s+database|grant\b|revoke\b|create\s+user|alter\s+user|set\s+password|load\s+data|into\s+outfile|into\s+dumpfile)\b/i.test(head)
    || /\b(drop\s+database|create\s+database|grant\b|revoke\b|create\s+user|alter\s+user|load\s+data|into\s+outfile)\b/i.test(stmt)) {
    throw new Error('Diese Anweisung ist im Panel nicht erlaubt.');
  }
}

export async function listTables(settings) {
  const p = getMysqlPool(settings);
  const [rows] = await p.query('SHOW TABLES');
  const key = Object.keys(rows[0] || {})[0] || 'Tables_in_db';
  return rows.map((r) => String(r[key]));
}

export async function databaseOverview(settings) {
  const p = getMysqlPool(settings);
  const [rows] = await p.query('SHOW TABLE STATUS');
  return rows.map((r) => ({
    name: String(r.Name),
    rows: Number(r.Rows ?? 0),
    engine: r.Engine ? String(r.Engine) : '',
    collation: r.Collation ? String(r.Collation) : '',
    size: Number(r.Data_length ?? 0) + Number(r.Index_length ?? 0),
  }));
}

export async function searchTable(settings, tableName, column, q, limit = 100) {
  const table = assertTableName(tableName);
  const columnName = assertTableName(column);
  const cols = await tableStructure(settings, table);
  if (!cols.some((c) => c.field === columnName)) throw new Error('Spalte nicht gefunden.');
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const p = getMysqlPool(settings);
  const [rows, fields] = await p.query({
    sql: `SELECT * FROM \`${table}\` WHERE \`${columnName}\` LIKE ? LIMIT ?`,
    values: [`%${String(q ?? '')}%`, lim],
    timeout: 15_000,
  });
  const list = Array.isArray(rows) ? rows : [];
  return {
    rows: list,
    columns: fields?.map((f) => f.name) || Object.keys(list[0] || {}),
    limit: lim,
  };
}

export async function getDatabaseMeta(settings) {
  const p = getMysqlPool(settings);
  const [[verRow]] = await p.query('SELECT VERSION() AS version');
  return {
    database: databaseNameFromSettings(settings),
    version: String(verRow?.version || ''),
  };
}

export async function tableStructure(settings, tableName) {
  const table = assertTableName(tableName);
  const p = getMysqlPool(settings);
  const [rows] = await p.query(`SHOW FULL COLUMNS FROM \`${table}\``);
  return rows.map((r) => ({
    field: r.Field,
    type: r.Type,
    collation: r.Collation,
    null: r.Null,
    key: r.Key,
    default: r.Default,
    extra: r.Extra,
    privileges: r.Privileges,
    comment: r.Comment,
  }));
}

export async function tableIndexes(settings, tableName) {
  const table = assertTableName(tableName);
  const p = getMysqlPool(settings);
  const [rows] = await p.query(`SHOW INDEX FROM \`${table}\``);
  const byKey = new Map();
  for (const r of rows || []) {
    const name = String(r.Key_name || '');
    if (!byKey.has(name)) {
      byKey.set(name, {
        name,
        unique: Number(r.Non_unique) === 0,
        primary: name === 'PRIMARY',
        type: String(r.Index_type || ''),
        columns: [],
      });
    }
    byKey.get(name).columns.push(String(r.Column_name || ''));
  }
  return [...byKey.values()];
}

function assertColumnType(type) {
  const t = String(type || '').trim();
  if (!t || t.length > 128) throw new Error('Ungültiger Spaltentyp.');
  if (!/^[a-zA-Z][a-zA-Z0-9_\s(),.'"-]*$/.test(t)) throw new Error('Ungültiger Spaltentyp.');
  if (/;|--|\/\*|\*\//.test(t)) throw new Error('Ungültiger Spaltentyp.');
  return t;
}

function assertComment(comment) {
  const c = String(comment ?? '');
  if (c.length > 255) throw new Error('Kommentar zu lang.');
  if (/;|--|\/\*|\*\//.test(c)) throw new Error('Ungültiger Kommentar.');
  return c;
}

function buildColumnSql(def, escapeFn) {
  const name = assertTableName(def.name || def.field);
  const type = assertColumnType(def.type);
  const nullable = def.nullable === true || String(def.null).toUpperCase() === 'YES';
  const autoIncrement = Boolean(def.autoIncrement || /\bauto_increment\b/i.test(String(def.extra || '')));
  const comment = assertComment(def.comment || '');
  let sql = `\`${name}\` ${type}`;
  sql += nullable ? ' NULL' : ' NOT NULL';
  if (autoIncrement) {
    sql += ' AUTO_INCREMENT';
  } else if (def.default === null || def.defaultValue === null) {
    if (nullable) sql += ' DEFAULT NULL';
  } else {
    const raw = def.defaultValue !== undefined ? def.defaultValue : def.default;
    if (raw !== undefined && raw !== '') {
      const s = String(raw).trim();
      if (/^(CURRENT_TIMESTAMP(?:\(\d*\))?|NULL)$/i.test(s)) {
        sql += ` DEFAULT ${s}`;
      } else {
        sql += ` DEFAULT ${escapeFn(s)}`;
      }
    }
  }
  if (comment) sql += ` COMMENT ${escapeFn(comment)}`;
  return sql;
}

function afterClause(after, structure) {
  if (!after || after === 'FIRST') return ' FIRST';
  const col = assertTableName(after);
  if (!structure.some((c) => c.field === col)) throw new Error(`Spalte nicht gefunden: ${col}`);
  return ` AFTER \`${col}\``;
}

export async function createTable(settings, tableName, columns = []) {
  const table = assertTableName(tableName);
  const cols = Array.isArray(columns) ? columns : [];
  if (!cols.length) throw new Error('Mindestens eine Spalte nötig.');
  if (cols.length > 64) throw new Error('Zu viele Spalten (max. 64).');
  const names = cols.map((c) => assertTableName(c?.name || c?.field));
  if (new Set(names).size !== names.length) throw new Error('Spaltnamen müssen eindeutig sein.');
  const existing = await listTables(settings);
  if (existing.includes(table)) throw new Error(`Tabelle existiert bereits: ${table}`);
  const p = getMysqlPool(settings);
  const escapeFn = (v) => p.escape(v);
  const defs = cols.map((c) => buildColumnSql(c, escapeFn));
  const pk = cols
    .filter((c) => c.primary || c.key === 'PRI')
    .map((c) => assertTableName(c.name || c.field));
  if (pk.length) {
    defs.push(`PRIMARY KEY (${pk.map((c) => `\`${c}\``).join(', ')})`);
  }
  await p.query({
    sql: `CREATE TABLE \`${table}\` (${defs.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    timeout: 30_000,
  });
  return { ok: true, table };
}

export async function addTableColumn(settings, tableName, def, after = null) {
  const table = assertTableName(tableName);
  const structure = await tableStructure(settings, table);
  const name = assertTableName(def?.name || def?.field);
  if (structure.some((c) => c.field === name)) throw new Error(`Spalte existiert bereits: ${name}`);
  const p = getMysqlPool(settings);
  const colSql = buildColumnSql({ ...def, name }, (v) => p.escape(v));
  const pos = after ? afterClause(after, structure) : '';
  await p.query({
    sql: `ALTER TABLE \`${table}\` ADD COLUMN ${colSql}${pos}`,
    timeout: 30_000,
  });
  return { ok: true, field: name };
}

export async function modifyTableColumn(settings, tableName, column, def) {
  const table = assertTableName(tableName);
  const oldName = assertTableName(column);
  const structure = await tableStructure(settings, table);
  if (!structure.some((c) => c.field === oldName)) throw new Error(`Spalte nicht gefunden: ${oldName}`);
  const newName = assertTableName(def?.name || def?.field || oldName);
  if (newName !== oldName && structure.some((c) => c.field === newName)) {
    throw new Error(`Spalte existiert bereits: ${newName}`);
  }
  const p = getMysqlPool(settings);
  const colSql = buildColumnSql({ ...def, name: newName }, (v) => p.escape(v));
  const sql = newName === oldName
    ? `ALTER TABLE \`${table}\` MODIFY COLUMN ${colSql}`
    : `ALTER TABLE \`${table}\` CHANGE COLUMN \`${oldName}\` ${colSql}`;
  await p.query({ sql, timeout: 30_000 });
  return { ok: true, field: newName };
}

export async function dropTableColumn(settings, tableName, column) {
  const table = assertTableName(tableName);
  const col = assertTableName(column);
  const structure = await tableStructure(settings, table);
  if (!structure.some((c) => c.field === col)) throw new Error(`Spalte nicht gefunden: ${col}`);
  if (structure.length <= 1) throw new Error('Letzte Spalte kann nicht gelöscht werden.');
  const p = getMysqlPool(settings);
  await p.query({
    sql: `ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``,
    timeout: 30_000,
  });
  return { ok: true, field: col };
}

export async function dropTableIndex(settings, tableName, indexName) {
  const table = assertTableName(tableName);
  const name = String(indexName || '').trim();
  if (!name || name.length > 64) throw new Error('Ungültiger Index.');
  if (!/^[a-zA-Z0-9_$]+$/.test(name)) throw new Error('Ungültiger Index.');
  const p = getMysqlPool(settings);
  if (name === 'PRIMARY') {
    await p.query({ sql: `ALTER TABLE \`${table}\` DROP PRIMARY KEY`, timeout: 30_000 });
  } else {
    await p.query({ sql: `ALTER TABLE \`${table}\` DROP INDEX \`${name}\``, timeout: 30_000 });
  }
  return { ok: true, index: name };
}

export async function browseTable(settings, tableName, offset = 0, limit = 25) {
  const table = assertTableName(tableName);
  const off = Math.max(Number(offset) || 0, 0);
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 500);
  const p = getMysqlPool(settings);
  const structure = await tableStructure(settings, table);
  const primaryKey = structure.filter((c) => c.key === 'PRI').map((c) => c.field);
  const [[countRow]] = await p.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  const total = Number(countRow?.c ?? 0);
  const [rows, fields] = await p.query({
    sql: `SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`,
    values: [lim, off],
    timeout: 15_000,
  });
  const list = Array.isArray(rows) ? rows : [];
  const columns = fields?.map((f) => f.name) || Object.keys(list[0] || {});
  return { rows: list, columns, total, offset: off, limit: lim, primaryKey, structure };
}

function assertKnownColumns(structure, names) {
  const allowed = new Set(structure.map((c) => c.field));
  for (const name of names) {
    const col = assertTableName(name);
    if (!allowed.has(col)) throw new Error(`Ungültige Spalte: ${col}`);
  }
}

function primaryKeyFields(structure) {
  const pk = structure.filter((c) => c.key === 'PRI').map((c) => c.field);
  if (!pk.length) throw new Error('Tabelle hat keinen Primärschlüssel — Editieren nicht möglich.');
  return pk;
}

function normalizeCellValue(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export async function updateTableRow(settings, tableName, pk, changes) {
  const table = assertTableName(tableName);
  const structure = await tableStructure(settings, table);
  const pkFields = primaryKeyFields(structure);
  const pkObj = pk && typeof pk === 'object' ? pk : {};
  for (const field of pkFields) {
    if (!(field in pkObj)) throw new Error(`Primärschlüssel fehlt: ${field}`);
  }
  const setKeys = Object.keys(changes || {}).filter((k) => !(pkFields.includes(k) && structure.find((c) => c.field === k)?.extra?.includes('auto_increment')));
  if (!setKeys.length) throw new Error('Keine Änderungen.');
  assertKnownColumns(structure, setKeys);
  const sets = setKeys.map((k) => `\`${assertTableName(k)}\` = ?`);
  const wheres = pkFields.map((k) => `\`${k}\` = ?`);
  const values = [
    ...setKeys.map((k) => normalizeCellValue(changes[k])),
    ...pkFields.map((k) => normalizeCellValue(pkObj[k])),
  ];
  const p = getMysqlPool(settings);
  const [result] = await p.query({
    sql: `UPDATE \`${table}\` SET ${sets.join(', ')} WHERE ${wheres.join(' AND ')} LIMIT 1`,
    values,
    timeout: 15_000,
  });
  return { affectedRows: Number(result?.affectedRows ?? 0) };
}

export async function insertTableRow(settings, tableName, values) {
  const table = assertTableName(tableName);
  const structure = await tableStructure(settings, table);
  const payload = values && typeof values === 'object' ? values : {};
  const keys = Object.keys(payload).filter((k) => {
    const col = structure.find((c) => c.field === k);
    if (!col) return false;
    if (col.extra?.includes('auto_increment') && (payload[k] === '' || payload[k] == null)) return false;
    return true;
  });
  if (!keys.length) throw new Error('Keine Werte zum Einfügen.');
  assertKnownColumns(structure, keys);
  const cols = keys.map((k) => `\`${assertTableName(k)}\``);
  const placeholders = keys.map(() => '?');
  const p = getMysqlPool(settings);
  const [result] = await p.query({
    sql: `INSERT INTO \`${table}\` (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values: keys.map((k) => normalizeCellValue(payload[k])),
    timeout: 15_000,
  });
  return {
    affectedRows: Number(result?.affectedRows ?? 0),
    insertId: result?.insertId != null ? Number(result.insertId) : undefined,
  };
}

export async function deleteTableRow(settings, tableName, pk) {
  const table = assertTableName(tableName);
  const structure = await tableStructure(settings, table);
  const pkFields = primaryKeyFields(structure);
  const pkObj = pk && typeof pk === 'object' ? pk : {};
  for (const field of pkFields) {
    if (!(field in pkObj)) throw new Error(`Primärschlüssel fehlt: ${field}`);
  }
  const wheres = pkFields.map((k) => `\`${k}\` = ?`);
  const p = getMysqlPool(settings);
  const [result] = await p.query({
    sql: `DELETE FROM \`${table}\` WHERE ${wheres.join(' AND ')} LIMIT 1`,
    values: pkFields.map((k) => normalizeCellValue(pkObj[k])),
    timeout: 15_000,
  });
  return { affectedRows: Number(result?.affectedRows ?? 0) };
}

export async function runSelect(settings, sql, limit = 200) {
  const q = assertSelectOnly(sql);
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const p = getMysqlPool(settings);
  const [rows, fields] = await p.query({ sql: q, timeout: 15_000 });
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > capped) {
    return { kind: 'resultset', rows: list.slice(0, capped), truncated: true, columns: fields?.map((f) => f.name) || [] };
  }
  return {
    kind: 'resultset',
    rows: list,
    truncated: false,
    columns: fields?.map((f) => f.name) || Object.keys(list[0] || {}),
  };
}

export async function runOwnerQuery(settings, sql, limit = 500) {
  const statements = splitSqlStatements(sql);
  if (!statements.length) throw new Error('Leere Abfrage.');
  if (statements.length === 1 && !/[;]/.test(String(sql || '').trim())) {
    /* ein Statement ohne Trailing-; — wie bisher */
  }
  const maxStmt = 400;
  if (statements.length > maxStmt) {
    throw new Error(`Zu viele Anweisungen (max. ${maxStmt}).`);
  }
  for (const stmt of statements) assertScriptStatementAllowed(stmt);

  const capped = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const p = getMysqlPool(settings);
  let affectedRows = 0;
  let insertId;
  let lastResultset = null;
  let okCount = 0;

  for (let idx = 0; idx < statements.length; idx += 1) {
    const q = statements[idx];
    try {
      const [result, fields] = await p.query({ sql: q, timeout: 60_000 });
      if (Array.isArray(result)) {
        const list = result;
        lastResultset = {
          kind: 'resultset',
          rows: list.length > capped ? list.slice(0, capped) : list,
          truncated: list.length > capped,
          columns: fields?.map((f) => f.name) || Object.keys(list[0] || {}),
          statementIndex: idx + 1,
        };
      } else {
        affectedRows += Number(result?.affectedRows ?? 0);
        if (result?.insertId != null) insertId = Number(result.insertId);
        okCount += 1;
      }
    } catch (err) {
      const preview = q.length > 120 ? `${q.slice(0, 120)}…` : q;
      throw new Error(`Anweisung ${idx + 1}/${statements.length}: ${err.message}\n→ ${preview}`);
    }
  }

  if (statements.length === 1 && lastResultset) return lastResultset;
  if (lastResultset && okCount === 0 && statements.length === 1) return lastResultset;

  return {
    kind: 'ok',
    affectedRows,
    insertId,
    statements: statements.length,
    executed: okCount + (lastResultset ? 1 : 0),
    message: statements.length > 1
      ? `${statements.length} Anweisungen ausgeführt.`
      : undefined,
    resultset: lastResultset || undefined,
  };
}
