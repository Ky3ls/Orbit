import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXT = /\.(ya?ml|json5?|properties|toml|txt|cfg|conf|ini|log|md|csv|mcmeta|sk|js|lang|xml|sh|snbt)$/i;
const MAX_EDIT = 2 * 1048576;
/** Interne Orbit-Daten: lesbar, aber nicht über den Dateimanager änderbar */
const PROTECTED = new Set(['.orbit']);

/**
 * Pfad sicher innerhalb des Instanz-Ordners auflösen (auch über Symlinks hinweg).
 * @returns {{ abs: string, rel: string }}
 */
export function resolveInside(inst, rel = '') {
  const root = fs.realpathSync(inst.path);
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Pfad außerhalb der Instanz.');
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { /* existiert noch nicht */ }
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Pfad außerhalb der Instanz.');
  return { abs, rel: path.relative(root, abs).split(path.sep).join('/') };
}

function assertWritable(rel) {
  const top = rel.split('/')[0];
  if (PROTECTED.has(top)) throw new Error('Interne Orbit-Dateien können hier nicht geändert werden.');
  if (!rel) throw new Error('Der Instanz-Ordner selbst kann nicht geändert werden.');
}

export function listDir(inst, rel) {
  const { abs, rel: r } = resolveInside(inst, rel);
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw new Error('Kein Ordner.');
  const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => {
    let size = 0;
    let mtime = 0;
    try {
      const s = fs.statSync(path.join(abs, e.name));
      size = s.size;
      mtime = s.mtimeMs;
    } catch { /* kaputter Symlink */ }
    const dir = e.isDirectory();
    return { name: e.name, dir, size: dir ? null : size, mtime, editable: !dir && TEXT_EXT.test(e.name) && size <= MAX_EDIT };
  }).sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { path: r, abs, entries };
}

export function readText(inst, rel) {
  const { abs, rel: r } = resolveInside(inst, rel);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('Keine Datei.');
  if (st.size > MAX_EDIT) throw new Error('Datei zu groß zum Bearbeiten (max. 2 MB) — bitte herunterladen.');
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw new Error('Binärdatei — bitte herunterladen.');
  return { path: r, size: st.size, mtime: st.mtimeMs, content: buf.toString('utf8') };
}

export function writeText(inst, rel, content) {
  const { abs, rel: r } = resolveInside(inst, rel);
  assertWritable(r);
  const text = String(content ?? '');
  if (Buffer.byteLength(text) > MAX_EDIT) throw new Error('Inhalt zu groß (max. 2 MB).');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

export function makeDir(inst, rel) {
  const { abs, rel: r } = resolveInside(inst, rel);
  assertWritable(r);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export function removePath(inst, rel) {
  const { abs, rel: r } = resolveInside(inst, rel);
  assertWritable(r);
  fs.rmSync(abs, { recursive: true, force: true });
}

export function renamePath(inst, from, to) {
  const a = resolveInside(inst, from);
  const b = resolveInside(inst, to);
  assertWritable(a.rel);
  assertWritable(b.rel);
  if (fs.existsSync(b.abs)) throw new Error('Ziel existiert bereits.');
  fs.renameSync(a.abs, b.abs);
  return b.abs;
}

/** Upload in einen Ordner (Stream, max. 512 MB) */
export async function uploadFile(inst, dirRel, name, req) {
  const safe = path.basename(String(name || '')).replace(/[^\w.+\- ()]/g, '_');
  if (!safe || safe.startsWith('.')) throw new Error('Ungültiger Dateiname.');
  const { abs, rel } = resolveInside(inst, path.posix.join(String(dirRel || ''), safe));
  assertWritable(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(`${abs}.part`);
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1048576) { req.destroy(); out.destroy(); reject(new Error('Datei zu groß (max. 512 MB).')); }
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  fs.renameSync(`${abs}.part`, abs);
  return { abs, rel };
}

/** Download als Stream */
export function streamFile(inst, rel, res) {
  const { abs } = resolveInside(inst, rel);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('Keine Datei.');
  const name = path.basename(abs).replace(/"/g, '');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(abs).pipe(res);
}
