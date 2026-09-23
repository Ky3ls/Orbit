import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { FX_SERVER_ROOT } from './config.js';
import { FX_UNIT } from './control.js';
import { parseCfgIntegrations, parseServerCfg } from './fivem.js';
import { slugifyServerName } from './orbitServer.js';
import {
  activateOrbitServer,
  applyServerToSettings,
  listOrbitServers,
} from './orbitServersDb.js';
import { syncOrbitBridgeToDataPath } from './orbitBridgeSync.js';
import { setSetting } from './db.js';
import { importTxAdminModeration, playersDbPathForProfile } from './txAdminPlayersDb.js';

const exec = promisify(execFile);
const TX2_USER = process.env.ORBIT_USER || 'tx2';

const TXADMIN_UNITS = [
  'fivem-txadmin.service',
  'txadmin.service',
  'fxserver-txadmin.service',
];

const TXDATA_CANDIDATES = [
  () => process.env.TXADMIN_DATA_PATH,
  () => process.env.TXDATA_PATH,
  () => path.join(FX_SERVER_ROOT, 'txData'),
  '/root/RoleplayServer/txData',
  '/root/txData',
  '/home/fivem/txData',
  '/opt/fivem/txData',
];

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

async function unitState(unit) {
  let enabled = false;
  let active = false;
  try {
    const en = await exec('systemctl', ['is-enabled', unit], { timeout: 4000 });
    enabled = ['enabled', 'static'].includes(String(en.stdout).trim());
  } catch { /* */ }
  try {
    const ac = await exec('systemctl', ['is-active', unit], { timeout: 4000 });
    active = String(ac.stdout).trim() === 'active';
  } catch { /* */ }
  return { unit, enabled, active, present: enabled || active };
}

function pathsFromSystemdUnit(text) {
  const out = { fxRoot: '', txData: '', execStart: '' };
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (t.startsWith('ExecStart=')) out.execStart = t.slice(10).trim();
    const env = t.match(/^Environment=(.+)$/);
    if (env) {
      for (const part of env[1].split(/\s+/)) {
        const m = part.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m) continue;
        if (/TX|DATA|FX|FIVEM/i.test(m[1]) && m[2].includes('txData')) out.txData = m[2].replace(/^"|"$/g, '');
      }
    }
  }
  if (out.execStart.includes('txData')) {
    const m = out.execStart.match(/([^\s'"]+txData[^\s'"]*)/);
    if (m) out.txData = m[1];
  }
  return out;
}

function extractTxPathsFromCmdline(cmd) {
  const roots = new Set();
  const text = String(cmd || '');
  const txDataSet = text.match(/\+set\s+txDataPath\s+([^\s]+)/i);
  if (txDataSet) roots.add(path.resolve(txDataSet[1].replace(/['"]/g, '')));
  const profile = text.match(/\+set\s+serverProfile\s+(\S+)/i)?.[1]?.replace(/['"]/g, '');
  for (const m of text.matchAll(/([^\s'"]+txData[^\s'"]*)/gi)) {
    const p = path.resolve(m[1]);
    if (fs.existsSync(p)) roots.add(p);
    if (profile) {
      const profDir = path.join(p, profile);
      if (fs.existsSync(path.join(profDir, 'server.cfg'))) roots.add(p);
    }
  }
  const fxBin = text.match(/([^\s]+)\/alpine\/opt\/cfx-server\/FXServer/);
  if (fxBin) {
    const infer = path.resolve(path.dirname(fxBin[1]), '../../../txData');
    if (fs.existsSync(infer)) roots.add(infer);
  }
  return roots;
}

async function discoverTxDataFromProcesses() {
  const roots = new Set();
  try {
    const { stdout } = await exec('pgrep', ['-af', 'FXServer'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    for (const line of String(stdout).split('\n')) {
      for (const r of extractTxPathsFromCmdline(line)) roots.add(r);
    }
  } catch { /* */ }
  try {
    const { stdout } = await exec('pgrep', ['-af', 'txAdmin'], { timeout: 5000, maxBuffer: 1024 * 1024 });
    for (const line of String(stdout).split('\n')) {
      for (const r of extractTxPathsFromCmdline(line)) roots.add(r);
    }
  } catch { /* */ }
  try {
    for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const buf = fs.readFileSync(`/proc/${pid}/cmdline`);
        const cmd = buf.toString('utf8').replace(/\0/g, ' ');
        if (!/FXServer|txAdmin|cfx-server/i.test(cmd)) continue;
        for (const r of extractTxPathsFromCmdline(cmd)) roots.add(r);
      } catch { /* */ }
    }
  } catch { /* */ }
  return [...roots].filter((p) => fs.existsSync(p));
}

async function discoverTxDataRoots() {
  const roots = new Set();
  for (const cand of TXDATA_CANDIDATES) {
    const p = typeof cand === 'function' ? cand() : cand;
    if (!p) continue;
    const abs = path.resolve(String(p));
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) roots.add(abs);
  }
  for (const unit of TXADMIN_UNITS) {
    const unitPath = `/etc/systemd/system/${unit}`;
    const text = readFileSafe(unitPath);
    if (!text) continue;
    const parsed = pathsFromSystemdUnit(text);
    if (parsed.txData && fs.existsSync(parsed.txData)) roots.add(path.resolve(parsed.txData));
  }
  for (const p of await discoverTxDataFromProcesses()) roots.add(p);
  return [...roots];
}

function resolveFxServerRoot(txDataRoot) {
  const parent = path.dirname(txDataRoot);
  const tryRoots = [parent, FX_SERVER_ROOT, '/root/RoleplayServer', '/home/fivem/server', '/opt/fivem'];
  for (const root of tryRoots) {
    if (!root) continue;
    const bin = path.join(root, 'alpine/opt/cfx-server/FXServer');
    if (fs.existsSync(bin)) return root.replace(/\/$/, '');
  }
  return FX_SERVER_ROOT.replace(/\/$/, '');
}

function parseGamePortFromCfg(text) {
  const m = String(text).match(/endpoint_add_tcp\s+"[^"]*:(\d+)"/i)
    || String(text).match(/endpoint_add_udp\s+"[^"]*:(\d+)"/i);
  return m ? Number(m[1]) : 30120;
}

export function discoverTxAdminServers(txDataRoot) {
  const servers = [];
  const rootCfg = path.join(txDataRoot, 'server.cfg');
  if (fs.existsSync(rootCfg)) {
    servers.push({
      profile: path.basename(txDataRoot),
      dataPath: txDataRoot,
      cfgPath: rootCfg,
      playersDbPath: playersDbPathForProfile(txDataRoot),
    });
  }
  for (const name of fs.readdirSync(txDataRoot)) {
    if (name.startsWith('.') || name === 'admins.json') continue;
    const dir = path.join(txDataRoot, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const cfgPath = path.join(dir, 'server.cfg');
    if (!fs.existsSync(cfgPath)) continue;
    servers.push({
      profile: name,
      dataPath: dir,
      cfgPath,
      playersDbPath: playersDbPathForProfile(dir),
    });
  }
  return servers;
}

function uniqueSlugDb(db, slug) {
  let candidate = slug;
  let n = 2;
  while (db.prepare('SELECT id FROM orbit_servers WHERE slug = ?').get(candidate)) {
    candidate = `${slug}-${n}`;
    n += 1;
    if (n > 99) throw new Error('Zu viele Server-Slugs.');
  }
  return candidate;
}

function importExistingOrbitServer(db, { name, slug, dataPath, fxRoot, port, maxClients }) {
  const existing = db.prepare('SELECT * FROM orbit_servers WHERE data_path = ?').get(dataPath);
  if (existing) return existing;
  const slugFinal = uniqueSlugDb(db, slugifyServerName(slug || name));
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO orbit_servers (slug, name, data_path, fx_root, port, max_clients, is_active, created)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(slugFinal, name, dataPath, fxRoot || '', port, maxClients, now);
  return db.prepare('SELECT * FROM orbit_servers WHERE id = ?').get(info.lastInsertRowid);
}

function applyCfgToSettings(db, cfgText) {
  const parsed = parseServerCfg(cfgText);
  const pub = parsed.pub;
  if (pub.hostname) setSetting(db, 'hostname', pub.hostname);
  if (pub.project) setSetting(db, 'project', pub.project);
  if (pub.tags) setSetting(db, 'tags', pub.tags);
  if (pub.locale) setSetting(db, 'locale', pub.locale);
  if (pub.onesync) setSetting(db, 'onesync', pub.onesync);
  if (pub.gameBuild) setSetting(db, 'gameBuild', pub.gameBuild);
  if (pub.maxClients) setSetting(db, 'maxClients', String(pub.maxClients));
  const integr = parseCfgIntegrations(cfgText);
  if (integr.mysqlDsn) setSetting(db, 'mysqlDsn', integr.mysqlDsn);
  if (integr.rconPassword) setSetting(db, 'rconPassword', integr.rconPassword);
  return pub;
}

async function ensureDataPathAcl(dataPaths, fxRoot, logLine) {
  for (const dp of dataPaths) {
    try {
      await exec('sudo', ['-n', 'setfacl', '-R', '-m', `u:${TX2_USER}:rwx`, dp], { timeout: 120_000 });
      await exec('sudo', ['-n', 'setfacl', '-R', '-d', '-m', `u:${TX2_USER}:rwx`, dp], { timeout: 120_000 });
    } catch (err) {
      logLine('warn', `ACL ${dp}: ${err.message}`);
    }
  }
  if (fxRoot && fs.existsSync(fxRoot)) {
    try {
      await exec('sudo', ['-n', 'setfacl', '-m', `u:${TX2_USER}:rx`, fxRoot], { timeout: 30_000 });
      const alpine = path.join(fxRoot, 'alpine');
      if (fs.existsSync(alpine)) {
        await exec('sudo', ['-n', 'setfacl', '-R', '-m', `u:${TX2_USER}:rx`, alpine], { timeout: 120_000 });
      }
    } catch (err) {
      logLine('warn', `ACL FX-Root: ${err.message}`);
    }
  }
}

async function disableTxAdmin(logLine) {
  const stopped = [];
  for (const unit of TXADMIN_UNITS) {
    try {
      const st = await unitState(unit);
      if (!st.present && !st.active) continue;
      await exec('sudo', ['-n', 'systemctl', 'stop', unit], { timeout: 60_000 }).catch(() => {});
      await exec('sudo', ['-n', 'systemctl', 'disable', unit], { timeout: 30_000 }).catch(() => {});
      stopped.push(unit);
      logLine('ok', `${unit} gestoppt und deaktiviert.`);
    } catch { /* */ }
  }
  if (FX_UNIT && FX_UNIT !== 'tx2.service') {
    try {
      const st = await unitState(FX_UNIT);
      if (st.active || st.enabled) {
        await exec('sudo', ['-n', 'systemctl', 'stop', FX_UNIT], { timeout: 60_000 }).catch(() => {});
        await exec('sudo', ['-n', 'systemctl', 'disable', FX_UNIT], { timeout: 30_000 }).catch(() => {});
        stopped.push(FX_UNIT);
        logLine('ok', `${FX_UNIT} (txAdmin FX) deaktiviert.`);
      }
    } catch { /* */ }
  }
  return stopped;
}

async function txAdminProcessRunning() {
  try {
    const { stdout } = await exec('pgrep', ['-af', 'txAdmin'], { timeout: 3000 });
    return Boolean(String(stdout).trim());
  } catch {
    return false;
  }
}

/**
 * Erkennung txAdmin / txData auf dem Host.
 */
export async function detectTxAdminEnvironment() {
  const units = [];
  for (const u of TXADMIN_UNITS) {
    const st = await unitState(u);
    if (st.present || st.active) units.push(st);
  }
  const fxUnit = await unitState(FX_UNIT);
  const txDataRoots = await discoverTxDataRoots();
  const processTxRoots = await discoverTxDataFromProcesses();
  const profiles = [];
  let fxRoot = '';
  for (const root of txDataRoots) {
    const fx = resolveFxServerRoot(root);
    if (fx && !fxRoot) fxRoot = fx;
    for (const s of discoverTxAdminServers(root)) {
      const cfgText = readFileSafe(s.cfgPath);
      const parsed = parseServerCfg(cfgText);
      const pdb = s.playersDbPath || playersDbPathForProfile(s.dataPath);
      profiles.push({
        ...s,
        txDataRoot: root,
        port: parseGamePortFromCfg(cfgText),
        hostname: parsed.pub.hostname || s.profile,
        maxClients: parsed.pub.maxClients || 48,
        resourceCount: parsed.resources.length,
        playersDbPath: pdb,
        hasPlayersDb: fs.existsSync(pdb),
        alreadyInOrbit: false,
      });
    }
  }
  const adminsPath = txDataRoots.map((r) => path.join(r, 'admins.json')).find((p) => fs.existsSync(p));
  let txAdminAdmins = 0;
  if (adminsPath) {
    try {
      const j = JSON.parse(readFileSafe(adminsPath));
      txAdminAdmins = Array.isArray(j) ? j.length : 0;
    } catch { /* */ }
  }
  const processRunning = await txAdminProcessRunning();
  const found = profiles.length > 0;
  const hints = {
    processRunning,
    unitsActive: units.filter((u) => u.active).map((u) => u.unit),
    fxUnitActive: fxUnit.active,
    processTxRoots,
  };
  return {
    found,
    hints,
    txAdminAdmins,
    txDataRoots,
    fxRoot,
    units,
    fxUnit,
    processRunning,
    profiles,
    suggestedPanelPort: 40120,
    orbitPanelPort: 40220,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export async function migrateFromTxAdmin(db, opts, logLine = () => {}) {
  const detection = await detectTxAdminEnvironment();
  if (!detection.found || !detection.profiles.length) {
    throw new Error('Keine txAdmin-Server (txData mit server.cfg) gefunden.');
  }

  const wantProfiles = Array.isArray(opts.profiles) && opts.profiles.length
    ? new Set(opts.profiles.map(String))
    : null;

  const imported = [];
  const dataPaths = [];
  const fxRoot = detection.fxRoot || FX_SERVER_ROOT;

  for (const prof of detection.profiles) {
    if (wantProfiles && !wantProfiles.has(prof.profile) && !wantProfiles.has(prof.dataPath)) continue;
    const existing = listOrbitServers(db).find((r) => r.data_path === prof.dataPath);
    if (existing) {
      imported.push(existing);
      dataPaths.push(prof.dataPath);
      continue;
    }
    const cfgText = readFileSafe(prof.cfgPath);
    const parsed = parseServerCfg(cfgText);
    const name = parsed.pub.hostname || prof.profile;
    const row = importExistingOrbitServer(db, {
      name,
      slug: prof.profile,
      dataPath: prof.dataPath,
      fxRoot,
      port: prof.port,
      maxClients: parsed.pub.maxClients || 48,
    });
    imported.push(row);
    dataPaths.push(prof.dataPath);
    try {
      syncOrbitBridgeToDataPath(prof.dataPath, logLine);
    } catch (err) {
      logLine('warn', `orbit_bridge ${prof.profile}: ${err.message}`);
    }
  }

  if (!imported.length) throw new Error('Keine Server importiert (Filter oder bereits vorhanden).');

  const activeKey = opts.activeProfile || imported[0].slug;
  const activeRow = imported.find((r) => r.slug === activeKey || r.name === activeKey)
    || imported.find((r) => r.data_path.includes(String(opts.activeProfile || '')))
    || imported[0];

  activateOrbitServer(db, activeRow.id);
  setSetting(db, 'fxServerRoot', fxRoot);
  setSetting(db, 'fxControlMode', 'orbit');
  setSetting(db, 'controlEnabled', '1');
  setSetting(db, 'fivemHost', '127.0.0.1');
  setSetting(db, 'fivemPort', String(activeRow.port));
  setSetting(db, 'txAdminMigrated', '1');

  let hostname = activeRow.name;
  if (opts.importSettings !== false) {
    const cfgText = readFileSafe(path.join(activeRow.data_path, 'server.cfg'));
    const pub = applyCfgToSettings(db, cfgText);
    if (pub.hostname) hostname = pub.hostname;
    logLine('ok', 'server.cfg-Einstellungen ins Panel übernommen.');
  }

  await ensureDataPathAcl([...new Set(dataPaths)], fxRoot, logLine);

  const moderation = { bans: 0, warns: 0, whitelist: 0, skipped: 0 };
  const importMod = opts.importBans !== false || opts.importWarns !== false || opts.importWhitelist !== false;
  if (importMod) {
    const seenDb = new Set();
    for (const prof of detection.profiles) {
      const pdb = prof.playersDbPath || playersDbPathForProfile(prof.dataPath);
      if (seenDb.has(pdb)) continue;
      seenDb.add(pdb);
      const part = importTxAdminModeration(db, pdb, {
        bans: opts.importBans !== false,
        warns: opts.importWarns !== false,
        whitelist: opts.importWhitelist !== false,
      });
      moderation.bans += part.bans;
      moderation.warns += part.warns;
      moderation.whitelist += part.whitelist;
      moderation.skipped += part.skipped;
    }
    if (moderation.bans || moderation.warns || moderation.whitelist) {
      logLine('ok', `Moderation importiert: ${moderation.bans} Bans, ${moderation.warns} Warns, ${moderation.whitelist} WL.`);
    }
  }

  const stoppedUnits = opts.deactivateTxAdmin !== false
    ? await disableTxAdmin(logLine)
    : [];

  return {
    imported,
    active: activeRow,
    hostname,
    dataPath: activeRow.data_path,
    fxRoot,
    stoppedUnits,
    detection,
    moderation,
  };
}
