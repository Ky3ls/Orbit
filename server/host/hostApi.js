import os from 'node:os';
import fs from 'node:fs';
import { PORT } from '../config.js';
import { audit, setSetting, settingMap } from '../db.js';
import nodePath from 'node:path';
import { getMcInstance, listMcInstances } from '../minecraft/mcDb.js';
import { killTarget, startStats, statsSnapshot } from './stats.js';
import { getJob, listJobs } from './exec.js';
import {
  ENGINES, connectionInfo, createDatabase, dropDatabase, dumpDatabase, engineOverview, ensureDbTables,
  installEngine, listEngines, resetPassword, setExternal, setRemote, updateMeta,
} from './databases.js';
import { KNOWN, controlService, listServices, serviceLog } from './services.js';
import * as studio from './dbStudio.js';
import { hasPermission } from '../permissions.js';
import {
  SITE_TYPES, WEBSERVERS, activeWebserver, checkDns, deleteSite, dnsGuide, ensureWebTables, getSite,
  installWebserver, listCertificates, listForeignSites, listSites, publicIp, saveSite, setSiteEnabled, siteConfig,
} from './web.js';

/** Live-Statistik starten — Zuordnung der Prozesse zu Servern über deren Ordner */
export function initHostStats(db) {
  startStats(() => {
    let st = {};
    try { st = settingMap(db); } catch { /* */ }
    let mc = [];
    try { mc = listMcInstances(db).map((i) => ({ id: i.id, name: i.name, path: nodePath.resolve(i.path) })); } catch { /* */ }
    return { mc, fx: { name: st.serverLabel || st.hostname || 'FiveM', cwd: st.fxDataPath ? nodePath.resolve(st.fxDataPath) : null } };
  });
}

export function ensureHostTables(db) {
  ensureDbTables(db);
  ensureWebTables(db);
}

function publicJob(j) {
  if (!j) return null;
  const { promise, ...rest } = j;
  return rest;
}

/** Spiel-Port zu einem Server-Schlüssel (für SRV-Records) */
function gameInfo(db, key) {
  const [game, id] = String(key || '').split(':');
  if (game === 'minecraft') {
    const inst = getMcInstance(db, id);
    return inst ? { game, port: inst.port, name: inst.name } : { game };
  }
  if (game === 'fivem') {
    let row = null;
    try { row = db.prepare('SELECT name, port FROM orbit_servers WHERE is_active = 1').get(); } catch { /* */ }
    return { game, port: row?.port || 30120, name: row?.name || 'FiveM' };
  }
  return {};
}

/** Domain, über die ein Gameserver erreichbar ist (für die Anzeige der Adresse) */
export function gameDomain(db, key) {
  try {
    const r = db.prepare("SELECT domain FROM host_sites WHERE type = 'game' AND target = ? AND enabled = 1 ORDER BY id LIMIT 1").get(key);
    return r?.domain || null;
  } catch { return null; }
}

function hostFacts() {
  let disk = null;
  try { const s = fs.statfsSync('/'); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* */ }
  let osName = os.type();
  try { osName = (fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1] || osName; } catch { /* */ }
  return { hostname: os.hostname(), os: osName, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || '', memTotal: os.totalmem(), memFree: os.freemem(), load: os.loadavg(), uptime: os.uptime(), disk, node: process.version };
}

export async function handleHostApi({ req, res, url, method, pathname, me, db, ip, json, readBody }) {
  if (!pathname.startsWith('/api/host/')) return false;
  const can = (perm) => hasPermission(me, perm);
  const deny = () => { json(res, 403, { error: 'Dafür fehlt dir die Berechtigung.' }); return true; };
  const p = pathname.slice('/api/host'.length);
  // Live-Statistik gehört zur Übersicht, alles andere braucht host.view
  if (!(p === '/stats' && can('overview')) && !can('host.view')) return deny();

  try {
    if (method === 'GET' && p === '/overview') {
      const [services, engines, ws, addr] = await Promise.all([listServices(), listEngines(), activeWebserver(), publicIp()]);
      json(res, 200, {
        host: hostFacts(), ip: addr, services, engines, webserver: ws,
        sites: listSites(db).length, jobs: listJobs(),
      });
      return true;
    }
    if (method === 'GET' && p === '/stats') {
      json(res, 200, statsSnapshot(Number(url.searchParams.get('since')) || 0));
      return true;
    }
    if (method === 'POST' && p === '/processes/kill') {
      if (!can('host.services')) return deny();
      const body = await readBody(req);
      const r = await killTarget({ key: body.key ? String(body.key) : null, pid: body.pid ? Number(body.pid) : null, comm: body.comm ? String(body.comm) : null, force: !!body.force });
      audit(db, me.username, r.signal === 'SIGKILL' ? 'host.process.kill' : 'host.process.term', `${body.name || body.key || body.comm || ''} (PID ${r.pids.join(', ')})`.slice(0, 200), ip);
      json(res, 200, r);
      return true;
    }
    if (method === 'GET' && p === '/setup') {
      const st = settingMap(db);
      const has = (t) => { try { return !!db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get(); } catch { return false; } };
      const done = st.orbitSetupDone === '1' || (st.orbitSetupDone !== '0' && (has('orbit_servers') || has('mc_instances') || has('host_sites')));
      const [services, engines, ws, addr] = await Promise.all([listServices(), listEngines(), activeWebserver(), publicIp()]);
      json(res, 200, { done, host: hostFacts(), ip: addr, services, engines, webserver: ws, webservers: WEBSERVERS, panelPort: PORT, email: st.acmeEmail || '', certificates: (await listCertificates()).map(({ key, ...c }) => c) });
      return true;
    }
    if (method === 'POST' && p === '/setup/done') {
      if (!(can('host.install') || can('settings.write'))) return deny();
      setSetting(db, 'orbitSetupDone', '1');
      audit(db, me.username, 'host.setup.done', '', ip);
      json(res, 200, { ok: true });
      return true;
    }
    if (method === 'GET' && p === '/services') {
      json(res, 200, { services: await listServices() });
      return true;
    }
    const sm = p.match(/^\/services\/([a-z]+)\/(start|stop|restart|reload|enable|disable|log)$/);
    if (sm) {
      if (!KNOWN.some((k) => k.id === sm[1])) throw new Error('Unbekannter Dienst.');
      if (sm[2] === 'log' && method === 'GET') {
        json(res, 200, { lines: await serviceLog(sm[1], Number(url.searchParams.get('n')) || 150) });
        return true;
      }
      if (method !== 'POST') return false;
      if (!can('host.services')) return deny();
      const st = await controlService(sm[1], sm[2]);
      audit(db, me.username, `host.service.${sm[2]}`, sm[1], ip);
      json(res, 200, { service: st });
      return true;
    }
    const jm = p.match(/^\/jobs\/(\d+)$/);
    if (jm && method === 'GET') {
      const j = getJob(jm[1]);
      if (!j) throw new Error('Job nicht gefunden.');
      json(res, 200, { job: j });
      return true;
    }

    /* ── Datenbanken ── */
    if (method === 'GET' && p === '/db') {
      json(res, 200, { engines: await listEngines() });
      return true;
    }
    const dm = p.match(/^\/db\/(mysql|postgresql|redis)(?:\/([^/]+))?(?:\/(password|remote|dump|meta))?$/);
    if (dm) {
      const [, engine, rawName, action] = dm;
      const name = rawName ? decodeURIComponent(rawName) : null;
      if (method === 'GET' && !name) {
        json(res, 200, await engineOverview(db, engine));
        return true;
      }
      if (method === 'GET' && action === 'dump') {
        if (!can('host.db')) return deny();
        audit(db, me.username, 'host.db.dump', `${engine}/${name}`, ip);
        await dumpDatabase(db, engine, name, res);
        return true;
      }
      if (!can('host.db')) return deny();
      if (method === 'POST' && name === 'install') {
        if (!can('host.install')) return deny();
        const body = await readBody(req);
        const job = installEngine(engine, body.variant);
        audit(db, me.username, 'host.db.install', `${engine} ${body.variant || ''}`.trim(), ip);
        json(res, 200, { job: publicJob(job) });
        return true;
      }
      if (method === 'PUT' && name === 'external' && engine === 'mysql') {
        const body = await readBody(req);
        const out = await setExternal(!!body.on);
        audit(db, me.username, 'host.db.external', body.on ? 'an' : 'aus', ip);
        json(res, 200, out);
        return true;
      }
      if (method === 'POST' && !name) {
        const body = await readBody(req);
        const out = await createDatabase(db, engine, body);
        audit(db, me.username, 'host.db.create', `${engine}/${out.name} (${out.user})`, ip);
        json(res, 200, out);
        return true;
      }
      if (method === 'DELETE' && name && !action) {
        await dropDatabase(db, engine, name, { dropUser: url.searchParams.get('keepUser') !== '1' });
        audit(db, me.username, 'host.db.drop', `${engine}/${name}`, ip);
        json(res, 200, { ok: true });
        return true;
      }
      if (method === 'POST' && action === 'password') {
        const body = await readBody(req);
        const out = await resetPassword(db, engine, name, body);
        audit(db, me.username, 'host.db.password', `${engine}/${name}`, ip);
        json(res, 200, out);
        return true;
      }
      if (method === 'POST' && action === 'remote' && engine === 'mysql') {
        const body = await readBody(req);
        let out = await setRemote(db, name, !!body.on);
        if (body.on) out = { ...out, ...(await resetPassword(db, engine, name, {})) };
        audit(db, me.username, 'host.db.remote', `${name}: ${body.on ? 'an' : 'aus'}`, ip);
        json(res, 200, out);
        return true;
      }
      if (method === 'PATCH' && action === 'meta') {
        updateMeta(db, engine, name, await readBody(req));
        json(res, 200, { ok: true });
        return true;
      }
      if (method === 'GET' && action === 'connection') {
        json(res, 200, { connection: connectionInfo(engine, { name }) });
        return true;
      }
    }

    /* ── Datenbank-Studio (MySQL/MariaDB) ── */
    if (p.startsWith('/studio/')) {
      if (!can('host.db')) return deny();
      if (method === 'GET' && p === '/studio/server') {
        json(res, 200, await studio.serverInfo());
        return true;
      }
      if (method === 'POST' && p === '/studio/server/kill') {
        if (!can('host.db.studio')) return deny();
        const body = await readBody(req);
        await studio.killProcess(body.id);
        audit(db, me.username, 'host.db.kill', String(body.id), ip);
        json(res, 200, { ok: true });
        return true;
      }
      const sm2 = p.match(/^\/studio\/([^/]+)(?:\/(relations|search|users|sql|explain|export|import|tables))?$/);
      const tm = p.match(/^\/studio\/([^/]+)\/t\/([^/]+)\/(rows|structure|alter)$/);
      const dbName = decodeURIComponent((sm2 || tm || [])[1] || '');
      if (!dbName) return false;
      studio.ident(dbName, 'Datenbank');
      const managed = !!db.prepare("SELECT 1 FROM host_databases WHERE engine = 'mysql' AND name = ?").get(dbName);
      const unlocked = req.headers['x-orbit-unlock'] === '1' || url.searchParams.get('unlock') === '1';
      const write = (what) => {
        if (!can('host.db.studio')) throw Object.assign(new Error('Dafür fehlt dir die Berechtigung (Datenbank-Studio bearbeiten).'), { status: 403 });
        studio.assertWritable(dbName, { managed, unlocked });
        audit(db, me.username, `host.db.${what}`, dbName, ip);
      };
      if (sm2) {
        const action = sm2[2] || '';
        if (method === 'GET' && !action) { json(res, 200, { ...(await studio.dbOverview(dbName)), managed }); return true; }
        if (method === 'GET' && action === 'relations') { json(res, 200, await studio.relations(dbName)); return true; }
        if (method === 'GET' && action === 'search') { json(res, 200, await studio.searchAll(dbName, url.searchParams.get('q'))); return true; }
        if (method === 'GET' && action === 'users') { json(res, 200, { users: await studio.dbUsers(dbName) }); return true; }
        if (method === 'GET' && action === 'export') {
          audit(db, me.username, 'host.db.export', `${dbName}${url.searchParams.get('table') ? `.${url.searchParams.get('table')}` : ''}`, ip);
          await studio.exportData(dbName, res, { table: url.searchParams.get('table'), format: url.searchParams.get('format') || 'sql', query: url.searchParams.get('query') });
          return true;
        }
        if (method === 'POST' && action === 'sql') {
          const body = await readBody(req);
          if (studio.isWriteSql(body.sql)) write('sql');
          const out = await studio.runSql(dbName, body.sql);
          json(res, 200, out);
          return true;
        }
        if (method === 'POST' && action === 'explain') {
          const body = await readBody(req);
          json(res, 200, { rows: await studio.explain(dbName, body.sql) });
          return true;
        }
        if (method === 'POST' && action === 'import') {
          write('import');
          const out = await studio.importSql(dbName, req, { gz: url.searchParams.get('gz') === '1' });
          json(res, 200, { ok: true, ...out });
          return true;
        }
        if (method === 'POST' && action === 'tables') {
          const body = await readBody(req);
          write('create-table');
          json(res, 200, await studio.createTable(dbName, body));
          return true;
        }
      }
      if (tm) {
        const table = decodeURIComponent(tm[2]);
        studio.ident(table, 'Tabelle');
        if (tm[3] === 'structure' && method === 'GET') { json(res, 200, await studio.tableStructure(dbName, table)); return true; }
        if (tm[3] === 'rows' && method === 'GET') {
          let filters = [];
          try { filters = JSON.parse(url.searchParams.get('filters') || '[]'); } catch { /* */ }
          json(res, 200, await studio.browse(dbName, table, {
            offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit'), sort: url.searchParams.get('sort'),
            dir: url.searchParams.get('dir'), filters, q: url.searchParams.get('q') || '',
          }));
          return true;
        }
        if (tm[3] === 'rows') {
          const body = await readBody(req);
          if (method === 'POST') { write('insert'); json(res, 200, await studio.insertRow(dbName, table, body.values)); return true; }
          if (method === 'PATCH') { write('update'); json(res, 200, await studio.updateRow(dbName, table, body.key, body.changes)); return true; }
          if (method === 'DELETE') { write('delete'); json(res, 200, await studio.deleteRows(dbName, table, body.keys)); return true; }
        }
        if (tm[3] === 'alter' && method === 'POST') {
          const body = await readBody(req);
          write(`alter.${String(body.op).slice(0, 20)}`);
          json(res, 200, await studio.alterTable(dbName, table, body));
          return true;
        }
      }
      return false;
    }

    /* ── Webserver & Domains ── */
    if (method === 'GET' && p === '/web') {
      const [ws, certs, addr] = await Promise.all([activeWebserver(), listCertificates(), publicIp()]);
      const s = settingMap(db);
      json(res, 200, {
        webserver: ws, webservers: WEBSERVERS, types: SITE_TYPES, ip: addr, email: s.acmeEmail || '', panelPort: PORT,
        sites: listSites(db), foreign: listForeignSites(), certificates: certs.map(({ key, ...c }) => c),
      });
      return true;
    }
    if (method === 'GET' && p === '/web/check') {
      const d = String(url.searchParams.get('domain') || '').toLowerCase();
      json(res, 200, await checkDns(d, { srv: url.searchParams.get('srv') || null }));
      return true;
    }
    if (method === 'POST' && p === '/web/install') {
      if (!can('host.install')) return deny();
      const body = await readBody(req);
      const job = installWebserver(String(body.id || ''));
      audit(db, me.username, 'host.web.install', String(body.id), ip);
      json(res, 200, { job: publicJob(job) });
      return true;
    }
    if (method === 'POST' && p === '/web/sites') {
      if (!can('host.web')) return deny();
      const body = await readBody(req);
      if (body.email) setSetting(db, 'acmeEmail', String(body.email).trim().slice(0, 120));
      const job = saveSite(db, body, { email: String(body.email || settingMap(db).acmeEmail || '') });
      audit(db, me.username, 'host.web.add', `${body.domain} (${body.type})`, ip);
      json(res, 200, { job: publicJob(job) });
      return true;
    }
    const wm = p.match(/^\/web\/sites\/(\d+)(?:\/(enable|disable|dns|config))?$/);
    if (wm) {
      const site = getSite(db, wm[1]);
      if (!site) throw new Error('Seite nicht gefunden.');
      if (method === 'GET' && wm[2] === 'dns') {
        const gi = site.type === 'game' ? gameInfo(db, site.target) : {};
        const srv = gi.game === 'minecraft' && gi.port !== 25565 ? `_minecraft._tcp.${site.domain}` : null;
        const check = await checkDns(site.domain, { srv });
        json(res, 200, { check, guide: dnsGuide(site, { ip: check.serverIp, gamePort: gi.port, game: gi.game }), game: gi });
        return true;
      }
      if (method === 'GET' && wm[2] === 'config') {
        json(res, 200, { config: siteConfig(db, site.id) });
        return true;
      }
      if (!can('host.web')) return deny();
      if (method === 'PUT' && !wm[2]) {
        const body = await readBody(req);
        if (body.email) setSetting(db, 'acmeEmail', String(body.email).trim().slice(0, 120));
        const job = saveSite(db, body, { id: site.id, email: String(body.email || settingMap(db).acmeEmail || '') });
        audit(db, me.username, 'host.web.update', site.domain, ip);
        json(res, 200, { job: publicJob(job) });
        return true;
      }
      if (method === 'POST' && (wm[2] === 'enable' || wm[2] === 'disable')) {
        await setSiteEnabled(db, site.id, wm[2] === 'enable');
        audit(db, me.username, `host.web.${wm[2]}`, site.domain, ip);
        json(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE' && !wm[2]) {
        await deleteSite(db, site.id, { deleteFiles: url.searchParams.get('files') === '1' });
        audit(db, me.username, 'host.web.delete', site.domain, ip);
        json(res, 200, { ok: true });
        return true;
      }
    }
    return false;
  } catch (e) {
    if (!res.headersSent) json(res, e.status === 403 ? 403 : 400, { error: e.message || String(e) });
    return true;
  }
}

export { ENGINES };
