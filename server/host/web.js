import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { aptInstall, has, run, startJob } from './exec.js';
import { serviceStatus } from './services.js';

/*
 * Webserver & Domains.
 * Orbit schreibt ausschließlich eigene Dateien (orbit-site-<domain>.conf) und prüft jede Änderung
 * mit dem Config-Test des Webservers, bevor neu geladen wird. Schlägt der Test fehl, wird die
 * vorherige Fassung wiederhergestellt. Fremde Seiten werden nur gelesen.
 *
 * Für Tests lassen sich Pfade/Befehle umbiegen: ORBIT_NGINX_DIR, ORBIT_NGINX_ARGS ("-p … -c …"),
 * ORBIT_WWW_ROOT, ORBIT_ACME_ROOT.
 */
const NGINX_DIR = () => process.env.ORBIT_NGINX_DIR || '/etc/nginx';
const NGINX_ARGS = () => (process.env.ORBIT_NGINX_ARGS ? process.env.ORBIT_NGINX_ARGS.split(' ').filter(Boolean) : []);
const APACHE_DIR = '/etc/apache2';
const CADDY_DIR = '/etc/caddy';
const WWW_ROOT = () => process.env.ORBIT_WWW_ROOT || '/var/www';
const ACME_ROOT = () => process.env.ORBIT_ACME_ROOT || '/var/www/orbit-acme';
const HEADER = '# Von Orbit verwaltet — Änderungen hier werden beim nächsten Speichern in Orbit überschrieben.';

export const WEBSERVERS = {
  nginx: { id: 'nginx', label: 'nginx', pkg: 'nginx', text: 'Schnell und sparsam — Standard für Reverse-Proxys und statische Seiten' },
  apache: { id: 'apache', label: 'Apache', pkg: 'apache2', text: 'Klassiker, .htaccess-Unterstützung für PHP-Projekte' },
  caddy: { id: 'caddy', label: 'Caddy', pkg: 'caddy', text: 'Automatisches HTTPS ohne Zusatzschritte' },
};

export const SITE_TYPES = {
  proxy: { label: 'Reverse-Proxy', text: 'Leitet die Domain an eine App/Port weiter (Node, Panel, Dashboards)' },
  static: { label: 'Statische Website', text: 'HTML/CSS/JS aus einem Ordner' },
  php: { label: 'PHP-Website', text: 'WordPress, Laravel & Co. über PHP-FPM' },
  redirect: { label: 'Weiterleitung', text: 'Leitet auf eine andere Adresse um' },
  game: { label: 'Gameserver-Adresse', text: 'Domain zum Verbinden (Minecraft, FiveM) — nur DNS, kein Webserver' },
};

const DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
const WILDCARD_RE = /^\*\.(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

export function ensureWebTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS host_sites (
    id INTEGER PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    type TEXT NOT NULL,
    target TEXT,
    root TEXT,
    ssl TEXT NOT NULL DEFAULT 'none',
    cert TEXT,
    force_https INTEGER NOT NULL DEFAULT 1,
    websocket INTEGER NOT NULL DEFAULT 1,
    webserver TEXT,
    server_key TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  )`);
}

function checkDomain(d) {
  const s = String(d || '').trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(s)) throw new Error(`Domain ungültig: ${d || '(leer)'}`);
  return s;
}

/* ── Erkennung ── */
export async function activeWebserver() {
  for (const id of ['nginx', 'apache', 'caddy']) {
    const s = await serviceStatus(id);
    if (s.installed && s.active) return id;
  }
  for (const id of ['nginx', 'apache', 'caddy']) {
    const s = await serviceStatus(id);
    if (s.installed) return id;
  }
  return null;
}

export async function publicIp() {
  const r = await run('ip', ['-4', 'route', 'get', '1.1.1.1'], { allowFail: true, timeout: 3000 });
  const m = r.stdout.match(/src (\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
function ipNum(ip) { return ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0; }
function inCf(ip) {
  return CF_V4.some((c) => {
    const [base, bits] = c.split('/');
    const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (ipNum(ip) & mask) === (ipNum(base) & mask);
  });
}

/** DNS-Check: zeigt die Domain auf diesen Server (direkt oder über Cloudflare)? */
export async function checkDns(domain, { srv = null } = {}) {
  const ip = await publicIp();
  let a = [];
  try { a = await dns.resolve4(domain); } catch { /* */ }
  let srvRec = null;
  if (srv) {
    try { srvRec = (await dns.resolveSrv(srv))[0] || null; } catch { /* */ }
  }
  const cf = a.length > 0 && a.every(inCf);
  const direct = !!ip && a.includes(ip);
  return {
    domain,
    serverIp: ip,
    records: a,
    cloudflare: cf,
    ok: direct || cf,
    status: !a.length ? 'missing' : direct ? 'direct' : cf ? 'cloudflare' : 'other',
    srv: srvRec,
  };
}

/** Zertifikate, die schon auf dem Server liegen (Let's Encrypt + in nginx-Snippets referenzierte) */
export async function listCertificates() {
  const found = new Map();
  const add = async (cert, key, source) => {
    if (!cert || found.has(cert) || !fs.existsSync(cert)) return;
    const r = await run('openssl', ['x509', '-in', cert, '-noout', '-enddate', '-ext', 'subjectAltName'], { allowFail: true, timeout: 5000 });
    const names = [...r.stdout.matchAll(/DNS:([^,\s]+)/g)].map((m) => m[1].toLowerCase());
    const end = (r.stdout.match(/notAfter=(.*)/) || [])[1];
    found.set(cert, { id: cert, cert, key, names, expires: end ? Date.parse(end) : null, source });
  };
  try {
    for (const d of fs.readdirSync('/etc/letsencrypt/live')) {
      const base = path.join('/etc/letsencrypt/live', d);
      if (fs.statSync(base).isDirectory()) await add(path.join(base, 'fullchain.pem'), path.join(base, 'privkey.pem'), `Let's Encrypt (${d})`);
    }
  } catch { /* */ }
  for (const dir of [path.join(NGINX_DIR(), 'snippets'), path.join(NGINX_DIR(), 'conf.d')]) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      const c = (txt.match(/^\s*ssl_certificate\s+([^;\s]+);/m) || [])[1];
      const k = (txt.match(/^\s*ssl_certificate_key\s+([^;\s]+);/m) || [])[1];
      if (c && k) await add(c, k, `nginx-Snippet ${f}`);
    }
  }
  return [...found.values()];
}

function certMatches(cert, domain) {
  return cert.names.some((n) => n === domain || (WILDCARD_RE.test(n) && domain.endsWith(n.slice(1)) && domain.split('.').length === n.split('.').length));
}

/** Fremde (nicht von Orbit verwaltete) Seiten nur lesend auflisten */
export function listForeignSites() {
  const out = [];
  const dirs = [[path.join(NGINX_DIR(), 'sites-enabled'), 'nginx'], [path.join(APACHE_DIR, 'sites-enabled'), 'apache']];
  for (const [dir, ws] of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (f.startsWith('orbit-site-')) continue;
      let txt = '';
      try { txt = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      const names = [...txt.matchAll(ws === 'nginx' ? /server_name\s+([^;]+);/g : /Server(?:Name|Alias)\s+(.+)/g)].flatMap((m) => m[1].trim().split(/\s+/)).filter((n) => n && n !== '_' && n !== 'localhost');
      const proxies = [...txt.matchAll(/proxy_pass\s+([^;]+);|ProxyPass\s+\S+\s+(\S+)/g)].map((m) => (m[1] || m[2]).trim());
      const ssl = /listen\s+[^;]*443|SSLEngine\s+on/i.test(txt);
      out.push({ file: f, webserver: ws, domains: [...new Set(names)], proxies: [...new Set(proxies)].slice(0, 4), ssl });
    }
  }
  return out;
}

/* ── Konfiguration erzeugen ── */
function phpSocket() {
  try {
    const socks = fs.readdirSync('/run/php').filter((f) => /^php[\d.]+-fpm\.sock$/.test(f)).sort();
    if (socks.length) return `/run/php/${socks[socks.length - 1]}`;
  } catch { /* */ }
  return '/run/php/php-fpm.sock';
}

function proxyTarget(site) {
  const t = String(site.target || '');
  if (/^\d{1,5}$/.test(t)) return `http://127.0.0.1:${t}`;
  return t;
}

function siteRoot(site) {
  return site.root || path.join(WWW_ROOT(), site.domain, 'public');
}

function nginxBody(site) {
  const L = [];
  if (site.type === 'proxy') {
    L.push('    client_max_body_size 512m;');
    L.push('    location / {');
    L.push(`        proxy_pass ${proxyTarget(site)};`);
    L.push('        proxy_http_version 1.1;');
    L.push('        proxy_set_header Host $host;');
    L.push('        proxy_set_header X-Real-IP $remote_addr;');
    L.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    L.push('        proxy_set_header X-Forwarded-Proto $scheme;');
    if (site.websocket) {
      L.push('        proxy_set_header Upgrade $http_upgrade;');
      L.push('        proxy_set_header Connection "upgrade";');
    }
    L.push('        proxy_read_timeout 300s;');
    L.push('    }');
  } else if (site.type === 'static') {
    L.push(`    root ${siteRoot(site)};`);
    L.push('    index index.html index.htm;');
    L.push('    location / { try_files $uri $uri/ =404; }');
  } else if (site.type === 'php') {
    L.push(`    root ${siteRoot(site)};`);
    L.push('    index index.php index.html;');
    L.push('    client_max_body_size 128m;');
    L.push('    location / { try_files $uri $uri/ /index.php?$query_string; }');
    L.push('    location ~ \\.php$ {');
    L.push('        include fastcgi_params;');
    L.push('        fastcgi_split_path_info ^(.+\\.php)(/.+)$;');
    L.push('        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;');
    L.push(`        fastcgi_pass unix:${phpSocket()};`);
    L.push('    }');
    L.push('    location ~ /\\.(?!well-known) { deny all; }');
  } else if (site.type === 'redirect') {
    L.push(`    location / { return 301 ${site.target}$request_uri; }`);
  }
  return L.join('\n');
}

function nginxConf(site, cert) {
  const names = [site.domain, ...site.aliases].join(' ');
  const acme = `    location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT()}; default_type text/plain; }`;
  const out = [HEADER, `# Typ: ${site.type}`, ''];
  const tls = !!cert;
  out.push('server {', '    listen 80;', '    listen [::]:80;', `    server_name ${names};`, acme);
  if (tls && site.force_https) out.push('    location / { return 301 https://$host$request_uri; }');
  else out.push(nginxBody(site));
  out.push('}');
  if (tls) {
    out.push('', 'server {', '    listen 443 ssl http2;', '    listen [::]:443 ssl http2;', `    server_name ${names};`,
      `    ssl_certificate ${cert.cert};`, `    ssl_certificate_key ${cert.key};`, '    ssl_protocols TLSv1.2 TLSv1.3;', '    ssl_session_cache shared:orbitSSL:10m;', acme, nginxBody(site), '}');
  }
  return `${out.join('\n')}\n`;
}

function apacheBody(site) {
  const L = [];
  if (site.type === 'proxy') {
    const t = proxyTarget(site);
    L.push('    ProxyPreserveHost On', '    ProxyRequests Off');
    if (site.websocket) {
      L.push('    RewriteEngine On', '    RewriteCond %{HTTP:Upgrade} =websocket [NC]', `    RewriteRule /(.*) ${t.replace(/^http/, 'ws')}/$1 [P,L]`);
    }
    L.push(`    ProxyPass /.well-known/acme-challenge/ !`, `    ProxyPass / ${t}/`, `    ProxyPassReverse / ${t}/`, '    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}');
  } else if (site.type === 'static' || site.type === 'php') {
    L.push(`    DocumentRoot ${siteRoot(site)}`, `    <Directory ${siteRoot(site)}>`, '        Options -Indexes +FollowSymLinks', '        AllowOverride All', '        Require all granted', '    </Directory>');
    if (site.type === 'php') L.push('    <FilesMatch \\.php$>', `        SetHandler "proxy:unix:${phpSocket()}|fcgi://localhost"`, '    </FilesMatch>');
  } else if (site.type === 'redirect') {
    L.push(`    Redirect permanent / ${site.target}/`);
  }
  return L.join('\n');
}

function apacheConf(site, cert) {
  const alias = site.aliases.length ? `    ServerAlias ${site.aliases.join(' ')}\n` : '';
  const acme = `    Alias /.well-known/acme-challenge/ ${ACME_ROOT()}/.well-known/acme-challenge/\n    <Directory ${ACME_ROOT()}>\n        Require all granted\n    </Directory>`;
  const out = [HEADER, `# Typ: ${site.type}`, '', '<VirtualHost *:80>', `    ServerName ${site.domain}`];
  if (alias) out.push(alias.trimEnd());
  out.push(acme);
  if (cert && site.force_https) out.push('    RewriteEngine On', '    RewriteCond %{REQUEST_URI} !^/\\.well-known/', '    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]');
  else out.push(apacheBody(site));
  out.push('</VirtualHost>');
  if (cert) {
    out.push('', '<VirtualHost *:443>', `    ServerName ${site.domain}`);
    if (alias) out.push(alias.trimEnd());
    out.push('    SSLEngine on', `    SSLCertificateFile ${cert.cert}`, `    SSLCertificateKeyFile ${cert.key}`, acme, apacheBody(site), '</VirtualHost>');
  }
  return `${out.join('\n')}\n`;
}

function caddyConf(site) {
  const names = [site.domain, ...site.aliases].join(', ');
  const scheme = site.ssl === 'none' ? 'http://' : '';
  const host = site.ssl === 'none' ? [site.domain, ...site.aliases].map((n) => `http://${n}`).join(', ') : names;
  const L = [HEADER, `# Typ: ${site.type}`, `${scheme ? host : names} {`];
  if (site.type === 'proxy') L.push(`    reverse_proxy ${proxyTarget(site).replace(/^http:\/\//, '')}`);
  else if (site.type === 'static') L.push(`    root * ${siteRoot(site)}`, '    file_server');
  else if (site.type === 'php') L.push(`    root * ${siteRoot(site)}`, `    php_fastcgi unix/${phpSocket()}`, '    file_server');
  else if (site.type === 'redirect') L.push(`    redir ${site.target}{uri} permanent`);
  L.push('}');
  return `${L.join('\n')}\n`;
}

/* ── Dateien schreiben, testen, neu laden ── */
function filesFor(ws, domain) {
  if (ws === 'nginx') return { avail: path.join(NGINX_DIR(), 'sites-available', `orbit-site-${domain}.conf`), enabled: path.join(NGINX_DIR(), 'sites-enabled', `orbit-site-${domain}.conf`) };
  if (ws === 'apache') return { avail: path.join(APACHE_DIR, 'sites-available', `orbit-site-${domain}.conf`), enabled: path.join(APACHE_DIR, 'sites-enabled', `orbit-site-${domain}.conf`) };
  return { avail: path.join(CADDY_DIR, 'orbit', `orbit-site-${domain}.caddy`), enabled: null };
}

async function testConfig(ws) {
  if (ws === 'nginx') return run('nginx', [...NGINX_ARGS(), '-t'], { timeout: 20000 });
  if (ws === 'apache') return run('apache2ctl', ['configtest'], { timeout: 20000 });
  return run('caddy', ['validate', '--config', path.join(CADDY_DIR, 'Caddyfile'), '--adapter', 'caddyfile'], { timeout: 30000 });
}

async function reload(ws) {
  if (process.env.ORBIT_WEB_NORELOAD === '1') return null;
  if (ws === 'nginx') {
    if (NGINX_ARGS().length) return run('nginx', [...NGINX_ARGS(), '-s', 'reload'], { timeout: 20000 });
    return run('systemctl', ['reload', 'nginx'], { timeout: 30000 });
  }
  if (ws === 'apache') return run('systemctl', ['reload', 'apache2'], { timeout: 30000 });
  return run('systemctl', ['reload', 'caddy'], { timeout: 30000 });
}

async function prepareWebserver(ws) {
  fs.mkdirSync(path.join(ACME_ROOT(), '.well-known', 'acme-challenge'), { recursive: true });
  if (ws === 'apache') {
    await run('a2enmod', ['-q', 'proxy', 'proxy_http', 'proxy_wstunnel', 'proxy_fcgi', 'headers', 'rewrite', 'ssl'], { timeout: 30000 });
  }
  if (ws === 'caddy') {
    fs.mkdirSync(path.join(CADDY_DIR, 'orbit'), { recursive: true });
    const main = path.join(CADDY_DIR, 'Caddyfile');
    const txt = fs.existsSync(main) ? fs.readFileSync(main, 'utf8') : '';
    if (!txt.includes('import /etc/caddy/orbit/*')) fs.writeFileSync(main, `${txt.trimEnd()}\n\n# Von Orbit verwaltete Seiten\nimport /etc/caddy/orbit/*.caddy\n`);
  }
}

/** Datei schreiben + testen, bei Fehler alte Fassung zurück */
async function applyFile(ws, domain, content, { enable = true } = {}) {
  const f = filesFor(ws, domain);
  fs.mkdirSync(path.dirname(f.avail), { recursive: true });
  const before = fs.existsSync(f.avail) ? fs.readFileSync(f.avail, 'utf8') : null;
  const wasEnabled = f.enabled ? fs.existsSync(f.enabled) : true;
  fs.writeFileSync(f.avail, content);
  if (f.enabled && enable && !fs.existsSync(f.enabled)) fs.symlinkSync(f.avail, f.enabled);
  if (f.enabled && !enable && fs.existsSync(f.enabled)) fs.rmSync(f.enabled);
  try {
    await testConfig(ws);
  } catch (e) {
    if (before === null) fs.rmSync(f.avail, { force: true });
    else fs.writeFileSync(f.avail, before);
    if (f.enabled) {
      if (wasEnabled && !fs.existsSync(f.enabled)) fs.symlinkSync(f.avail, f.enabled);
      if (!wasEnabled && fs.existsSync(f.enabled)) fs.rmSync(f.enabled);
      if (before === null && fs.existsSync(f.enabled)) fs.rmSync(f.enabled, { force: true });
    }
    throw new Error(`Webserver-Test fehlgeschlagen, nichts geändert:\n${e.message}`);
  }
  await reload(ws);
  return f.avail;
}

function removeFiles(ws, domain) {
  const f = filesFor(ws, domain);
  if (f.enabled) fs.rmSync(f.enabled, { force: true });
  fs.rmSync(f.avail, { force: true });
}

function rowToSite(r) {
  return { ...r, aliases: JSON.parse(r.aliases || '[]'), force_https: !!r.force_https, websocket: !!r.websocket, enabled: !!r.enabled };
}

function ensureRoot(site, log) {
  if (site.type !== 'static' && site.type !== 'php') return;
  const root = siteRoot(site);
  if (fs.existsSync(root)) return;
  fs.mkdirSync(root, { recursive: true });
  const idx = site.type === 'php' ? 'index.php' : 'index.html';
  const body = site.type === 'php'
    ? `<?php echo "<h1>${site.domain}</h1><p>PHP läuft (" . PHP_VERSION . ") — eingerichtet mit Orbit.</p>";\n`
    : `<!doctype html><meta charset="utf-8"><title>${site.domain}</title><style>body{font:16px system-ui;background:#0a0a0a;color:#eee;display:grid;place-items:center;height:100vh;margin:0}</style><div><h1>${site.domain}</h1><p>Diese Seite ist bereit — eingerichtet mit Orbit.</p></div>\n`;
  fs.writeFileSync(path.join(root, idx), body);
  run('chown', ['-R', 'www-data:www-data', path.dirname(root)], { allowFail: true }).catch(() => {});
  log?.(`Ordner angelegt: ${root}`);
}

/* ── Öffentliche API ── */
export function listSites(db) {
  return db.prepare('SELECT * FROM host_sites ORDER BY domain').all().map(rowToSite);
}

export function getSite(db, id) {
  const r = db.prepare('SELECT * FROM host_sites WHERE id = ?').get(Number(id));
  return r ? rowToSite(r) : null;
}

function normalizeInput(body, existing) {
  const type = String(body.type ?? existing?.type ?? '');
  if (!SITE_TYPES[type]) throw new Error('Typ ungültig.');
  const domain = checkDomain(body.domain ?? existing?.domain);
  const aliases = [...new Set((Array.isArray(body.aliases) ? body.aliases : String(body.aliases ?? '').split(/[\s,]+/)).filter(Boolean).map(checkDomain))].filter((a) => a !== domain).slice(0, 10);
  let target = body.target ?? existing?.target ?? '';
  target = String(target).trim();
  if (type === 'proxy') {
    if (/^\d{1,5}$/.test(target)) {
      const p = Number(target);
      if (p < 1 || p > 65535) throw new Error('Port ungültig.');
    } else if (!/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[\w./-]*)?$/i.test(target)) {
      throw new Error('Ziel ungültig — Port (z. B. 3000) oder http://host:port');
    }
  } else if (type === 'redirect') {
    if (!/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[\w./%-]*)?$/i.test(target)) throw new Error('Weiterleitungsziel ungültig (https://…).');
    target = target.replace(/\/$/, '');
  } else if (type === 'game') {
    if (!/^(minecraft|fivem):[\w-]+$/.test(target)) throw new Error('Gameserver auswählen.');
  } else target = null;
  let root = body.root ?? existing?.root ?? null;
  if (root) {
    root = String(root).trim();
    if (!/^\/[\w./-]+$/.test(root) || root.includes('..')) throw new Error('Ordner ungültig.');
  }
  const ssl = String(body.ssl ?? existing?.ssl ?? 'none');
  if (!['none', 'letsencrypt', 'existing', 'auto'].includes(ssl)) throw new Error('SSL-Option ungültig.');
  return {
    type, domain, aliases, target, root: type === 'static' || type === 'php' ? root : null, ssl,
    cert: ssl === 'existing' ? String(body.cert ?? existing?.cert ?? '') : null,
    force_https: body.forceHttps !== undefined ? !!body.forceHttps : existing ? existing.force_https : true,
    websocket: body.websocket !== undefined ? !!body.websocket : existing ? existing.websocket : true,
    note: body.note !== undefined ? String(body.note || '').slice(0, 120) : existing?.note || null,
    server_key: body.serverKey !== undefined ? body.serverKey || null : existing?.server_key || null,
  };
}

async function certFor(site) {
  if (site.ssl === 'existing') {
    const all = await listCertificates();
    const c = all.find((x) => x.id === site.cert);
    if (!c) throw new Error('Zertifikat nicht gefunden.');
    return c;
  }
  if (site.ssl === 'letsencrypt') {
    const dir = `/etc/letsencrypt/live/${site.domain}`;
    if (fs.existsSync(`${dir}/fullchain.pem`)) return { cert: `${dir}/fullchain.pem`, key: `${dir}/privkey.pem` };
  }
  return null;
}

function renderFor(ws, site, cert) {
  if (ws === 'nginx') return nginxConf(site, cert);
  if (ws === 'apache') return apacheConf(site, cert);
  return caddyConf(site);
}

/**
 * Seite anlegen oder ändern (Hintergrund-Job, weil Let's Encrypt dauern kann).
 */
export function saveSite(db, body, { id = null, email = '' } = {}) {
  const existing = id ? getSite(db, id) : null;
  if (id && !existing) throw new Error('Seite nicht gefunden.');
  const site = normalizeInput(body, existing);
  const clash = db.prepare('SELECT id FROM host_sites WHERE domain = ?').get(site.domain);
  if (clash && clash.id !== Number(id)) throw new Error('Diese Domain ist schon eingetragen.');
  const foreign = listForeignSites().find((f) => f.domains.includes(site.domain));
  if (foreign && site.type !== 'game') throw new Error(`Die Domain wird schon von ${foreign.file} (${foreign.webserver}) bedient — Orbit ändert fremde Konfigurationen nicht.`);
  if (site.ssl === 'letsencrypt' && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error("Für Let's Encrypt wird eine E-Mail-Adresse gebraucht.");

  return startJob('site', `${site.domain} ${existing ? 'aktualisieren' : 'einrichten'}`, async (log, step) => {
    let ws = null;
    if (site.type !== 'game') {
      ws = existing?.webserver || await activeWebserver();
      if (!ws) throw new Error('Kein Webserver installiert — zuerst nginx, Apache oder Caddy installieren.');
      if (ws === 'caddy' && site.ssl !== 'none') site.ssl = 'auto';
      step(`Webserver: ${WEBSERVERS[ws].label}`);
      await prepareWebserver(ws);
      ensureRoot(site, log);
      if (existing && existing.domain !== site.domain && existing.webserver) {
        removeFiles(existing.webserver, existing.domain);
        await reload(existing.webserver).catch(() => {});
      }
      let cert = ws === 'caddy' ? null : await certFor(site);
      if (site.ssl === 'letsencrypt' && !cert) {
        step('HTTP-Konfiguration für die Zertifikatsprüfung');
        await applyFile(ws, site.domain, renderFor(ws, site, null));
        step("Zertifikat bei Let's Encrypt anfordern");
        const dnsr = await checkDns(site.domain);
        if (!dnsr.ok) log(`Achtung: ${site.domain} zeigt noch nicht auf diesen Server (${dnsr.records.join(', ') || 'kein A-Record'}).`, 'warn');
        const args = ['certonly', '--webroot', '-w', ACME_ROOT(), '--non-interactive', '--agree-tos', '--keep-until-expiring', '-m', email, '--cert-name', site.domain, '-d', site.domain, ...site.aliases.flatMap((a) => ['-d', a])];
        if (!(await has('certbot'))) {
          step('certbot installieren');
          await aptInstall(['certbot'], log);
        }
        const r = await run('certbot', args, { timeout: 180000, allowFail: true });
        log(r.stdout + r.stderr);
        if (r.code !== 0) throw new Error(`Let's Encrypt hat das Zertifikat abgelehnt. Prüfe, ob die Domain auf diesen Server zeigt und Port 80 erreichbar ist (bei Cloudflare: SSL-Modus „Flexible“ oder „Full“, kein „Always use HTTPS“ vor dem ersten Zertifikat). Die Seite läuft vorerst ohne HTTPS.`);
        cert = await certFor(site);
      }
      step('Konfiguration schreiben und testen');
      const file = await applyFile(ws, site.domain, renderFor(ws, site, cert));
      log(`Aktiv: ${file}`, 'ok');
    }
    const now = Date.now();
    if (existing) {
      db.prepare('UPDATE host_sites SET domain=?, aliases=?, type=?, target=?, root=?, ssl=?, cert=?, force_https=?, websocket=?, webserver=?, server_key=?, note=?, updated=? WHERE id=?')
        .run(site.domain, JSON.stringify(site.aliases), site.type, site.target, site.root, site.ssl, site.cert, site.force_https ? 1 : 0, site.websocket ? 1 : 0, ws, site.server_key, site.note, now, existing.id);
      return { id: existing.id };
    }
    const info = db.prepare('INSERT INTO host_sites (domain, aliases, type, target, root, ssl, cert, force_https, websocket, webserver, server_key, note, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(site.domain, JSON.stringify(site.aliases), site.type, site.target, site.root, site.ssl, site.cert, site.force_https ? 1 : 0, site.websocket ? 1 : 0, ws, site.server_key, site.note, now, now);
    return { id: Number(info.lastInsertRowid) };
  });
}

export async function setSiteEnabled(db, id, on) {
  const site = getSite(db, id);
  if (!site) throw new Error('Seite nicht gefunden.');
  if (site.webserver) {
    const content = fs.readFileSync(filesFor(site.webserver, site.domain).avail, 'utf8');
    if (site.webserver === 'caddy') {
      const f = filesFor('caddy', site.domain).avail;
      if (on) fs.writeFileSync(f, content.replace(/^#disabled /gm, ''));
      else fs.writeFileSync(f, content.split('\n').map((l) => (l.startsWith('#') ? l : `#disabled ${l}`)).join('\n'));
      await testConfig('caddy');
      await reload('caddy');
    } else await applyFile(site.webserver, site.domain, content, { enable: on });
  }
  db.prepare('UPDATE host_sites SET enabled = ?, updated = ? WHERE id = ?').run(on ? 1 : 0, Date.now(), site.id);
}

export async function deleteSite(db, id, { deleteFiles = false } = {}) {
  const site = getSite(db, id);
  if (!site) throw new Error('Seite nicht gefunden.');
  if (site.webserver) {
    removeFiles(site.webserver, site.domain);
    await testConfig(site.webserver).catch(() => {});
    await reload(site.webserver).catch(() => {});
  }
  if (deleteFiles && (site.type === 'static' || site.type === 'php') && !site.root) {
    fs.rmSync(path.join(WWW_ROOT(), site.domain), { recursive: true, force: true });
  }
  db.prepare('DELETE FROM host_sites WHERE id = ?').run(site.id);
}

export function siteConfig(db, id) {
  const site = getSite(db, id);
  if (!site?.webserver) return null;
  try { return fs.readFileSync(filesFor(site.webserver, site.domain).avail, 'utf8'); } catch { return null; }
}

export function installWebserver(id) {
  const w = WEBSERVERS[id];
  if (!w) throw new Error('Unbekannter Webserver.');
  return startJob('install', `${w.label} installieren`, async (log, step) => {
    const cur = await activeWebserver();
    if (cur === id) { log(`${w.label} ist bereits installiert.`, 'ok'); return { already: true }; }
    if (cur) {
      const s = await serviceStatus(cur);
      if (s.active) throw new Error(`${WEBSERVERS[cur].label} läuft bereits auf Port 80/443 — zwei Webserver gleichzeitig gehen nicht.`);
    }
    step(`${w.label} wird installiert`);
    await aptInstall([w.pkg], log);
    if (process.env.ORBIT_HOST_DRYRUN === '1') return { dryRun: true };
    await prepareWebserver(id);
    const unit = id === 'apache' ? 'apache2' : id;
    await run('systemctl', ['enable', '--now', unit], { timeout: 60000 });
    log(`${w.label} läuft.`, 'ok');
    return {};
  });
}

/** DNS-Anleitung für Cloudflare (oder jeden anderen DNS-Anbieter) */
export function dnsGuide(site, { ip, gamePort = null, game = null } = {}) {
  const sub = site.domain;
  if (site.type === 'game') {
    const recs = [{ type: 'A', name: sub, value: ip || '<Server-IP>', proxy: false, note: 'Proxy AUS (graue Wolke) — Gameserver-Verkehr kann nicht über Cloudflare laufen' }];
    if (game === 'minecraft' && gamePort && gamePort !== 25565) {
      recs.push({ type: 'SRV', name: `_minecraft._tcp.${sub}`, value: `0 5 ${gamePort} ${sub}`, proxy: false, note: `Damit Spieler ohne :${gamePort} verbinden können` });
    }
    return recs;
  }
  return [{ type: 'A', name: sub, value: ip || '<Server-IP>', proxy: true, note: 'Proxy AN (orange Wolke) schützt die Seite; AUS geht auch' }, ...site.aliases.map((a) => ({ type: 'A', name: a, value: ip || '<Server-IP>', proxy: true, note: 'Alias' }))];
}
