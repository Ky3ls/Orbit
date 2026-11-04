import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config.js';
import { download } from './mcJava.js';
import { getJson, mojangVersion, UA } from './mcSources.js';

/*
 * Item-Texturen, Blockmodelle und Sprachdateien direkt aus dem offiziellen Client-JAR (einmal pro Version).
 * Daraus entstehen Inventar-Icons (Items flach, Blöcke als Iso-Würfel) und deutsche Item-Namen.
 */
const run = promisify(execFile);
export const ASSETS_ROOT = path.join(DATA_DIR, 'mc-assets');
const jobs = new Map();
const itemCache = new Map();

const safeVer = (v) => String(v || '').replace(/[^\w.-]/g, '');
const verDir = (v) => path.join(ASSETS_ROOT, safeVer(v));
const mcDir = (v) => path.join(verDir(v), 'assets', 'minecraft');

export function assetsReady(version) {
  return fs.existsSync(path.join(verDir(version), '.ready'));
}

/** Startet den Download im Hintergrund; gibt sofort zurück */
export function ensureAssets(version) {
  const v = safeVer(version);
  if (!v || assetsReady(v)) return { ready: assetsReady(v) };
  if (!jobs.has(v)) {
    const job = (async () => {
      const dir = verDir(v);
      fs.mkdirSync(dir, { recursive: true });
      const meta = await mojangVersion(v);
      const jar = path.join(dir, 'client.jar');
      if (!fs.existsSync(jar)) await download(meta.downloads.client.url, jar);
      await run('unzip', ['-o', '-q', jar,
        'assets/minecraft/textures/item/*', 'assets/minecraft/textures/block/*',
        'assets/minecraft/textures/entity/player/*', 'assets/minecraft/textures/mob_effect/*',
        'assets/minecraft/models/item/*', 'assets/minecraft/models/block/*', 'assets/minecraft/items/*',
        'assets/minecraft/lang/en_us.json', '-d', dir], { maxBuffer: 1 << 24 }).catch((e) => {
        if (e.code !== 11) throw e; // 11 = einzelne Muster ohne Treffer (ältere Versionen)
      });
      // Deutsche Übersetzung kommt über den Asset-Index
      try {
        const index = await getJson(meta.assetIndex.url);
        const obj = index.objects['minecraft/lang/de_de.json'];
        if (obj) {
          const res = await fetch(`https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`, { headers: { 'User-Agent': UA } });
          if (res.ok) fs.writeFileSync(path.join(mcDir(v), 'lang', 'de_de.json'), Buffer.from(await res.arrayBuffer()));
        }
      } catch { /* Englisch reicht als Fallback */ }
      fs.rmSync(jar, { force: true });
      fs.writeFileSync(path.join(dir, '.ready'), new Date().toISOString());
    })().finally(() => jobs.delete(v));
    job.catch(() => {});
    jobs.set(v, job);
  }
  return { ready: false, pending: true };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const TINT = {
  grass: '#7cbd6b', foliage: '#59ae30', water: '#3f76e4',
};
function tintFor(tex) {
  if (/^block\/(grass_block_top|short_grass|tall_grass_(top|bottom)|fern|large_fern_(top|bottom)|sugar_cane)$/.test(tex)) return TINT.grass;
  if (/^block\/(oak|jungle|acacia|dark_oak|mangrove)_leaves$|^block\/vine$|^block\/lily_pad$/.test(tex)) return TINT.foliage;
  if (/^block\/spruce_leaves$/.test(tex)) return '#619961';
  if (/^block\/birch_leaves$/.test(tex)) return '#80a755';
  return null;
}

const stripNs = (s) => String(s || '').replace(/^minecraft:/, '');

/** Blockmodell auflösen (Parent-Kette) → Texturen-Map */
function blockTextures(ver, model, depth = 0) {
  if (depth > 8) return { textures: {}, parents: [] };
  const m = readJson(path.join(mcDir(ver), 'models', `${stripNs(model)}.json`));
  if (!m) return { textures: {}, parents: [] };
  const up = m.parent ? blockTextures(ver, m.parent, depth + 1) : { textures: {}, parents: [] };
  const textures = { ...up.textures, ...(m.textures || {}) };
  return { textures, parents: [stripNs(m.parent || ''), ...up.parents] };
}
const texStr = (v) => (typeof v === 'string' ? v : (v && typeof v.sprite === 'string' ? v.sprite : null));
function resolveTex(textures, key, depth = 0) {
  let v = texStr(textures[key]);
  while (v && v.startsWith('#') && depth < 8) { v = texStr(textures[v.slice(1)]); depth += 1; }
  return v ? stripNs(v) : null;
}
const texExists = (ver, t) => t && fs.existsSync(path.join(mcDir(ver), 'textures', `${t}.png`));

/** Erstes Modell + Tönung aus items/<id>.json (1.21.4+) */
function itemDef(ver, name) {
  const d = readJson(path.join(mcDir(ver), 'items', `${name}.json`));
  if (!d) return null;
  let model = null;
  let tint = null;
  let special = false;
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || model || depth > 12) return;
    if (o.type === 'minecraft:model' && typeof o.model === 'string') {
      model = o.model;
      const t = (o.tints || [])[0];
      if (t?.type === 'minecraft:grass') tint = TINT.grass;
      else if (t?.type === 'minecraft:constant' && Number.isFinite(t.value)) tint = `#${(t.value >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
      else if (t?.type === 'minecraft:dye' || t?.type === 'minecraft:firework') tint = null;
      return;
    }
    if (o.type === 'minecraft:special' && typeof o.base === 'string') { model = o.base; special = true; return; }
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, depth + 1);
  };
  walk(d.model);
  return model ? { model: stripNs(model), tint, special } : null;
}

const CUBE_PARENTS = /^block\/(cube|cube_all|cube_column|cube_column_horizontal|cube_bottom_top|cube_top|orientable|orientable_with_bottom|leaves|template_glazed_terracotta|cube_mirrored_all|cube_all_inner_faces|stairs|slab|inner_stairs|outer_stairs)$/;

/** Icon-Beschreibung für ein Item */
function iconFor(ver, id) {
  const name = stripNs(id);
  const def = itemDef(ver, name);
  const modelPath = def?.model || `item/${name}`;
  const { textures, parents } = blockTextures(ver, modelPath);
  const tint = def?.tint || undefined;
  const isBlock = modelPath.startsWith('block/') || parents.some((p) => p.startsWith('block/'));
  const flat = resolveTex(textures, 'layer0');
  if (flat && texExists(ver, flat)) return { k: 'i', t: flat, tint: tint || tintFor(flat) || undefined };
  if (def?.special) {
    const pt = resolveTex(textures, 'particle');
    if (/chest|shulker_box|_bed$|barrel/.test(name) && pt && texExists(ver, pt)) return { k: 'b', top: pt, left: pt, right: pt };
    return null;
  }
  const hasTopSide = (resolveTex(textures, 'top') || resolveTex(textures, 'end')) && resolveTex(textures, 'side');
  if (isBlock && (parents.some((p) => CUBE_PARENTS.test(p)) || (hasTopSide && !resolveTex(textures, 'cross')))) {
    const top = resolveTex(textures, 'top') || resolveTex(textures, 'end') || resolveTex(textures, 'up') || resolveTex(textures, 'all') || resolveTex(textures, 'side');
    const side = resolveTex(textures, 'side') || resolveTex(textures, 'all') || resolveTex(textures, 'north') || top;
    const front = resolveTex(textures, 'front') || side;
    if (top && side && texExists(ver, top) && texExists(ver, side)) {
      const out = { k: 'b', top, left: texExists(ver, front) ? front : side, right: side };
      const tt = tint || tintFor(top);
      if (tt) out.tint = tt;
      if (/leaves|vine/.test(name) && tt) out.tintSide = tt;
      if (parents.includes('block/slab')) out.s = 'slab';
      if (parents.some((p) => /stairs/.test(p))) out.s = 'stairs';
      return out;
    }
  }
  if (texExists(ver, `item/${name}`)) return { k: 'i', t: `item/${name}` };
  const any = resolveTex(textures, 'particle') || resolveTex(textures, 'texture') || resolveTex(textures, 'cross')
    || Object.values(textures).map(texStr).filter(Boolean).map(stripNs).find((t) => !t.startsWith('#'));
  if (any && texExists(ver, any)) return { k: isBlock && !textures.cross && !/torch|rail|flower|sapling|lantern|chain|bars|pane|door/.test(name) ? 'b' : 'i', t: any, top: any, left: any, right: any, tint: tint || tintFor(any) || undefined };
  return null;
}

/** Alle Items mit Namen + Icon (gecacht pro Version) */
export function itemCatalog(version) {
  const ver = safeVer(version);
  if (!assetsReady(ver)) return null;
  if (itemCache.has(ver)) return itemCache.get(ver);
  const de = readJson(path.join(mcDir(ver), 'lang', 'de_de.json')) || {};
  const en = readJson(path.join(mcDir(ver), 'lang', 'en_us.json')) || {};
  const ids = new Set();
  for (const dir of ['items', 'models/item']) {
    try { for (const f of fs.readdirSync(path.join(mcDir(ver), dir))) if (f.endsWith('.json')) ids.add(f.slice(0, -5)); } catch { /* */ }
  }
  const items = {};
  for (const id of ids) {
    const key = [`item.minecraft.${id}`, `block.minecraft.${id}`].find((k) => de[k] || en[k]);
    if (!key) continue;
    items[`minecraft:${id}`] = { n: de[key] || en[key], i: iconFor(ver, id) };
  }
  const lang = {};
  for (const [k, val] of Object.entries(de && Object.keys(de).length ? de : en)) {
    if (/^(enchantment|effect|advancements|stat|entity)\.minecraft\./.test(k) || /^advancements\./.test(k) || /^stat_type\./.test(k)) lang[k] = val;
  }
  const out = { items, lang, version: ver };
  itemCache.set(ver, out);
  return out;
}

/** Textur-Datei sicher auflösen (nur innerhalb von textures/) */
export function texturePath(version, rel) {
  const base = path.join(mcDir(version), 'textures');
  const clean = String(rel || '').replace(/\.png$/, '');
  if (!/^[a-z0-9_/.-]+$/.test(clean) || clean.includes('..')) return null;
  const file = path.join(base, `${clean}.png`);
  return file.startsWith(base + path.sep) && fs.existsSync(file) ? file : null;
}

/* ── Skins (Mojang) ── */
const SKIN_DIR = path.join(DATA_DIR, 'mc-skins');
const SKIN_TTL = 6 * 3600_000;
const skinJobs = new Map();

export async function skinFor(uuid) {
  const id = String(uuid || '').toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const file = path.join(SKIN_DIR, `${id}.png`);
  const metaFile = path.join(SKIN_DIR, `${id}.json`);
  try {
    if (Date.now() - fs.statSync(metaFile).mtimeMs < SKIN_TTL) {
      const meta = readJson(metaFile);
      return meta?.none ? { none: true, slim: meta.slim } : { file, slim: !!meta?.slim };
    }
  } catch { /* noch nicht geladen */ }
  if (!skinJobs.has(id)) {
    skinJobs.set(id, (async () => {
      fs.mkdirSync(SKIN_DIR, { recursive: true });
      try {
        const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('kein Profil');
        const prof = await res.json();
        const tex = JSON.parse(Buffer.from(prof.properties?.find((p) => p.name === 'textures')?.value || '', 'base64').toString('utf8') || '{}');
        const skin = tex.textures?.SKIN;
        if (!skin?.url) throw new Error('kein Skin');
        const url = skin.url.replace(/^http:/, 'https:');
        if (!/^https:\/\/textures\.minecraft\.net\//.test(url)) throw new Error('fremde URL');
        const img = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
        if (!img.ok) throw new Error('Skin-Download');
        fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
        fs.writeFileSync(metaFile, JSON.stringify({ slim: skin.metadata?.model === 'slim' }));
      } catch {
        fs.writeFileSync(metaFile, JSON.stringify({ none: true }));
      }
    })().finally(() => skinJobs.delete(id)));
  }
  await skinJobs.get(id);
  const meta = readJson(metaFile);
  return meta?.none ? { none: true } : { file, slim: !!meta?.slim };
}

/** Standard-Skin aus den Client-Assets (Steve/Alex) */
export function defaultSkin(version, slim) {
  return texturePath(version, `entity/player/${slim ? 'slim/alex' : 'wide/steve'}`)
    || texturePath(version, 'entity/steve');
}
