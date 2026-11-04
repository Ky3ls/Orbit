import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../db.js';
import { MC_ROOT, deleteMcInstanceRow, ensureMcTables, getMcInstance, listMcInstances, updateMcInstance } from './mcDb.js';
import { createInstance, getJob, isPortAvailable, suggestPort } from './mcInstall.js';
import { ensureJava, listJavas } from './mcJava.js';
import { checkUpdates, enrichMeta, installMod, listMods, modKind, removeMod, saveUpload, searchMods, toggleMod, updateMod } from './mcMods.js';
import { listConfigs, readConfig, writeConfigRaw, writeConfigValues } from './mcConfig.js';
import { listDir, makeDir, readText, removePath, renamePath, streamFile, uploadFile, writeText } from './mcFiles.js';
import { assetsReady, defaultSkin, ensureAssets, itemCatalog, skinFor, texturePath } from './mcAssets.js';
import { analyzeServer, getImportJob, importServer, scanServers } from './mcImport.js';
import { editInventory, listPlayers, playerAction, playerDetail } from './mcPlayers.js';
import { checkHost, externalCheck, publicHost, setPublicHost } from './mcNet.js';
import { chownForRun, initMinecraft, isRunning, mcStatus, readConsole, restartMc, runningRamMb, sendMc, startMc, stopMc } from './mcProcess.js';
import { PROPERTY_SCHEMA, readProperties, writeProperties } from './mcProperties.js';
import { hostMemory, suggestRam } from './mcRam.js';
import { MC_TYPES, listVersions, requiredJava } from './mcSources.js';

export { ensureMcTables, initMinecraft };

function publicInstance(inst, host = '') {
  let launch = {};
  try { launch = JSON.parse(inst.launch || '{}'); } catch { /* */ }
  return {
    id: inst.id,
    slug: inst.slug,
    name: inst.name,
    game: 'minecraft',
    type: inst.type,
    mcVersion: inst.mc_version,
    loaderVersion: inst.loader_version,
    path: inst.path,
    port: inst.port,
    host,
    address: host ? `${host}:${inst.port}` : null,
    ramMb: inst.ram_mb,
    javaMajor: inst.java_major,
    javaPath: inst.java_path,
    launchMode: launch.mode || null,
    autostart: !!inst.autostart,
    autoRestart: !!inst.auto_restart,
    state: inst.state,
    created: inst.created,
    modKind: modKind(inst)?.noun || null,
    status: mcStatus(inst),
  };
}

/**
 * Minecraft-API. Gibt true zurück, wenn die Route behandelt wurde.
 */
export async function handleMinecraftApi({ req, res, url, method, pathname, me, db, ip, json, hasPerm, readBody, logLine }) {
  if (!pathname.startsWith('/api/mc/')) return false;
  const canView = hasPerm(me, 'overview') || hasPerm(me, 'console') || hasPerm(me, 'control');
  const canControl = hasPerm(me, 'control');
  const canManage = canControl && (me.role === 'owner' || me.role === 'admin');
  const canConsole = hasPerm(me, 'console.write') || canControl;
  const deny = () => json(res, 403, { error: 'Keine Berechtigung.' });
  const fail = (e, code = 400) => {
    if (res.headersSent) { try { res.end(); } catch { /* */ } return; }
    json(res, code, { error: e.message || String(e) });
  };
  if (!canView) { deny(); return true; }

  try {
    /* ── Katalog ── */
    if (method === 'GET' && pathname === '/api/mc/types') {
      json(res, 200, { types: MC_TYPES });
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/versions') {
      const type = String(url.searchParams.get('type') || '');
      const versions = await listVersions(type);
      json(res, 200, { type, versions });
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/java') {
      const mc = String(url.searchParams.get('mc') || '');
      const required = mc ? await requiredJava(mc) : null;
      json(res, 200, { required, installed: listJavas().map((j) => ({ major: j.major, home: j.home, managed: j.managed })) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/ram-suggest') {
      const q = url.searchParams;
      const id = q.get('id');
      const inst = id ? getMcInstance(db, id) : null;
      const mods = q.get('mods') != null ? Number(q.get('mods')) : (inst ? listMods(inst).items.filter((m) => m.enabled).length : 0);
      const props = inst ? readProperties(inst.path) : {};
      const s = suggestRam({
        type: q.get('type') || inst?.type || 'paper',
        mods,
        players: Number(q.get('players') || props['max-players'] || 20),
        viewDistance: Number(q.get('viewDistance') || props['view-distance'] || 10),
        reservedMb: runningRamMb(db, id),
        currentMb: inst && isRunning(inst.id) ? inst.ram_mb : 0,
      });
      json(res, 200, { ...s, mods });
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/port-suggest') {
      json(res, 200, { port: await suggestPort(db) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/port-check') {
      json(res, 200, await isPortAvailable(db, Number(url.searchParams.get('port')), url.searchParams.get('id')));
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/host') {
      json(res, 200, { ...hostMemory(), reservedMb: runningRamMb(db) });
      return true;
    }

    /* ── Öffentliche Adresse ── */
    if (pathname === '/api/mc/address') {
      if (method === 'PUT') {
        if (!canManage) return deny() || true;
        const body = await readBody(req);
        const host = setPublicHost(db, body.host);
        audit(db, me.username, 'mc.address', host, ip);
        json(res, 200, { host, check: host ? await checkHost(host) : null });
        return true;
      }
      const host = publicHost(db);
      json(res, 200, { host, check: host ? await checkHost(host) : null });
      return true;
    }
    if (method === 'GET' && pathname === '/api/mc/address/check') {
      json(res, 200, await checkHost(String(url.searchParams.get('host') || '').trim().toLowerCase()));
      return true;
    }

    /* ── Instanzen ── */
    if (method === 'GET' && pathname === '/api/mc/instances') {
      json(res, 200, { instances: listMcInstances(db).map((i) => publicInstance(i, publicHost(db))), host: { ...hostMemory(), reservedMb: runningRamMb(db) } });
      return true;
    }
    if (method === 'POST' && pathname === '/api/mc/instances') {
      if (!canManage) return deny() || true;
      const body = await readBody(req);
      const out = await createInstance(db, {
        name: body.name,
        type: body.type,
        mcVersion: String(body.mcVersion || ''),
        loaderVersion: body.loaderVersion ? String(body.loaderVersion) : undefined,
        port: Number(body.port),
        ramMb: Number(body.ramMb),
        eula: body.eula === true,
        autostart: !!body.autostart,
        startAfter: !!body.startAfter,
        properties: body.properties && typeof body.properties === 'object' ? body.properties : undefined,
      }, logLine);
      audit(db, me.username, 'mc.create', `${out.instance.name} (${body.type} ${body.mcVersion})`, ip);
      json(res, 200, { instance: publicInstance(out.instance, publicHost(db)), jobId: out.jobId });
      return true;
    }
    const jm = pathname.match(/^\/api\/mc\/jobs\/(\d+)$/);
    if (method === 'GET' && jm) {
      const job = getJob(jm[1]);
      if (!job) return json(res, 404, { error: 'Job nicht gefunden.' }) || true;
      const after = Number(url.searchParams.get('after') || 0);
      json(res, 200, { ...job, log: job.log.filter((l) => l.t > after) });
      return true;
    }

    /* ── Import bestehender Server ── */
    if (pathname.startsWith('/api/mc/import')) {
      if (!canManage) return deny() || true;
      if (method === 'GET' && pathname === '/api/mc/import/scan') {
        json(res, 200, { servers: scanServers(db) });
        return true;
      }
      if (method === 'GET' && pathname === '/api/mc/import/analyze') {
        json(res, 200, { server: await analyzeServer(db, url.searchParams.get('path') || '') });
        return true;
      }
      const ij = pathname.match(/^\/api\/mc\/import\/jobs\/(\d+)$/);
      if (method === 'GET' && ij) {
        const job = getImportJob(ij[1]);
        if (!job) { json(res, 404, { error: 'Job nicht gefunden.' }); return true; }
        const after = Number(url.searchParams.get('after') || 0);
        json(res, 200, { ...job, log: job.log.filter((l) => l.t > after) });
        return true;
      }
      if (method === 'POST' && pathname === '/api/mc/import') {
        const body = await readBody(req);
        const out = await importServer(db, body, logLine);
        audit(db, me.username, 'mc.import', `${out.instance.name} ← ${body.path} (${body.mode || 'copy'})`, ip);
        json(res, 200, { instance: publicInstance(out.instance, publicHost(db)), jobId: out.jobId });
        return true;
      }
      return false;
    }

    /* ── Assets: Item-Katalog, Texturen, Skins ── */
    const am = pathname.match(/^\/api\/mc\/assets\/([\w.-]+)\/(catalog|tex)$/);
    if (am && method === 'GET') {
      const ver = am[1];
      if (am[2] === 'catalog') {
        if (!assetsReady(ver)) {
          try { ensureAssets(ver); } catch (e) { return json(res, 200, { pending: false, error: e.message }) || true; }
          json(res, 200, { pending: true });
          return true;
        }
        json(res, 200, itemCatalog(ver));
        return true;
      }
      const file = texturePath(ver, url.searchParams.get('p'));
      if (!file) { json(res, 404, { error: 'Textur nicht gefunden.' }); return true; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800' });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    const sm = pathname.match(/^\/api\/mc\/skin\/([0-9a-fA-F-]{32,36})$/);
    if (sm && method === 'GET') {
      const skin = await skinFor(sm[1]);
      const ver = String(url.searchParams.get('v') || '').replace(/[^\w.-]/g, '');
      const file = skin?.file || (ver && assetsReady(ver) ? defaultSkin(ver, skin?.slim) : null);
      if (!file || !fs.existsSync(file)) { json(res, 404, { error: 'Kein Skin.' }); return true; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=21600', 'X-Skin-Model': skin?.slim ? 'slim' : 'wide' });
      fs.createReadStream(file).pipe(res);
      return true;
    }

    const im = pathname.match(/^\/api\/mc\/instances\/(\d+)(\/.*)?$/);
    if (!im) return false;
    const inst = getMcInstance(db, im[1]);
    if (!inst) { json(res, 404, { error: 'Instanz nicht gefunden.' }); return true; }
    const sub = im[2] || '';

    if (method === 'GET' && sub === '') {
      json(res, 200, { instance: publicInstance(inst, publicHost(db)) });
      return true;
    }
    if (method === 'PATCH' && sub === '') {
      if (!canManage) return deny() || true;
      const body = await readBody(req);
      const patch = {};
      if (body.name !== undefined) {
        const n = String(body.name).trim().slice(0, 40);
        if (n.length < 2) throw new Error('Name zu kurz.');
        patch.name = n;
      }
      if (body.ramMb !== undefined) patch.ram_mb = Math.max(1024, Math.min(65536, Math.round(Number(body.ramMb) / 256) * 256));
      if (body.autostart !== undefined) patch.autostart = body.autostart ? 1 : 0;
      if (body.autoRestart !== undefined) patch.auto_restart = body.autoRestart ? 1 : 0;
      if (body.port !== undefined && Number(body.port) !== inst.port) {
        if (isRunning(inst.id)) throw new Error('Port nur bei gestopptem Server änderbar.');
        const chk = await isPortAvailable(db, Number(body.port), inst.id);
        if (!chk.ok) throw new Error(chk.reason);
        patch.port = Number(body.port);
        writeProperties(inst.path, { 'server-port': patch.port, 'query.port': patch.port });
      }
      if (body.javaMajor !== undefined) {
        const j = await ensureJava(Number(body.javaMajor), logLine);
        patch.java_major = j.major;
        patch.java_path = j.bin;
      }
      const next = updateMcInstance(db, inst.id, patch);
      audit(db, me.username, 'mc.update', `${inst.name}: ${Object.keys(patch).join(', ')}`, ip);
      json(res, 200, { instance: publicInstance(next, publicHost(db)) });
      return true;
    }
    if (method === 'DELETE' && sub === '') {
      if (me.role !== 'owner') return deny() || true;
      if (isRunning(inst.id)) throw new Error('Server zuerst stoppen.');
      const body = await readBody(req).catch(() => ({}));
      const target = path.resolve(inst.path);
      if (body.deleteFiles && target.startsWith(path.resolve(MC_ROOT) + path.sep)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
      deleteMcInstanceRow(db, inst.id);
      audit(db, me.username, 'mc.delete', `${inst.name}${body.deleteFiles ? ' (inkl. Dateien)' : ''}`, ip);
      json(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && sub === '/control') {
      if (!canControl) return deny() || true;
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'start') await startMc(db, inst.id, logLine);
      else if (action === 'stop') await stopMc(db, inst.id, { log: logLine });
      else if (action === 'kill') await stopMc(db, inst.id, { kill: true, log: logLine });
      else if (action === 'restart') await restartMc(db, inst.id, logLine);
      else throw new Error('Aktion muss start, stop, restart oder kill sein.');
      audit(db, me.username, `mc.${action}`, inst.name, ip);
      json(res, 200, { ok: true, status: mcStatus(getMcInstance(db, inst.id)) });
      return true;
    }
    if (method === 'GET' && sub === '/console') {
      json(res, 200, readConsole(inst, url.searchParams.get('offset')));
      return true;
    }
    if (method === 'POST' && sub === '/command') {
      if (!canConsole) return deny() || true;
      const body = await readBody(req);
      const cmd = String(body.command || '').slice(0, 300);
      sendMc(inst, cmd);
      audit(db, me.username, 'mc.command', `${inst.name}: ${cmd.slice(0, 120)}`, ip);
      json(res, 200, { ok: true });
      return true;
    }
    if (sub === '/properties') {
      if (method === 'GET') {
        json(res, 200, { values: readProperties(inst.path), schema: PROPERTY_SCHEMA });
        return true;
      }
      if (method === 'PUT') {
        if (!canManage) return deny() || true;
        const body = await readBody(req);
        const patch = {};
        for (const [k, v] of Object.entries(body.values || {})) {
          if (!/^[a-z0-9.\-]+$/i.test(k) || k === 'server-port' || k === 'query.port') continue;
          patch[k] = v;
        }
        const values = writeProperties(inst.path, patch);
        audit(db, me.username, 'mc.properties', `${inst.name}: ${Object.keys(patch).join(', ')}`, ip);
        json(res, 200, { values, restartNeeded: isRunning(inst.id) });
        return true;
      }
    }
    if (method === 'GET' && sub === '/reach') {
      const host = publicHost(db);
      if (!host) throw new Error('Keine öffentliche Adresse eingestellt.');
      json(res, 200, { host, port: inst.port, dns: await checkHost(host), external: await externalCheck(host, inst.port) });
      return true;
    }

    /* ── Configs (Paper/Spigot/Bukkit/Purpur) ── */
    if (method === 'GET' && sub === '/configs') {
      json(res, 200, { configs: listConfigs(inst) });
      return true;
    }
    const cm = sub.match(/^\/configs\/([a-z-]+)$/);
    if (cm) {
      if (method === 'GET') {
        json(res, 200, readConfig(inst, cm[1]));
        return true;
      }
      if (method === 'PUT') {
        if (!canManage) return deny() || true;
        const body = await readBody(req, 4 * 1048576);
        const file = body.raw !== undefined ? writeConfigRaw(inst, cm[1], body.raw) : writeConfigValues(inst, cm[1], body.values);
        chownForRun(file);
        audit(db, me.username, 'mc.config', `${inst.name}: ${cm[1]}`, ip);
        json(res, 200, { ...readConfig(inst, cm[1]), restartNeeded: isRunning(inst.id) });
        return true;
      }
    }

    /* ── Dateimanager ── */
    if (sub === '/files') {
      const rel = url.searchParams.get('path') || '';
      if (method === 'GET') {
        json(res, 200, url.searchParams.get('read') ? readText(inst, rel) : listDir(inst, rel));
        return true;
      }
      if (!canManage) return deny() || true;
      if (method === 'PUT') {
        const body = await readBody(req, 3 * 1048576);
        chownForRun(writeText(inst, body.path, body.content));
        audit(db, me.username, 'mc.file.write', `${inst.name}: ${body.path}`, ip);
        json(res, 200, { ok: true, restartNeeded: isRunning(inst.id) });
        return true;
      }
      if (method === 'DELETE') {
        removePath(inst, rel);
        audit(db, me.username, 'mc.file.delete', `${inst.name}: ${rel}`, ip);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (sub === '/files/mkdir' && method === 'POST') {
      if (!canManage) return deny() || true;
      const body = await readBody(req);
      chownForRun(makeDir(inst, body.path));
      json(res, 200, { ok: true });
      return true;
    }
    if (sub === '/files/rename' && method === 'POST') {
      if (!canManage) return deny() || true;
      const body = await readBody(req);
      chownForRun(renamePath(inst, body.from, body.to), true);
      audit(db, me.username, 'mc.file.rename', `${inst.name}: ${body.from} → ${body.to}`, ip);
      json(res, 200, { ok: true });
      return true;
    }
    if (sub === '/files/upload' && method === 'POST') {
      if (!canManage) return deny() || true;
      const up = await uploadFile(inst, url.searchParams.get('path') || '', url.searchParams.get('name'), req);
      chownForRun(up.abs);
      audit(db, me.username, 'mc.file.upload', `${inst.name}: ${up.rel}`, ip);
      json(res, 200, { ok: true, path: up.rel });
      return true;
    }
    if (sub === '/files/download' && method === 'GET') {
      streamFile(inst, url.searchParams.get('path') || '', res);
      return true;
    }

    /* ── Spieler ── */
    if (sub === '/players' && method === 'GET') {
      json(res, 200, await listPlayers(inst));
      return true;
    }
    if (sub === '/players/action' && method === 'POST') {
      if (!canControl) return deny() || true;
      const body = await readBody(req);
      const out = await playerAction(inst, body, me.username);
      const who = body.name || body.ip || '';
      audit(db, me.username, `mc.player.${String(body.action).slice(0, 24)}`, `${inst.name}: ${who}${body.reason ? ` (${String(body.reason).slice(0, 80)})` : ''}`, ip);
      json(res, 200, { ok: true, viaFile: !!out?.file, output: out?.out || null });
      return true;
    }
    const pm = sub.match(/^\/players\/([0-9a-fA-F-]{36})(\/inventory)?$/);
    if (pm && method === 'GET' && !pm[2]) {
      json(res, 200, { player: await playerDetail(inst, pm[1]) });
      return true;
    }
    if (pm && pm[2] && method === 'POST') {
      if (!canControl) return deny() || true;
      const body = await readBody(req);
      const out = await editInventory(inst, pm[1], body);
      audit(db, me.username, 'mc.player.inventory', `${inst.name}: ${pm[1].slice(0, 8)} ${body.op} ${body.slot || ''} ${body.id || ''}`.trim(), ip);
      json(res, 200, { ok: true, viaFile: !!out?.file });
      return true;
    }

    if (sub === '/mods' && method === 'GET') {
      await enrichMeta(inst);
      json(res, 200, listMods(inst));
      return true;
    }
    if (sub === '/mods/search' && method === 'GET') {
      json(res, 200, await searchMods(inst, url.searchParams.get('q') || '', url.searchParams.get('offset')));
      return true;
    }
    if (sub === '/mods/updates' && method === 'GET') {
      json(res, 200, { updates: await checkUpdates(inst) });
      return true;
    }
    if (sub.startsWith('/mods') && method !== 'GET' && !canManage) return deny() || true;
    if (sub === '/mods/install' && method === 'POST') {
      const body = await readBody(req);
      const added = await installMod(inst, String(body.projectId || ''), logLine);
      audit(db, me.username, 'mc.mod.install', `${inst.name}: ${added.join(', ')}`, ip);
      json(res, 200, { ok: true, added, restartNeeded: isRunning(inst.id) });
      return true;
    }
    if (sub === '/mods/update' && method === 'POST') {
      const body = await readBody(req);
      const added = await updateMod(inst, String(body.file || ''), String(body.projectId || ''), logLine);
      audit(db, me.username, 'mc.mod.update', `${inst.name}: ${added.join(', ')}`, ip);
      json(res, 200, { ok: true, added, restartNeeded: isRunning(inst.id) });
      return true;
    }
    if (sub === '/mods/toggle' && method === 'POST') {
      const body = await readBody(req);
      toggleMod(inst, body.file, !!body.enabled);
      json(res, 200, { ok: true, restartNeeded: isRunning(inst.id) });
      return true;
    }
    if (sub === '/mods/upload' && method === 'POST') {
      const name = await saveUpload(inst, req, url.searchParams.get('name'));
      audit(db, me.username, 'mc.mod.upload', `${inst.name}: ${name}`, ip);
      json(res, 200, { ok: true, file: name, restartNeeded: isRunning(inst.id) });
      return true;
    }
    if (sub === '/mods' && method === 'DELETE') {
      const file = url.searchParams.get('file');
      removeMod(inst, file);
      audit(db, me.username, 'mc.mod.remove', `${inst.name}: ${file}`, ip);
      json(res, 200, { ok: true, restartNeeded: isRunning(inst.id) });
      return true;
    }
    return false;
  } catch (err) {
    fail(err);
    return true;
  }
}
