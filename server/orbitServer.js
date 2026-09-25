import fs from 'node:fs';
import path from 'node:path';
import { FX_SERVER_ROOT, ORBIT_SERVERS_ROOT } from './config.js';
import { resolveCustomDataPath, resolveOrbitServersRoot } from './serverPathPolicy.js';
import { sanitizeCfgMetaComments } from './cfgSanitize.js';

const DEFAULT_ENSURES = ['oxmysql', 'pma-voice'];

export function slugifyServerName(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'orbit-server';
}

function uniqueSlug(root, slug) {
  let candidate = slug;
  let n = 2;
  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${slug}-${n}`;
    n += 1;
    if (n > 99) throw new Error('Zu viele Server mit ähnlichem Namen.');
  }
  return candidate;
}

function renderOrbitCfg({ name, project, port, maxClients, locale, tags, onesync }) {
  const ensures = DEFAULT_ENSURES.map((r) => `ensure ${r}`).join('\n');
  // onesync nur als Kommentar — wird per FX-Launch +set gesetzt (sonst: internal ConVar warning)
  return [
    '# Netzwerk',
    `endpoint_add_tcp "0.0.0.0:${port}"`,
    `endpoint_add_udp "0.0.0.0:${port}"`,
    '',
    '# Server',
    `sv_hostname "${String(name).replace(/"/g, '')}"`,
    `sv_maxclients ${maxClients}`,
    `sets sv_projectName "${String(project || name).replace(/"/g, '')}"`,
    `sets tags "${String(tags || 'roleplay').replace(/"/g, '')}"`,
    `sets locale "${String(locale || 'de-DE').replace(/"/g, '')}"`,
    `# OneSync: ${onesync}`,
    '',
    '# Lizenz und MySQL:',
    '# set sv_licenseKey "…"',
    '# set mysql_connection_string "…"',
    '',
    '# Ressourcen',
    ensures,
    '',
  ].join('\n');
}

/**
 * Legt einen eigenen Orbit-Server (Datenverzeichnis + server.cfg) an.
 * FX-Binary bleibt unter fxServerRoot (Artifact).
 * Existiert server.cfg bereits → Ordner übernehmen (reuse), außer replaceExisting.
 */
export function provisionOrbitServer(opts) {
  const displayName = String(opts.name || '').trim();
  if (displayName.length < 2) throw new Error('Servername fehlt (min. 2 Zeichen).');

  const port = Number(opts.port);
  const maxClients = Number(opts.maxClients);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port ungültig.');
  if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 2048) throw new Error('Slots ungültig.');

  let dataPath;
  let slug;
  let reused = false;
  const customData = resolveCustomDataPath(opts.dataPath);
  if (customData) {
    dataPath = customData;
    slug = slugifyServerName(displayName);
    const cfgExisting = path.join(dataPath, 'server.cfg');
    if (fs.existsSync(cfgExisting)) {
      if (opts.replaceExisting) {
        // Ordner leeren für frisches Setup
        for (const name of fs.readdirSync(dataPath)) {
          fs.rmSync(path.join(dataPath, name), { recursive: true, force: true });
        }
      } else {
        reused = true;
      }
    }
    fs.mkdirSync(dataPath, { recursive: true });
  } else {
    const root = resolveOrbitServersRoot(opts.serversRoot, ORBIT_SERVERS_ROOT);
    fs.mkdirSync(root, { recursive: true });
    slug = uniqueSlug(root, slugifyServerName(displayName));
    dataPath = path.join(root, slug);
  }
  const cfgFile = path.join(dataPath, 'server.cfg');
  const resourcesDir = path.join(dataPath, 'resources');

  fs.mkdirSync(resourcesDir, { recursive: true });
  if (!fs.existsSync(path.join(resourcesDir, '.gitkeep'))) {
    fs.writeFileSync(path.join(resourcesDir, '.gitkeep'), '', { mode: 0o644 });
  }

  const onesync = opts.onesync === 'off' || opts.onesync === 'legacy' ? opts.onesync : 'on';
  if (!reused) {
    const cfg = renderOrbitCfg({
      name: displayName,
      project: opts.project || displayName,
      port,
      maxClients,
      locale: opts.locale || 'de-DE',
      tags: opts.tags || 'roleplay, german',
      onesync,
    });
    fs.writeFileSync(cfgFile, sanitizeCfgMetaComments(cfg), { encoding: 'utf8', mode: 0o644 });
  } else {
    // Port/Hostname in bestehender CFG anpassen
    try {
      let cur = fs.readFileSync(cfgFile, 'utf8');
      cur = cur.replace(/endpoint_add_tcp\s+"[^"]+"/i, `endpoint_add_tcp "0.0.0.0:${port}"`);
      cur = cur.replace(/endpoint_add_udp\s+"[^"]+"/i, `endpoint_add_udp "0.0.0.0:${port}"`);
      cur = cur.replace(/sv_hostname\s+"[^"]*"/i, `sv_hostname "${String(displayName).replace(/"/g, '')}"`);
      cur = cur.replace(/sv_maxclients\s+\d+/i, `sv_maxclients ${maxClients}`);
      fs.writeFileSync(cfgFile, sanitizeCfgMetaComments(cur), 'utf8');
    } catch { /* cfg bleibt */ }
  }

  const fxServerRoot = String(opts.fxServerRoot || FX_SERVER_ROOT).replace(/\/$/, '');

  return {
    orbitServerName: displayName,
    orbitServerSlug: slug,
    fxDataPath: dataPath,
    fxServerRoot,
    cfgFile,
    reused,
    settings: {
      orbitServerName: displayName,
      orbitServerSlug: slug,
      serverLabel: displayName,
      fxDataPath: dataPath,
      fxServerRoot,
      fxControlMode: 'orbit',
      hostname: displayName,
      project: opts.project || displayName,
      fivemHost: '127.0.0.1',
      fivemPort: String(port),
      maxClients: String(maxClients),
      locale: opts.locale || 'de-DE',
      tags: opts.tags || 'roleplay, german',
      onesync,
      controlEnabled: '1',
    },
  };
}

export function orbitServerProfile(settings) {
  return {
    name: settings.orbitServerName || settings.serverLabel || settings.hostname || '',
    slug: settings.orbitServerSlug || '',
    dataPath: settings.fxDataPath || '',
    fxServerRoot: settings.fxServerRoot || '',
    controlMode: settings.fxControlMode === 'orbit' ? 'orbit' : 'systemd',
  };
}
