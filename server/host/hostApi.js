import os from 'node:os';
import fs from 'node:fs';
import { PORT } from '../config.js';
import { audit, setSetting, settingMap } from '../db.js';
import { getMcInstance } from '../minecraft/mcDb.js';
import { getJob, listJobs } from './exec.js';
import {
  ENGINES, connectionInfo, createDatabase, dropDatabase, dumpDatabase, engineOverview, ensureDbTables,
  installEngine, listEngines, resetPassword, setExternal, setRemote, updateMeta,
} from './databases.js';
import { KNOWN, controlService, listServices, serviceLog } from './services.js';
import {
  SITE_TYPES, WEBSERVERS, activeWebserver, checkDns, deleteSite, dnsGuide, ensureWebTables, getSite,
  installWebserver, listCertificates, listForeignSites, listSites, publicIp, saveSite, setSiteEnabled, siteConfig,
} from './web.js';

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
  const isOwner = me.role === 'owner';
  const canView = isOwner || me.role === 'admin';
  const deny = () => { json(res, 403, { error: 'Nur der Inhaber darf den Host verwalten.' }); return true; };
  if (!canView) return deny();
  const p = pathname.slice('/api/host'.length);

  try {
    if (method === 'GET' && p === '/overview') {
      const [services, engines, ws, addr] = await Promise.all([listServices(), listEngines(), activeWebserver(), publicIp()]);
      json(res, 200, {
        host: hostFacts(), ip: addr, services, engines, webserver: ws,
        sites: listSites(db).length, jobs: listJobs(),
      });
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
      if (!isOwner) return deny();
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
      if (!isOwner) return deny();
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
        if (!isOwner) return deny();
        audit(db, me.username, 'host.db.dump', `${engine}/${name}`, ip);
        await dumpDatabase(db, engine, name, res);
        return true;
      }
      if (!isOwner) return deny();
      if (method === 'POST' && name === 'install') {
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
      if (!isOwner) return deny();
      const body = await readBody(req);
      const job = installWebserver(String(body.id || ''));
      audit(db, me.username, 'host.web.install', String(body.id), ip);
      json(res, 200, { job: publicJob(job) });
      return true;
    }
    if (method === 'POST' && p === '/web/sites') {
      if (!isOwner) return deny();
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
      if (!isOwner) return deny();
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
    if (!res.headersSent) json(res, 400, { error: e.message || String(e) });
    return true;
  }
}

export { ENGINES };
