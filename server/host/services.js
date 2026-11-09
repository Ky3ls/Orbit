import { has, run } from './exec.js';

/*
 * Bekannte Dienste auf dem Host. Orbit steuert nur diese — keine beliebigen Units.
 */
export const KNOWN = [
  { id: 'nginx', unit: 'nginx', label: 'nginx', kind: 'web', bin: 'nginx', ports: [80, 443] },
  { id: 'apache', unit: 'apache2', label: 'Apache', kind: 'web', bin: 'apache2', ports: [80, 443] },
  { id: 'caddy', unit: 'caddy', label: 'Caddy', kind: 'web', bin: 'caddy', ports: [80, 443] },
  { id: 'mysql', unit: 'mysql', label: 'MySQL', kind: 'db', bin: 'mysqld', ports: [3306] },
  { id: 'mariadb', unit: 'mariadb', label: 'MariaDB', kind: 'db', bin: 'mariadbd', ports: [3306] },
  { id: 'postgresql', unit: 'postgresql', label: 'PostgreSQL', kind: 'db', bin: 'psql', ports: [5432] },
  { id: 'redis', unit: 'redis-server', label: 'Redis', kind: 'db', bin: 'redis-server', ports: [6379] },
  { id: 'php', unit: null, label: 'PHP-FPM', kind: 'runtime', bin: null, ports: [] },
];

async function phpUnit() {
  const r = await run('systemctl', ['list-unit-files', '--type=service', '--no-legend', 'php*-fpm.service'], { allowFail: true });
  const units = r.stdout.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((u) => /^php[\d.]+-fpm\.service$/.test(u));
  return units.sort().pop()?.replace(/\.service$/, '') || null;
}

export async function unitOf(id) {
  const s = KNOWN.find((k) => k.id === id);
  if (!s) throw new Error('Unbekannter Dienst.');
  return s.unit || (id === 'php' ? phpUnit() : null);
}

async function unitInfo(unit) {
  const r = await run('systemctl', ['show', unit, '--no-pager', '--property=LoadState,ActiveState,SubState,UnitFileState,ActiveEnterTimestamp,MainPID,MemoryCurrent'], { allowFail: true });
  const p = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) p[line.slice(0, i)] = line.slice(i + 1);
  }
  const since = p.ActiveEnterTimestamp ? Date.parse(p.ActiveEnterTimestamp.replace(/^\w+ /, '')) : NaN;
  return {
    installed: p.LoadState === 'loaded',
    active: p.ActiveState === 'active',
    state: p.ActiveState || 'unknown',
    sub: p.SubState || '',
    enabled: p.UnitFileState === 'enabled',
    since: Number.isFinite(since) ? since : null,
    pid: Number(p.MainPID) || null,
    memory: Number(p.MemoryCurrent) && p.MemoryCurrent !== '[not set]' ? Number(p.MemoryCurrent) : null,
  };
}

async function versionOf(id) {
  const tries = {
    nginx: ['nginx', ['-v']],
    apache: ['apache2', ['-v']],
    caddy: ['caddy', ['version']],
    mysql: ['mysqld', ['--version']],
    mariadb: ['mariadbd', ['--version']],
    postgresql: ['psql', ['--version']],
    redis: ['redis-server', ['--version']],
    php: ['php', ['-v']],
  }[id];
  if (!tries) return null;
  const r = await run(tries[0], tries[1], { allowFail: true, timeout: 5000 }).catch(() => null);
  const txt = `${r?.stdout || ''} ${r?.stderr || ''}`;
  const m = txt.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

export async function serviceStatus(id) {
  const k = KNOWN.find((s) => s.id === id);
  const unit = await unitOf(id);
  if (!unit) return { ...k, unit: null, installed: false, active: false, state: 'missing' };
  const info = await unitInfo(unit);
  // MySQL-Paket von MariaDB: Unit „mysql“ zeigt auf mariadb → doppelt vermeiden
  if (id === 'mysql' && info.installed && await has('mariadbd')) return { ...k, unit, installed: false, active: false, state: 'alias' };
  return { ...k, unit, ...info, version: info.installed ? await versionOf(id) : null };
}

export async function listServices() {
  const out = await Promise.all(KNOWN.map((k) => serviceStatus(k.id).catch(() => ({ ...k, installed: false }))));
  return out.filter((s) => s.state !== 'alias');
}

export async function controlService(id, action) {
  if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(action)) throw new Error('Aktion ungültig.');
  const unit = await unitOf(id);
  if (!unit) throw new Error('Dienst ist nicht installiert.');
  // Webserver: vor Neustart/Reload die Konfiguration prüfen, sonst bleibt er danach aus
  if (['restart', 'reload', 'start'].includes(action)) {
    if (id === 'nginx') await run('nginx', ['-t'], { timeout: 15000 });
    if (id === 'apache') await run('apache2ctl', ['configtest'], { timeout: 15000 });
    if (id === 'caddy') await run('caddy', ['validate', '--config', '/etc/caddy/Caddyfile'], { timeout: 15000 });
  }
  if (action === 'enable' || action === 'disable') await run('systemctl', [action, unit], { timeout: 30000 });
  else await run('systemctl', [action, unit], { timeout: 90000 });
  return serviceStatus(id);
}

export async function serviceLog(id, lines = 120) {
  const unit = await unitOf(id);
  if (!unit) throw new Error('Dienst ist nicht installiert.');
  const r = await run('journalctl', ['-u', unit, '-n', String(Math.min(500, lines)), '--no-pager', '-o', 'short-iso'], { allowFail: true, timeout: 10000 });
  return r.stdout.split('\n').filter(Boolean);
}
