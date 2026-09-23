import { installArtifact, installedArtifacts, listRecentBuilds, resolveInstalledArtifact } from './artifacts.js';
import { notifyServerEvent } from './discord.js';
import {
  activateOrbitServer,
  buildSettingsForServer,
  createAndActivateOrbitServer,
  ensureOrbitServersTable,
  getOrbitServerById,
  listOrbitServers,
} from './orbitServersDb.js';
import { controlFx } from './control.js';
import { listSupervisorInstances, supervisorRunning } from './fxSupervisor.js';
import { runRecipeYaml } from './recipeRunner.js';
import { parseDropFromLogLine, listDrops, ensureDropsTable } from './playerDrops.js';
import { runRecipeInstall, RECIPE_PACKS } from './recipeInstall.js';
import { settingMap, setSetting, audit } from './db.js';
import { syncResourcesFromDisk } from './resourceScan.js';
import { randomToken } from './auth.js';
import { ORIGIN, ORBIT_ARTIFACTS_ROOT, ORBIT_SERVERS_ROOT, FX_SERVER_ROOT } from './config.js';
import { applyProdSecretsToCfg, prodReadiness } from './prodConfig.js';
import { refreshInstanceMonitors } from './instanceMonitor.js';
import { parseCfgIntegrations } from './fivem.js';
import { ensureIngameToken, hotDeployOrbit, syncOrbitSystemResource } from './orbitBridgeSync.js';
import { sendSupervisorCommand, supervisorConsoleReady } from './fxSupervisor.js';
import fs from 'node:fs';
import path from 'node:path';

export function initPlatform(db) {
  ensureOrbitServersTable(db);
  ensureDropsTable(db);
}

function str(v, max) {
  return String(v ?? '').slice(0, max);
}

/**
 * @returns {boolean} handled
 */
export async function handlePlatformApi(ctx) {
  const { req, res, url, method, pathname, me, db, ip, json, hasPerm, readBody, logLine } = ctx;
  const inScope = pathname.startsWith('/api/platform/')
    || pathname.startsWith('/api/artifacts')
    || pathname.startsWith('/api/servers')
    || pathname === '/api/drops'
    || pathname.startsWith('/api/ingame');
  if (!inScope) return false;

  if (method === 'GET' && pathname === '/api/artifacts') {
    if (!hasPerm(me, 'settings')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const [list, installed] = await Promise.all([
      listRecentBuilds(15).catch((e) => ({ error: e.message, builds: [], recommended: '' })),
      Promise.resolve(installedArtifacts()),
    ]);
    const settings = settingMap(db);
    return json(res, 200, { ...list, installed, fxServerRoot: settings.fxServerRoot || '' });
  }

  if (method === 'POST' && pathname === '/api/artifacts/install') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const build = str(body.build, 16);
    try {
      const result = await installArtifact(build, (t) => logLine('info', t));
      setSetting(db, 'fxServerRoot', result.path);
      setSetting(db, 'fxArtifactBuild', result.build);
      audit(db, me.username, 'artifact.install', result.build, ip);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/artifacts/activate') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const build = str(body.build, 16);
    try {
      const result = resolveInstalledArtifact(build);
      setSetting(db, 'fxServerRoot', result.path);
      setSetting(db, 'fxArtifactBuild', result.build);
      audit(db, me.username, 'artifact.activate', result.build, ip);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/servers') {
    if (!hasPerm(me, 'settings')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const instMap = new Map(listSupervisorInstances().map((i) => [i.id, i]));
    const servers = listOrbitServers(db).map((s) => {
      const key = String(s.id);
      const inst = instMap.get(key);
      return {
        ...s,
        supervisorPhase: inst?.phase || (supervisorRunning(key) ? 'running' : 'idle'),
        pid: inst?.pid ?? null,
      };
    });
    return json(res, 200, { servers, instances: listSupervisorInstances() });
  }

  if (method === 'POST' && pathname === '/api/servers') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const name = str(body.name, 80);
    try {
      const { row, result } = createAndActivateOrbitServer(db, {
        name,
        port: Number(body.port) || 30120,
        maxClients: Number(body.maxClients) || 48,
        fxServerRoot: str(body.fxServerRoot, 256) || settingMap(db).fxServerRoot,
      });
      syncResourcesFromDisk(db);
      audit(db, me.username, 'server.create', row.slug, ip);
      return json(res, 200, { ok: true, server: row, dataPath: result.fxDataPath });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  /** One-Shot: neuer RP-Server = anlegen + Recipe + License/MySQL + optional Start */
  if (method === 'POST' && pathname === '/api/servers/provision-full') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const name = str(body.name, 80);
    const recipeId = ['blank', 'esx', 'qb'].includes(body.recipe) ? body.recipe : 'esx';
    const mysqlConnection = str(body.mysqlConnection, 256);
    const licenseKey = str(body.licenseKey, 128);
    const port = Number(body.port) || 30120;
    const maxClients = Number(body.maxClients) || 48;
    const doStart = body.start !== false;
    const steps = [];
    try {
      const settings = settingMap(db);
      if (!settings.fxServerRoot) {
        return json(res, 400, { error: 'Kein FX-Artifact — zuerst unter FX Builds installieren.' });
      }
      const { row, result } = createAndActivateOrbitServer(db, {
        name,
        port,
        maxClients,
        fxServerRoot: settings.fxServerRoot,
        onesync: body.onesync === 'off' || body.onesync === 'legacy' ? body.onesync : 'on',
      });
      steps.push(`Server angelegt: ${result.fxDataPath}`);
      ensureIngameToken(db);
      const recipeResult = await runRecipeInstall(recipeId, result.fxDataPath, (t) => {
        logLine('info', t);
        steps.push(t);
      }, {
        mysqlConnection,
        panelUrl: '',
        ingameToken: '',
      });
      steps.push(`Recipe „${recipeId}“ OK`);
      const cfgPath = path.join(result.fxDataPath, 'server.cfg');
      if (licenseKey || mysqlConnection) {
        applyProdSecretsToCfg(cfgPath, { licenseKey, mysqlConnection });
        steps.push('License/MySQL in server.cfg');
      }
      syncOrbitSystemResource(settings.fxServerRoot, result.fxDataPath, (t) => steps.push(t));
      syncResourcesFromDisk(db);
      setSetting(db, 'fxControlMode', 'orbit');
      setSetting(db, 'autoRestartEnabled', '1');
      audit(db, me.username, 'server.provision', `${row.slug}:${recipeId}`, ip);
      let started = null;
      if (doStart) {
        const srvSettings = buildSettingsForServer(db, row);
        started = await controlFx('start', srvSettings, logLine, { instanceId: String(row.id) });
        steps.push('FX gestartet');
      }
      return json(res, 200, {
        ok: true,
        server: row,
        dataPath: result.fxDataPath,
        recipe: recipeResult,
        started,
        steps,
      });
    } catch (err) {
      return json(res, 400, { error: err.message, steps });
    }
  }

  if (method === 'POST' && pathname === '/api/servers/control') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const id = Number(body.id);
    const action = str(body.action, 16);
    if (!['start', 'stop', 'restart'].includes(action)) {
      return json(res, 400, { error: 'action: start|stop|restart' });
    }
    const row = getOrbitServerById(db, id);
    if (!row) return json(res, 404, { error: 'Server nicht gefunden.' });
    const settings = buildSettingsForServer(db, row);
    try {
      await controlFx(action, settings, logLine, { instanceId: String(id) });
      audit(db, me.username, `server.${action}`, row.slug, ip);
      return json(res, 200, { ok: true, action, instanceId: String(id) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/servers/activate') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const id = Number(body.id);
    try {
      const row = activateOrbitServer(db, id);
      syncResourcesFromDisk(db);
      return json(res, 200, { ok: true, server: row });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/servers/recipe') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const recipeId = str(body.recipe, 32);
    const settings = settingMap(db);
    const dataPath = str(body.dataPath, 256) || settings.fxDataPath;
    if (!dataPath) return json(res, 400, { error: 'Kein Datenpfad.' });
    try {
      const result = await runRecipeInstall(recipeId, dataPath, (t) => logLine('info', t), {
        mysqlConnection: str(body.mysqlConnection, 256),
        panelUrl: str(body.panelUrl, 256) || process.env.ORBIT_PUBLIC_URL || ORIGIN || '',
        ingameToken: settings.ingameToken || '',
      });
      setSetting(db, 'recipeProfile', recipeId);
      syncResourcesFromDisk(db);
      audit(db, me.username, 'recipe.install', recipeId, ip);
      return json(res, 200, { ok: true, result, recipes: Object.keys(RECIPE_PACKS) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/servers/recipe-yaml') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const settings = settingMap(db);
    const dataPath = str(body.dataPath, 256) || settings.fxDataPath;
    const yamlText = str(body.yaml, 200_000);
    if (!dataPath || !yamlText) return json(res, 400, { error: 'dataPath und yaml erforderlich.' });
    try {
      const result = await runRecipeYaml(yamlText, dataPath, (t) => logLine('info', t));
      syncResourcesFromDisk(db);
      audit(db, me.username, 'recipe.yaml', result.name, ip);
      return json(res, 200, { ok: true, result });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/drops') {
    if (!hasPerm(me, 'history')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const hours = Math.min(Number(url.searchParams.get('hours') || 24), 168);
    return json(res, 200, listDrops(db, hours));
  }

  if (method === 'POST' && pathname === '/api/ingame/token') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const fresh = randomToken();
    setSetting(db, 'ingameToken', fresh);
    return json(res, 200, { token: fresh });
  }

  if (method === 'POST' && pathname === '/api/ingame/hot-deploy') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    try {
      if (!supervisorConsoleReady(settings)) {
        syncOrbitSystemResource(settings.fxServerRoot || FX_SERVER_ROOT, settings.fxDataPath || '', (t) => logLine('info', t));
        ensureIngameToken(db);
        return json(res, 200, { ok: true, note: 'Resource kopiert — FX-Konsole offline; nach nächstem Start aktiv.' });
      }
      hotDeployOrbit(db, (cmd) => sendSupervisorCommand(settings, cmd), settings.fxServerRoot, settings.fxDataPath, (t) => logLine('info', t));
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/servers/console-target') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const id = body.id === null || body.id === '' ? '' : String(Number(body.id) || '');
    setSetting(db, 'consoleTargetServerId', id);
    return json(res, 200, { ok: true, consoleTargetServerId: id });
  }

  if (method === 'GET' && pathname === '/api/platform/monitoring') {
    if (!hasPerm(me, 'monitor')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    const instances = await refreshInstanceMonitors(db, settings.fivemHost || '127.0.0.1');
    return json(res, 200, { instances, consoleTargetServerId: settings.consoleTargetServerId || '' });
  }

  if (method === 'GET' && pathname === '/api/platform/readiness') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const settings = settingMap(db);
    const dataPath = settings.fxDataPath || '';
    const report = prodReadiness(dataPath, settings.fxServerRoot || '');
    report.paths = { artifacts: ORBIT_ARTIFACTS_ROOT, servers: ORBIT_SERVERS_ROOT };
    try {
      const cfg = dataPath ? path.join(dataPath, 'server.cfg') : '';
      const raw = cfg && fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
      const integr = parseCfgIntegrations(raw);
      report.cfg = {
        license: /sv_licenseKey\s+"[^"]+"/i.test(raw),
        mysql: !!integr.mysqlDsn,
      };
    } catch {
      report.cfg = { license: false, mysql: false };
    }
    return json(res, 200, report);
  }

  if (method === 'POST' && pathname === '/api/platform/prod-config') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const settings = settingMap(db);
    const dataPath = str(body.dataPath, 256) || settings.fxDataPath;
    if (!dataPath) return json(res, 400, { error: 'Kein Datenpfad.' });
    const cfgPath = path.join(dataPath, 'server.cfg');
    try {
      applyProdSecretsToCfg(cfgPath, {
        licenseKey: str(body.licenseKey, 128),
        mysqlConnection: str(body.mysqlConnection, 256),
      });
      audit(db, me.username, 'prod.config', dataPath, ip);
      return json(res, 200, { ok: true, cfgPath });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/platform/discord-test') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const settings = settingMap(db);
    try {
      await notifyServerEvent(settings, 'Orbit Test', 'Webhook funktioniert.');
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (pathname.startsWith('/api/artifacts') || pathname.startsWith('/api/servers')
    || pathname === '/api/drops' || pathname.startsWith('/api/ingame') || pathname.startsWith('/api/platform/')) {
    json(res, 404, { error: 'Nicht gefunden.' });
    return true;
  }
  return false;
}
