import crypto from 'node:crypto';
import fs from 'node:fs';
import { aptInstall, has, run, runInput, startJob } from './exec.js';
import { serviceStatus } from './services.js';

/*
 * Datenbank-Server auf dem Host: installieren, Datenbanken + Benutzer anlegen, Passwörter, Zugriff.
 * Admin-Zugang ohne gespeicherte Passwörter: MySQL/MariaDB über den Unix-Socket (root, auth_socket),
 * PostgreSQL als Systembenutzer „postgres“, Redis über redis-cli.
 * Fremde Datenbanken (nicht von Orbit angelegt) werden angezeigt, aber nie gelöscht.
 */
export const ENGINES = {
  mysql: { id: 'mysql', label: 'MySQL / MariaDB', port: 3306, variants: [{ id: 'mariadb', label: 'MariaDB', pkg: 'mariadb-server' }, { id: 'mysql', label: 'MySQL', pkg: 'mysql-server' }], uses: 'Websites (WordPress, Laravel), FiveM (oxmysql), Minecraft-Plugins (LuckPerms, CoreProtect)' },
  postgresql: { id: 'postgresql', label: 'PostgreSQL', port: 5432, variants: [{ id: 'postgresql', label: 'PostgreSQL', pkg: 'postgresql' }], uses: 'Moderne Web-Apps, Discord-Bots, Analysen' },
  redis: { id: 'redis', label: 'Redis', port: 6379, variants: [{ id: 'redis', label: 'Redis', pkg: 'redis-server' }], uses: 'Cache, Sessions, Queues für Web-Apps und Bots' },
};

const SYS_MYSQL = new Set(['mysql', 'information_schema', 'performance_schema', 'sys']);
const SYS_MYSQL_USERS = new Set(['root', 'debian-sys-maint', 'mysql.sys', 'mysql.session', 'mysql.infoschema', 'mariadb.sys']);
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/;

export function ensureDbTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS host_databases (
    id INTEGER PRIMARY KEY,
    engine TEXT NOT NULL,
    name TEXT NOT NULL,
    user TEXT,
    remote INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    server_key TEXT,
    created INTEGER NOT NULL,
    UNIQUE(engine, name)
  )`);
}

export function genPassword(len = 24) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i += 1) s += abc[b[i] % abc.length];
  return s;
}

function checkName(n, what = 'Name') {
  const s = String(n || '').trim();
  if (!NAME_RE.test(s)) throw new Error(`${what} ungültig — Buchstaben, Zahlen und _, beginnt mit Buchstabe, max. 48 Zeichen.`);
  return s;
}
function checkPassword(p) {
  const s = String(p || '');
  if (s.length < 10) throw new Error('Passwort zu kurz (mindestens 10 Zeichen).');
  if (!/^[A-Za-z0-9!#%+,.:=?@^_~-]+$/.test(s)) throw new Error('Passwort enthält nicht erlaubte Zeichen (keine Anführungszeichen, Leerzeichen oder Backslashes).');
  return s;
}

/* ── MySQL / MariaDB ── */
async function mysqlCli() {
  return (await has('mariadb')) || (await has('mysql'));
}
async function mysqlQuery(sql) {
  const cli = await mysqlCli();
  if (!cli) throw new Error('MySQL/MariaDB-Client fehlt.');
  const r = await runInput(cli, ['--protocol=socket', '-uroot', '-N', '-B', '--default-character-set=utf8mb4'], sql, { timeout: 30000 });
  return r.stdout.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}
const mq = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const mid = (s) => `\`${String(s).replace(/`/g, '')}\``;

async function mysqlVariant() {
  if (await has('mariadbd')) return 'mariadb';
  if (await has('mysqld')) return 'mysql';
  return null;
}

async function mysqlOverview(managed) {
  const rows = await mysqlQuery(`
    SELECT s.schema_name, COALESCE(SUM(t.data_length + t.index_length), 0), COUNT(t.table_name)
    FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
    GROUP BY s.schema_name ORDER BY s.schema_name;
    SELECT '--users--', '', '';
    SELECT u.user, u.host, COALESCE(GROUP_CONCAT(DISTINCT d.db SEPARATOR ','), '') FROM mysql.user u LEFT JOIN mysql.db d ON d.user = u.user AND d.host = u.host GROUP BY u.user, u.host;`);
  const dbs = [];
  const users = [];
  let mode = 'db';
  for (const r of rows) {
    if (r[0] === '--users--') { mode = 'users'; continue; }
    if (mode === 'db') {
      if (SYS_MYSQL.has(r[0])) continue;
      dbs.push({ name: r[0], size: Number(r[1]) || 0, tables: Number(r[2]) || 0 });
    } else {
      if (SYS_MYSQL_USERS.has(r[0])) continue;
      users.push({ user: r[0], host: r[1], dbs: r[2] ? r[2].split(',').map((x) => x.replace(/\\_/g, '_')) : [] });
    }
  }
  for (const d of dbs) {
    const m = managed.find((x) => x.name === d.name);
    d.managed = !!m;
    d.meta = m || null;
    d.users = users.filter((u) => u.dbs.includes(d.name)).map((u) => `${u.user}@${u.host}`);
  }
  return { databases: dbs, users };
}

async function mysqlCreate({ name, user, password, remote }) {
  const hosts = remote ? ['localhost', '127.0.0.1', '%'] : ['localhost', '127.0.0.1'];
  const sql = [
    `CREATE DATABASE ${mid(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    ...hosts.flatMap((h) => [
      `CREATE USER IF NOT EXISTS ${mq(user)}@${mq(h)} IDENTIFIED BY ${mq(password)};`,
      `GRANT ALL PRIVILEGES ON ${mid(name)}.* TO ${mq(user)}@${mq(h)};`,
    ]),
    'FLUSH PRIVILEGES;',
  ].join('\n');
  await mysqlQuery(sql);
}

async function mysqlDrop({ name, user }) {
  const sql = [`DROP DATABASE IF EXISTS ${mid(name)};`];
  if (user) {
    const rows = await mysqlQuery(`SELECT host FROM mysql.user WHERE user = ${mq(user)};`);
    for (const [h] of rows) sql.push(`DROP USER IF EXISTS ${mq(user)}@${mq(h)};`);
  }
  await mysqlQuery(sql.join('\n'));
}

async function mysqlPassword(user, password) {
  const rows = await mysqlQuery(`SELECT host FROM mysql.user WHERE user = ${mq(user)};`);
  if (!rows.length) throw new Error('Benutzer nicht gefunden.');
  await mysqlQuery(rows.map(([h]) => `ALTER USER ${mq(user)}@${mq(h)} IDENTIFIED BY ${mq(password)};`).join('\n') + '\nFLUSH PRIVILEGES;');
}

async function mysqlRemote(user, name, on) {
  if (on) {
    const rows = await mysqlQuery(`SELECT 1 FROM mysql.user WHERE user = ${mq(user)} AND host = '%';`);
    if (!rows.length) throw new Error('Für externen Zugriff Passwort zurücksetzen (dabei wird der Zugang angelegt).');
  } else {
    await mysqlQuery(`DROP USER IF EXISTS ${mq(user)}@'%'; FLUSH PRIVILEGES;`);
  }
  return name;
}

/** Lauscht der Server nur lokal? (bind-address) */
async function mysqlBind() {
  const rows = await mysqlQuery("SELECT @@bind_address;").catch(() => [['?']]);
  return rows[0]?.[0] || '?';
}

const BIND_DROPIN = () => (fs.existsSync('/etc/mysql/mariadb.conf.d') ? '/etc/mysql/mariadb.conf.d/99-orbit-bind.cnf' : '/etc/mysql/mysql.conf.d/99-orbit-bind.cnf');

async function mysqlSetExternal(on) {
  const f = BIND_DROPIN();
  if (on) fs.writeFileSync(f, '# Von Orbit verwaltet — externer Zugriff\n[mysqld]\nbind-address = 0.0.0.0\n');
  else fs.rmSync(f, { force: true });
  const v = await mysqlVariant();
  await run('systemctl', ['restart', v === 'mariadb' ? 'mariadb' : 'mysql'], { timeout: 90000 });
}

/* ── PostgreSQL ── */
async function pg(sql, dbName = 'postgres') {
  const r = await runInput('runuser', ['-u', 'postgres', '--', 'psql', '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', dbName], sql, { timeout: 30000 });
  return r.stdout.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
}
const pq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const pid = (s) => `"${String(s).replace(/"/g, '')}"`;

async function pgOverview(managed) {
  const rows = await pg("SELECT d.datname, pg_database_size(d.datname), r.rolname FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE NOT d.datistemplate AND d.datname <> 'postgres' ORDER BY 1;");
  const roles = await pg("SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND rolname <> 'postgres' ORDER BY 1;");
  const databases = rows.map(([name, size, owner]) => {
    const m = managed.find((x) => x.name === name);
    return { name, size: Number(size) || 0, tables: null, users: [owner], managed: !!m, meta: m || null };
  });
  return { databases, users: roles.map(([u, login]) => ({ user: u, host: '', login: login === 't', dbs: databases.filter((d) => d.users.includes(u)).map((d) => d.name) })) };
}

async function pgCreate({ name, user, password }) {
  await pg(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${pq(user)}) THEN CREATE ROLE ${pid(user)} LOGIN PASSWORD ${pq(password)}; END IF; END $$;`);
  await pg(`CREATE DATABASE ${pid(name)} OWNER ${pid(user)} ENCODING 'UTF8' TEMPLATE template0;`);
}
async function pgDrop({ name, user }) {
  await pg(`DROP DATABASE IF EXISTS ${pid(name)} WITH (FORCE);`);
  if (user) await pg(`DROP ROLE IF EXISTS ${pid(user)};`).catch(() => {});
}
async function pgPassword(user, password) {
  await pg(`ALTER ROLE ${pid(user)} WITH PASSWORD ${pq(password)};`);
}

/* ── Redis ── */
async function redisCli(args, password) {
  const r = await run('redis-cli', ['--no-auth-warning', ...(password ? ['-a', password] : []), ...args], { timeout: 10000, allowFail: true });
  return r.stdout.trim();
}
function redisConfPass() {
  try {
    const m = fs.readFileSync('/etc/redis/redis.conf', 'utf8').match(/^\s*requirepass\s+(\S+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}
async function redisOverview() {
  const pw = redisConfPass();
  const info = await redisCli(['INFO'], pw);
  const get = (k) => (info.match(new RegExp(`^${k}:(.*)$`, 'm')) || [])[1]?.trim();
  const keyspace = [...info.matchAll(/^db(\d+):keys=(\d+)/gm)].map((m) => ({ name: `db${m[1]}`, keys: Number(m[2]) }));
  return {
    databases: keyspace.map((k) => ({ name: k.name, size: null, tables: null, keys: k.keys, users: [], managed: false })),
    users: [],
    redis: { version: get('redis_version'), memory: Number(get('used_memory')) || 0, peak: Number(get('used_memory_peak')) || 0, clients: Number(get('connected_clients')) || 0, uptime: Number(get('uptime_in_seconds')) || 0, auth: !!pw },
  };
}
async function redisSetPassword(password) {
  const old = redisConfPass();
  await redisCli(['CONFIG', 'SET', 'requirepass', password], old);
  const r = await redisCli(['CONFIG', 'REWRITE'], password);
  if (!/OK/.test(r)) throw new Error(`Redis: ${r || 'CONFIG REWRITE fehlgeschlagen'}`);
}

/* ── Öffentliche API ── */
export async function engineStatus(id) {
  const e = ENGINES[id];
  if (!e) throw new Error('Unbekannte Datenbank.');
  if (id === 'mysql') {
    const variant = await mysqlVariant();
    const svc = variant ? await serviceStatus(variant) : { installed: false };
    return { ...e, variant, service: svc, installed: !!variant && svc.installed };
  }
  const svc = await serviceStatus(id);
  return { ...e, variant: id, service: svc, installed: svc.installed };
}

export async function listEngines() {
  return Promise.all(Object.keys(ENGINES).map((id) => engineStatus(id).catch((err) => ({ ...ENGINES[id], installed: false, error: err.message }))));
}

export function installEngine(id, variant) {
  const e = ENGINES[id];
  if (!e) throw new Error('Unbekannte Datenbank.');
  const v = e.variants.find((x) => x.id === (variant || e.variants[0].id));
  if (!v) throw new Error('Variante ungültig.');
  return startJob('install', `${v.label} installieren`, async (log, step) => {
    const cur = await engineStatus(id);
    if (cur.installed) { log(`${cur.variant || v.label} ist bereits installiert.`, 'ok'); return { already: true }; }
    step(`${v.label} wird installiert`);
    await aptInstall([v.pkg], log);
    if (process.env.ORBIT_HOST_DRYRUN === '1') return { dryRun: true };
    step('Dienst aktivieren');
    const unit = id === 'redis' ? 'redis-server' : id === 'mysql' ? (v.id === 'mariadb' ? 'mariadb' : 'mysql') : 'postgresql';
    await run('systemctl', ['enable', '--now', unit], { timeout: 90000 });
    if (id === 'redis') {
      step('Redis absichern (Passwort setzen)');
      const pw = genPassword(32);
      await redisSetPassword(pw);
      log('Redis lauscht nur lokal und hat jetzt ein Passwort.', 'ok');
      return { password: pw };
    }
    log(`${v.label} läuft und lauscht nur lokal (127.0.0.1).`, 'ok');
    return {};
  });
}

function managedRows(db, engine) {
  return db.prepare('SELECT * FROM host_databases WHERE engine = ? ORDER BY name').all(engine);
}

export async function engineOverview(db, id) {
  const st = await engineStatus(id);
  if (!st.installed) return { engine: st, databases: [], users: [] };
  if (!st.service.active) return { engine: st, databases: [], users: [], stopped: true };
  const managed = managedRows(db, id);
  if (id === 'mysql') return { engine: st, ...(await mysqlOverview(managed)), bind: await mysqlBind(), external: fs.existsSync(BIND_DROPIN()) };
  if (id === 'postgresql') return { engine: st, ...(await pgOverview(managed)) };
  return { engine: st, ...(await redisOverview()) };
}

export function connectionInfo(engine, { name, user, password, host = '127.0.0.1', port }) {
  const p = port || ENGINES[engine].port;
  const pw = password || '<passwort>';
  if (engine === 'mysql') {
    return [
      { label: 'URL', value: `mysql://${user}:${pw}@${host}:${p}/${name}` },
      { label: 'FiveM (oxmysql)', value: `set mysql_connection_string "mysql://${user}:${pw}@${host}:${p}/${name}?charset=utf8mb4"` },
      { label: 'JDBC (Minecraft-Plugins)', value: `jdbc:mysql://${host}:${p}/${name}?useSSL=false` },
      { label: 'Laravel / .env', value: `DB_CONNECTION=mysql\nDB_HOST=${host}\nDB_PORT=${p}\nDB_DATABASE=${name}\nDB_USERNAME=${user}\nDB_PASSWORD=${pw}` },
    ];
  }
  if (engine === 'postgresql') {
    return [
      { label: 'URL', value: `postgresql://${user}:${pw}@${host}:${p}/${name}` },
      { label: 'JDBC', value: `jdbc:postgresql://${host}:${p}/${name}` },
      { label: '.env', value: `DATABASE_URL=postgresql://${user}:${pw}@${host}:${p}/${name}` },
    ];
  }
  return [{ label: 'URL', value: `redis://:${pw}@${host}:${p}` }];
}

export async function createDatabase(db, engine, body) {
  if (engine === 'redis') throw new Error('Redis hat keine benannten Datenbanken — nutze die Verbindung direkt.');
  const name = checkName(body.name, 'Datenbankname');
  const user = checkName(body.user || name, 'Benutzername');
  const password = body.password ? checkPassword(body.password) : genPassword();
  const remote = engine === 'mysql' && !!body.remote;
  if (db.prepare('SELECT 1 FROM host_databases WHERE engine = ? AND name = ?').get(engine, name)) throw new Error('Datenbank existiert bereits.');
  if (engine === 'mysql') {
    const exists = await mysqlQuery(`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${mq(name)};`);
    if (exists.length) throw new Error('Datenbank existiert bereits.');
    await mysqlCreate({ name, user, password, remote });
  } else {
    const exists = await pg(`SELECT 1 FROM pg_database WHERE datname = ${pq(name)};`);
    if (exists.length) throw new Error('Datenbank existiert bereits.');
    await pgCreate({ name, user, password });
  }
  db.prepare('INSERT INTO host_databases (engine, name, user, remote, note, server_key, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(engine, name, user, remote ? 1 : 0, String(body.note || '').slice(0, 120) || null, body.serverKey || null, Date.now());
  return { name, user, password, remote, connection: connectionInfo(engine, { name, user, password }) };
}

function managedOrThrow(db, engine, name) {
  const row = db.prepare('SELECT * FROM host_databases WHERE engine = ? AND name = ?').get(engine, name);
  if (!row) throw new Error('Diese Datenbank wurde nicht von Orbit angelegt — Orbit ändert oder löscht sie nicht.');
  return row;
}

export async function dropDatabase(db, engine, name, { dropUser = true } = {}) {
  const row = managedOrThrow(db, engine, name);
  if (engine === 'mysql') await mysqlDrop({ name, user: dropUser ? row.user : null });
  else await pgDrop({ name, user: dropUser ? row.user : null });
  db.prepare('DELETE FROM host_databases WHERE id = ?').run(row.id);
}

export async function resetPassword(db, engine, name, body = {}) {
  if (engine === 'redis') {
    const password = body.password ? checkPassword(body.password) : genPassword(32);
    await redisSetPassword(password);
    return { password, connection: connectionInfo('redis', { password }) };
  }
  const row = managedOrThrow(db, engine, name);
  const password = body.password ? checkPassword(body.password) : genPassword();
  if (engine === 'mysql') {
    await mysqlPassword(row.user, password);
    if (row.remote) {
      await mysqlQuery(`CREATE USER IF NOT EXISTS ${mq(row.user)}@'%' IDENTIFIED BY ${mq(password)}; ALTER USER ${mq(row.user)}@'%' IDENTIFIED BY ${mq(password)}; GRANT ALL PRIVILEGES ON ${mid(row.name)}.* TO ${mq(row.user)}@'%'; FLUSH PRIVILEGES;`);
    }
  } else await pgPassword(row.user, password);
  return { password, connection: connectionInfo(engine, { name: row.name, user: row.user, password }) };
}

export async function setRemote(db, name, on) {
  const row = managedOrThrow(db, 'mysql', name);
  if (!on) await mysqlRemote(row.user, name, false);
  db.prepare('UPDATE host_databases SET remote = ? WHERE id = ?').run(on ? 1 : 0, row.id);
  return { needsPassword: !!on };
}

export async function setExternal(on) {
  await mysqlSetExternal(!!on);
  return { bind: await mysqlBind() };
}

export function updateMeta(db, engine, name, body) {
  const row = managedOrThrow(db, engine, name);
  db.prepare('UPDATE host_databases SET note = ?, server_key = ? WHERE id = ?')
    .run(body.note !== undefined ? String(body.note || '').slice(0, 120) : row.note, body.serverKey !== undefined ? (body.serverKey || null) : row.server_key, row.id);
}

/** Datenbank als SQL-Datei exportieren (Stream) */
export async function dumpDatabase(db, engine, name, res) {
  if (engine === 'redis') throw new Error('Für Redis gibt es keinen SQL-Export.');
  const known = engine === 'mysql'
    ? (await mysqlQuery(`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${mq(name)};`)).length
    : (await pg(`SELECT 1 FROM pg_database WHERE datname = ${pq(name)};`)).length;
  if (!known) throw new Error('Datenbank nicht gefunden.');
  const { spawn } = await import('node:child_process');
  const cmd = engine === 'mysql'
    ? [(await has('mariadb-dump')) || 'mysqldump', ['--protocol=socket', '-uroot', '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', '--', name]]
    : ['runuser', ['-u', 'postgres', '--', 'pg_dump', '--no-owner', '-d', name]];
  const p = spawn(cmd[0], cmd[1]);
  res.writeHead(200, {
    'Content-Type': 'application/sql; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.sql"`,
    'Cache-Control': 'no-store',
  });
  p.stdout.pipe(res);
  p.stderr.on('data', () => {});
  p.on('error', () => res.end());
}
