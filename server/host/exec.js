import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';

/*
 * Host-Befehle für Orbit (läuft als root). Nur execFile/spawn mit Argument-Arrays — keine Shell.
 * Testbarkeit: ORBIT_HOST_DRYRUN=1 lässt apt-get nur simulieren.
 */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 60_000, maxBuffer: opts.maxBuffer ?? 8 << 20, env: { ...process.env, ...opts.env }, input: opts.input }, (err, stdout, stderr) => {
      if (err && !opts.allowFail) {
        const msg = String(stderr || stdout || err.message).trim().split('\n').slice(-6).join('\n');
        const e = new Error(msg || err.message);
        e.code = err.code;
        e.stdout = stdout;
        e.stderr = stderr;
        reject(e);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: err ? (err.code ?? 1) : 0 });
    });
  });
}

/** Mit stdin-Eingabe (z. B. SQL an mysql/psql) */
export function runInput(cmd, args, input, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...opts.env }, cwd: opts.cwd, uid: opts.uid, gid: opts.gid });
    let out = '';
    let err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd}: Zeitüberschreitung`)); }, opts.timeout ?? 60_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0 && !opts.allowFail) reject(new Error((err || out).trim().split('\n').slice(-6).join('\n') || `${cmd} Code ${code}`));
      else resolve({ stdout: out, stderr: err, code });
    });
    p.stdin.end(input);
  });
}

export async function has(cmd) {
  const r = await run('sh', ['-c', `command -v ${cmd.replace(/[^\w.+-]/g, '')}`], { allowFail: true });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

export function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/* ── Hintergrund-Jobs (apt-Installationen) mit Live-Log ── */
const jobs = new Map();
let seq = 1;
let aptChain = Promise.resolve();

export function getJob(id) {
  const j = jobs.get(Number(id));
  if (!j) return null;
  const { promise, ...rest } = j;
  return rest;
}

export function listJobs() {
  return [...jobs.values()].filter((j) => !j.done || Date.now() - j.finished < 600_000).map(({ promise, ...r }) => r);
}

/**
 * Job anlegen. fn(log, setStep) erledigt die Arbeit.
 */
export function startJob(kind, label, fn) {
  const job = { id: seq++, kind, label, step: 'Startet', log: [], done: false, error: null, result: null, started: Date.now(), finished: 0 };
  const log = (text, level = 'info') => {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      job.log.push({ t: Date.now(), level, text: line.slice(0, 400) });
    }
    if (job.log.length > 600) job.log.splice(0, job.log.length - 600);
  };
  const setStep = (s) => { job.step = s; log(s, 'step'); };
  jobs.set(job.id, job);
  job.promise = (async () => {
    try {
      job.result = await fn(log, setStep);
      log('Fertig.', 'ok');
    } catch (e) {
      job.error = e.message || String(e);
      log(job.error, 'err');
    } finally {
      job.done = true;
      job.finished = Date.now();
    }
  })();
  for (const [id, j] of jobs) if (j.done && Date.now() - j.finished > 3600_000) jobs.delete(id);
  return job;
}

/** Befehl streamen (Ausgabe ins Job-Log) */
export function stream(cmd, args, log, opts = {}) {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`, 'cmd');
    const p = spawn(cmd, args, { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', ...opts.env } });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd}: Zeitüberschreitung`)); }, opts.timeout ?? 900_000);
    let tail = '';
    const on = (d) => { const s = String(d); tail = (tail + s).slice(-2000); log(s); };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} fehlgeschlagen (Code ${code}): ${tail.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

/** apt-Pakete installieren — nacheinander, nie parallel (dpkg-Lock) */
export function aptInstall(pkgs, log) {
  const p = aptChain.then(async () => {
    const dry = process.env.ORBIT_HOST_DRYRUN === '1';
    await stream('apt-get', ['update', '-q'], log, { timeout: 300_000 }).catch((e) => log(`apt update: ${e.message}`, 'warn'));
    await stream('apt-get', ['install', '-y', '-q', '--no-install-recommends', ...(dry ? ['--simulate'] : []), ...pkgs], log);
  });
  aptChain = p.catch(() => {});
  return p;
}
