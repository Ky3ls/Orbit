import fs from 'node:fs';
import os from 'node:os';
import { isBlockedPath } from '../serverPathPolicy.js';
import { run } from './exec.js';

/*
 * Live-Statistik des Hosts: Sampler alle 5 s (CPU, RAM, Swap, Netz, Datenträger, Last),
 * Prozesse alle 10 s — zugeordnet zu Verursachern (einzelne Gameserver, Datenbanken, Webserver, Orbit …).
 * Verlauf: 1 Stunde im Speicher.
 */
const STEP = 5000;
const KEEP = 720; // 1 h
const history = [];
let last = null;
let consumers = [];
let processes = [];
let resolveEntities = () => ({ mc: [], fx: null });
let timer = null;
let tick = 0;

function readCpu() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = v[3] + (v[4] || 0);
  const total = v.reduce((a, b) => a + b, 0);
  return { idle, total, iowait: v[4] || 0 };
}

function readMem() {
  const m = {};
  for (const l of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
    const [k, val] = l.split(':');
    if (val) m[k.trim()] = Number(val.trim().split(/\s+/)[0]) * 1024;
  }
  const total = m.MemTotal || 0;
  const avail = m.MemAvailable ?? m.MemFree ?? 0;
  const cache = (m.Cached || 0) + (m.Buffers || 0) + (m.SReclaimable || 0) - (m.Shmem || 0);
  return { total, used: total - avail, avail, cache: Math.max(0, cache), swapTotal: m.SwapTotal || 0, swapUsed: (m.SwapTotal || 0) - (m.SwapFree || 0) };
}

function readNet() {
  let rx = 0;
  let tx = 0;
  for (const l of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
    const [name, rest] = l.split(':');
    if (!rest) continue;
    const n = name.trim();
    if (n === 'lo' || /^(docker|veth|br-|virbr)/.test(n)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    rx += f[0];
    tx += f[8];
  }
  return { rx, tx };
}

function physicalDisks() {
  try {
    return fs.readdirSync('/sys/block').filter((d) => !/^(loop|ram|zram|sr|dm-)/.test(d));
  } catch { return []; }
}
const DISKS = physicalDisks();

function readDisk() {
  let r = 0;
  let w = 0;
  for (const l of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
    const f = l.trim().split(/\s+/);
    if (f.length < 10 || !DISKS.includes(f[2])) continue;
    r += Number(f[5]) * 512;
    w += Number(f[9]) * 512;
  }
  return { r, w };
}

function diskUsage() {
  try { const s = fs.statfsSync('/'); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; }
}

/* ── Prozesse → Verursacher ── */
const CATS = ['minecraft', 'fivem', 'database', 'web', 'orbit', 'other'];

function classify(p, ent) {
  const mc = ent.mc.find((i) => p.cwd && (p.cwd === i.path || p.cwd.startsWith(`${i.path}/`)));
  if (mc) return { key: `minecraft:${mc.id}`, name: mc.name, cat: 'minecraft', game: 'minecraft' };
  if (/ld-musl|FXServer|citizen/i.test(`${p.comm} ${p.args}`) || (ent.fx?.cwd && p.cwd && p.cwd.startsWith(ent.fx.cwd))) return { key: 'fivem', name: ent.fx?.name || 'FiveM', cat: 'fivem', game: 'fivem' };
  if (p.pid === process.pid) return { key: 'orbit', name: 'Orbit-Panel', cat: 'orbit' };
  if (/^(mysqld|mariadbd)$/.test(p.comm)) return { key: 'db:mysql', name: p.comm === 'mariadbd' ? 'MariaDB' : 'MySQL', cat: 'database' };
  if (/^postgres/.test(p.comm)) return { key: 'db:postgresql', name: 'PostgreSQL', cat: 'database' };
  if (/^redis-server/.test(p.comm)) return { key: 'db:redis', name: 'Redis', cat: 'database' };
  if (/^nginx/.test(p.comm)) return { key: 'web:nginx', name: 'nginx', cat: 'web' };
  if (/^(apache2|httpd)/.test(p.comm)) return { key: 'web:apache', name: 'Apache', cat: 'web' };
  if (/^caddy/.test(p.comm)) return { key: 'web:caddy', name: 'Caddy', cat: 'web' };
  if (/^php-fpm/.test(p.comm)) return { key: 'web:php', name: 'PHP-FPM', cat: 'web' };
  if (p.user === 'orbit-mc' && /java/.test(p.comm)) return { key: `java:${p.pid}`, name: 'Minecraft (fremd)', cat: 'minecraft', game: 'minecraft' };
  if (/java/.test(p.comm)) return { key: `java:${p.pid}`, name: `Java (${p.user})`, cat: 'other' };
  const exe = String(p.args || '').split(' ')[0].split('/').pop() || p.comm;
  const name = /^(MainThread|.*-[0-9a-f]{6,}|\d.*)$/.test(p.comm) || p.comm.length >= 15 ? exe : p.comm;
  return { key: `proc:${name}`, name, cat: 'other' };
}

async function sampleProcesses() {
  const r = await run('ps', ['-eo', 'pid=,ppid=,user:20=,rss=,pcpu=,etimes=,comm=,args='], { timeout: 8000, allowFail: true, maxBuffer: 16 << 20 });
  const ent = resolveEntities();
  const list = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    let args = m[8].slice(0, 300);
    // Gesperrte Pfade (Pfad-Policy) auch in Befehlszeilen nicht zeigen
    if (args.split(/\s+/).some((tok) => tok.startsWith('/') && isBlockedPath(tok))) args = '(ausgeblendet)';
    const p = { pid: Number(m[1]), ppid: Number(m[2]), user: m[3], rss: Number(m[4]) * 1024, cpu: Number(m[5]), age: Number(m[6]), comm: m[7], args };
    if (!p.rss) continue;
    if (p.rss > 20 * 1024 * 1024 || /java|ld-musl|mysqld|mariadbd|postgres|nginx|php-fpm|redis/.test(p.comm)) {
      try { p.cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`); } catch { /* */ }
    }
    list.push(p);
  }
  // CPU-Werte aus ps sind Lebenszeit-Mittel — für „jetzt“ aus /proc/<pid>/stat-Deltas rechnen
  const now = Date.now();
  const hz = 100;
  for (const p of list) {
    try {
      const st = fs.readFileSync(`/proc/${p.pid}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      const ticks = Number(f[11]) + Number(f[12]);
      const prev = cpuTicks.get(p.pid);
      if (prev) p.cpuNow = Math.max(0, ((ticks - prev.ticks) / hz) / ((now - prev.t) / 1000) * 100);
      cpuTicks.set(p.pid, { ticks, t: now });
    } catch { /* */ }
  }
  for (const pid of cpuTicks.keys()) if (!list.some((p) => p.pid === pid)) cpuTicks.delete(pid);

  const groups = new Map();
  for (const p of list) {
    const c = classify(p, ent);
    p.owner = c;
    let g = groups.get(c.key);
    if (!g) { g = { ...c, rss: 0, cpu: 0, pids: 0, main: p }; groups.set(c.key, g); }
    g.rss += p.rss;
    g.cpu += p.cpuNow ?? 0;
    g.pids += 1;
    if (p.rss > g.main.rss) g.main = p;
  }
  // kleine Einzelprozesse unter „Andere Prozesse“ bündeln
  const big = [];
  const rest = { key: 'other:rest', name: 'Andere Prozesse', cat: 'other', rss: 0, cpu: 0, pids: 0 };
  for (const g of groups.values()) {
    if (g.cat === 'other' && g.rss < 80 * 1024 * 1024) { rest.rss += g.rss; rest.cpu += g.cpu; rest.pids += g.pids; continue; }
    big.push({ key: g.key, name: g.name, cat: g.cat, game: g.game, rss: g.rss, cpu: Math.round(g.cpu * 10) / 10, pids: g.pids, pid: g.main.pid, since: g.main.age ? now - g.main.age * 1000 : null });
  }
  if (rest.pids) big.push({ ...rest, cpu: Math.round(rest.cpu * 10) / 10 });
  consumers = big.sort((a, b) => b.rss - a.rss);
  processes = list.sort((a, b) => b.rss - a.rss).slice(0, 15).map((p) => ({
    pid: p.pid, user: p.user, comm: p.comm, args: p.args, rss: p.rss, cpu: Math.round((p.cpuNow ?? p.cpu) * 10) / 10, owner: p.owner?.name, cat: p.owner?.cat, since: now - p.age * 1000,
  }));
}
const cpuTicks = new Map();

function sample() {
  const t = Date.now();
  const cpu = readCpu();
  const mem = readMem();
  const net = readNet();
  const disk = readDisk();
  const point = { t, mem: mem.used, cache: mem.cache, swap: mem.swapUsed, load: os.loadavg()[0] };
  if (last) {
    const dt = (t - last.t) / 1000;
    const dTotal = cpu.total - last.cpu.total;
    point.cpu = dTotal > 0 ? Math.max(0, Math.min(100, (1 - (cpu.idle - last.cpu.idle) / dTotal) * 100)) : 0;
    point.iowait = dTotal > 0 ? Math.max(0, ((cpu.iowait - last.cpu.iowait) / dTotal) * 100) : 0;
    point.rx = Math.max(0, (net.rx - last.net.rx) / dt);
    point.tx = Math.max(0, (net.tx - last.net.tx) / dt);
    point.dr = Math.max(0, (disk.r - last.disk.r) / dt);
    point.dw = Math.max(0, (disk.w - last.disk.w) / dt);
    // RAM je Bereich (aus der letzten Prozess-Messung)
    if (consumers.length) {
      const by = Object.fromEntries(CATS.map((c) => [c, 0]));
      for (const c of consumers) by[c.cat] = (by[c.cat] || 0) + c.rss;
      point.cats = by;
    }
    history.push(point);
    if (history.length > KEEP) history.shift();
  }
  last = { t, cpu, net, disk, mem };
}

export function startStats(resolver) {
  if (resolver) resolveEntities = resolver;
  if (timer) return;
  try { sample(); } catch { /* */ }
  sampleProcesses().catch(() => {});
  timer = setInterval(() => {
    try { sample(); } catch { /* */ }
    tick += 1;
    if (tick % 2 === 0) sampleProcesses().catch(() => {});
  }, STEP);
  timer.unref?.();
}

export function statsSnapshot(since = 0) {
  const mem = readMem();
  const cur = history[history.length - 1] || {};
  return {
    step: STEP,
    cores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || '',
    uptime: os.uptime(),
    load: os.loadavg(),
    mem,
    disk: diskUsage(),
    now: cur,
    history: since ? history.filter((p) => p.t > since) : history,
    consumers,
    processes,
    categories: CATS,
  };
}
