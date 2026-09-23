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

export async function browseTable(settings, tableName, offset = 0, limit = 25) {
  const table = assertTableName(tableName);
  const off = Math.max(Number(offset) || 0, 0);
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 500);
  const p = getMysqlPool(settings);
  const [[countRow]] = await p.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  const total = Number(countRow?.c ?? 0);
  const [rows, fields] = await p.query({
    sql: `SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`,
    values: [lim, off],
    timeout: 15_000,
  });
  const list = Array.isArray(rows) ? rows : [];
  const columns = fields?.map((f) => f.name) || Object.keys(list[0] || {});
  return { rows: list, columns, total, offset: off, limit: lim };
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
  const q = assertSingleStatement(sql);
  const capped = Math.min(Math.max(Number(limit) || 500, 1), 500);
  const p = getMysqlPool(settings);
  const [result, fields] = await p.query({ sql: q, timeout: 30_000 });
  if (Array.isArray(result)) {
    const list = result;
    if (list.length > capped) {
      return {
        kind: 'resultset',
        rows: list.slice(0, capped),
        truncated: true,
        columns: fields?.map((f) => f.name) || [],
      };
    }
    return {
      kind: 'resultset',
      rows: list,
      truncated: false,
      columns: fields?.map((f) => f.name) || Object.keys(list[0] || {}),
    };
  }
  return {
    kind: 'ok',
    affectedRows: Number(result?.affectedRows ?? 0),
    insertId: result?.insertId != null ? Number(result.insertId) : undefined,
    warningStatus: result?.warningStatus,
    message: result?.info ? String(result.info) : undefined,
  };
}
