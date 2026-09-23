import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COOKIE,
  TICKET_COOKIE,
  clearCookie,
  clientIp,
  cookieHeader,
  createSession,
  hasPerm,
  hashPassword,
  loadSession,
  newTotpSecret,
  passwordOk,
  publicUser,
  randomToken,
  readCookie,
  sha256,
  userOk,
  verifyPassword,
  verifyTotp,
  SESSION_MS,
} from './auth.js';
import { cfxAuthorizeUrl, exchangeCfxCode, fetchCfxUserInfo } from './cfx.js';
import {
  clearBootstrapPin,
  clearPendingCfxClaim,
  ensureBootstrapPin,
  hasUsers as dbHasUsers,
  printBootstrapBanner,
  readPendingCfxClaim,
  storePendingCfxClaim,
  verifyBootstrapPin,
} from './bootstrapPin.js';
import { ORIGIN, PORT, HOST, DATA_DIR, ORBIT_SERVERS_ROOT, CFG_PATH, FX_SERVER_ROOT } from './config.js';
import { audit, getDb, setSetting, settingMap } from './db.js';
import { getUserPrefs, setUserPrefs } from './userPrefs.js';
import { controlFx, fxProcessActive, FX_UNIT } from './control.js';
import { fxConsoleReady } from './fxCommand.js';
import { orbitControlMode } from './fxLaunch.js';
import { patchCfgServerOpts } from './cfgPatch.js';
import { mergeCfgSecrets, parseCfgIntegrations, parseServerCfg, probeFiveM, readCfg, redactCfg, readHost, syncActiveCfgPath, validateCfg, writeCfg } from './fivem.js';
import { orbitServerProfile } from './orbitServer.js';
import {
  buildSettingsForServer,
  createAndActivateOrbitServer,
  getActiveOrbitServer,
  listOrbitServers,
} from './orbitServersDb.js';
import {
  buildSetupPreflight,
  checkPortInUse,
  defaultDbName,
  installMysql,
  orbitPortConflict,
  provisionMysqlDatabase,
} from './onboarding.js';
import { applyProdSecretsToCfg } from './prodConfig.js';
import {
  applyPanelAccess,
  buildPanelAccessPreview,
  schedulePanelServiceRestart,
} from './panelAccess.js';
import { probeServerPath, resolveCustomDataPath, resolveOrbitServersRoot } from './serverPathPolicy.js';
import { prepareServerDataPath, sudoAvailable } from './hostAccess.js';
import { detectTxAdminEnvironment, migrateFromTxAdmin } from './txAdminMigration.js';
import {
  extraSecurityHeaders,
  REQUIRE_TLS,
  requestIsSecure,
  tlsRequiredResponse,
} from './transportSecurity.js';
import { runRecipeInstall } from './recipeInstall.js';
import { runRecipeYaml } from './recipeRunner.js';
import { fetchRecommendedBuild, installArtifact } from './artifacts.js';
import { handlePlatformApi, initPlatform } from './platformApi.js';
import { handleIngamePublicApi } from './ingameApi.js';
import { hotDeployOrbit, ensureIngameToken, syncOrbitSystemResource } from './orbitBridgeSync.js';
import { parseDropFromLogLine, recordDrop } from './playerDrops.js';
import { notifyServerEvent, notifyPlayerDrop } from './discord.js';
import { refreshDiscordBot, setDiscordBotDeps } from './discordBot.js';
import { pollFxJournal } from './fxJournal.js';
import {
  browseTable,
  databaseOverview,
  getDatabaseMeta,
  listTables,
  mysqlReady,
  runOwnerQuery,
  runSelect,
  searchTable,
  tableStructure,
} from './mysql.js';
import { buildResourceGroups, resolveResourceActual, syncResourcesFromDisk } from './resourceScan.js';
import { drainCommandQueue } from './queueWorker.js';
import { refreshInstanceMonitors } from './instanceMonitor.js';
import { pollOrbitLogDrops } from './fxLogTail.js';
import { resolveConsoleSettings } from './consoleSettings.js';
import { fxCommandReady } from './rcon.js';
import { sendSupervisorCommand, stopFxProcess, supervisorPhase, supervisorConsoleReady } from './fxSupervisor.js';
import { logLine, runtime, pushSeries, setLogHook, snapshot } from './state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const db = getDb();

const buckets = new Map();
function hit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.reset) {
    bucket = { n: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.n += 1;
  if (buckets.size > 8000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  return bucket.n <= limit;
}

const RECIPES = {
  blank: ['oxmysql', 'sessionmanager', 'hardcap', 'chat'],
  esx: ['oxmysql', 'es_extended', 'ox_lib', 'ky3ls_loading', 'ky3ls_chat', '[core]', '[esx_addons]', '[scripts]'],
  qb: ['oxmysql', 'qb-core', 'qb-multicharacter', '[qb]'],
  qbox: ['oxmysql', 'qbx_core', 'ox_lib', '[qbx]'],
  vmenu: ['oxmysql', 'vMenu', 'hardcap'],
  streetkings: ['oxmysql', 'streetkings', 'hardcap'],
  warfare: ['oxmysql', 'warfaretacticsv', 'hardcap'],
  redm: ['oxmysql', 'sessionmanager', 'hardcap'],
  vorp: ['oxmysql', 'vorp_core', 'vorp_character'],
};

function renderCfg({ name, project, port, maxClients, locale, tags, onesync, recipe }) {
  const ensures = (RECIPES[recipe] || RECIPES.blank).map((name) => `ensure ${name}`).join('\n');
  return [
    `endpoint_add_tcp "0.0.0.0:${port}"`,
    `endpoint_add_udp "0.0.0.0:${port}"`,
    '',
    `sv_hostname "${name.replace(/"/g, '')}"`,
    `sv_maxclients ${maxClients}`,
    `sets sv_projectName "${project.replace(/"/g, '')}"`,
    `sets tags "${tags.replace(/"/g, '')}"`,
    `sets locale "${locale.replace(/"/g, '')}"`,
    `## [txAdmin CFG validator]: onesync ${onesync}`,
    onesync === 'off' ? '## set onesync off' : onesync === 'legacy' ? 'set onesync legacy' : 'set onesync on',
    '',
    '# Lizenzschlüssel bleibt in der echten server.cfg und wird hier nicht gespeichert.',
    '',
    ensures,
    '',
  ].join('\n');
}

function parseServerCfgSafe(text) {
  try {
    return parseServerCfg(text);
  } catch {
    return { resources: [], pub: {} };
  }
}

function setupDone() {
  return settingMap(db).setupDone === '1';
}

/** Master fehlt — PIN-Link oder Passwort-Schritt. */
function masterBootstrapState(req) {
  if (dbHasUsers(db)) {
    return { needsMaster: false, phase: 'done', hasUsers: true, pendingCfx: null };
  }
  ensureBootstrapPin(db);
  const claimTok = readCookie(req, 'orbit_claim');
  const pending = readPendingCfxClaim(db, claimTok);
  if (pending) {
    return {
      needsMaster: true,
      phase: 'create',
      hasUsers: false,
      pendingCfx: { name: pending.cfxName, id: pending.cfxId },
    };
  }
  return { needsMaster: true, phase: 'pin', hasUsers: false, pendingCfx: null };
}

/** Öffentliche Panel-URL für OAuth-Redirects (IP:Port ohne ORBIT_PUBLIC_URL). */
function requestPublicOrigin(req) {
  if (process.env.ORBIT_PUBLIC_URL) return ORIGIN;
  const xfHost = req.headers['x-forwarded-host'];
  const host = (typeof xfHost === 'string' && xfHost.split(',')[0].trim()) || req.headers.host || '';
  if (!host || host.length > 253) return ORIGIN;
  const xfProto = req.headers['x-forwarded-proto'];
  let proto = typeof xfProto === 'string' ? xfProto.split(',')[0].trim().toLowerCase() : '';
  if (proto !== 'http' && proto !== 'https') {
    proto = String(ORIGIN).startsWith('https://') ? 'https' : 'http';
  }
  return `${proto}://${host}`.replace(/\/$/, '');
}

function persistFivemCfgFromSettings(settings) {
  const { raw } = readCfg();
  const next = patchCfgServerOpts(raw, {
    onesync: settings.onesync || 'on',
    gameBuild: settings.gameBuild || '',
    maxClients: Number(settings.maxClients) || 48,
    hostname: settings.hostname,
    project: settings.project,
    tags: settings.tags || '',
    locale: settings.locale || 'de-DE',
  });
  writeCfg(next);
}

function redirect(res, location, extraHeaders = []) {
  res.writeHead(302, [
    ['Location', location],
    ['Cache-Control', 'no-store'],
    ...extraHeaders,
  ]);
  res.end();
}

function json(res, status, body, extraHeaders = []) {
  const payload = JSON.stringify(body);
  const secure = res._orbitSecure === true;
  const sec = extraSecurityHeaders(secure);
  res.writeHead(status, [
    ['Content-Type', 'application/json; charset=utf-8'],
    ['Cache-Control', 'no-store'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'no-referrer'],
    ['X-Robots-Tag', 'noindex, nofollow'],
    ...Object.entries(sec).map(([k, v]) => [k, v]),
    ['Content-Length', Buffer.byteLength(payload)],
    ...extraHeaders,
  ]);
  res.end(payload);
}

function readBody(req, max = 65_536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error('payload'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function requestHostOrigin(req) {
  const xfHost = req.headers['x-forwarded-host'];
  const host = (typeof xfHost === 'string' && xfHost.split(',')[0].trim()) || req.headers.host || '';
  if (!host || host.length > 253) return '';
  const xfProto = req.headers['x-forwarded-proto'];
  let proto = typeof xfProto === 'string' ? xfProto.split(',')[0].trim().toLowerCase() : '';
  if (proto !== 'http' && proto !== 'https') {
    proto = String(ORIGIN).startsWith('https://') ? 'https' : 'http';
  }
  return `${proto}://${host}`.replace(/\/$/, '');
}

function originOk(req) {
  const allowed = new Set([ORIGIN.replace(/\/$/, '')]);
  const fromHost = requestHostOrigin(req);
  if (fromHost) allowed.add(fromHost);
  // Localhost-Varianten desselben Ports
  try {
    const u = new URL(ORIGIN);
    allowed.add(`http://127.0.0.1:${u.port || PORT}`);
    allowed.add(`http://localhost:${u.port || PORT}`);
  } catch { /* */ }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && origin.length < 256) {
    return allowed.has(origin.replace(/\/$/, ''));
  }
  const referer = req.headers.referer || '';
  if (!referer) return false;
  for (const base of allowed) {
    if (referer === base || referer.startsWith(`${base}/`)) return true;
  }
  return false;
}

function mutationOk(req) {
  if (!originOk(req)) return false;
  return req.headers['x-tx2-client'] === '1';
}

function ipAllowed(ip) {
  const raw = (settingMap(db).ipAllowlist || '').trim();
  if (!raw) return true;
  const list = raw.split(/[\s,]+/).filter(Boolean);
  return list.includes(ip);
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function primaryId(identifiers) {
  const list = identifiers || [];
  return list.find((id) => id.startsWith('license:')) || list[0] || '';
}

let dummyHash = '';
let fivemTick = 0;
let firedMinute = '';
let queueBusy = false;
let lastResourceScan = 0;

async function loop() {
  try {
    const host = readHost();
    runtime.host = host;
    fivemTick += 1;
    if (fivemTick % 2 === 0) {
      const settings = settingMap(db);
      runtime.controlEnabled = settings.controlEnabled !== '0';
      const port = Number(settings.fivemPort) || 30120;
      const [probe, active] = await Promise.all([
        probeFiveM(settings.fivemHost || '127.0.0.1', port),
        fxProcessActive(settings),
      ]);
      runtime.unitActive = active;
      runtime.fxControlMode = orbitControlMode(settings);
      runtime.fxCommandReady = fxConsoleReady(settings);
      runtime.supervisorPhase = runtime.fxControlMode === 'orbit' ? supervisorPhase() : 'n/a';
      const was = runtime.online;
      runtime.online = probe.online;
      runtime.players = probe.players;
      runtime.fxResources = probe.resources;
      runtime.clients = probe.online ? probe.clients : 0;
      if (probe.hostname) runtime.hostname = probe.hostname;
      else runtime.hostname = settings.hostname || 'FiveM';
      runtime.maxClients = probe.maxClients || Number(settings.maxClients) || 48;
      if (runtime.controlPhase === 'starting' && (probe.online || active)) runtime.controlPhase = 'idle';
      if (runtime.controlPhase === 'stopping' && !probe.online && !active) runtime.controlPhase = 'idle';
      if (runtime.controlPhase === 'restarting' && probe.online) runtime.controlPhase = 'idle';
      if (probe.online && !was) {
        runtime.onlineSince = Date.now();
        logLine('ok', 'FiveM-Endpunkt erreichbar.');
      }
      if (!probe.online && was) {
        runtime.onlineSince = null;
        db.prepare("UPDATE resources SET actual = 'unknown'").run();
        logLine('warn', 'FiveM-Endpunkt nicht erreichbar.');
      }
      if (probe.online && !runtime.onlineSince) runtime.onlineSince = Date.now();
      if (!probe.online) runtime.onlineSince = null;
      if (probe.online) {
        const now = Date.now();
        const up = db.prepare(`
          INSERT INTO players (identifier, name, ping, ids, first_seen, last_seen, play_ms)
          VALUES (?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(identifier) DO UPDATE SET
            name = excluded.name,
            ping = excluded.ping,
            ids = excluded.ids,
            last_seen = excluded.last_seen,
            play_ms = play_ms + 2000
        `);
        for (const player of probe.players) {
          const identifier = primaryId(player.identifiers);
          if (!identifier) continue;
          up.run(identifier, player.name, player.ping, JSON.stringify(player.identifiers), now, now);
        }
        if (probe.resources.length) {
          const names = new Set(probe.resources);
          const known = db.prepare('SELECT name FROM resources').all();
          const mark = db.prepare('UPDATE resources SET actual = ?, updated = ? WHERE name = ?');
          for (const row of known) mark.run(names.has(row.name) ? 'started' : 'stopped', now, row.name);
        }
      }
    }
    pushSeries({
      t: Date.now(),
      cpu: host.cpu,
      ram: host.ramPct,
      players: runtime.clients,
    });
    checkSchedule();
    const settings = settingMap(db);
    if (fivemTick % 2 === 0) {
      refreshInstanceMonitors(db, settings.fivemHost || '127.0.0.1')
        .then((rows) => { runtime.instances = rows; })
        .catch(() => {});
      for (const s of listOrbitServers(db)) {
        if (s.data_path) pollOrbitLogDrops(db, s.data_path, settings);
      }
      if (!listOrbitServers(db).length && settings.fxDataPath) {
        pollOrbitLogDrops(db, settings.fxDataPath, settings);
      }
    }
    if (fivemTick % 3 === 0) pollFxJournal(logLine, settings).catch(() => {});
    if (!queueBusy) {
      queueBusy = true;
      drainCommandQueue(db, resolveConsoleSettings(db), logLine)
        .catch((err) => logLine('bad', `Queue: ${err.message}`))
        .finally(() => { queueBusy = false; });
    }
    if (fivemTick % 30 === 0) {
      const now = Date.now();
      db.prepare('DELETE FROM tickets WHERE expires < ?').run(now);
      db.prepare('DELETE FROM sessions WHERE expires < ? OR revoked = 1').run(now - 86_400_000);
    }
    if (Date.now() - lastResourceScan > 120_000) {
      try {
        syncResourcesFromDisk(db);
        lastResourceScan = Date.now();
      } catch (err) {
        logLine('warn', `Ressourcen-Scan: ${err.message}`);
      }
    }
  } catch (err) {
    logLine('bad', `Monitor: ${err.message}`);
  }
}

function checkSchedule() {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${hhmm}`;
  if (firedMinute === key) return;
  const due = db.prepare('SELECT * FROM schedule WHERE enabled = 1 AND hhmm = ?').all(hhmm);
  if (!due.length) return;
  firedMinute = key;
  const control = settingMap(db).controlEnabled !== '0';
  for (const job of due) {
    if (job.last_key === key) continue;
    db.prepare('UPDATE schedule SET last_key = ? WHERE id = ?').run(key, job.id);
    const settings = settingMap(db);
    const via = orbitControlMode(settings) === 'orbit' ? 'Orbit-Prozess' : 'systemd';
    const detail = control
      ? `Zeitplan „${job.label}“: Neustart über ${via}.`
      : 'Zeitplan ausgelöst, Server-Steuerung ist aus.';
    logLine('info', detail);
    audit(db, 'system', 'schedule', `${job.label} ${hhmm}`, 'local');
    if (control) {
      runtime.controlPhase = 'restarting';
      controlFx('restart', settings, logLine)
        .then(() => logLine('ok', `Zeitplan: Neustart (${via})`))
        .catch((err) => {
          runtime.controlPhase = 'idle';
          logLine('bad', `Zeitplan-Neustart fehlgeschlagen: ${err.message}`);
        });
    }
  }
}

function queueCommand(kind, payload, author, ip) {
  db.prepare('INSERT INTO queue (kind, payload, author, status, created) VALUES (?, ?, ?, ?, ?)')
    .run(kind, JSON.stringify(payload), author, 'queued', Date.now());
  audit(db, author, kind, JSON.stringify(payload).slice(0, 240), ip);
  logLine('info', `${author} → ${kind} ${payload.name || payload.identifier || payload.command || ''}`.trim());
}

function requireFxCommand(res, settings, { serverControlOk = false } = {}) {
  if (fxConsoleReady(settings) || serverControlOk) return true;
  const hint = orbitControlMode(settings) === 'orbit'
    ? 'FXServer unter Orbit starten oder RCON in server.cfg setzen.'
    : 'Orbit-Prozessmodus aktivieren und starten, oder `rcon_password` in server.cfg setzen.';
  json(res, 503, { error: `Keine Server-Konsole: ${hint}` });
  return false;
}

function syncCfgSecrets(parsed) {
  const extra = parseCfgIntegrations(parsed.raw || '');
  if (extra.rconPassword) setSetting(db, 'rconPassword', extra.rconPassword);
  if (extra.mysqlDsn) setSetting(db, 'mysqlDsn', extra.mysqlDsn);
}

function nextRestartInfo() {
  const jobs = db.prepare('SELECT id, label, hhmm, enabled FROM schedule WHERE enabled = 1 ORDER BY hhmm').all();
  if (!jobs.length) return { at: null, inMs: null, label: null, jobId: null, text: 'Kein Neustart geplant' };
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  let best = null;
  for (const job of jobs) {
    const [h, m] = job.hhmm.split(':').map(Number);
    let mins = h * 60 + m - cur;
    if (mins <= 0) mins += 24 * 60;
    if (!best || mins < best.mins) best = { job, mins };
  }
  const at = new Date(now.getTime() + best.mins * 60_000);
  at.setSeconds(0, 0);
  const hLeft = Math.floor(best.mins / 60);
  const mLeft = best.mins % 60;
  const text = hLeft > 0 ? `in ${hLeft} Stunden, ${mLeft} Minuten` : `in ${mLeft} Minuten`;
  return {
    at: at.getTime(),
    inMs: best.mins * 60_000,
    label: best.job.label,
    jobId: best.job.id,
    hhmm: best.job.hhmm,
    text,
  };
}

function playerStats() {
  const now = Date.now();
  const day = now - 86_400_000;
  const week = now - 7 * 86_400_000;
  const total = db.prepare('SELECT COUNT(*) AS c FROM players').get().c;
  const last24 = db.prepare('SELECT COUNT(*) AS c FROM players WHERE last_seen >= ?').get(day).c;
  const new24 = db.prepare('SELECT COUNT(*) AS c FROM players WHERE first_seen >= ?').get(day).c;
  const new7 = db.prepare('SELECT COUNT(*) AS c FROM players WHERE first_seen >= ?').get(week).c;
  return { total, last24, new24, new7 };
}

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  const method = req.method || 'GET';
  const pathname = url.pathname;

  if (REQUIRE_TLS && !res._orbitSecure) {
    const { status, body } = tlsRequiredResponse();
    return json(res, status, body);
  }

  if (!ipAllowed(ip)) return json(res, 403, { error: 'Diese Adresse ist nicht freigegeben.' });
  if (!hit(`g:${ip}`, 180, 60_000)) return json(res, 429, { error: 'Zu viele Anfragen.' });

  // Ingame-Pipe (FX → Panel) vor CSRF/Session — wie txAdmin luaCom
  if (await handleIngamePublicApi({
    req, res, url, method, pathname, db, json, readBody, runtime, logLine, ip,
  })) return;

  const mutating = method !== 'GET' && method !== 'HEAD';
  if (mutating && !mutationOk(req)) return json(res, 403, { error: 'Anfrage abgelehnt.' });

  if (method === 'GET' && pathname === '/api/bootstrap') {
    const boot = masterBootstrapState(req);
    const me = !boot.needsMaster ? loadSession(db, req) : null;
    return json(res, 200, {
      brand: 'Orbit',
      needsMaster: boot.needsMaster,
      masterPhase: boot.phase,
      pendingCfx: boot.pendingCfx,
      setup: setupDone(),
      hasUsers: boot.hasUsers,
      user: me ? publicUser(me) : null,
      tls: { required: REQUIRE_TLS, secure: res._orbitSecure === true, origin: ORIGIN },
    });
  }

  if (method === 'POST' && pathname === '/api/bootstrap/pin') {
    if (!hit(`boot:${ip}`, 12, 15 * 60_000)) return json(res, 429, { error: 'Zu viele Versuche.' });
    if (dbHasUsers(db)) return json(res, 409, { error: 'Master existiert bereits. Bitte anmelden.' });
    ensureBootstrapPin(db);
    const body = await readBody(req);
    const pin = typeof body.pin === 'string' ? body.pin : String(body.pin || '');
    if (!verifyBootstrapPin(pin)) {
      return json(res, 401, { error: 'PIN ungültig. Schau in die Terminal-/Dienst-Ausgabe.' });
    }
    const ticket = randomToken();
    db.prepare('INSERT INTO tickets (token_hash, user_id, expires) VALUES (?, ?, ?)')
      .run(sha256(ticket), 0, Date.now() + 10 * 60_000);
    return json(res, 200, { ok: true }, [[
      'Set-Cookie', cookieHeader('orbit_pin', ticket, 600, 'Lax'),
    ]]);
  }

  if (method === 'POST' && pathname === '/api/bootstrap/master') {
    if (!hit(`boot:${ip}`, 4, 15 * 60_000)) return json(res, 429, { error: 'Zu viele Versuche.' });
    if (dbHasUsers(db)) return json(res, 409, { error: 'Master existiert bereits. Bitte anmelden.' });
    const claimTok = readCookie(req, 'orbit_claim');
    const pending = readPendingCfxClaim(db, claimTok);
    if (!pending) {
      return json(res, 400, { error: 'Zuerst PIN bestätigen und Cfx.re verknüpfen.' });
    }
    const body = await readBody(req);
    const password = typeof body.password === 'string' ? body.password : '';
    const accept = body.accept === true || body.accept === '1';
    if (!accept) return json(res, 400, { error: 'Bitte die Bedingungen akzeptieren.' });
    if (!passwordOk(password)) {
      return json(res, 400, { error: 'Backup-Passwort mind. 6 Zeichen.' });
    }
    const usernameBase = String(pending.cfxName || 'owner').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24) || 'owner';
    let username = usernameBase;
    let n = 0;
    while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      n += 1;
      username = `${usernameBase.slice(0, 20)}${n}`;
    }
    const takenCfx = db.prepare('SELECT id FROM users WHERE cfx_id = ?').get(pending.cfxId);
    if (takenCfx) return json(res, 409, { error: 'Dieses Cfx.re-Konto ist bereits verknüpft.' });
    const now = Date.now();
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, role, must_change, created, cfx_id, cfx_name)
      VALUES (?, ?, 'owner', 0, ?, ?, ?)
    `).run(username, await hashPassword(password), now, pending.cfxId, pending.cfxName);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    clearPendingCfxClaim(db);
    clearBootstrapPin();
    const token = createSession(db, user, req);
    audit(db, username, 'master.create', pending.cfxId, ip);
    logLine('ok', `Master-Account ${username} (Cfx: ${pending.cfxName}) angelegt`);
    return json(res, 200, { user: publicUser(user), setup: false }, [
      ['Set-Cookie', cookieHeader(COOKIE, token, SESSION_MS / 1000)],
      ['Set-Cookie', cookieHeader('orbit_claim', '', 0, 'Lax')],
      ['Set-Cookie', cookieHeader('orbit_pin', '', 0, 'Lax')],
    ]);
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    if (!hit(`l:${ip}`, 6, 10 * 60_000)) return json(res, 429, { error: 'Zu viele Anmeldeversuche.' });
    const body = await readBody(req);
    const username = str(body.username, 24);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const hash = user?.password_hash || dummyHash;
    const match = await verifyPassword(password, hash);
    if (!user || !match || user.disabled) {
      if (user && !user.disabled) {
        const failed = user.failed + 1;
        const locked = failed >= 8 ? Date.now() + 15 * 60_000 : 0;
        db.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?').run(locked ? 0 : failed, locked, user.id);
        if (locked) audit(db, user.username, 'lockout', '', ip);
      }
      return json(res, 401, { error: 'Zugangsdaten ungültig.' });
    }
    if (user.locked_until > Date.now()) return json(res, 429, { error: 'Anmeldung vorübergehend gesperrt.' });
    if (user.totp_enabled && user.totp_secret) {
      const ticket = randomToken();
      db.prepare('INSERT INTO tickets (token_hash, user_id, expires) VALUES (?, ?, ?)').run(sha256(ticket), user.id, Date.now() + 5 * 60_000);
      return json(res, 200, { totpRequired: true }, [[ 'Set-Cookie', cookieHeader(TICKET_COOKIE, ticket, 300) ]]);
    }
    db.prepare('UPDATE users SET failed = 0, locked_until = 0, last_login = ? WHERE id = ?').run(Date.now(), user.id);
    const token = createSession(db, user, req);
    audit(db, user.username, 'login', '', ip);
    logLine('ok', `${user.username} angemeldet`);
    return json(res, 200, { user: publicUser(user), setup: setupDone() }, [[ 'Set-Cookie', cookieHeader(COOKIE, token, SESSION_MS / 1000) ]]);
  }

  if (method === 'POST' && pathname === '/api/auth/totp') {
    if (!hit(`l:${ip}`, 8, 10 * 60_000)) return json(res, 429, { error: 'Zu viele Anmeldeversuche.' });
    const body = await readBody(req);
    const ticket = readCookie(req, TICKET_COOKIE);
    const row = ticket
      ? db.prepare('SELECT t.user_id, u.* FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.expires > ?').get(sha256(ticket), Date.now())
      : null;
    if (!row || !verifyTotp(row.totp_secret, body.code)) {
      return json(res, 401, { error: 'Code ungültig.' }, [[ 'Set-Cookie', clearCookie(TICKET_COOKIE) ]]);
    }
    db.prepare('DELETE FROM tickets WHERE token_hash = ?').run(sha256(ticket));
    db.prepare('UPDATE users SET failed = 0, locked_until = 0, last_login = ? WHERE id = ?').run(Date.now(), row.id);
    const token = createSession(db, row, req);
    audit(db, row.username, 'login', 'totp', ip);
    return json(res, 200, { user: publicUser(row), setup: setupDone() }, [
      ['Set-Cookie', cookieHeader(COOKIE, token, SESSION_MS / 1000)],
      ['Set-Cookie', clearCookie(TICKET_COOKIE)],
    ]);
  }

  if (method === 'GET' && pathname === '/api/auth/cfx/start') {
    if (!hit(`cfx:${ip}`, 8, 10 * 60_000)) return redirect(res, '/login?cfx=rate');
    const rawMode = url.searchParams.get('mode') || 'login';
    const mode = rawMode === 'link' || rawMode === 'claim' ? rawMode : 'login';
    let userId = null;
    if (mode === 'link') {
      const linked = loadSession(db, req);
      if (!linked) return redirect(res, '/login');
      userId = linked.id;
    } else if (mode === 'claim') {
      if (dbHasUsers(db)) return redirect(res, '/login');
      const pinTicket = readCookie(req, 'orbit_pin');
      const pinOk = pinTicket
        ? db.prepare('SELECT user_id FROM tickets WHERE token_hash = ? AND expires > ?').get(sha256(pinTicket), Date.now())
        : null;
      if (!pinOk) return redirect(res, '/install?cfx=pin');
      userId = null;
    }
    const state = randomToken();
    const redirectUri = `${requestPublicOrigin(req)}/api/auth/cfx/callback`;
    db.prepare('INSERT INTO oauth_states (nonce, mode, user_id, expires) VALUES (?, ?, ?, ?)')
      .run(state, mode, userId, Date.now() + 10 * 60_000);
    return redirect(res, cfxAuthorizeUrl({ redirectUri, state }));
  }

  if (method === 'GET' && pathname === '/api/auth/cfx/callback') {
    try {
      const code = url.searchParams.get('code');
      const stateTok = url.searchParams.get('state');
      if (!code || !stateTok) {
        const err = url.searchParams.get('error_description') || url.searchParams.get('error') || 'missing_code';
        return redirect(res, `/login?cfx=error&detail=${encodeURIComponent(String(err).slice(0, 80))}`);
      }
      const state = db.prepare('SELECT * FROM oauth_states WHERE nonce = ?').get(stateTok);
      db.prepare('DELETE FROM oauth_states WHERE nonce = ?').run(stateTok);
      if (!state || state.expires < Date.now()) return redirect(res, '/login?cfx=error');

      const redirectUri = `${requestPublicOrigin(req)}/api/auth/cfx/callback`;
      const tokenSet = await exchangeCfxCode({ code, redirectUri });
      const profile = await fetchCfxUserInfo(tokenSet.access_token);

      if (state.mode === 'claim') {
        if (dbHasUsers(db)) return redirect(res, '/login');
        const taken = db.prepare('SELECT id FROM users WHERE cfx_id = ?').get(profile.id);
        if (taken) return redirect(res, '/install?cfx=taken');
        const claimTok = storePendingCfxClaim(db, profile);
        const pinTicket = readCookie(req, 'orbit_pin');
        if (pinTicket) db.prepare('DELETE FROM tickets WHERE token_hash = ?').run(sha256(pinTicket));
        audit(db, profile.username, 'cfx.claim', profile.id, ip);
        logLine('ok', `Cfx.re verknüpft (${profile.username}) — Master-Passwort setzen`);
        return redirect(res, '/install?step=create', [
          ['Set-Cookie', cookieHeader('orbit_claim', claimTok, 1800, 'Lax')],
          ['Set-Cookie', cookieHeader('orbit_pin', '', 0, 'Lax')],
        ]);
      }

      if (state.mode === 'link') {
        const taken = db.prepare('SELECT id FROM users WHERE cfx_id = ? AND id != ?').get(profile.id, state.user_id);
        if (taken) return redirect(res, '/settings?cfx=taken');
        db.prepare('UPDATE users SET cfx_id = ?, cfx_name = ? WHERE id = ?').run(profile.id, profile.username, state.user_id);
        audit(db, profile.username, 'cfx.link', profile.id, ip);
        return redirect(res, '/settings?cfx=ok');
      }

      const user = db.prepare('SELECT * FROM users WHERE cfx_id = ?').get(profile.id);
      if (!user || user.disabled) return redirect(res, '/login?cfx=unknown');
      if (user.locked_until > Date.now()) return redirect(res, '/login?cfx=locked');
      if (user.totp_enabled && user.totp_secret) {
        const ticket = randomToken();
        db.prepare('INSERT INTO tickets (token_hash, user_id, expires) VALUES (?, ?, ?)').run(sha256(ticket), user.id, Date.now() + 5 * 60_000);
        return redirect(res, '/login?totp=1', [[ 'Set-Cookie', cookieHeader(TICKET_COOKIE, ticket, 300, 'Lax') ]]);
      }
      db.prepare('UPDATE users SET failed = 0, locked_until = 0, last_login = ? WHERE id = ?').run(Date.now(), user.id);
      const token = createSession(db, user, req);
      audit(db, user.username, 'login', 'cfx', ip);
      logLine('ok', `${user.username} über Cfx.re angemeldet`);
      return redirect(res, setupDone() ? '/panel' : '/setup', [[ 'Set-Cookie', cookieHeader(COOKIE, token, SESSION_MS / 1000, 'Lax') ]]);
    } catch (err) {
      console.error('cfx callback', err.message);
      return redirect(res, '/login?cfx=error');
    }
  }

  const session = loadSession(db, req);
  if (!session) return json(res, 401, { error: 'Nicht angemeldet.' });
  const me = session;

  if (await handlePlatformApi({
    req, res, url, method, pathname, me, db, ip, json, hasPerm, readBody, logLine,
  })) return;

  if (method === 'POST' && pathname === '/api/auth/logout') {
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(me.sid);
    audit(db, me.username, 'logout', '', ip);
    return json(res, 200, { ok: true }, [[ 'Set-Cookie', clearCookie(COOKIE) ]]);
  }

  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: publicUser(me), setup: setupDone() });

  if (method === 'GET' && pathname === '/api/prefs') {
    const { prefs, isDefault } = getUserPrefs(db, me.id);
    return json(res, 200, { prefs, isDefault });
  }

  if (method === 'PUT' && pathname === '/api/prefs') {
    const body = await readBody(req);
    const prefs = setUserPrefs(db, me.id, body && typeof body === 'object' ? body : {});
    return json(res, 200, { prefs });
  }

  if (method === 'POST' && pathname === '/api/auth/cfx/unlink') {
    db.prepare('UPDATE users SET cfx_id = NULL, cfx_name = NULL WHERE id = ?').run(me.id);
    audit(db, me.username, 'cfx.unlink', '', ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/setup/preflight') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    try {
      const preflight = await buildSetupPreflight(db);
      return json(res, 200, preflight);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/setup/check-port') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const port = Number(body.port);
    const check = await checkPortInUse(port, '127.0.0.1');
    const conflict = orbitPortConflict(db, port);
    return json(res, 200, { ...check, orbitConflict: conflict });
  }

  if (method === 'GET' && pathname === '/api/txadmin/detect') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    try {
      const report = await detectTxAdminEnvironment();
      return json(res, 200, report);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/txadmin/migrate') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    try {
      const mig = await migrateFromTxAdmin(db, {
        importSettings: body.importSettings !== false,
        deactivateTxAdmin: body.deactivateTxAdmin !== false,
        importBans: body.importBans !== false,
        importWarns: body.importWarns !== false,
        importWhitelist: body.importWhitelist !== false,
        activeProfile: str(body.activeProfile, 80),
        profiles: Array.isArray(body.profiles) ? body.profiles.map((p) => String(p)) : undefined,
      }, logLine);
      const count = syncResourcesFromDisk(db);
      let started = false;
      const migrateSteps = [];
      if (body.startServers !== false) {
        try {
          await controlFx('start', buildSettingsForServer(db, mig.active), logLine);
          started = true;
        } catch (err) {
          migrateSteps.push(`FX-Start: ${err.message}`);
        }
      }
      audit(db, me.username, 'txadmin.migrate', mig.active.slug, ip);
      return json(res, 200, {
        ok: true,
        imported: mig.imported,
        active: mig.active,
        dataPath: mig.dataPath,
        hostname: mig.hostname,
        resources: count,
        stoppedUnits: mig.stoppedUnits,
        moderation: mig.moderation,
        serverStarted: started,
        nextSteps: migrateSteps,
      });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/setup/panel-access') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    try {
      const preview = await buildPanelAccessPreview();
      return json(res, 200, preview);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/setup/panel-access/preview') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    try {
      const preview = await buildPanelAccessPreview({
        mode: body.mode,
        panelPort: body.panelPort,
        publicHost: body.publicHost,
        domain: body.domain,
        https: body.https,
      });
      return json(res, 200, preview);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/setup/validate-path') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const elevate = await sudoAvailable();
    const report = probeServerPath({
      serversRoot: str(body.serversRoot, 256),
      dataPath: str(body.dataPath, 512),
      defaultRoot: ORBIT_SERVERS_ROOT,
      canElevate: elevate,
    });
    return json(res, 200, report);
  }

  if (method === 'POST' && pathname === '/api/setup/mysql-install') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    try {
      const st = await installMysql(logLine);
      audit(db, me.username, 'setup.mysql.install', st.service, ip);
      return json(res, 200, { ok: true, mysql: st });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/setup/mysql-provision') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    const dbName = str(body.dbName, 48) || defaultDbName(str(body.serverName, 48) || 'server');
    try {
      const prov = await provisionMysqlDatabase({
        dbName,
        rootPassword: body.mysqlRootPassword !== undefined ? str(body.mysqlRootPassword, 128) : undefined,
        appUser: str(body.appUser, 32) || 'orbit',
      });
      setSetting(db, 'mysqlDsn', prov.dsn);
      audit(db, me.username, 'setup.mysql.db', prov.dbName, ip);
      return json(res, 200, { ok: true, ...prov, dsnRedacted: prov.dsn.replace(/:([^:@]+)@/, ':***@') });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/setup') {
    if (!hasPerm(me, 'settings') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    let detected = null;
    try {
      const parsed = readCfg();
      detected = {
        hostname: parsed.pub.hostname,
        project: parsed.pub.project,
        tags: parsed.pub.tags,
        locale: parsed.pub.locale,
        maxClients: parsed.pub.maxClients,
        resources: parsed.resources.length,
        port: Number(settings.fivemPort) || 30120,
      };
    } catch {
      detected = null;
    }
    return json(res, 200, {
      done: settings.setupDone === '1',
      profile: {
        mode: settings.profileMode || '',
        name: settings.hostname || '',
        project: settings.project || '',
        recipe: settings.profileRecipe || '',
        port: settings.fivemPort || '30120',
        maxClients: settings.maxClients || '48',
        locale: settings.locale || 'de-DE',
        tags: settings.tags || '',
        onesync: settings.onesync || 'on',
      },
      detected,
    });
  }

  if (method === 'POST' && pathname === '/api/setup') {
    if (me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const deploy = ['popular', 'existing', 'remote', 'custom'].includes(body.deploy) ? body.deploy : (body.mode === 'existing' ? 'existing' : 'popular');
    const name = str(body.name, 80);
    const port = Number(body.port);
    const maxClients = Number(body.maxClients);
    const recipe = Object.keys(RECIPES).includes(body.recipe) ? body.recipe : 'esx';
    const locale = str(body.locale, 12) || 'de-DE';
    const tags = str(body.tags, 120);
    const project = str(body.project, 80) || name;
    const onesync = body.onesync === 'off' ? 'off' : body.onesync === 'legacy' ? 'legacy' : 'on';
    const recipeUrl = str(body.recipeUrl, 300);
    if (name.length < 2) return json(res, 400, { error: 'Servername fehlt.' });
    if (!Number.isInteger(port) || port < 1 || port > 65535) return json(res, 400, { error: 'Port ungültig.' });
    if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 2048) return json(res, 400, { error: 'Slots ungültig.' });
    if (deploy === 'remote' && !/^https:\/\/[\w.\-]+(\/[\w.\-/?=&%]*)?$/i.test(recipeUrl)) {
      return json(res, 400, { error: 'Recipe-URL muss mit https:// beginnen.' });
    }
    const migratingTxAdmin = body.migrateFromTxAdmin === true && me.role === 'owner';
    const portProbe = migratingTxAdmin ? { inUse: false, available: true } : await checkPortInUse(port, '127.0.0.1');
    const portConflict = migratingTxAdmin ? null : orbitPortConflict(db, port);
    if (!migratingTxAdmin && portProbe.inUse) {
      return json(res, 400, { error: `Port ${port} ist auf diesem Host bereits belegt.` });
    }
    if (!migratingTxAdmin && portConflict) {
      return json(res, 400, { error: `Port ${port} ist bereits für „${portConflict.name}“ reserviert.` });
    }
    const licenseKey = str(body.licenseKey, 128);
    let mysqlDsn = str(body.mysqlConnection, 280);
    if (body.createDatabase) {
      try {
        const prov = await provisionMysqlDatabase({
          dbName: str(body.dbName, 48) || defaultDbName(name),
          appUser: str(body.dbUser, 32) || 'orbit',
          appPassword: typeof body.dbPassword === 'string' && body.dbPassword.length >= 6
            ? body.dbPassword.slice(0, 128)
            : undefined,
          rootPassword: body.mysqlRootPassword !== undefined ? str(body.mysqlRootPassword, 128) : undefined,
        });
        mysqlDsn = prov.dsn;
        setSetting(db, 'mysqlDsn', mysqlDsn);
        logLine('ok', `MySQL DB ${prov.dbName} + User ${prov.appUser} angelegt`);
      } catch (err) {
        return json(res, 400, { error: `Datenbank: ${err.message}` });
      }
    } else if (mysqlDsn) {
      setSetting(db, 'mysqlDsn', mysqlDsn);
    }
    let imported = 0;
    let hostname = name;
    let slots = maxClients;
    let dataPath = '';
    let nextSteps = [];
    let skipNewServer = false;
    const settingsBefore = settingMap(db);

    if (migratingTxAdmin) {
      try {
        const mig = await migrateFromTxAdmin(db, {
          importSettings: body.importTxAdminSettings !== false,
          deactivateTxAdmin: body.deactivateTxAdmin !== false,
          importBans: body.importTxAdminBans !== false,
          importWarns: body.importTxAdminWarns !== false,
          importWhitelist: body.importTxAdminWhitelist !== false,
          activeProfile: str(body.txAdminProfile, 80),
        }, logLine);
        skipNewServer = true;
        dataPath = mig.dataPath;
        hostname = mig.hostname;
        slots = Number(settingMap(db).maxClients) || maxClients;
        imported = mig.imported.length;
        syncResourcesFromDisk(db);
        nextSteps.push(`txAdmin → Orbit: ${mig.imported.length} Server übernommen.`);
        if (mig.stoppedUnits?.length) {
          nextSteps.push(`Deaktiviert: ${mig.stoppedUnits.join(', ')}`);
        }
        if (mig.moderation?.bans || mig.moderation?.warns || mig.moderation?.whitelist) {
          nextSteps.push(`Moderation: ${mig.moderation.bans} Bans, ${mig.moderation.warns} Warns, ${mig.moderation.whitelist} Allowlist`);
        }
        audit(db, me.username, 'setup.txadmin.migrate', mig.active.slug, ip);
      } catch (err) {
        return json(res, 400, { error: `txAdmin-Migration: ${err.message}` });
      }
    }

    if (deploy === 'existing') {
      try {
        const customData = str(body.dataPath, 512);
        if (customData) {
          dataPath = resolveCustomDataPath(customData);
          await prepareServerDataPath(dataPath, logLine);
          setSetting(db, 'fxDataPath', dataPath);
          setSetting(db, 'fxControlMode', 'orbit');
          syncActiveCfgPath(settingMap(db));
        } else {
          dataPath = settingsBefore.fxDataPath || '';
        }
        if (!dataPath) {
          return json(res, 400, { error: 'Datenordner für vorhandenen Server fehlt.' });
        }
        const parsed = readCfg();
        const now = Date.now();
        const insert = db.prepare('INSERT OR IGNORE INTO resources (name, actual, updated) VALUES (?, ?, ?)');
        for (const resource of parsed.resources) insert.run(resource, 'unknown', now);
        imported = parsed.resources.length;
        if (parsed.pub.hostname) hostname = parsed.pub.hostname;
        if (parsed.pub.maxClients) slots = parsed.pub.maxClients;
      } catch (err) {
        return json(res, 500, { error: err.message || 'Die vorhandene server.cfg konnte nicht gelesen werden.' });
      }
    } else if (!skipNewServer) {
      let serversRootOpt = '';
      let dataPathOpt = '';
      try {
        const customRoot = str(body.serversRoot, 256);
        const customData = str(body.dataPath, 512);
        if (customData) {
          dataPathOpt = resolveCustomDataPath(customData);
          await prepareServerDataPath(dataPathOpt, logLine);
        } else if (customRoot) {
          serversRootOpt = resolveOrbitServersRoot(customRoot, ORBIT_SERVERS_ROOT);
          await prepareServerDataPath(serversRootOpt, logLine);
        } else if (settingsBefore.orbitServersRoot) {
          serversRootOpt = resolveOrbitServersRoot(settingsBefore.orbitServersRoot, ORBIT_SERVERS_ROOT);
        }
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      // FX zuerst nach /opt/orbit/artifacts, dann Server-Daten unter /opt/orbit/servers
      let fxRoot = settingsBefore.fxServerRoot || '';
      try {
        const hasFx = fxRoot && fs.existsSync(path.join(fxRoot, 'alpine/opt/cfx-server/FXServer'));
        if (!hasFx && body.installArtifact !== false) {
          const build = await fetchRecommendedBuild();
          const installed = await installArtifact(build, (t) => logLine('info', t));
          fxRoot = installed.path;
          setSetting(db, 'fxServerRoot', fxRoot);
          setSetting(db, 'fxArtifactBuild', installed.build);
          logLine('ok', `FX Artifact ${installed.build} → ${fxRoot}`);
        }
      } catch (err) {
        return json(res, 500, { error: `FX-Download: ${err.message}` });
      }
      try {
        const { row, result } = createAndActivateOrbitServer(db, {
          name: hostname,
          project,
          port,
          maxClients: slots,
          locale,
          tags,
          onesync,
          fxServerRoot: fxRoot,
          serversRoot: serversRootOpt || undefined,
          dataPath: dataPathOpt || undefined,
        });
        if (serversRootOpt) setSetting(db, 'orbitServersRoot', serversRootOpt);
        dataPath = result.fxDataPath;
        setSetting(db, 'fxControlMode', 'orbit');
        const ingameToken = settingsBefore.ingameToken || '';
        const recipeOpts = {
          mysqlConnection: mysqlDsn || settingsBefore.mysqlDsn || '',
          panelUrl: ORIGIN,
          ingameToken,
        };
        if (deploy === 'remote' && recipeUrl) {
          const resRecipe = await fetch(recipeUrl, { signal: AbortSignal.timeout(120_000) });
          if (!resRecipe.ok) throw new Error(`Recipe-URL ${resRecipe.status}`);
          await runRecipeYaml(await resRecipe.text(), dataPath, (t) => logLine('info', t));
        } else if (recipe === 'esx' || recipe === 'qb' || recipe === 'blank') {
          await runRecipeInstall(recipe, dataPath, (t) => logLine('info', t), recipeOpts);
        } else {
          await runRecipeInstall('blank', dataPath, (t) => logLine('info', t), recipeOpts);
          const cfgFile = path.join(dataPath, 'server.cfg');
          let cfgText = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : '';
          for (const resName of RECIPES[recipe] || RECIPES.blank) {
            const line = `ensure ${resName}`;
            if (!cfgText.includes(line)) cfgText += `\n${line}`;
          }
          fs.writeFileSync(cfgFile, cfgText.trim() + '\n', 'utf8');
        }
        syncResourcesFromDisk(db);
        imported = (RECIPES[recipe] || RECIPES.blank).length;
        logLine('ok', `Orbit-Server „${row.name}“ unter ${dataPath}`);
      } catch (err) {
        return json(res, 500, { error: `Server/Recipe: ${err.message}` });
      }
    }

    setSetting(db, 'hostname', hostname);
    setSetting(db, 'project', project || hostname);
    setSetting(db, 'fivemHost', '127.0.0.1');
    setSetting(db, 'fivemPort', port);
    setSetting(db, 'maxClients', slots);
    setSetting(db, 'locale', locale);
    setSetting(db, 'tags', tags);
    setSetting(db, 'onesync', onesync);
    setSetting(db, 'profileMode', deploy);
    setSetting(db, 'profileRecipe', recipe);
    if (recipeUrl) setSetting(db, 'recipeUrl', recipeUrl);
    if (dataPath && (licenseKey || mysqlDsn)) {
      try {
        const cfgFile = path.join(dataPath, 'server.cfg');
        if (!fs.existsSync(cfgFile) && mysqlDsn) {
          // minimale cfg, damit Connection nicht verloren geht
          fs.writeFileSync(cfgFile, `# Orbit\nset mysql_connection_string "${mysqlDsn.replace(/"/g, '')}"\n`, 'utf8');
        }
        applyProdSecretsToCfg(cfgFile, {
          licenseKey,
          mysqlConnection: mysqlDsn,
        });
        if (mysqlDsn) setSetting(db, 'mysqlDsn', mysqlDsn);
        syncActiveCfgPath(settingMap(db));
        try {
          syncCfgSecrets({ raw: fs.readFileSync(cfgFile, 'utf8') });
        } catch { /* */ }
        if (mysqlDsn) logLine('ok', `mysql_connection_string → ${cfgFile}`);
      } catch (err) {
        nextSteps.push(`CFG Secrets: ${err.message}`);
      }
    }

    setSetting(db, 'setupDone', '1');
    setSetting(db, 'fxControlMode', 'orbit');
    setSetting(db, 'controlEnabled', '1');
    runtime.hostname = hostname;
    runtime.maxClients = slots;

    // Fallback: FX nachziehen (z. B. existing/migrate ohne Binary)
    let artifactBuild = settingMap(db).fxArtifactBuild || '';
    try {
      let root = settingMap(db).fxServerRoot || '';
      let hasFx = root && fs.existsSync(path.join(root, 'alpine/opt/cfx-server/FXServer'));
      if (!hasFx && body.installArtifact !== false) {
        const build = await fetchRecommendedBuild();
        const installed = await installArtifact(build, (t) => logLine('info', t));
        setSetting(db, 'fxServerRoot', installed.path);
        setSetting(db, 'fxArtifactBuild', installed.build);
        artifactBuild = installed.build;
        root = installed.path;
        hasFx = true;
        logLine('ok', `FX Artifact ${installed.build} → ${installed.path}`);
      } else if (hasFx) {
        artifactBuild = settingMap(db).fxArtifactBuild || artifactBuild;
      }
      if (hasFx && root) {
        const activeRow = getActiveOrbitServer(db);
        if (activeRow) {
          db.prepare('UPDATE orbit_servers SET fx_root = ? WHERE id = ?').run(root, activeRow.id);
        }
      }
    } catch (err) {
      nextSteps.push(`FX Build: unter Einstellungen → FX Builds installieren (${err.message})`);
    }

    const settingsAfter = settingMap(db);
    let serverStarted = false;
    try {
      const cfgFile = dataPath ? path.join(dataPath, 'server.cfg') : '';
      const integr = cfgFile && fs.existsSync(cfgFile)
        ? parseCfgIntegrations(fs.readFileSync(cfgFile, 'utf8'))
        : parseCfgIntegrations('');
      if (!/sv_licenseKey\s+"[^"]+"/i.test(fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : '')) {
        nextSteps.push('sv_licenseKey in server.cfg setzen');
      }
    } catch {
      nextSteps.push('server.cfg prüfen (License/MySQL)');
    }
    if (!mysqlReady(settingsAfter)) {
      nextSteps.push('mysql_connection_string in server.cfg setzen');
    }
    if (body.startServer !== false && (migratingTxAdmin || (licenseKey && mysqlReady(settingsAfter)))) {
      try {
        const active = getActiveOrbitServer(db);
        if (active) {
          await controlFx('start', buildSettingsForServer(db, active), logLine);
          serverStarted = true;
        }
      } catch (err) {
        nextSteps.push(`Autostart: ${err.message}`);
      }
    } else if (!serverStarted) {
      nextSteps.push('Server unter Einstellungen → Instanzen starten oder Command-Panel');
    }

    let panelUrl = ORIGIN;
    let panelRestart = false;
    const pa = body.panelAccess;
    if (pa && typeof pa === 'object' && me.role === 'owner') {
      try {
        const panelResult = await applyPanelAccess({
          mode: pa.mode === 'domain' ? 'domain' : 'port',
          panelPort: Number(pa.panelPort),
          publicHost: str(pa.publicHost, 64),
          domain: str(pa.domain, 253),
          stack: str(pa.stack, 16) || 'auto',
          https: pa.https !== false,
        }, logLine);
        panelUrl = panelResult.publicUrl;
        setSetting(db, 'orbitPublicUrl', panelResult.publicUrl);
        setSetting(db, 'panelAccessMode', panelResult.mode);
        setSetting(db, 'panelPort', String(panelResult.panelPort));
        for (const line of panelResult.nextSteps || []) nextSteps.push(line);
        schedulePanelServiceRestart();
        panelRestart = true;
        audit(db, me.username, 'setup.panel', panelResult.mode, ip);
      } catch (err) {
        nextSteps.push(`Panel-Zugang: ${err.message}`);
      }
    }

    audit(db, me.username, 'setup', deploy, ip);
    logLine('ok', `Serverprofil ${deploy}: ${hostname}`);
    const cfg = deploy === 'existing' ? '' : renderCfg({ name: hostname, project: project || hostname, port, maxClients: slots, locale, tags, onesync, recipe });
    return json(res, 200, {
      ok: true,
      imported,
      cfg,
      deploy,
      recipe,
      dataPath,
      artifactBuild,
      nextSteps,
      serverStarted,
      mysqlReady: mysqlReady(settingsAfter),
      panelUrl,
      panelRestart,
    });
  }

  if (method === 'GET' && pathname === '/api/stream') {
    if (!hasPerm(me, 'monitor') && !hasPerm(me, 'console')) return json(res, 403, { error: 'Keine Berechtigung.' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    let cursor = runtime.consoleSeq;
    let timer = null;
    const send = (event, data) => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clearInterval(timer);
      }
    };
    send('console', runtime.console.slice(-200));
    send('state', snapshot());
    timer = setInterval(() => {
      const fresh = runtime.console.filter((line) => line.id > cursor);
      if (fresh.length) {
        cursor = fresh[fresh.length - 1].id;
        send('console', fresh);
      }
      send('state', snapshot());
    }, 2000);
    req.on('close', () => clearInterval(timer));
    return;
  }

  if (method === 'GET' && pathname === '/api/overview') {
    if (!hasPerm(me, 'overview')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    const bans = db.prepare('SELECT COUNT(*) AS c FROM bans WHERE revoked = 0 AND (expires IS NULL OR expires > ?)').get(Date.now()).c;
    const warns = db.prepare('SELECT COUNT(*) AS c FROM warns').get().c;
    const whitelist = db.prepare('SELECT COUNT(*) AS c FROM whitelist').get().c;
    const liveSet = runtime.online && runtime.fxResources?.length
      ? new Set(runtime.fxResources)
      : null;
    const ctx = { serverOnline: runtime.online, liveStarted: liveSet };
    const resources = db.prepare('SELECT name, actual, desired FROM resources ORDER BY name LIMIT 12').all()
      .map((row) => ({ ...row, actual: resolveResourceActual(row, ctx) }));
    const resourceCount = db.prepare('SELECT COUNT(*) AS c FROM resources').get().c;
    const schedule = db.prepare('SELECT id, label, hhmm, enabled FROM schedule ORDER BY hhmm').all();
    const feed = db.prepare('SELECT id, user, action, detail, created FROM audit ORDER BY id DESC LIMIT 8').all();
    const queued = db.prepare('SELECT COUNT(*) AS c FROM queue WHERE status = ?').get('queued').c;
    return json(res, 200, {
      state: snapshot(),
      players: runtime.players,
      bans, warns, whitelist, resources, resourceCount, schedule, feed, queued,
      nextRestart: nextRestartInfo(),
      allowlistEnabled: settings.allowlistEnabled === '1',
      discordBot: settings.discordEnabled === '1',
      stats: playerStats(),
      brand: 'Orbit',
      versions: { orbit: '1.0.0', fx: runtime.fxVersion || 'b31689/Lin' },
    });
  }

  if (method === 'GET' && pathname === '/api/sidebar') {
    if (!hasPerm(me, 'overview') && !hasPerm(me, 'players')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    return json(res, 200, {
      hostname: runtime.hostname || settings.hostname || 'Roleplay',
      status: snapshot().status,
      online: runtime.online,
      clients: runtime.clients,
      players: runtime.players,
      onlineSince: runtime.onlineSince,
      nextRestart: nextRestartInfo(),
      allowlistEnabled: settings.allowlistEnabled === '1',
      discordBot: settings.discordEnabled === '1',
      controlEnabled: runtime.controlEnabled,
      versions: { orbit: '1.0.0', fx: runtime.fxVersion || 'b31689/Lin' },
    });
  }

  if (method === 'GET' && pathname === '/api/players') {
    if (!hasPerm(me, 'players')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const q = str(url.searchParams.get('q') || '', 64).toLowerCase();
    const mode = str(url.searchParams.get('mode') || 'online', 16);
    if (mode === 'history' || mode === 'all') {
      let rows = db.prepare('SELECT identifier, name, ping, ids, first_seen, last_seen, note, play_ms FROM players ORDER BY last_seen DESC LIMIT 400').all();
      if (q) rows = rows.filter((row) => `${row.name} ${row.identifier} ${row.note || ''}`.toLowerCase().includes(q));
      const settings = settingMap(db);
      return json(res, 200, {
        online: runtime.online,
        players: runtime.players,
        history: rows,
        stats: playerStats(),
        fxCommandReady: fxConsoleReady(settings),
        fxControlMode: orbitControlMode(settings),
      });
    }
    const settings = settingMap(db);
    return json(res, 200, {
      online: runtime.online,
      players: runtime.players,
      stats: playerStats(),
      fxCommandReady: fxConsoleReady(settings),
      fxControlMode: orbitControlMode(settings),
    });
  }

  if (method === 'POST' && pathname === '/api/players/action') {
    if (!hasPerm(me, 'players')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const action = str(body.action, 16);
    const reason = str(body.reason, 180);
    if (!['kick', 'warn', 'message'].includes(action) || reason.length < 2) {
      return json(res, 400, { error: 'Aktion oder Grund ungültig.' });
    }
    const playerId = Number(body.id);
    const player = runtime.players.find((p) => p.id === playerId);
    if (!player) return json(res, 404, { error: 'Spieler ist nicht online.' });
    const identifier = primaryId(player.identifiers);
    if (action === 'warn' && identifier) {
      db.prepare('INSERT INTO warns (identifier, name, reason, author, created) VALUES (?, ?, ?, ?, ?)')
        .run(identifier, player.name, reason, me.username, Date.now());
    }
    const settings = settingMap(db);
    if (!requireFxCommand(res, settings)) return;
    queueCommand(action, { id: playerId, name: player.name, identifier, reason }, me.username, ip);
    return json(res, 200, { ok: true, queued: true });
  }

  if (method === 'GET' && pathname === '/api/history') {
    if (!hasPerm(me, 'history')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const q = str(url.searchParams.get('q') || '', 64).toLowerCase();
    let rows = db.prepare('SELECT identifier, name, ping, ids, first_seen, last_seen, note FROM players ORDER BY last_seen DESC LIMIT 300').all();
    if (q) rows = rows.filter((row) => `${row.name} ${row.identifier} ${row.note || ''}`.toLowerCase().includes(q));
    return json(res, 200, { players: rows });
  }

  if (method === 'POST' && pathname === '/api/history/note') {
    if (!hasPerm(me, 'history')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const identifier = str(body.identifier, 80);
    const note = str(body.note, 240);
    if (!/^[\w:.\-@]{3,80}$/.test(identifier)) return json(res, 400, { error: 'Identifier ungültig.' });
    const changed = db.prepare('UPDATE players SET note = ? WHERE identifier = ?').run(note, identifier).changes;
    if (!changed) return json(res, 404, { error: 'Spieler unbekannt.' });
    audit(db, me.username, 'note', identifier, ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/bans') {
    if (!hasPerm(me, 'bans')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const rows = db.prepare('SELECT * FROM bans ORDER BY id DESC LIMIT 400').all();
    return json(res, 200, { bans: rows });
  }

  if (method === 'POST' && pathname === '/api/bans') {
    if (!hasPerm(me, 'bans')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const identifier = str(body.identifier, 80);
    const name = str(body.name, 64);
    const reason = str(body.reason, 180);
    const hours = Number(body.hours);
    if (!/^[\w:.\-@]{3,80}$/.test(identifier) || reason.length < 3) return json(res, 400, { error: 'Ban-Daten ungültig.' });
    if (![0, 2, 24, 168, 720].includes(hours)) return json(res, 400, { error: 'Dauer ungültig.' });
    const expires = hours === 0 ? null : Date.now() + hours * 3600_000;
    db.prepare('INSERT INTO bans (identifier, name, reason, author, expires, created, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)')
      .run(identifier, name, reason, me.username, expires, Date.now());
    const settings = settingMap(db);
    if (!requireFxCommand(res, settings)) return;
    queueCommand('ban', { identifier, name, reason, hours }, me.username, ip);
    return json(res, 200, { ok: true });
  }

  const revoke = pathname.match(/^\/api\/bans\/(\d+)\/revoke$/);
  if (method === 'POST' && revoke) {
    if (!hasPerm(me, 'bans') || me.role === 'moderator') return json(res, 403, { error: 'Keine Berechtigung.' });
    db.prepare('UPDATE bans SET revoked = 1 WHERE id = ?').run(Number(revoke[1]));
    audit(db, me.username, 'unban', revoke[1], ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/whitelist') {
    if (!hasPerm(me, 'whitelist')) return json(res, 403, { error: 'Keine Berechtigung.' });
    return json(res, 200, { entries: db.prepare('SELECT * FROM whitelist ORDER BY id DESC').all() });
  }

  if (method === 'POST' && pathname === '/api/whitelist') {
    if (!hasPerm(me, 'whitelist') || me.role === 'moderator') return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const identifier = str(body.identifier, 80);
    const note = str(body.note, 160);
    if (!/^[\w:.\-@]{3,80}$/.test(identifier)) return json(res, 400, { error: 'Identifier ungültig.' });
    try {
      db.prepare('INSERT INTO whitelist (identifier, note, author, created) VALUES (?, ?, ?, ?)').run(identifier, note, me.username, Date.now());
    } catch {
      return json(res, 409, { error: 'Identifier ist schon auf der Whitelist.' });
    }
    audit(db, me.username, 'whitelist.add', identifier, ip);
    return json(res, 200, { ok: true });
  }

  const wlDel = pathname.match(/^\/api\/whitelist\/(\d+)$/);
  if (method === 'DELETE' && wlDel) {
    if (!hasPerm(me, 'whitelist') || me.role === 'moderator') return json(res, 403, { error: 'Keine Berechtigung.' });
    db.prepare('DELETE FROM whitelist WHERE id = ?').run(Number(wlDel[1]));
    audit(db, me.username, 'whitelist.remove', wlDel[1], ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/resources') {
    if (!hasPerm(me, 'resources')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    try {
      syncResourcesFromDisk(db);
      lastResourceScan = Date.now();
    } catch (err) {
      logLine('warn', `Ressourcen-Scan: ${err.message}`);
    }
    const live = runtime.online && (runtime.fxResources?.length > 0)
      ? new Set(runtime.fxResources)
      : null;
    const groups = buildResourceGroups(db, live, runtime.online);
    const resources = groups.flatMap((g) => g.resources);
    return json(res, 200, {
      groups,
      resources,
      online: runtime.online,
      fxCommandReady: fxConsoleReady(settings),
      mysqlReady: mysqlReady(settings),
      resourceRoot: 'resources/',
      fxControlMode: orbitControlMode(settings),
    });
  }

  if (method === 'POST' && pathname === '/api/resources/action') {
    if (!hasPerm(me, 'resources')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const name = str(body.name, 64);
    const action = str(body.action, 16);
    if (!/^[a-zA-Z0-9_\-[\]]{1,64}$/.test(name) || !['start', 'stop', 'restart'].includes(action)) {
      return json(res, 400, { error: 'Ressource oder Aktion ungültig.' });
    }
    const row = db.prepare('SELECT name FROM resources WHERE name = ?').get(name);
    if (!row) return json(res, 404, { error: 'Ressource nicht in der server.cfg.' });
    const desired = action === 'stop' ? 'stopped' : 'started';
    const settings = settingMap(db);
    if (!requireFxCommand(res, settings)) return;
    db.prepare('UPDATE resources SET desired = ?, updated = ? WHERE name = ?').run(desired, Date.now(), name);
    queueCommand(`resource.${action}`, { name }, me.username, ip);
    return json(res, 200, { ok: true, queued: true });
  }

  if (method === 'GET' && pathname === '/api/schedule') {
    if (!hasPerm(me, 'schedule')) return json(res, 403, { error: 'Keine Berechtigung.' });
    return json(res, 200, { jobs: db.prepare('SELECT * FROM schedule ORDER BY hhmm').all() });
  }

  if (method === 'POST' && pathname === '/api/schedule') {
    if (!hasPerm(me, 'schedule')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const label = str(body.label, 48);
    const hhmm = str(body.hhmm, 5);
    if (label.length < 2 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return json(res, 400, { error: 'Zeitplan ungültig.' });
    db.prepare('INSERT INTO schedule (label, hhmm, enabled) VALUES (?, ?, 1)').run(label, hhmm);
    audit(db, me.username, 'schedule.add', `${label} ${hhmm}`, ip);
    return json(res, 200, { ok: true });
  }

  const sched = pathname.match(/^\/api\/schedule\/(\d+)$/);
  if (sched && (method === 'DELETE' || method === 'PATCH')) {
    if (!hasPerm(me, 'schedule')) return json(res, 403, { error: 'Keine Berechtigung.' });
    if (method === 'DELETE') db.prepare('DELETE FROM schedule WHERE id = ?').run(Number(sched[1]));
    else {
      const body = await readBody(req);
      db.prepare('UPDATE schedule SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, Number(sched[1]));
    }
    audit(db, me.username, 'schedule.update', sched[1], ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/audit') {
    if (!hasPerm(me, 'audit')) return json(res, 403, { error: 'Keine Berechtigung.' });
    return json(res, 200, { entries: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 400').all() });
  }

  if (method === 'GET' && pathname === '/api/queue') {
    if (!hasPerm(me, 'console')) return json(res, 403, { error: 'Keine Berechtigung.' });
    return json(res, 200, { items: db.prepare('SELECT * FROM queue ORDER BY id DESC LIMIT 80').all() });
  }

  if (method === 'POST' && pathname === '/api/console') {
    if (!hasPerm(me, 'console')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const command = str(body.command, 180);
    const settings = resolveConsoleSettings(db);
    if (!/^[a-zA-Z0-9_\-:.[\]'" ]{2,180}$/.test(command)) {
      return json(res, 400, { error: 'Befehl enthält ungültige Zeichen.' });
    }
    if (!requireFxCommand(res, settings)) return;
    queueCommand('console', { command }, me.username, ip);
    return json(res, 200, { ok: true, queued: true });
  }

  if (method === 'POST' && pathname === '/api/announce') {
    if (!hasPerm(me, 'control') && !hasPerm(me, 'console')) return json(res, 403, { error: 'Keine Berechtigung.' });
    if (!hit(`ann:${me.id}`, 12, 60_000)) return json(res, 429, { error: 'Zu viele Announcements.' });
    const body = await readBody(req);
    const message = str(body.message, 180);
    if (message.length < 2) return json(res, 400, { error: 'Nachricht zu kurz.' });
    const settings = resolveConsoleSettings(db);
    if (!requireFxCommand(res, settings)) return;
    queueCommand('console', { command: `say ${message}` }, me.username, ip);
    logLine('info', `Announce: ${message}`);
    return json(res, 200, { ok: true, queued: true });
  }

  if (method === 'GET' && pathname === '/api/cfg') {
    if (!hasPerm(me, 'cfg') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    try {
      const parsed = readCfg();
      let writable = false;
      try {
        fs.accessSync(parsed.path, fs.constants.W_OK);
        writable = true;
      } catch { writable = false; }
      return json(res, 200, {
        content: redactCfg(parsed.raw),
        path: parsed.path,
        writable,
        warnings: validateCfg(parsed.raw),
        resources: parsed.resources.length,
      });
    } catch (err) {
      return json(res, 500, { error: `CFG nicht lesbar: ${err.message}` });
    }
  }

  if (method === 'PUT' && pathname === '/api/cfg') {
    if (!hasPerm(me, 'cfg') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    if (!hit(`cfg:${me.id}`, 6, 60_000)) return json(res, 429, { error: 'Zu viele CFG-Schreibvorgänge.' });
    const body = await readBody(req, 600_000);
    const content = typeof body.content === 'string' ? body.content : '';
    const errors = validateCfg(content);
    if (errors.length) return json(res, 400, { error: errors[0], errors });
    let original = '';
    try {
      original = readCfg().raw;
    } catch (err) {
      return json(res, 500, { error: `Original-CFG nicht lesbar: ${err.message}` });
    }
    const merged = mergeCfgSecrets(original, content);
    try {
      writeCfg(merged);
    } catch (err) {
      const draft = path.join(DATA_DIR, 'server.cfg.draft');
      try {
        fs.writeFileSync(draft, merged, 'utf8');
      } catch { /* ignore */ }
      return json(res, 403, {
        error: `Schreiben fehlgeschlagen (${err.code || err.message}). Draft unter data/server.cfg.draft gespeichert.`,
        draft: true,
      });
    }
    const parsed = parseServerCfgSafe(merged);
    const now = Date.now();
    const insert = db.prepare('INSERT OR IGNORE INTO resources (name, actual, updated) VALUES (?, ?, ?)');
    for (const name of parsed.resources) insert.run(name, 'unknown', now);
    audit(db, me.username, 'cfg.save', `${merged.length} bytes`, ip);
    logLine('ok', `${me.username} hat server.cfg gespeichert.`);
    return json(res, 200, { ok: true, resources: parsed.resources.length });
  }

  if (method === 'GET' && pathname === '/api/console/download') {
    if (!hasPerm(me, 'console')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const text = runtime.console.map((l) => `[${new Date(l.t).toISOString()}] ${l.level} ${l.text}`).join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="orbit-console.log"',
      'Cache-Control': 'no-store',
    });
    res.end(text);
    return;
  }

  if (method === 'GET' && pathname === '/api/orbit-server') {
    if (!hasPerm(me, 'settings')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    return json(res, 200, { profile: orbitServerProfile(settings) });
  }

  if (method === 'POST' && pathname === '/api/orbit-server') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur der Inhaber kann einen Orbit-Server anlegen.' });
    const body = await readBody(req);
    const name = str(body.name, 80);
    const port = body.port !== undefined ? Number(body.port) : Number(settingMap(db).fivemPort || 30120);
    const maxClients = body.maxClients !== undefined ? Number(body.maxClients) : Number(settingMap(db).maxClients || 48);
    try {
      const { result, row } = createAndActivateOrbitServer(db, {
        name,
        port,
        maxClients,
        project: str(body.project, 80) || name,
        locale: str(body.locale, 12) || 'de-DE',
        tags: str(body.tags, 120) || 'roleplay, german',
        onesync: body.onesync === 'off' ? 'off' : body.onesync === 'legacy' ? 'legacy' : 'on',
        fxServerRoot: str(body.fxServerRoot, 256) || settingMap(db).fxServerRoot,
      });
      const count = syncResourcesFromDisk(db);
      runtime.hostname = result.settings.hostname;
      runtime.maxClients = maxClients;
      audit(db, me.username, 'orbit-server.create', result.orbitServerSlug, ip);
      logLine('ok', `Orbit-Server „${result.orbitServerName}“ → ${result.fxDataPath}`);
      return json(res, 200, {
        ok: true,
        profile: orbitServerProfile(settingMap(db)),
        server: row,
        resources: count,
        dataPath: result.fxDataPath,
      });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/server/status') {
    if (!hasPerm(me, 'overview') && !hasPerm(me, 'control')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    const profile = orbitServerProfile(settings);
    return json(res, 200, {
      online: runtime.online,
      unitActive: runtime.unitActive,
      controlEnabled: runtime.controlEnabled,
      controlPhase: runtime.controlPhase,
      status: snapshot().status,
      clients: runtime.clients,
      maxClients: runtime.maxClients || Number(settings.maxClients) || 48,
      hostname: runtime.hostname || settings.hostname,
      serverLabel: settings.serverLabel || profile.name || settings.hostname || 'Game Server',
      orbitServer: profile,
      fxCommandReady: fxConsoleReady(settings),
      mysqlReady: mysqlReady(settings),
      fxControlMode: orbitControlMode(settings),
      supervisorPhase: orbitControlMode(settings) === 'orbit' ? supervisorPhase() : 'n/a',
    });
  }

  if (method === 'POST' && pathname === '/api/server/control') {
    if (!hasPerm(me, 'control')) return json(res, 403, { error: 'Keine Berechtigung.' });
    if (!hit(`ctl:${me.id}`, 8, 60_000)) return json(res, 429, { error: 'Zu viele Steuerungsbefehle.' });
    const body = await readBody(req);
    const action = str(body.action, 16);
    if (!['start', 'stop', 'restart'].includes(action)) {
      return json(res, 400, { error: 'Aktion muss start, stop oder restart sein.' });
    }
    const settings = settingMap(db);
    if (runtime.controlPhase !== 'idle') {
      return json(res, 409, { error: 'Ein Steuerungsbefehl läuft bereits.' });
    }
    runtime.controlPhase = action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting';
    logLine('info', `${me.username} → Server ${action}`);
    audit(db, me.username, `server.${action}`, '', ip);
    try {
      await controlFx(action, settings, logLine);
      const via = orbitControlMode(settings) === 'orbit' ? 'Orbit FXServer' : FX_UNIT;
      logLine('ok', `${action} → ${via}`);
      notifyServerEvent(settings, `Server ${action}`, `${settings.hostname || 'Server'} via ${via}`).catch(() => {});
      return json(res, 200, { ok: true, action, phase: runtime.controlPhase });
    } catch (err) {
      runtime.controlPhase = 'idle';
      logLine('bad', `Server-${action} fehlgeschlagen: ${err.message}`);
      return json(res, 500, { error: `Steuerung fehlgeschlagen: ${err.message}` });
    }
  }

  if (method === 'GET' && pathname === '/api/admins') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur der Inhaber verwaltet das Team.' });
    const users = db.prepare('SELECT id, username, role, disabled, totp_enabled, created, last_login FROM users ORDER BY id').all();
    return json(res, 200, { users });
  }

  if (method === 'POST' && pathname === '/api/admins') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const username = str(body.username, 24);
    const password = typeof body.password === 'string' ? body.password : '';
    const role = str(body.role, 16);
    if (!userOk(username) || !passwordOk(password) || !['admin', 'moderator'].includes(role)) {
      return json(res, 400, { error: 'Benutzer, Passwort oder Rolle ungültig.' });
    }
    try {
      const hash = await hashPassword(password);
      db.prepare('INSERT INTO users (username, password_hash, role, must_change, created) VALUES (?, ?, ?, 1, ?)')
        .run(username, hash, role, Date.now());
    } catch {
      return json(res, 409, { error: 'Benutzername ist vergeben.' });
    }
    audit(db, me.username, 'admin.add', `${username}:${role}`, ip);
    return json(res, 200, { ok: true });
  }

  const adminId = pathname.match(/^\/api\/admins\/(\d+)$/);
  if (adminId && (method === 'PATCH' || method === 'DELETE')) {
    if (me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const id = Number(adminId[1]);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target || target.role === 'owner') return json(res, 400, { error: 'Dieser Account kann so nicht geändert werden.' });
    if (method === 'DELETE') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      audit(db, me.username, 'admin.remove', target.username, ip);
    } else {
      const body = await readBody(req);
      const disabled = body.disabled ? 1 : 0;
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled, id);
      if (disabled) db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(id);
      audit(db, me.username, disabled ? 'admin.disable' : 'admin.enable', target.username, ip);
    }
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/settings') {
    if (!hasPerm(me, 'settings')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    return json(res, 200, {
      settings: {
        hostname: settings.hostname || '',
        project: settings.project || '',
        fivemHost: settings.fivemHost || '127.0.0.1',
        fivemPort: settings.fivemPort || '30120',
        controlEnabled: settings.controlEnabled !== '0',
        ipAllowlist: me.role === 'owner' ? (settings.ipAllowlist || '') : '',
        maxClients: settings.maxClients || '48',
        tags: settings.tags || '',
        locale: settings.locale || 'de-DE',
        onesync: settings.onesync === 'off' || settings.onesync === 'legacy' ? settings.onesync : 'on',
        gameBuild: settings.gameBuild || '',
        allowlistEnabled: settings.allowlistEnabled === '1',
        discordEnabled: settings.discordEnabled === '1',
        discordNotifyDrops: settings.discordNotifyDrops === '1',
        discordBotEnabled: settings.discordBotEnabled === '1',
        discordBotConfigured: Boolean(settings.discordBotToken),
        discordWebhook: me.role === 'owner' ? (settings.discordWebhook || '') : '',
        discordGuild: settings.discordGuild || '',
        fxCommandReady: fxConsoleReady(settings),
        mysqlReady: mysqlReady(settings),
        rconConfigured: Boolean(settings.rconPassword),
        rconPort: settings.rconPort || '',
        fxControlMode: settings.fxControlMode === 'orbit' ? 'orbit' : 'systemd',
        fxServerRoot: me.role === 'owner' ? (settings.fxServerRoot || '') : '',
        fxDataPath: me.role === 'owner' ? (settings.fxDataPath || '') : '',
        fxServerExtraArgs: me.role === 'owner' ? (settings.fxServerExtraArgs || '') : '',
        orbitServerName: settings.orbitServerName || '',
        orbitServerSlug: settings.orbitServerSlug || '',
        serverLabel: settings.serverLabel || settings.hostname || '',
        orbitServersRoot: me.role === 'owner' ? (settings.orbitServersRoot || ORBIT_SERVERS_ROOT) : '',
        consoleTargetServerId: me.role === 'owner' ? (settings.consoleTargetServerId || '') : '',
        autoRestartEnabled: settings.autoRestartEnabled !== '0',
      },
    });
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    if (!hasPerm(me, 'settings')) return json(res, 403, { error: 'Keine Berechtigung.' });
    const body = await readBody(req);
    const hostname = str(body.hostname, 80);
    const project = str(body.project, 80);
    const fivemHost = str(body.fivemHost, 64);
    const fivemPort = Number(body.fivemPort);
    if (hostname.length < 2) return json(res, 400, { error: 'Hostname fehlt.' });
    if (fivemHost !== '127.0.0.1') return json(res, 400, { error: 'FiveM-Host muss 127.0.0.1 bleiben.' });
    if (!Number.isInteger(fivemPort) || fivemPort < 1 || fivemPort > 65535) return json(res, 400, { error: 'Port ungültig.' });
    let allow = '';
    if (me.role === 'owner') {
      allow = str(body.ipAllowlist, 500);
      if (allow && !allow.split(/[\s,]+/).every((item) => /^[\d.:a-fA-F]{3,45}$/.test(item))) {
        return json(res, 400, { error: 'Allowlist enthält keine gültige IP.' });
      }
    }
    setSetting(db, 'hostname', hostname);
    setSetting(db, 'project', project);
    setSetting(db, 'fivemHost', fivemHost);
    setSetting(db, 'fivemPort', fivemPort);
    setSetting(db, 'allowlistEnabled', body.allowlistEnabled ? '1' : '0');
    const onesync = body.onesync === 'off' ? 'off' : body.onesync === 'legacy' ? 'legacy' : 'on';
    setSetting(db, 'onesync', onesync);
    const maxSlots = Number(body.maxClients);
    if (Number.isInteger(maxSlots) && maxSlots >= 1 && maxSlots <= 2048) {
      setSetting(db, 'maxClients', String(maxSlots));
      runtime.maxClients = maxSlots;
    }
    setSetting(db, 'tags', str(body.tags || '', 200));
    setSetting(db, 'locale', str(body.locale || 'de-DE', 16));
    const gameBuild = str(body.gameBuild || '', 8);
    if (gameBuild && !/^\d{4,5}$/.test(gameBuild)) {
      return json(res, 400, { error: 'Game Build ungültig.' });
    }
    setSetting(db, 'gameBuild', gameBuild);
    if (me.role === 'owner') {
      if (body.controlEnabled === false) setSetting(db, 'controlEnabled', '0');
      else setSetting(db, 'controlEnabled', '1');
      setSetting(db, 'ipAllowlist', allow);
      setSetting(db, 'discordEnabled', body.discordEnabled ? '1' : '0');
      setSetting(db, 'discordNotifyDrops', body.discordNotifyDrops ? '1' : '0');
      const webhook = str(body.discordWebhook || '', 300);
      if (webhook && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook)) {
        return json(res, 400, { error: 'Discord-Webhook ungültig.' });
      }
      setSetting(db, 'discordWebhook', webhook);
      setSetting(db, 'discordGuild', str(body.discordGuild || '', 64));
      setSetting(db, 'discordBotEnabled', body.discordBotEnabled ? '1' : '0');
      const botTok = str(body.discordBotToken || '', 200);
      if (botTok) setSetting(db, 'discordBotToken', botTok);
      const rconPort = Number(body.rconPort);
      if (body.rconPort !== undefined && body.rconPort !== '' && (!Number.isInteger(rconPort) || rconPort < 1 || rconPort > 65535)) {
        return json(res, 400, { error: 'RCON-Port ungültig.' });
      }
      if (Number.isInteger(rconPort)) setSetting(db, 'rconPort', String(rconPort));
      const rconPw = str(body.rconPassword || '', 128);
      if (rconPw) setSetting(db, 'rconPassword', rconPw);
      const mode = body.fxControlMode === 'orbit' ? 'orbit' : 'systemd';
      setSetting(db, 'fxControlMode', mode);
      const fxRoot = str(body.fxServerRoot || '', 256);
      const fxData = str(body.fxDataPath || '', 256);
      const fxExtra = str(body.fxServerExtraArgs || '', 400);
      if (fxRoot) setSetting(db, 'fxServerRoot', fxRoot);
      if (fxData) setSetting(db, 'fxDataPath', fxData);
      if (body.autoRestartEnabled === false) setSetting(db, 'autoRestartEnabled', '0');
      else if (body.autoRestartEnabled === true) setSetting(db, 'autoRestartEnabled', '1');
      syncActiveCfgPath(settingMap(db));
      setSetting(db, 'fxServerExtraArgs', fxExtra);
    }
    try {
      const map = settingMap(db);
      persistFivemCfgFromSettings(map);
    } catch (err) {
      return json(res, 500, { error: `server.cfg: ${err.message}` });
    }
    audit(db, me.username, 'settings', '', ip);
    if (me.role === 'owner') {
      refreshDiscordBot(settingMap(db)).catch((e) => logLine('warn', `Discord-Bot: ${e.message}`));
    }
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/settings/rcon-test') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    if (!fxConsoleReady(settings)) return json(res, 400, { error: 'Keine Konsole (Orbit-Prozess oder RCON).' });
    try {
      const { sendFxCommand } = await import('./rcon.js');
      const out = await sendFxCommand(settings, 'status');
      return json(res, 200, { ok: true, message: out ? String(out).slice(0, 200) : 'RCON OK.' });
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/database/meta') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert (mysql_connection_string in server.cfg).' });
    try {
      const meta = await getDatabaseMeta(settings);
      return json(res, 200, meta);
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/database/tables') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert (mysql_connection_string in server.cfg).' });
    try {
      const tables = await listTables(settings);
      return json(res, 200, { tables });
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/database/overview') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert.' });
    try {
      const tables = await databaseOverview(settings);
      return json(res, 200, { tables });
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/database/search') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    if (!hit(`sql:${me.id}`, 40, 60_000)) return json(res, 429, { error: 'Zu viele Abfragen.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert.' });
    const body = await readBody(req);
    const table = str(body.table, 128);
    const column = str(body.column, 128);
    const q = str(body.q, 200);
    if (!table || !column) return json(res, 400, { error: 'Tabelle und Spalte erforderlich.' });
    try {
      const result = await searchTable(settings, table, column, q, body.limit);
      audit(db, me.username, 'sql.search', `${table}.${column}`, ip);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/database/structure') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert.' });
    const table = str(url.searchParams.get('table') || '', 128);
    if (!table) return json(res, 400, { error: 'Tabellenname fehlt.' });
    try {
      const columns = await tableStructure(settings, table);
      return json(res, 200, { table, columns });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/database/browse') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert.' });
    const table = str(url.searchParams.get('table') || '', 128);
    if (!table) return json(res, 400, { error: 'Tabellenname fehlt.' });
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 25);
    try {
      const result = await browseTable(settings, table, offset, limit);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/database/query') {
    if (!hasPerm(me, 'database') && me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    if (!hit(`sql:${me.id}`, 30, 60_000)) return json(res, 429, { error: 'Zu viele Abfragen.' });
    const settings = settingMap(db);
    if (!mysqlReady(settings)) return json(res, 503, { error: 'MySQL nicht konfiguriert.' });
    const body = await readBody(req);
    const sql = str(body.sql, 8000);
    const ownerSql = me.role === 'owner';
    try {
      const result = ownerSql
        ? await runOwnerQuery(settings, sql, body.limit)
        : await runSelect(settings, sql, body.limit);
      audit(db, me.username, ownerSql ? 'sql.exec' : 'sql.select', sql.slice(0, 120), ip);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/settings/reset-setup') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Nur Inhaber.' });
    const body = await readBody(req);
    if (body.confirm !== true && body.confirm !== '1') {
      return json(res, 400, { error: 'Bestätigung fehlt (confirm: true).' });
    }
    const settings = settingMap(db);
    try {
      if (orbitControlMode(settings) === 'orbit') {
        await stopFxProcess(settings, logLine, { stopAll: true });
      } else {
        await controlFx('stop', settings, logLine).catch(() => {});
      }
    } catch (err) {
      logLine('warn', `Setup-Reset: FX stop — ${err.message}`);
    }
    setSetting(db, 'setupDone', '0');
    audit(db, me.username, 'setup.reset', '', ip);
    logLine('info', 'Einrichtung zurückgesetzt — Wizard erneut verfügbar.');
    return json(res, 200, { ok: true, setup: false });
  }

  if (method === 'POST' && pathname === '/api/settings/rescan') {
    if (me.role !== 'owner') return json(res, 403, { error: 'Keine Berechtigung.' });
    let parsed;
    try {
      parsed = readCfg();
    } catch {
      return json(res, 500, { error: 'server.cfg konnte nicht gelesen werden.' });
    }
    syncCfgSecrets(parsed);
    const count = syncResourcesFromDisk(db);
    lastResourceScan = Date.now();
    if (parsed.pub.hostname) setSetting(db, 'hostname', parsed.pub.hostname);
    if (parsed.pub.maxClients) setSetting(db, 'maxClients', parsed.pub.maxClients);
    if (parsed.pub.project) setSetting(db, 'project', parsed.pub.project);
    if (parsed.pub.tags) setSetting(db, 'tags', parsed.pub.tags);
    if (parsed.pub.locale) setSetting(db, 'locale', parsed.pub.locale);
    if (parsed.pub.onesync) setSetting(db, 'onesync', parsed.pub.onesync);
    if (parsed.pub.gameBuild) setSetting(db, 'gameBuild', parsed.pub.gameBuild);
    audit(db, me.username, 'rescan', String(count), ip);
    return json(res, 200, { ok: true, count });
  }

  if (method === 'POST' && pathname === '/api/auth/password') {
    const body = await readBody(req);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';
    if (!passwordOk(next)) return json(res, 400, { error: 'Neues Passwort: mindestens 6 Zeichen.' });
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
    if (!(await verifyPassword(current, row.password_hash))) return json(res, 401, { error: 'Aktuelles Passwort stimmt nicht.' });
    db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(await hashPassword(next), me.id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(me.id, me.sid);
    audit(db, me.username, 'password', '', ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/auth/totp/setup') {
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, me.id);
    const label = encodeURIComponent(`TX2:${me.username}`);
    return json(res, 200, { secret, url: `otpauth://totp/${label}?secret=${secret}&issuer=TX2&digits=6&period=30` });
  }

  if (method === 'POST' && pathname === '/api/auth/totp/enable') {
    const body = await readBody(req);
    const row = db.prepare('SELECT totp_pending FROM users WHERE id = ?').get(me.id);
    if (!row?.totp_pending || !verifyTotp(row.totp_pending, body.code)) return json(res, 400, { error: 'Code ungültig.' });
    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_pending = NULL WHERE id = ?').run(row.totp_pending, me.id);
    audit(db, me.username, 'totp.on', '', ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/auth/totp/disable') {
    const body = await readBody(req);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
    if (!(await verifyPassword(body.password || '', row.password_hash)) || !verifyTotp(row.totp_secret, body.code)) {
      return json(res, 401, { error: 'Passwort oder Code ungültig.' });
    }
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL WHERE id = ?').run(me.id);
    audit(db, me.username, 'totp.off', '', ip);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/sessions') {
    if (!hasPerm(me, 'sessions') && me.role !== 'owner' && me.role !== 'admin') return json(res, 403, { error: 'Keine Berechtigung.' });
    const rows = db.prepare(`
      SELECT id, ip, ua, created, last_seen, expires FROM sessions
      WHERE user_id = ? AND revoked = 0 AND expires > ? ORDER BY last_seen DESC
    `).all(me.id, Date.now());
    return json(res, 200, { sessions: rows.map((row) => ({ ...row, current: row.id === me.sid })) });
  }

  const sessDel = pathname.match(/^\/api\/sessions\/(\d+)$/);
  if (method === 'DELETE' && sessDel) {
    const id = Number(sessDel[1]);
    if (id === me.sid) return json(res, 400, { error: 'Die aktuelle Sitzung beendest du über Abmelden.' });
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?').run(id, me.id);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Nicht gefunden.' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serveStatic(req, res, url) {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: 'Bad request' });
  }
  if (pathname.includes('\0')) return json(res, 400, { error: 'Bad request' });
  const rel = pathname.replace(/^\/+/, '');
  const filePath = path.resolve(dist, rel);
  if (filePath !== path.join(dist, 'index.html') && filePath !== dist && !filePath.startsWith(`${dist}${path.sep}`)) {
    return json(res, 403, { error: 'Forbidden' });
  }
  let target = filePath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(dist, 'index.html');
  if (!fs.existsSync(target)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('TX2 wird noch gebaut.');
    return;
  }
  const ext = path.extname(target);
  const cache = target.endsWith(`${path.sep}index.html`) || ext === '.html'
    ? 'no-store'
    : 'public, max-age=31536000, immutable';
  const secure = res._orbitSecure === true;
  const sec = extraSecurityHeaders(secure);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    ...sec,
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    res._orbitSecure = requestIsSecure(req);
    const url = new URL(req.url || '/', `http://${HOST}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Interner Fehler.' : 'Anfrage abgelehnt.' });
  }
});

const boot = (async () => {
  dummyHash = await hashPassword('tx2-timing-pad-not-a-login');
  initPlatform(db);
  setDiscordBotDeps({
    settingMap: () => settingMap(db),
    getRuntime: () => runtime,
    probeFiveM,
  });
  setLogHook((level, text) => {
    const drop = parseDropFromLogLine(text);
    if (!drop) return;
    recordDrop(db, drop);
    notifyPlayerDrop(settingMap(db), drop).catch(() => {});
  });
  syncActiveCfgPath(settingMap(db));
  if (settingMap(db).controlEnabled === '0') {
    setSetting(db, 'controlEnabled', '1');
  }
  try {
    ensureIngameToken(db);
    const s = settingMap(db);
    syncOrbitSystemResource(s.fxServerRoot || FX_SERVER_ROOT, s.fxDataPath || '', (t) => logLine('info', t));
    if (supervisorConsoleReady(s)) {
      hotDeployOrbit(db, (cmd) => sendSupervisorCommand(s, cmd), s.fxServerRoot, s.fxDataPath, (t) => logLine('info', t));
    }
  } catch (err) {
    logLine('warn', `orbit boot: ${err.message}`);
  }
  try {
    syncCfgSecrets(readCfg());
  } catch { /* cfg noch nicht lesbar */ }
  logLine('info', `Orbit bereit — API-TLS: ${REQUIRE_TLS ? 'erforderlich (HTTPS)' : 'relax'}.`);
  refreshDiscordBot(settingMap(db)).catch((e) => logLine('warn', `Discord-Bot: ${e.message}`));
  await loop();
  setInterval(loop, 2000);
  server.listen(PORT, HOST, () => {
    console.log(`Orbit hört auf http://${HOST}:${PORT}`);
    printBootstrapBanner(db).catch(() => {});
  });
})();

boot.catch((err) => {
  console.error(err);
  process.exit(1);
});
