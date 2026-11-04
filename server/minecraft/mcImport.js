import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { isBlockedPath, normalizeServerPath } from '../serverPathPolicy.js';
import { MC_ROOT, getMcInstance, insertMcInstance, listMcInstances, uniqueSlug, updateMcInstance } from './mcDb.js';
import { isPortAvailable, suggestPort } from './mcInstall.js';
import { ensureJava } from './mcJava.js';
import { readProperties, writeProperties } from './mcProperties.js';
import { suggestRam } from './mcRam.js';
import { neoToMc, requiredJava } from './mcSources.js';

/*
 * Bestehende Minecraft-Server übernehmen: finden → analysieren → kopieren (oder vor Ort) → Instanz.
 * Das Original wird beim Kopieren nur gelesen.
 */
const run = promisify(execFile);
const SCAN_ROOTS = ['/root', '/home', '/opt', '/srv', '/var/games', '/mnt', '/data'];
const PRUNE = new Set(['world', 'world_nether', 'world_the_end', 'libraries', 'mods', 'plugins', 'node_modules', '.git', 'logs', 'crash-reports',
  'cache', 'config', 'versions', 'proc', 'sys', 'dev', 'tmp', 'backups', 'backup', 'dist', 'kubejs', 'defaultconfigs', 'region', 'DIM-1', 'DIM1']);

const jobs = new Map();
let jobSeq = 0;
export const getImportJob = (id) => jobs.get(Number(id)) || null;

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function ls(dir) { try { return fs.readdirSync(dir); } catch { return []; } }
function readText(p, max = 64 * 1024) {
  try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(max); const n = fs.readSync(fd, b, 0, max, 0); fs.closeSync(fd); return b.subarray(0, n).toString('utf8'); } catch { return ''; }
}
const verCmp = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** Laufende Java-Prozesse mit Arbeitsordner (für „läuft gerade“) */
function javaProcsByCwd() {
  const out = new Map();
  for (const pid of ls('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      if (comm !== 'java') continue;
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      out.set(cwd, Number(pid));
    } catch { /* Prozess weg / keine Rechte */ }
  }
  return out;
}

/** Start-Skripte nach RAM und Forge-Args durchsuchen */
function scriptHints(dir) {
  const files = ['user_jvm_args.txt', 'start.sh', 'run.sh', 'start_once.sh', 'launch.sh', 'ServerStart.sh', 'start.bat', 'run.bat'];
  let ramMb = null;
  let argsFile = null;
  let jar = null;
  for (const f of files) {
    const raw = readText(path.join(dir, f));
    if (!raw) continue;
    // Kommentarzeilen (#, REM, ::) ignorieren — gilt der zuletzt gesetzte Wert
    const t = raw.split(/\r?\n/).filter((l) => !/^\s*(#|rem\b|::)/i.test(l)).join('\n');
    const xmx = [...t.matchAll(/-Xmx(\d+)([GgMm])/g)].at(-1);
    if (xmx && !ramMb) ramMb = Number(xmx[1]) * (/g/i.test(xmx[2]) ? 1024 : 1);
    const af = t.match(/@(libraries\/[^\s"']+unix_args\.txt)/);
    if (af && !argsFile && exists(path.join(dir, af[1]))) argsFile = af[1];
    const j = t.match(/-jar\s+"?([\w.+-]+\.jar)/);
    if (j && !jar && exists(path.join(dir, j[1]))) jar = j[1];
  }
  return { ramMb, argsFile, jar };
}

/** Typ, Version, Loader und Start-Methode erkennen */
export function detectServer(dirIn) {
  const dir = normalizeServerPath(dirIn);
  if (!path.isAbsolute(dir)) throw new Error('Pfad muss absolut sein.');
  if (isBlockedPath(dir)) throw new Error('Dieser Pfad ist gesperrt.');
  if (!exists(path.join(dir, 'server.properties')) && !ls(dir).some((f) => /\.jar$/.test(f))) {
    throw new Error('Kein Minecraft-Server gefunden (keine server.properties oder Server-JAR).');
  }
  const files = ls(dir);
  const props = readProperties(dir);
  const hints = scriptHints(dir);
  const out = {
    path: dir, type: null, mcVersion: null, loaderVersion: null, launch: null,
    port: Number(props['server-port']) || 25565, motd: props.motd || '', levelName: props['level-name'] || 'world',
    maxPlayers: Number(props['max-players']) || 20, viewDistance: Number(props['view-distance']) || 10,
    onlineMode: props['online-mode'] !== 'false', whitelist: props['white-list'] === 'true',
    ramMb: hints.ramMb, notes: [],
  };

  // Forge / NeoForge (moderne Installer: unix_args.txt)
  const neoDir = path.join(dir, 'libraries', 'net', 'neoforged', 'neoforge');
  const forgeDir = path.join(dir, 'libraries', 'net', 'minecraftforge', 'forge');
  const pickArgs = (base, ver) => `libraries/${path.relative(path.join(dir, 'libraries'), path.join(base, ver, 'unix_args.txt'))}`;
  if (hints.argsFile && /neoforged/.test(hints.argsFile)) {
    const v = hints.argsFile.split('/').slice(-2, -1)[0];
    Object.assign(out, { type: 'neoforge', loaderVersion: v, mcVersion: neoToMc(v), launch: { mode: 'args', argsFile: hints.argsFile } });
  } else if (hints.argsFile && /minecraftforge/.test(hints.argsFile)) {
    const v = hints.argsFile.split('/').slice(-2, -1)[0];
    const [mc, loader] = v.split('-');
    Object.assign(out, { type: 'forge', loaderVersion: loader, mcVersion: mc, launch: { mode: 'args', argsFile: hints.argsFile } });
  } else if (exists(neoDir)) {
    const vs = ls(neoDir).filter((v) => exists(path.join(neoDir, v, 'unix_args.txt'))).sort(verCmp);
    const v = vs.at(-1);
    if (v) {
      Object.assign(out, { type: 'neoforge', loaderVersion: v, mcVersion: neoToMc(v), launch: { mode: 'args', argsFile: pickArgs(neoDir, v) } });
      if (vs.length > 1) out.notes.push(`Mehrere NeoForge-Versionen gefunden (${vs.join(', ')}) — die neueste wird genutzt.`);
    }
  } else if (exists(forgeDir)) {
    const vs = ls(forgeDir).filter((v) => exists(path.join(forgeDir, v, 'unix_args.txt'))).sort(verCmp);
    const v = vs.at(-1);
    if (v) {
      const [mc, loader] = v.split('-');
      Object.assign(out, { type: 'forge', loaderVersion: loader, mcVersion: mc, launch: { mode: 'args', argsFile: pickArgs(forgeDir, v) } });
    }
  }

  if (!out.type) {
    const jars = files.filter((f) => /\.jar$/i.test(f) && !/installer/i.test(f));
    const paper = jars.find((f) => /^paper-([\d.]+)-(\d+)\.jar$/.test(f));
    const purpur = jars.find((f) => /^purpur-([\d.]+)-(\d+)\.jar$/.test(f));
    const fabric = jars.find((f) => /^fabric-server-(mc\.|launch)/.test(f));
    const forgeOld = jars.find((f) => /^forge-[\d.]+-[\d.]+(-universal)?\.jar$/.test(f));
    if (paper) {
      const [, mc, build] = paper.match(/^paper-([\d.]+)-(\d+)\.jar$/);
      Object.assign(out, { type: 'paper', mcVersion: mc, loaderVersion: build, launch: { mode: 'jar', jar: paper } });
    } else if (purpur) {
      const [, mc, build] = purpur.match(/^purpur-([\d.]+)-(\d+)\.jar$/);
      Object.assign(out, { type: 'purpur', mcVersion: mc, loaderVersion: build, launch: { mode: 'jar', jar: purpur } });
    } else if (fabric) {
      const m = fabric.match(/mc\.([\d.]+)-loader\.([\d.]+)/);
      let mc = m?.[1] || null;
      if (!mc) {
        const fp = readText(path.join(dir, 'fabric-server-launcher.properties'));
        mc = (fp.match(/serverJar=.*?([\d]+\.[\d.]+)/) || [])[1] || null;
      }
      Object.assign(out, { type: 'fabric', mcVersion: mc, loaderVersion: m?.[2] || null, launch: { mode: 'jar', jar: fabric } });
    } else if (forgeOld) {
      const [, mc, loader] = forgeOld.match(/^forge-([\d.]+)-([\d.]+)/);
      Object.assign(out, { type: 'forge', mcVersion: mc, loaderVersion: loader, launch: { mode: 'jar', jar: forgeOld } });
    } else {
      // Paper/Purpur unter anderem Namen? versions/<mc>/paper-<mc>.jar verrät die Version
      const vdir = ls(path.join(dir, 'versions')).find((v) => /^\d+\.[\d.]+$/.test(v));
      const jar = hints.jar || jars.find((f) => /server|minecraft|spigot|paper|purpur/i.test(f)) || jars[0];
      if (jar) {
        let type = 'vanilla';
        if (vdir && ls(path.join(dir, 'versions', vdir)).some((f) => /^paper-/.test(f))) type = 'paper';
        if (vdir && ls(path.join(dir, 'versions', vdir)).some((f) => /^purpur-/.test(f))) type = 'purpur';
        if (exists(path.join(dir, 'plugins')) && type === 'vanilla') { type = 'paper'; out.notes.push('Plugin-Ordner gefunden — als Paper-kompatibel erkannt.'); }
        Object.assign(out, { type, mcVersion: vdir || null, launch: { mode: 'jar', jar } });
      }
    }
  }
  if (!out.type) throw new Error('Server-Typ konnte nicht erkannt werden (keine Server-JAR, kein Forge/NeoForge-Startskript).');
  if (!out.mcVersion) {
    // Vanilla: version.json im JAR
    out.notes.push('Minecraft-Version nicht im Dateinamen — bitte prüfen.');
  }

  const kind = ['paper', 'purpur'].includes(out.type) ? 'plugins' : ['fabric', 'forge', 'neoforge'].includes(out.type) ? 'mods' : null;
  out.kind = kind;
  out.extensions = kind ? ls(path.join(dir, kind)).filter((f) => /\.jar$/i.test(f)).length : 0;
  out.worlds = ls(dir).filter((f) => exists(path.join(dir, f, 'level.dat')));
  out.players = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'usercache.json'), 'utf8')).length; } catch { return 0; } })();
  out.ops = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'ops.json'), 'utf8')).length; } catch { return 0; } })();
  out.running = javaProcsByCwd().get(dir) || null;
  out.mcsmanager = /\/[0-9a-f]{32}\/?$/.test(dir) || exists(path.join(dir, '.mcsm'));
  out.hasIcon = exists(path.join(dir, 'server-icon.png'));
  out.eula = /eula\s*=\s*true/i.test(readText(path.join(dir, 'eula.txt')));
  // Vor Ort übernehmen geht nur, wenn der Laufzeit-Benutzer alle Elternordner betreten darf
  out.inplaceOk = (() => {
    let d = path.dirname(dir);
    while (d && d !== path.dirname(d)) {
      try { if (!(fs.statSync(d).mode & 0o001)) return false; } catch { return false; }
      d = path.dirname(d);
    }
    return true;
  })();
  return out;
}

/** Ordner nach Servern absuchen (schnell, ohne Größe) */
export function scanServers(db) {
  const managed = new Set(listMcInstances(db).map((i) => path.resolve(i.path)));
  const found = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth < 0 || found.length > 40 || isBlockedPath(dir) || dir.startsWith(path.resolve(MC_ROOT))) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === 'server.properties')) {
      if (!seen.has(dir)) {
        seen.add(dir);
        try { found.push({ ...detectServer(dir), managed: managed.has(dir) }); } catch (e) { found.push({ path: dir, error: e.message }); }
      }
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || PRUNE.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), depth - 1);
    }
  };
  for (const root of SCAN_ROOTS) if (exists(root)) walk(root, 4);
  return found;
}

/** Ordnergröße (für Kopie + Speicherplatz-Check) */
export async function dirSize(dir) {
  try {
    const { stdout } = await run('du', ['-sb', dir], { timeout: 120_000, maxBuffer: 1 << 20 });
    return Number(stdout.split(/\s/)[0]) || 0;
  } catch { return null; }
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}

/** Vollständige Analyse inkl. Größe, Platz, Port, RAM-Vorschlag */
export async function analyzeServer(db, dir) {
  const info = detectServer(dir);
  const [size, port] = await Promise.all([dirSize(info.path), (async () => {
    const chk = await isPortAvailable(db, info.port);
    return chk.ok ? { port: info.port, ok: true } : { port: await suggestPort(db, info.port === 25565 ? 25566 : info.port + 1), ok: false, reason: chk.reason };
  })()]);
  fs.mkdirSync(MC_ROOT, { recursive: true });
  const free = freeBytes(MC_ROOT);
  const ram = suggestRam({ type: info.type, mods: info.extensions, players: info.maxPlayers, viewDistance: info.viewDistance });
  return {
    ...info,
    size,
    free,
    fits: size == null || free == null ? null : free > size + 1024 ** 3,
    port: port.port,
    originalPort: info.port,
    portConflict: port.ok ? null : port.reason,
    ramSuggest: ram.recommended,
    ramMax: ram.max,
    ramReasons: ram.reasons,
    javaMajor: info.mcVersion ? await requiredJava(info.mcVersion) : null,
    managed: listMcInstances(db).some((i) => path.resolve(i.path) === info.path),
  };
}

/** Import starten (Hintergrund-Job) */
export async function importServer(db, opts, log = () => {}) {
  const info = detectServer(opts.path);
  if (listMcInstances(db).some((i) => path.resolve(i.path) === info.path)) throw new Error('Dieser Ordner ist schon eine Orbit-Instanz.');
  const name = String(opts.name || '').trim().slice(0, 40);
  if (name.length < 2) throw new Error('Name zu kurz.');
  const type = opts.type || info.type;
  const mcVersion = String(opts.mcVersion || info.mcVersion || '').trim();
  if (!mcVersion) throw new Error('Minecraft-Version fehlt.');
  const port = Number(opts.port) || info.port;
  const avail = await isPortAvailable(db, port);
  if (!avail.ok) throw new Error(avail.reason);
  const ramMb = Math.max(1024, Math.min(65536, Math.round(Number(opts.ramMb) / 256) * 256 || 4096));
  const mode = opts.mode === 'inplace' ? 'inplace' : 'copy';
  const slug = uniqueSlug(db, name);
  const dest = mode === 'copy' ? path.join(MC_ROOT, slug) : info.path;
  if (mode === 'copy') {
    if (exists(dest)) throw new Error('Zielordner existiert schon.');
    const size = await dirSize(info.path);
    fs.mkdirSync(MC_ROOT, { recursive: true });
    const free = freeBytes(MC_ROOT);
    if (size && free && free < size + 1024 ** 3) throw new Error(`Zu wenig Speicher: ${(size / 1024 ** 3).toFixed(1)} GB nötig, ${(free / 1024 ** 3).toFixed(1)} GB frei.`);
  } else if (info.running) {
    throw new Error('Der Server läuft gerade — zum Übernehmen vor Ort erst stoppen.');
  }

  const inst = insertMcInstance(db, { slug, name, type, mcVersion, loaderVersion: opts.loaderVersion || info.loaderVersion, path: dest, port, ramMb, autostart: !!opts.autostart });
  const job = { id: ++jobSeq, instanceId: inst.id, done: false, error: null, step: 'Vorbereiten', progress: 0, log: [] };
  jobs.set(job.id, job);
  const jlog = (level, text) => { job.log.push({ t: Date.now(), level, text }); if (job.log.length > 400) job.log.shift(); };
  const step = (s, p) => { job.step = s; job.progress = p; jlog('step', s); };

  (async () => {
    try {
      if (mode === 'copy') {
        step('Dateien kopieren', 2);
        jlog('info', `${info.path} → ${dest}`);
        if (info.running) jlog('warn', 'Der Quell-Server läuft — die Welt wird im laufenden Betrieb kopiert. Für eine 100 % saubere Kopie vorher stoppen.');
        await new Promise((resolve, reject) => {
          const args = ['-a', '--info=progress2', '--no-inc-recursive', '--exclude=session.lock', '--exclude=/.orbit/', '--exclude=*.log.gz'];
          if (opts.skipLogs !== false) args.push('--exclude=/logs/', '--exclude=/crash-reports/');
          const p = spawn('rsync', [...args, `${info.path}/`, `${dest}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
          let last = -1;
          p.stdout.on('data', (d) => {
            const m = String(d).match(/(\d+)%/g);
            if (!m) return;
            const pct = Number(m.at(-1).replace('%', ''));
            job.progress = 2 + Math.round(pct * 0.83);
            if (pct >= last + 10) { last = pct; jlog('info', `Kopiert: ${pct}%`); }
          });
          let err = '';
          p.stderr.on('data', (d) => { err += String(d); });
          p.on('exit', (code) => (code === 0 || code === 24 ? resolve() : reject(new Error(`Kopieren fehlgeschlagen (rsync ${code}): ${err.slice(-300)}`))));
          p.on('error', reject);
        });
      }

      step('Java prüfen', 88);
      const major = await requiredJava(mcVersion);
      jlog('info', `Minecraft ${mcVersion} benötigt Java ${major}`);
      const java = await ensureJava(major, jlog);
      updateMcInstance(db, inst.id, { java_major: java.major, java_path: java.bin, launch: JSON.stringify(info.launch) });

      step('Einstellungen übernehmen', 94);
      const patch = { 'server-port': port, 'query.port': port };
      if (opts.motd !== undefined && opts.motd !== info.motd) patch.motd = String(opts.motd).slice(0, 120);
      writeProperties(dest, patch);
      if (!/eula\s*=\s*true/.test(readText(path.join(dest, 'eula.txt')))) {
        if (!opts.eula) throw new Error('Die Minecraft-EULA muss akzeptiert werden.');
        fs.writeFileSync(path.join(dest, 'eula.txt'), `# Akzeptiert über Orbit am ${new Date().toISOString()}\neula=true\n`);
      }
      jlog('info', `Übernommen: ${info.extensions} ${info.kind === 'mods' ? 'Mods' : 'Plugins'}, ${info.worlds.length} Welt(en), ${info.players} Spieler, ${info.ops} OPs`);
      updateMcInstance(db, inst.id, { state: 'ready' });
      step('Fertig', 100);
      jlog('ok', `${name} ist bereit.`);
      log('ok', `[MC:${slug}] importiert aus ${info.path} (${mode})`);
    } catch (err) {
      job.error = err.message;
      jlog('bad', err.message);
      updateMcInstance(db, inst.id, { state: 'failed' });
      log('warn', `[MC:${slug}] Import fehlgeschlagen: ${err.message}`);
    } finally {
      job.done = true;
    }
  })();
  return { instance: getMcInstance(db, inst.id), jobId: job.id };
}
