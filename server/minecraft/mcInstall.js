import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MC_ROOT, getMcInstance, insertMcInstance, listMcInstances, uniqueSlug, updateMcInstance } from './mcDb.js';
import { download, ensureJava } from './mcJava.js';
import { writeProperties } from './mcProperties.js';
import { requiredJava, resolveDownload, typeMeta } from './mcSources.js';
import { startMc } from './mcProcess.js';

/** Laufende/abgeschlossene Installations-Jobs (im Speicher) */
const jobs = new Map();
let jobSeq = 0;

export function getJob(id) {
  return jobs.get(Number(id)) || null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

/** Nächster freier Port ab 25565 (belegte Ports anderer Instanzen/Prozesse überspringen) */
export async function suggestPort(db, from = 25565) {
  const used = new Set(listMcInstances(db).map((i) => Number(i.port)));
  for (let p = from; p < from + 200; p += 1) {
    if (used.has(p)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await portFree(p)) return p;
  }
  throw new Error('Kein freier Port gefunden.');
}

export async function isPortAvailable(db, port, exceptId) {
  const clash = listMcInstances(db).find((i) => Number(i.port) === Number(port) && Number(i.id) !== Number(exceptId));
  if (clash) return { ok: false, reason: `Port wird schon von „${clash.name}“ genutzt.` };
  if (!(await portFree(Number(port)))) return { ok: false, reason: `Port ${port} ist auf dem Host belegt.` };
  return { ok: true };
}

function runInstaller(javaBin, cwd, log) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaBin, ['-jar', 'installer.jar', '--installServer'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let last = 0;
    const onData = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        // Installer ist sehr gesprächig — nur jede ~2s eine Zeile weiterreichen
        if (Date.now() - last > 2000 || /error|fail|success|done/i.test(line)) {
          last = Date.now();
          log('info', line.slice(0, 200));
        }
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Installer-Timeout (15 min).')); }, 15 * 60_000);
    p.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Installer beendet mit Code ${code}.`));
    });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function findFile(dir, re, depth = 6) {
  if (depth < 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && re.test(p)) return p;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findFile(path.join(dir, e.name), re, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Instanz anlegen und im Hintergrund installieren.
 * @param {{ name: string, type: string, mcVersion: string, loaderVersion?: string, port: number, ramMb: number,
 *   eula: boolean, autostart?: boolean, startAfter?: boolean, properties?: Record<string, string> }} opts
 */
export async function createInstance(db, opts, log = () => {}) {
  if (!typeMeta(opts.type)) throw new Error('Unbekannter Server-Typ.');
  if (!opts.eula) throw new Error('Die Minecraft-EULA muss akzeptiert werden.');
  const name = String(opts.name || '').trim().slice(0, 40);
  if (name.length < 2) throw new Error('Name zu kurz.');
  const port = Number(opts.port);
  const avail = await isPortAvailable(db, port);
  if (!avail.ok) throw new Error(avail.reason);
  const ramMb = Math.max(1024, Math.min(65536, Math.round(Number(opts.ramMb) / 256) * 256 || 4096));
  const slug = uniqueSlug(db, name);
  const dir = path.join(MC_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });
  const inst = insertMcInstance(db, {
    slug, name, type: opts.type, mcVersion: opts.mcVersion, loaderVersion: opts.loaderVersion,
    path: dir, port, ramMb, autostart: !!opts.autostart,
  });

  const job = { id: ++jobSeq, instanceId: inst.id, done: false, error: null, step: 'Vorbereiten', progress: 0, log: [] };
  jobs.set(job.id, job);
  const jlog = (level, text) => {
    job.log.push({ t: Date.now(), level, text });
    if (job.log.length > 400) job.log.shift();
  };
  const step = (name, progress) => { job.step = name; job.progress = progress; jlog('step', name); };

  (async () => {
    try {
      step('Java prüfen', 5);
      const major = await requiredJava(opts.mcVersion);
      jlog('info', `Minecraft ${opts.mcVersion} benötigt Java ${major}`);
      const java = await ensureJava(major, jlog);
      updateMcInstance(db, inst.id, { java_major: java.major, java_path: java.bin });

      step('Server-Dateien laden', 25);
      const dl = await resolveDownload(opts.type, opts.mcVersion, opts.loaderVersion);
      jlog('info', `Quelle: ${dl.url}`);
      await download(dl.url, path.join(dir, dl.file), (pct) => { job.progress = 25 + Math.round(pct * 0.35); jlog('info', `Download ${pct}%`); });
      if (dl.loaderVersion) updateMcInstance(db, inst.id, { loader_version: dl.loaderVersion });

      let launch = { mode: 'jar', jar: 'server.jar' };
      if (dl.installer) {
        step(`${typeMeta(opts.type).label}-Installer ausführen`, 62);
        await runInstaller(java.bin, dir, jlog);
        const argsFile = findFile(path.join(dir, 'libraries'), /(minecraftforge\/forge|neoforged\/neoforge)\/[^/]+\/unix_args\.txt$/);
        if (argsFile) {
          launch = { mode: 'args', argsFile: path.relative(dir, argsFile) };
        } else {
          const jar = fs.readdirSync(dir).find((f) => /^forge-.*\.jar$/.test(f) && !/installer/.test(f));
          if (!jar) throw new Error('Installer lief, aber kein Startskript gefunden.');
          launch = { mode: 'jar', jar };
        }
        for (const f of ['installer.jar', 'installer.jar.log', 'run.bat']) fs.rmSync(path.join(dir, f), { force: true });
      }
      updateMcInstance(db, inst.id, { launch: JSON.stringify(launch) });

      step('Konfiguration schreiben', 85);
      fs.writeFileSync(path.join(dir, 'eula.txt'), `# Akzeptiert über Orbit am ${new Date().toISOString()}\neula=true\n`);
      const kind = typeMeta(opts.type).kind;
      writeProperties(dir, {
        'server-port': port,
        'query.port': port,
        motd: name,
        'max-players': 20,
        difficulty: 'normal',
        'view-distance': 10,
        'simulation-distance': 10,
        'allow-flight': kind === 'mods' ? 'true' : 'false',
        'enable-rcon': 'false',
        ...(opts.properties || {}),
      });
      for (const sub of kind === 'plugins' ? ['plugins'] : kind === 'mods' ? ['mods', 'config'] : []) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
      }
      updateMcInstance(db, inst.id, { state: 'ready' });
      step('Fertig', 100);
      jlog('ok', `${name} ist bereit.`);
      log('ok', `[MC:${slug}] installiert (${opts.type} ${opts.mcVersion})`);
      if (opts.startAfter) await startMc(db, inst.id, log);
    } catch (err) {
      job.error = err.message;
      jlog('bad', err.message);
      updateMcInstance(db, inst.id, { state: 'failed' });
      log('warn', `[MC:${slug}] Installation fehlgeschlagen: ${err.message}`);
    } finally {
      job.done = true;
    }
  })();

  return { instance: getMcInstance(db, inst.id), jobId: job.id };
}
