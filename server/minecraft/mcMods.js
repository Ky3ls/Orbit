import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { download } from './mcJava.js';
import { UA, typeMeta } from './mcSources.js';

const API = 'https://api.modrinth.com/v2';

const LOADERS = {
  fabric: ['fabric'],
  forge: ['forge'],
  neoforge: ['neoforge'],
  paper: ['paper', 'spigot', 'bukkit'],
  purpur: ['purpur', 'paper', 'spigot', 'bukkit'],
};

export function modKind(inst) {
  const kind = typeMeta(inst.type)?.kind;
  if (kind === 'mods') return { dir: 'mods', projectType: 'mod', noun: 'Mods' };
  if (kind === 'plugins') return { dir: 'plugins', projectType: 'plugin', noun: 'Plugins' };
  return null;
}

async function mr(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Modrinth: HTTP ${res.status}`);
  return res.json();
}

const metaFile = (inst) => path.join(inst.path, '.orbit', 'mods.json');
function readMeta(inst) {
  try { return JSON.parse(fs.readFileSync(metaFile(inst), 'utf8')); } catch { return {}; }
}
function writeMeta(inst, meta) {
  fs.mkdirSync(path.dirname(metaFile(inst)), { recursive: true });
  fs.writeFileSync(metaFile(inst), JSON.stringify(meta, null, 2));
}

/** Modrinth-Suche passend zu Loader + MC-Version der Instanz */
export async function searchMods(inst, query, offset = 0) {
  const k = modKind(inst);
  if (!k) throw new Error('Vanilla unterstützt keine Mods oder Plugins.');
  const loaders = LOADERS[inst.type] || [];
  const facets = [
    [`project_type:${k.projectType}`],
    loaders.map((l) => `categories:${l}`),
    [`versions:${inst.mc_version}`],
  ];
  if (k.projectType === 'mod') facets.push(['server_side:required', 'server_side:optional']);
  const params = new URLSearchParams({
    query: String(query || '').slice(0, 80),
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(Math.max(0, Number(offset) || 0)),
    index: query ? 'relevance' : 'downloads',
  });
  const d = await mr(`/search?${params}`);
  const installed = new Set(Object.keys(readMeta(inst)));
  return {
    total: d.total_hits,
    hits: (d.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url,
      downloads: h.downloads,
      follows: h.follows,
      categories: (h.display_categories || h.categories || []).filter((c) => !loaders.includes(c)).slice(0, 4),
      installed: installed.has(h.project_id),
    })),
  };
}

async function bestVersion(inst, projectId) {
  const loaders = LOADERS[inst.type] || [];
  const params = new URLSearchParams({
    loaders: JSON.stringify(loaders),
    game_versions: JSON.stringify([inst.mc_version]),
  });
  const list = await mr(`/project/${encodeURIComponent(projectId)}/version?${params}`);
  if (!list.length) return null;
  return list.find((v) => v.version_type === 'release') || list[0];
}

/** Installieren inkl. Pflicht-Abhängigkeiten */
export async function installMod(inst, projectId, log = () => {}, depth = 0, seen = new Set()) {
  const k = modKind(inst);
  if (!k) throw new Error('Vanilla unterstützt keine Mods oder Plugins.');
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const meta = readMeta(inst);
  if (meta[projectId] && fs.existsSync(path.join(inst.path, k.dir, meta[projectId].file))) return [];
  const version = await bestVersion(inst, projectId);
  if (!version) throw new Error(`Keine passende Version für ${inst.type} ${inst.mc_version}.`);
  const file = version.files.find((f) => f.primary) || version.files[0];
  const project = await mr(`/project/${encodeURIComponent(projectId)}`);
  const safeName = path.basename(file.filename).replace(/[^\w.+-]/g, '_');
  await download(file.url, path.join(inst.path, k.dir, safeName));
  meta[projectId] = {
    projectId,
    slug: project.slug,
    title: project.title,
    icon: project.icon_url,
    versionId: version.id,
    versionNumber: version.version_number,
    file: safeName,
    sha1: file.hashes?.sha1 || null,
    dependency: depth > 0,
    installedAt: Date.now(),
  };
  writeMeta(inst, meta);
  log('ok', `${project.title} ${version.version_number} installiert`);
  const added = [project.title];
  if (depth < 3) {
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required' || !dep.project_id) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        added.push(...await installMod(inst, dep.project_id, log, depth + 1, seen));
      } catch (e) {
        log('warn', `Abhängigkeit ${dep.project_id}: ${e.message}`);
      }
    }
  }
  return added;
}

/** Installierte Mods/Plugins (Ordner-Inhalt + Modrinth-Metadaten) */
export function listMods(inst) {
  const k = modKind(inst);
  if (!k) return { kind: null, items: [] };
  const dir = path.join(inst.path, k.dir);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/i.test(f)); } catch { /* */ }
  const meta = readMeta(inst);
  const byFile = new Map(Object.values(meta).map((m) => [m.file, m]));
  const items = files.map((f) => {
    const enabled = !f.endsWith('.disabled');
    const base = enabled ? f : f.replace(/\.disabled$/, '');
    const m = byFile.get(base);
    let size = 0;
    try { size = fs.statSync(path.join(dir, f)).size; } catch { /* */ }
    return {
      file: f,
      enabled,
      size,
      title: m?.title || base.replace(/\.jar$/i, ''),
      icon: m?.icon || null,
      version: m?.versionNumber || null,
      projectId: m?.projectId || null,
      slug: m?.slug || null,
      dependency: !!m?.dependency,
      manual: !m,
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
  return { kind: k, items };
}

function safeFile(inst, file) {
  const k = modKind(inst);
  const name = path.basename(String(file || ''));
  if (!k || !/\.jar(\.disabled)?$/i.test(name)) throw new Error('Ungültige Datei.');
  return path.join(inst.path, k.dir, name);
}

export function toggleMod(inst, file, enabled) {
  const p = safeFile(inst, file);
  const target = enabled ? p.replace(/\.disabled$/, '') : (p.endsWith('.disabled') ? p : `${p}.disabled`);
  if (p !== target) fs.renameSync(p, target);
}

export function removeMod(inst, file) {
  const p = safeFile(inst, file);
  fs.rmSync(p, { force: true });
  const base = path.basename(p).replace(/\.disabled$/, '');
  const meta = readMeta(inst);
  for (const [id, m] of Object.entries(meta)) if (m.file === base) delete meta[id];
  writeMeta(inst, meta);
}

/** Hochgeladene JAR speichern (Stream, max. 256 MB) */
export async function saveUpload(inst, req, filename) {
  const k = modKind(inst);
  if (!k) throw new Error('Vanilla unterstützt keine Mods oder Plugins.');
  const name = path.basename(String(filename || '')).replace(/[^\w.+-]/g, '_');
  if (!/\.jar$/i.test(name)) throw new Error('Nur .jar-Dateien.');
  const dest = path.join(inst.path, k.dir, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(`${dest}.part`);
    req.on('data', (c) => {
      size += c.length;
      if (size > 256 * 1048576) { req.destroy(); out.destroy(); reject(new Error('Datei zu groß (max. 256 MB).')); }
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  fs.renameSync(`${dest}.part`, dest);
  return name;
}

/** Updates über Datei-Hashes prüfen (ein Modrinth-Aufruf) */
export async function checkUpdates(inst) {
  const { items } = listMods(inst);
  const k = modKind(inst);
  const hashes = {};
  for (const it of items) {
    try {
      const buf = fs.readFileSync(path.join(inst.path, k.dir, it.file));
      hashes[crypto.createHash('sha1').update(buf).digest('hex')] = it.file;
    } catch { /* */ }
  }
  if (!Object.keys(hashes).length) return {};
  const d = await mr('/version_files/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hashes: Object.keys(hashes),
      algorithm: 'sha1',
      loaders: LOADERS[inst.type] || [],
      game_versions: [inst.mc_version],
    }),
  });
  const out = {};
  for (const [hash, v] of Object.entries(d || {})) {
    const file = hashes[hash];
    const primary = (v.files || []).find((f) => f.primary) || v.files?.[0];
    if (file && primary && primary.hashes?.sha1 !== hash) {
      out[file] = { version: v.version_number, projectId: v.project_id };
    }
  }
  return out;
}

/** Mod aktualisieren: alte Datei entfernen, neueste Version installieren */
export async function updateMod(inst, file, projectId, log) {
  removeMod(inst, file);
  return installMod(inst, projectId, log);
}
