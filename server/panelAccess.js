import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ORIGIN, PORT } from './config.js';

const exec = promisify(execFile);
const ORBIT_UNIT = 'orbit';
const DROP_IN = `/etc/systemd/system/${ORBIT_UNIT}.service.d/orbit-panel.conf`;

export const DEFAULT_PANEL_PORT = 40220;

const STACKS = [
  { id: 'nginx', unit: 'nginx', binary: 'nginx', label: 'nginx' },
  { id: 'apache', unit: 'apache2', binary: 'apache2', label: 'Apache' },
  { id: 'caddy', unit: 'caddy', binary: 'caddy', label: 'Caddy' },
];

async function cmd(bin, args, timeout = 8000) {
  const { stdout } = await exec(bin, args, { timeout, maxBuffer: 512 * 1024 });
  return String(stdout || '').trim();
}

export async function detectWebStacks() {
  const out = [];
  for (const s of STACKS) {
    let installed = false;
    let active = false;
    try {
      await exec('which', [s.binary], { timeout: 3000 });
      installed = true;
    } catch { /* */ }
    if (installed) {
      try {
        const st = await cmd('systemctl', ['is-active', s.unit], 4000);
        active = st === 'active';
      } catch { /* */ }
    }
    out.push({ id: s.id, label: s.label, installed, active });
  }
  return out;
}

export async function detectPublicIpv4() {
  try {
    return await cmd('curl', ['-fsS', '--max-time', '4', 'https://api.ipify.org'], 6000);
  } catch { /* */ }
  try {
    const line = await cmd('hostname', ['-I'], 3000);
    const ip = line.split(/\s+/).find((x) => x && !x.startsWith('127.') && !x.includes(':'));
    if (ip) return ip;
  } catch { /* */ }
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

export function parseDomainInput(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!s || s.length > 253 || !s.includes('.')) throw new Error('Gültige Domain eingeben (z. B. panel.example.de).');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    throw new Error('Domain enthält ungültige Zeichen.');
  }
  return s;
}

export function pickSuggestedStack(stacks) {
  const active = stacks.find((s) => s.active);
  if (active) return active.id;
  const installed = stacks.find((s) => s.installed);
  if (installed) return installed.id;
  return 'nginx';
}

export async function buildPanelAccessPreview(opts = {}) {
  const panelPort = Number(opts.panelPort) || DEFAULT_PANEL_PORT;
  const stacks = await detectWebStacks();
  const publicIp = await detectPublicIpv4();
  const suggestedStack = pickSuggestedStack(stacks);
  const mode = opts.mode === 'domain' ? 'domain' : 'port';
  let publicUrl = ORIGIN;
  if (mode === 'port') {
    const host = String(opts.publicHost || publicIp).trim();
    publicUrl = `http://${host}:${panelPort}`;
  } else if (opts.domain) {
    const domain = parseDomainInput(opts.domain);
    publicUrl = opts.https !== false ? `https://${domain}` : `http://${domain}`;
  }
  return {
    mode,
    panelPort,
    publicIp,
    hostname: os.hostname(),
    currentOrigin: ORIGIN,
    currentListenPort: PORT,
    stacks,
    suggestedStack,
    previewUrl: publicUrl,
    directPortUrl: `http://${publicIp}:${panelPort}`,
  };
}

function nginxSitePath(domain) {
  return `/etc/nginx/sites-available/orbit-${domain.replace(/\./g, '-')}.conf`;
}

function apacheSitePath(domain) {
  return `/etc/apache2/sites-available/orbit-${domain.replace(/\./g, '-')}.conf`;
}

function proxyBlock(panelPort) {
  return [
    'location / {',
    `  proxy_pass http://127.0.0.1:${panelPort};`,
    '  proxy_http_version 1.1;',
    '  proxy_set_header Host $host;',
    '  proxy_set_header X-Real-IP $remote_addr;',
    '  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '  proxy_set_header X-Forwarded-Proto $scheme;',
    '  proxy_set_header Upgrade $http_upgrade;',
    '  proxy_set_header Connection "upgrade";',
    '}',
  ].join('\n');
}

async function configureNginx(domain, panelPort, logLine) {
  const site = nginxSitePath(domain);
  const body = [
    `# Orbit Panel — auto-generated`,
    'server {',
    '  listen 80;',
    '  listen [::]:80;',
    `  server_name ${domain};`,
    proxyBlock(panelPort),
    '}',
    '',
  ].join('\n');
  const tmp = `/tmp/orbit-nginx-${Date.now()}.conf`;
  fs.writeFileSync(tmp, body, 'utf8');
  await exec('sudo', ['-n', 'cp', tmp, site], { timeout: 15_000 });
  const enabled = `/etc/nginx/sites-enabled/${path.basename(site)}`;
  try {
    await exec('sudo', ['-n', 'ln', '-sf', site, enabled], { timeout: 5000 });
  } catch { /* may use conf.d */ }
  await exec('sudo', ['-n', 'nginx', '-t'], { timeout: 20_000 });
  await exec('sudo', ['-n', 'systemctl', 'reload', 'nginx'], { timeout: 20_000 });
  logLine('ok', `nginx VHost für ${domain} aktiv.`);
  return { ok: true, stack: 'nginx', configPath: site };
}

async function configureApache(domain, panelPort, logLine) {
  const site = apacheSitePath(domain);
  const body = [
    '# Orbit Panel — auto-generated',
    '<VirtualHost *:80>',
    `  ServerName ${domain}`,
    '  ProxyPreserveHost On',
    `  ProxyPass / http://127.0.0.1:${panelPort}/`,
    `  ProxyPassReverse / http://127.0.0.1:${panelPort}/`,
    '  RequestHeader set X-Forwarded-Proto "https" env=HTTPS',
    '</VirtualHost>',
    '',
  ].join('\n');
  const tmp = `/tmp/orbit-apache-${Date.now()}.conf`;
  fs.writeFileSync(tmp, body, 'utf8');
  await exec('sudo', ['-n', 'cp', tmp, site], { timeout: 15_000 });
  await exec('sudo', ['-n', 'a2enmod', 'proxy', 'proxy_http', 'headers'], { timeout: 30_000 }).catch(() => {});
  await exec('sudo', ['-n', 'a2ensite', path.basename(site)], { timeout: 15_000 }).catch(() => {});
  await exec('sudo', ['-n', 'systemctl', 'reload', 'apache2'], { timeout: 20_000 });
  logLine('ok', `Apache VHost für ${domain} aktiv.`);
  return { ok: true, stack: 'apache', configPath: site };
}

async function configureCaddy(domain, panelPort, logLine) {
  const snippetPath = `/etc/caddy/orbit-${domain.replace(/\./g, '-')}.caddy`;
  const body = `${domain} {\n  reverse_proxy 127.0.0.1:${panelPort}\n}\n`;
  const tmp = `/tmp/orbit-caddy-${Date.now()}`;
  fs.writeFileSync(tmp, body, 'utf8');
  await exec('sudo', ['-n', 'cp', tmp, snippetPath], { timeout: 15_000 });
  const main = '/etc/caddy/Caddyfile';
  let mainText = '';
  try { mainText = fs.readFileSync(main, 'utf8'); } catch { /* */ }
  const importLine = `import ${snippetPath}`;
  if (!mainText.includes(importLine)) {
    const merged = `${mainText.trim()}\n\n# Orbit Panel\n${importLine}\n`;
    const tmpMain = `/tmp/Caddyfile-orbit-${Date.now()}`;
    fs.writeFileSync(tmpMain, merged, 'utf8');
    await exec('sudo', ['-n', 'cp', tmpMain, main], { timeout: 15_000 });
  }
  await exec('sudo', ['-n', 'systemctl', 'reload', 'caddy'], { timeout: 20_000 });
  logLine('ok', `Caddy vHost für ${domain} aktiv (TLS automatisch).`);
  return { ok: true, stack: 'caddy', configPath: snippetPath };
}

async function tryCertbotNginx(domain, logLine) {
  try {
    await exec('which', ['certbot'], { timeout: 3000 });
    await exec('sudo', [
      '-n', 'certbot', '--nginx', '-d', domain,
      '--non-interactive', '--agree-tos', '--register-unsafely-without-email', '--redirect',
    ], { timeout: 300_000 });
    logLine('ok', `Let's Encrypt Zertifikat für ${domain}.`);
    return true;
  } catch (err) {
    logLine('warn', `certbot: ${err.message}`);
    return false;
  }
}

async function configureReverseProxy(stackId, domain, panelPort, logLine, opts = {}) {
  const stacks = await detectWebStacks();
  let stack = stackId === 'auto' ? pickSuggestedStack(stacks) : stackId;
  const meta = stacks.find((s) => s.id === stack);
  if (!meta?.installed) {
    return {
      ok: false,
      stack,
      message: `${stack} ist nicht installiert — bitte Webserver installieren oder Port-Zugang wählen.`,
    };
  }
  let result;
  if (stack === 'nginx') result = await configureNginx(domain, panelPort, logLine);
  else if (stack === 'apache') result = await configureApache(domain, panelPort, logLine);
  else if (stack === 'caddy') result = await configureCaddy(domain, panelPort, logLine);
  else return { ok: false, stack, message: 'Unbekannter Webserver.' };

  if (opts.https !== false && stack === 'nginx') {
    await tryCertbotNginx(domain, logLine);
  }
  return result;
}

async function writeSystemdDropIn(env, logLine) {
  const lines = ['[Service]', ...Object.entries(env).map(([k, v]) => `Environment=${k}=${v}`), ''];
  const tmp = `/tmp/orbit-systemd-${Date.now()}.conf`;
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
  await exec('sudo', ['-n', 'mkdir', '-p', '/etc/systemd/system/orbit.service.d'], { timeout: 10_000 });
  await exec('sudo', ['-n', 'cp', tmp, DROP_IN], { timeout: 10_000 });
  await exec('sudo', ['-n', 'systemctl', 'daemon-reload'], { timeout: 20_000 });
  logLine('info', 'systemd orbit.service.d aktualisiert.');
}

export function schedulePanelServiceRestart() {
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', 'restart', ORBIT_UNIT], () => {
      setTimeout(() => process.exit(0), 200);
    });
  }, 600);
}

/**
 * @param {{ mode: 'port'|'domain', panelPort?: number, publicHost?: string, domain?: string, stack?: string, https?: boolean }} opts
 */
export async function applyPanelAccess(opts, logLine = () => {}) {
  const mode = opts.mode === 'domain' ? 'domain' : 'port';
  const panelPort = Number(opts.panelPort) || DEFAULT_PANEL_PORT;
  if (!Number.isInteger(panelPort) || panelPort < 1024 || panelPort > 65535) {
    throw new Error('Panel-Port ungültig (1024–65535).');
  }

  const nextSteps = [];
  let publicUrl;
  let bindHost = '127.0.0.1';
  let requireTls = '1';
  let tlsRelax = '0';

  if (mode === 'port') {
    const ip = String(opts.publicHost || await detectPublicIpv4()).trim();
    publicUrl = `http://${ip}:${panelPort}`;
    bindHost = '0.0.0.0';
    requireTls = '0';
    tlsRelax = '1';
    nextSteps.push(`Panel direkt: ${publicUrl} (per IP:Port — Port ${panelPort} freigeben).`);
  } else {
    const domain = parseDomainInput(opts.domain);
    const useHttps = opts.https !== false;
    publicUrl = useHttps ? `https://${domain}` : `http://${domain}`;
    bindHost = '127.0.0.1';
    requireTls = useHttps ? '1' : '0';
    tlsRelax = useHttps ? '0' : '1';

    const proxy = await configureReverseProxy(
      opts.stack || 'auto',
      domain,
      panelPort,
      logLine,
      { https: useHttps },
    );
    if (!proxy.ok) {
      nextSteps.push(proxy.message || 'Reverse-Proxy konnte nicht eingerichtet werden.');
      nextSteps.push(`DNS: ${domain} → Server-IP, dann nginx/Apache manuell auf 127.0.0.1:${panelPort}.`);
    } else if (useHttps && proxy.stack === 'nginx') {
      nextSteps.push('Falls HTTPS noch fehlt: DNS prüfen, dann certbot --nginx -d ' + domain);
    } else if (useHttps && proxy.stack === 'apache') {
      nextSteps.push('Apache: certbot --apache -d ' + domain);
    }
    nextSteps.push(`Öffentliche Panel-URL: ${publicUrl}`);
  }

  await writeSystemdDropIn({
    ORBIT_PUBLIC_URL: publicUrl,
    ORBIT_BIND_HOST: bindHost,
    ORBIT_PANEL_PORT: String(panelPort),
    ORBIT_REQUIRE_TLS: requireTls,
    ORBIT_TLS_RELAX: tlsRelax,
  }, logLine);

  return {
    mode,
    publicUrl,
    panelPort,
    bindHost,
    nextSteps,
    restartScheduled: true,
  };
}
