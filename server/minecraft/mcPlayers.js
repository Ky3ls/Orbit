import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { plain, readNbtFile, T, writeNbtFile } from './mcNbt.js';
import { chownForRun, consoleQuery, isRunning, mcStatus, sendMc } from './mcProcess.js';
import { readProperties, writeProperties } from './mcProperties.js';
import { lastIp, logPlayers } from './mcConsole.js';
import { parseSnbt } from './mcSnbt.js';
import { UA } from './mcSources.js';

/* ── Pfade & Dateien ── */
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;
const ITEM_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

function worldDir(inst) {
  const level = String(readProperties(inst.path)['level-name'] || 'world').replace(/\.\./g, '');
  return path.join(inst.path, level);
}
/** 26.x: world/players/{data,stats,advancements} — davor world/{playerdata,stats,advancements} */
function playerDirs(inst) {
  const w = worldDir(inst);
  if (fs.existsSync(path.join(w, 'players', 'data'))) {
    return { data: path.join(w, 'players', 'data'), stats: path.join(w, 'players', 'stats'), adv: path.join(w, 'players', 'advancements') };
  }
  return { data: path.join(w, 'playerdata'), stats: path.join(w, 'stats'), adv: path.join(w, 'advancements') };
}

const jsonCache = new Map();
function readJson(file, fallback) {
  try {
    const st = fs.statSync(file);
    const hit = jsonCache.get(file);
    if (hit && hit.m === st.mtimeMs && hit.s === st.size) return hit.v;
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    jsonCache.set(file, { m: st.mtimeMs, s: st.size, v });
    return v;
  } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  chownForRun(file);
  jsonCache.delete(file);
}
const listFile = (inst, f) => path.join(inst.path, f);
const lists = (inst) => ({
  cache: readJson(listFile(inst, 'usercache.json'), []),
  whitelist: readJson(listFile(inst, 'whitelist.json'), []),
  ops: readJson(listFile(inst, 'ops.json'), []),
  bans: readJson(listFile(inst, 'banned-players.json'), []),
  ipBans: readJson(listFile(inst, 'banned-ips.json'), []),
});

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

export function dashUuid(id) {
  const h = String(id || '').toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function offlineUuid(name) {
  const b = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return dashUuid(b.toString('hex'));
}

/** Name → UUID (Mojang, sonst Offline-UUID bei online-mode=false) */
async function resolveProfile(inst, name) {
  if (!NAME_RE.test(name)) throw new Error('Ungültiger Spielername (3–16 Zeichen, A–Z, 0–9, _).');
  const known = lists(inst).cache.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (known) return { uuid: known.uuid, name: known.name };
  if (readProperties(inst.path)['online-mode'] === 'false') return { uuid: offlineUuid(name), name };
  for (const url of [`https://api.mojang.com/users/profiles/minecraft/${name}`, `https://api.minecraftservices.com/minecraft/profile/lookup/name/${name}`]) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) });
      if (res.status === 404 || res.status === 204) throw Object.assign(new Error(`Spieler „${name}“ gibt es bei Mojang nicht.`), { final: true });
      if (!res.ok) continue;
      const d = await res.json();
      return { uuid: dashUuid(d.id), name: d.name };
    } catch (e) { if (e.final) throw e; }
  }
  throw new Error('Mojang ist gerade nicht erreichbar — später erneut versuchen.');
}

/* ── Befehle ── direkt in die Server-Konsole (Antwort erscheint live in der Konsole) */
async function command(inst, cmd) {
  if (!isRunning(inst.id)) throw new Error('Server läuft nicht.');
  sendMc(inst, cmd);
  return { out: null, rcon: false };
}

/** Online-Spieler live aus der Konsole (Login/Logout) — ohne RCON */
export async function onlinePlayers(inst) {
  if (!isRunning(inst.id)) return { players: [], max: 0, source: 'offline' };
  const cache = lists(inst).cache;
  const players = logPlayers(inst).map((p) => ({
    name: p.name,
    uuid: p.uuid || cache.find((c) => c.name.toLowerCase() === p.name.toLowerCase())?.uuid || null,
  }));
  const st = mcStatus(inst);
  return { players, max: st.maxPlayers || 0, count: players.length, source: 'log' };
}

/* ── Statistiken ── */
const ONE_CM_EXCLUDE = new Set(['minecraft:fall_one_cm']);
function sum(o) { return Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0); }
function top(o, n = 8) {
  return Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, v]) => ({ id, v }));
}
function statsSummary(json) {
  const s = json?.stats || {};
  const c = s['minecraft:custom'] || {};
  const distance = Object.entries(c).filter(([k]) => k.endsWith('_one_cm') && !ONE_CM_EXCLUDE.has(k)).reduce((a, [, v]) => a + v, 0);
  return {
    playTicks: c['minecraft:play_time'] ?? c['minecraft:play_one_minute'] ?? 0,
    deaths: c['minecraft:deaths'] || 0,
    mobKills: c['minecraft:mob_kills'] || 0,
    playerKills: c['minecraft:player_kills'] || 0,
    distanceCm: distance,
    jumps: c['minecraft:jump'] || 0,
    damageDealt: c['minecraft:damage_dealt'] || 0,
    damageTaken: c['minecraft:damage_taken'] || 0,
    mined: sum(s['minecraft:mined']),
    crafted: sum(s['minecraft:crafted']),
    placed: sum(s['minecraft:used']),
    sinceDeath: c['minecraft:time_since_death'] ?? null,
    trades: c['minecraft:traded_with_villager'] || 0,
    fish: c['minecraft:fish_caught'] || 0,
    sleeps: c['minecraft:sleep_in_bed'] || 0,
    joins: c['minecraft:leave_game'] || 0,
  };
}
function parseMcDate(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : null;
}
function advancementSummary(json) {
  if (!json) return { done: [], first: null };
  let first = null;
  const done = [];
  for (const [key, val] of Object.entries(json)) {
    if (key === 'DataVersion' || !val || typeof val !== 'object') continue;
    let last = null;
    for (const d of Object.values(val.criteria || {})) {
      const t = parseMcDate(d);
      if (t && (!first || t < first)) first = t;
      if (t && (!last || t > last)) last = t;
    }
    if (val.done && !key.includes(':recipes/')) done.push({ id: key, at: last });
  }
  done.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { done, first };
}

/* ── Spielerliste ── */
export async function listPlayers(inst) {
  const L = lists(inst);
  const dirs = playerDirs(inst);
  const online = await onlinePlayers(inst);
  const byUuid = new Map();
  const add = (uuid, name) => {
    const u = dashUuid(uuid);
    if (!u) return null;
    if (!byUuid.has(u)) byUuid.set(u, { uuid: u, name: name || null });
    const p = byUuid.get(u);
    if (name && !p.name) p.name = name;
    return p;
  };
  for (const c of L.cache) add(c.uuid, c.name);
  for (const w of L.whitelist) { const p = add(w.uuid, w.name); if (p) p.whitelisted = true; }
  for (const o of L.ops) { const p = add(o.uuid, o.name); if (p) p.op = o.level || 4; }
  for (const b of L.bans) {
    const p = add(b.uuid, b.name);
    if (p) p.banned = { reason: b.reason || '', source: b.source || '', created: parseMcDate(b.created), expires: b.expires === 'forever' ? null : parseMcDate(b.expires) };
  }
  let files = [];
  try { files = fs.readdirSync(dirs.data).filter((f) => f.endsWith('.dat')).slice(0, 3000); } catch { /* */ }
  for (const f of files) add(f.slice(0, -4), null);
  for (const o of online.players) {
    const p = o.uuid ? add(o.uuid, o.name) : [...byUuid.values()].find((x) => x.name === o.name);
    if (p) p.online = true;
  }
  const players = [...byUuid.values()].map((p) => {
    const stats = statsSummary(readJson(path.join(dirs.stats, `${p.uuid}.json`), null));
    const adv = advancementSummary(readJson(path.join(dirs.adv, `${p.uuid}.json`), null));
    return {
      uuid: p.uuid,
      name: p.name || p.uuid.slice(0, 8),
      online: !!p.online,
      op: p.op || 0,
      whitelisted: !!p.whitelisted,
      banned: p.banned || null,
      lastSeen: p.online ? Date.now() : mtime(path.join(dirs.data, `${p.uuid}.dat`)),
      firstSeen: adv.first,
      advancements: adv.done.length,
      playTicks: stats.playTicks,
      deaths: stats.deaths,
      mobKills: stats.mobKills,
      playerKills: stats.playerKills,
      hasData: files.includes(`${p.uuid}.dat`),
    };
  }).sort((a, b) => (b.online - a.online) || ((b.lastSeen || 0) - (a.lastSeen || 0)) || a.name.localeCompare(b.name));
  const props = readProperties(inst.path);
  return {
    running: isRunning(inst.id),
    live: online.source === 'log',
    rcon: false,
    online: online.count ?? online.players.length,
    max: online.max || Number(props['max-players']) || 20,
    whitelist: props['white-list'] === 'true',
    enforceWhitelist: props['enforce-whitelist'] === 'true',
    onlineMode: props['online-mode'] !== 'false',
    players,
    ipBans: L.ipBans.map((b) => ({ ip: b.ip, reason: b.reason || '', source: b.source || '', created: parseMcDate(b.created) })),
  };
}

/* ── Spielerdetails ── */
const MAT_TOOL = { wooden: 59, stone: 131, iron: 250, golden: 32, diamond: 1561, netherite: 2031, copper: 190 };
const MAT_ARMOR = { leather: 5, chainmail: 15, iron: 15, golden: 7, diamond: 33, netherite: 37, copper: 11, turtle: 25 };
const ARMOR_BASE = { helmet: 11, chestplate: 16, leggings: 15, boots: 13 };
const MISC_DMG = { elytra: 432, trident: 250, bow: 384, crossbow: 465, shield: 336, fishing_rod: 64, shears: 238, flint_and_steel: 64, carrot_on_a_stick: 25, warped_fungus_on_a_stick: 100, mace: 500, brush: 64, wolf_armor: 64 };
function maxDamage(id) {
  const n = String(id).replace(/^minecraft:/, '');
  if (MISC_DMG[n]) return MISC_DMG[n];
  const m = n.match(/^(\w+?)_(sword|pickaxe|axe|shovel|hoe|spear)$/);
  if (m && MAT_TOOL[m[1]]) return MAT_TOOL[m[1]];
  const a = n.match(/^(\w+?)_(helmet|chestplate|leggings|boots)$/);
  if (a && MAT_ARMOR[a[1]]) return MAT_ARMOR[a[1]] * ARMOR_BASE[a[2]];
  return null;
}

function textOf(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    if (/^[{["]/.test(v)) { try { return textOf(JSON.parse(v)); } catch { return v; } }
    return v;
  }
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v === 'object') return `${v.text ?? (v.translate || '')}${(v.extra || []).map(textOf).join('')}`;
  return String(v);
}
function enchList(o) {
  if (!o) return [];
  if (Array.isArray(o)) return o.map((e) => ({ id: e.id, lvl: e.lvl ?? e.level ?? 1 }));
  const levels = o.levels && typeof o.levels === 'object' ? o.levels : o;
  return Object.entries(levels).filter(([, v]) => typeof v === 'number').map(([id, lvl]) => ({ id, lvl }));
}
function normItem(raw, depth = 0) {
  if (!raw || !raw.id || raw.id === 'minecraft:air') return null;
  const c = raw.components || {};
  const tag = raw.tag || {};
  const item = { id: raw.id, count: raw.count ?? raw.Count ?? 1 };
  const name = textOf(c['minecraft:custom_name'] ?? c['minecraft:item_name'] ?? tag.display?.Name);
  if (name) item.name = name;
  const ench = [...enchList(c['minecraft:enchantments'] ?? tag.Enchantments), ...enchList(c['minecraft:stored_enchantments'] ?? tag.StoredEnchantments)];
  if (ench.length) item.ench = ench;
  const dmg = c['minecraft:damage'] ?? tag.Damage;
  const max = c['minecraft:max_damage'] ?? maxDamage(raw.id);
  if (max) { item.max = max; item.dmg = dmg || 0; }
  if (c['minecraft:unbreakable'] || tag.Unbreakable) item.unbreakable = true;
  const lore = c['minecraft:lore'] ?? tag.display?.Lore;
  if (Array.isArray(lore) && lore.length) item.lore = lore.slice(0, 8).map(textOf);
  const pot = c['minecraft:potion_contents'];
  if (pot) item.potion = typeof pot === 'string' ? pot : pot.potion || null;
  if (c['minecraft:trim']) item.trim = c['minecraft:trim'].material || true;
  if (depth < 1) {
    const cont = c['minecraft:container'] ?? tag.BlockEntityTag?.Items;
    if (Array.isArray(cont) && cont.length) {
      item.contents = cont.map((e) => {
        const it = normItem(e.item || e, depth + 1);
        return it ? { slot: e.slot ?? e.Slot ?? 0, ...it } : null;
      }).filter(Boolean);
    }
    const bundle = c['minecraft:bundle_contents'];
    if (Array.isArray(bundle) && bundle.length) item.contents = bundle.map((e, i) => ({ slot: i, ...normItem(e, depth + 1) })).filter((x) => x.id);
  }
  const keys = Object.keys(c).filter((k) => !['minecraft:custom_name', 'minecraft:enchantments', 'minecraft:damage', 'minecraft:repair_cost'].includes(k));
  if (keys.length) item.extra = keys.length;
  return item;
}

const OLD_ARMOR = { 100: 'feet', 101: 'legs', 102: 'chest', 103: 'head', '-106': 'offhand' };
function normalizePlayer(p) {
  const inv = {};
  const equip = {};
  for (const e of p.Inventory || []) {
    const slot = Number(e.Slot);
    const it = normItem(e);
    if (!it) continue;
    if (slot >= 0 && slot <= 35) inv[slot] = it;
    else if (OLD_ARMOR[slot]) equip[OLD_ARMOR[slot]] = it;
  }
  for (const [k, v] of Object.entries(p.equipment || {})) { const it = normItem(v); if (it) equip[k] = it; }
  const ender = {};
  for (const e of p.EnderItems || []) { const it = normItem(e); if (it) ender[Number(e.Slot)] = it; }
  const maxHealth = (p.attributes || p.Attributes || []).find((a) => /max_health$/.test(a.id || a.Name || ''))?.base ?? 20;
  return {
    health: Math.round((p.Health ?? 20) * 10) / 10,
    maxHealth,
    absorption: p.AbsorptionAmount || 0,
    food: p.foodLevel ?? 20,
    saturation: Math.round((p.foodSaturationLevel ?? 0) * 10) / 10,
    xpLevel: p.XpLevel || 0,
    xpP: p.XpP || 0,
    xpTotal: p.XpTotal || 0,
    gamemode: ['survival', 'creative', 'adventure', 'spectator'][p.playerGameType ?? 0] || 'survival',
    pos: (p.Pos || []).map((n) => Math.round(n * 10) / 10),
    dimension: p.Dimension || 'minecraft:overworld',
    respawn: p.respawn ? { pos: p.respawn.pos, dimension: p.respawn.dimension } : (p.SpawnX != null ? { pos: [p.SpawnX, p.SpawnY, p.SpawnZ], dimension: p.SpawnDimension } : null),
    lastDeath: p.LastDeathLocation ? { pos: p.LastDeathLocation.pos, dimension: p.LastDeathLocation.dimension } : null,
    effects: (p.active_effects || p.ActiveEffects || []).map((e) => ({ id: e.id, amp: e.amplifier || 0, dur: e.duration ?? -1 })),
    selected: p.SelectedItemSlot || 0,
    flying: !!p.abilities?.flying,
    air: p.Air ?? 300,
    fire: p.Fire > 0,
    inv,
    equip,
    ender,
  };
}

export async function playerDetail(inst, uuidIn, opts = {}) {
  const uuid = dashUuid(uuidIn);
  if (!uuid) throw new Error('Ungültige UUID.');
  const list = await listPlayers(inst);
  const base = list.players.find((p) => p.uuid === uuid);
  if (!base) throw new Error('Spieler nicht gefunden.');
  const dirs = playerDirs(inst);
  let raw = null;
  let source = null;
  const datFile = path.join(dirs.data, `${uuid}.dat`);
  if (fs.existsSync(datFile)) {
    try { raw = plain(readNbtFile(datFile)); source = 'file'; } catch { /* beschädigt */ }
  }
  if (base.online && list.running) {
    try {
      const parts = opts.parts === 'inv' ? [...INV_PARTS, 'active_effects'] : opts.parts === 'all' ? [...INV_PARTS, 'active_effects', 'abilities'] : ['active_effects'];
      const live = await livePlayer(inst, base.name, parts);
      if (Object.keys(live).length) {
        raw = { ...(raw || {}), ...live };
        // fehlende Liste = leer (z. B. keine Effekte mehr)
        if (parts.includes('active_effects') && !live.active_effects) raw.active_effects = [];
        if (parts.includes('EnderItems') && !live.EnderItems) raw.EnderItems = [];
        source = 'live';
      }
    } catch { /* Datei bleibt */ }
  }
  const statsJson = readJson(path.join(dirs.stats, `${uuid}.json`), null);
  const s = statsJson?.stats || {};
  const adv = advancementSummary(readJson(path.join(dirs.adv, `${uuid}.json`), null));
  return {
    ...base,
    ip: lastIp(inst, base.name),
    ipBanned: false,
    source,
    canEdit: base.online ? true : !!raw,
    editMode: base.online ? 'command' : 'file',
    liveParts: source === 'live' ? (opts.parts || 'vitals') : null,
    data: raw ? normalizePlayer(raw) : null,
    stats: statsJson ? {
      summary: statsSummary(statsJson),
      custom: Object.entries(s['minecraft:custom'] || {}).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, v })),
      mined: top(s['minecraft:mined']),
      killed: top(s['minecraft:killed']),
      killedBy: top(s['minecraft:killed_by'], 5),
      used: top(s['minecraft:used']),
      crafted: top(s['minecraft:crafted']),
      broken: top(s['minecraft:broken'], 5),
    } : null,
    advancementsList: adv.done.slice(0, 80),
  };
}

/* ── Live-Daten eines Online-Spielers ──
 * Ein einziges `data get entity` über die Konsole (dort ungekürzt) — die Antwortzeile fängt
 * der Live-Tail ab, sie taucht nicht in der Konsolen-Ansicht auf. */
const VITALS = ['Health', 'foodLevel', 'foodSaturationLevel', 'XpLevel', 'XpP', 'XpTotal', 'Pos', 'Dimension', 'playerGameType', 'SelectedItemSlot', 'AbsorptionAmount', 'Air', 'Fire'];
const INV_PARTS = ['Inventory', 'equipment', 'EnderItems'];

async function livePlayer(inst, name, parts) {
  const raw = {};
  const keys = [...VITALS, ...parts];
  const full = await consoleQuery(inst, `data get entity ${name}`, name, 4000);
  if (full == null) return raw;
  try {
    const all = parseSnbt(full);
    for (const k of keys) if (all && all[k] !== undefined) raw[k] = all[k];
    return raw;
  } catch { /* Parser kommt mit etwas nicht klar → einzeln nachfragen */ }
  for (const key of keys) {
    const txt = await consoleQuery(inst, `data get entity ${name} ${key}`, name);
    if (txt == null) continue;
    try { raw[key] = parseSnbt(txt); } catch { /* */ }
  }
  return raw;
}

/** Item-Modifier inline: ab 26.x heißt der Schlüssel `type`, davor `function` */
async function modify(inst, target, slot, fn, args) {
  const major = Number(String(inst.mc_version || '').split('.')[0]) || 1;
  const keys = major >= 26 ? ['type', 'function'] : ['function', 'type'];
  for (const k of keys) {
    const r = await command(inst, `item modify entity ${target} ${slot} {${k}:"${fn}",${args}}`);
    if (!r.out || !/Failed to parse|No key/.test(r.out)) return r;
  }
  throw new Error('Item konnte nicht geändert werden (Server-Version kennt den Modifier nicht).');
}

/* ── Inventar bearbeiten ── */
function cmdSlot(slot) {
  const [kind, nRaw] = String(slot).split(':');
  const n = Number(nRaw);
  if (kind === 'inv' && n >= 0 && n <= 8) return `hotbar.${n}`;
  if (kind === 'inv' && n >= 9 && n <= 35) return `inventory.${n - 9}`;
  if (kind === 'armor' && ['head', 'chest', 'legs', 'feet'].includes(nRaw)) return `armor.${nRaw}`;
  if (kind === 'offhand') return 'weapon.offhand';
  if (kind === 'ender' && n >= 0 && n <= 26) return `enderchest.${n}`;
  throw new Error('Ungültiger Slot.');
}

function fileSlotRef(root, slot, dataVersion) {
  const [kind, nRaw] = String(slot).split(':');
  const v = root.v;
  const newFormat = dataVersion >= 4300 || !!v.equipment; // 1.21.5+: Rüstung in "equipment"
  if (kind === 'inv' || kind === 'ender' || (!newFormat && (kind === 'armor' || kind === 'offhand'))) {
    const key = kind === 'ender' ? 'EnderItems' : 'Inventory';
    if (!v[key]) v[key] = { t: T.LIST, v: { et: T.COMPOUND, v: [] } };
    let n = Number(nRaw);
    if (kind === 'armor') n = { feet: 100, legs: 101, chest: 102, head: 103 }[nRaw];
    if (kind === 'offhand') n = -106;
    return { type: 'list', list: v[key].v, n };
  }
  if (!v.equipment) v.equipment = { t: T.COMPOUND, v: {} };
  return { type: 'equip', comp: v.equipment.v, key: kind === 'offhand' ? 'offhand' : nRaw };
}

export async function editInventory(inst, uuidIn, body) {
  const uuid = dashUuid(uuidIn);
  const op = String(body.op || '');
  const detail = (await listPlayers(inst)).players.find((p) => p.uuid === uuid);
  if (!detail) throw new Error('Spieler nicht gefunden.');
  const count = Math.max(1, Math.min(99, Math.round(Number(body.count) || 1)));
  const id = String(body.id || '');
  if (op === 'set' && !ITEM_RE.test(id)) throw new Error('Ungültige Item-ID.');

  if (op === 'move') return moveItem(inst, detail, String(body.from || ''), String(body.to || ''));

  if (detail.online) {
    const n = detail.name;
    if (op === 'clear') return command(inst, `clear ${n}`);
    if (op === 'clear-ender') {
      for (let i = 0; i < 27; i += 1) await command(inst, `item replace entity ${n} enderchest.${i} with minecraft:air`);
      return { ok: true };
    }
    const s = cmdSlot(body.slot);
    if (op === 'remove') return command(inst, `item replace entity ${n} ${s} with minecraft:air`);
    if (op === 'count') return modify(inst, n, s, 'minecraft:set_count', `count:${count}`);
    if (op === 'repair') return modify(inst, n, s, 'minecraft:set_damage', 'damage:1.0');
    if (op === 'set') return command(inst, `item replace entity ${n} ${s} with ${id} ${count}`);
    throw new Error('Unbekannte Aktion.');
  }

  const file = path.join(playerDirs(inst).data, `${uuid}.dat`);
  if (!fs.existsSync(file)) throw new Error('Für diesen Spieler gibt es noch keine Spielerdaten.');
  const root = readNbtFile(file);
  const dv = root.v.DataVersion?.v || 0;
  const countKey = dv && dv < 3837 ? 'Count' : 'count';
  const mkItem = (slotN) => {
    const v = { id: { t: T.STRING, v: id } };
    v[countKey] = countKey === 'Count' ? { t: T.BYTE, v: count } : { t: T.INT, v: count };
    if (slotN !== undefined) v.Slot = { t: T.BYTE, v: slotN };
    return { t: T.COMPOUND, v };
  };
  if (op === 'clear' || op === 'clear-ender') {
    const key = op === 'clear' ? 'Inventory' : 'EnderItems';
    if (root.v[key]) root.v[key].v.v = [];
    if (op === 'clear' && root.v.equipment) root.v.equipment.v = {};
  } else {
    const ref = fileSlotRef(root, body.slot, dv);
    if (ref.type === 'list') {
      const idx = ref.list.v.findIndex((e) => e.v.Slot?.v === ref.n);
      const cur = idx >= 0 ? ref.list.v[idx] : null;
      if (op === 'remove') { if (idx >= 0) ref.list.v.splice(idx, 1); }
      else if (op === 'set') {
        const it = mkItem(ref.n);
        if (idx >= 0) ref.list.v[idx] = it; else ref.list.v.push(it);
        ref.list.et = T.COMPOUND;
      } else if (!cur) throw new Error('Slot ist leer.');
      else if (op === 'count') {
        const k = cur.v.count ? 'count' : 'Count';
        cur.v[k] = { t: cur.v[k]?.t || T.INT, v: count };
      } else if (op === 'repair') {
        delete cur.v.components?.v['minecraft:damage'];
        if (cur.v.tag?.v.Damage) cur.v.tag.v.Damage.v = 0;
      } else throw new Error('Unbekannte Aktion.');
    } else {
      const cur = ref.comp[ref.key];
      if (op === 'remove') delete ref.comp[ref.key];
      else if (op === 'set') ref.comp[ref.key] = mkItem();
      else if (!cur) throw new Error('Slot ist leer.');
      else if (op === 'count') cur.v.count = { t: cur.v.count?.t || T.INT, v: count };
      else if (op === 'repair') delete cur.v.components?.v['minecraft:damage'];
      else throw new Error('Unbekannte Aktion.');
    }
  }
  writeNbtFile(file, root);
  chownForRun(file);
  try { chownForRun(`${file}.orbit-bak`); } catch { /* */ }
  return { ok: true, file: true };
}

/* ── Items verschieben / tauschen ── */
const slotKey = (slot) => String(slot);
function occupiedMap(norm) {
  const m = new Map();
  for (const [n, it] of Object.entries(norm.inv)) m.set(`inv:${n}`, it);
  for (const [n, it] of Object.entries(norm.ender)) m.set(`ender:${n}`, it);
  for (const k of ['head', 'chest', 'legs', 'feet']) if (norm.equip[k]) m.set(`armor:${k}`, norm.equip[k]);
  if (norm.equip.offhand) m.set('offhand', norm.equip.offhand);
  return m;
}

async function moveItem(inst, detail, from, to) {
  cmdSlot(from); cmdSlot(to); // validiert beide
  if (from === to) return { ok: true };
  if (detail.online) {
    const n = detail.name;
    const live = await livePlayer(inst, n, INV_PARTS);
    const occ = occupiedMap(normalizePlayer({ ...live, EnderItems: live.EnderItems || [] }));
    if (!occ.has(slotKey(from))) throw new Error('Der Slot ist inzwischen leer.');
    const F = cmdSlot(from);
    const D = cmdSlot(to);
    if (!occ.has(slotKey(to))) {
      await command(inst, `item replace entity ${n} ${D} from entity ${n} ${F}`);
      await command(inst, `item replace entity ${n} ${F} with minecraft:air`);
      return { ok: true };
    }
    // Tauschen über einen freien Zwischen-Slot
    const order = [...Array.from({ length: 27 }, (_, i) => i + 9), ...Array.from({ length: 9 }, (_, i) => i)].map((i) => `inv:${i}`);
    const tmp = order.find((k) => !occ.has(k) && k !== from && k !== to);
    if (!tmp) throw new Error('Zum Tauschen braucht der Spieler einen freien Inventar-Slot.');
    const T2 = cmdSlot(tmp);
    await command(inst, `item replace entity ${n} ${T2} from entity ${n} ${D}`);
    await command(inst, `item replace entity ${n} ${D} from entity ${n} ${F}`);
    await command(inst, `item replace entity ${n} ${F} from entity ${n} ${T2}`);
    await command(inst, `item replace entity ${n} ${T2} with minecraft:air`);
    return { ok: true, swapped: true };
  }

  // offline: direkt in der Spielerdatei
  const file = path.join(playerDirs(inst).data, `${detail.uuid}.dat`);
  if (!fs.existsSync(file)) throw new Error('Für diesen Spieler gibt es noch keine Spielerdaten.');
  const root = readNbtFile(file);
  const dv = root.v.DataVersion?.v || 0;
  const take = (slot) => {
    const ref = fileSlotRef(root, slot, dv);
    if (ref.type === 'list') {
      const idx = ref.list.v.findIndex((e) => e.v.Slot?.v === ref.n);
      if (idx < 0) return null;
      const [tag] = ref.list.v.splice(idx, 1);
      delete tag.v.Slot;
      return tag;
    }
    const tag = ref.comp[ref.key] || null;
    delete ref.comp[ref.key];
    return tag;
  };
  const put = (slot, tag) => {
    const ref = fileSlotRef(root, slot, dv);
    if (ref.type === 'list') {
      tag.v.Slot = { t: T.BYTE, v: ref.n };
      ref.list.v.push(tag);
      ref.list.et = T.COMPOUND;
    } else {
      delete tag.v.Slot;
      ref.comp[ref.key] = tag;
    }
  };
  const a = take(from);
  if (!a) throw new Error('Der Slot ist leer.');
  const b = take(to);
  put(to, a);
  if (b) put(from, b);
  writeNbtFile(file, root);
  chownForRun(file);
  try { chownForRun(`${file}.orbit-bak`); } catch { /* */ }
  return { ok: true, file: true, swapped: !!b };
}

/* ── Aktionen (Kick, Bann, OP, Whitelist, …) ── */
function mcDate(t = Date.now()) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
}
const clean = (s, n = 200) => String(s || '').replace(/[\r\n§]/g, ' ').trim().slice(0, n);
const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'];

export async function playerAction(inst, body, actor = 'Orbit') {
  const action = String(body.action || '');
  const reason = clean(body.reason);
  const running = isRunning(inst.id);

  // Server-weite Schalter
  if (action === 'whitelist-on' || action === 'whitelist-off') {
    const on = action === 'whitelist-on';
    if (running) await command(inst, `whitelist ${on ? 'on' : 'off'}`);
    writeProperties(inst.path, { 'white-list': on ? 'true' : 'false', ...(body.enforce !== undefined ? { 'enforce-whitelist': body.enforce ? 'true' : 'false' } : {}) });
    return { ok: true };
  }
  if (action === 'pardon-ip' || action === 'ban-ip') {
    const ip = String(body.ip || '');
    if (!IP_RE.test(ip)) throw new Error('Ungültige IP.');
    if (running) return command(inst, action === 'ban-ip' ? `ban-ip ${ip}${reason ? ` ${reason}` : ''}` : `pardon-ip ${ip}`);
    const file = listFile(inst, 'banned-ips.json');
    const cur = readJson(file, []).filter((b) => b.ip !== ip);
    if (action === 'ban-ip') cur.push({ ip, created: mcDate(), source: actor, expires: 'forever', reason: reason || 'Gebannt über Orbit' });
    writeJson(file, cur);
    return { ok: true };
  }
  if (action === 'broadcast') {
    const msg = clean(body.message, 240);
    if (!msg) throw new Error('Nachricht fehlt.');
    return command(inst, `say ${msg}`);
  }

  // Spieler-bezogen
  let name = String(body.name || '');
  let uuid = dashUuid(body.uuid);
  if (!NAME_RE.test(name)) throw new Error('Ungültiger Spielername.');
  if (!uuid && ['op', 'whitelist-add', 'ban'].includes(action) && !running) ({ uuid, name } = await resolveProfile(inst, name));

  if (running) {
    switch (action) {
      case 'kick': return command(inst, `kick ${name}${reason ? ` ${reason}` : ''}`);
      case 'ban': return command(inst, `ban ${name}${reason ? ` ${reason}` : ''}`);
      case 'pardon': return command(inst, `pardon ${name}`);
      case 'op': return command(inst, `op ${name}`);
      case 'deop': return command(inst, `deop ${name}`);
      case 'whitelist-add': return command(inst, `whitelist add ${name}`);
      case 'whitelist-remove': return command(inst, `whitelist remove ${name}`);
      case 'gamemode': {
        const gm = String(body.value);
        if (!GAMEMODES.includes(gm)) throw new Error('Ungültiger Spielmodus.');
        return command(inst, `gamemode ${gm} ${name}`);
      }
      case 'heal': await command(inst, `effect give ${name} minecraft:instant_health 1 4 true`); return command(inst, `effect give ${name} minecraft:saturation 1 20 true`);
      case 'feed': return command(inst, `effect give ${name} minecraft:saturation 1 20 true`);
      case 'effects-clear': return command(inst, `effect clear ${name}`);
      case 'kill': return command(inst, `kill ${name}`);
      case 'clear': return command(inst, `clear ${name}`);
      case 'message': {
        const msg = clean(body.message, 240);
        if (!msg) throw new Error('Nachricht fehlt.');
        return command(inst, `tell ${name} ${msg}`);
      }
      case 'xp': {
        const n = Math.max(-1000, Math.min(1000, Math.round(Number(body.value) || 0)));
        return command(inst, `xp add ${name} ${n} levels`);
      }
      case 'give': {
        const id = String(body.id || '');
        if (!ITEM_RE.test(id)) throw new Error('Ungültige Item-ID.');
        const count = Math.max(1, Math.min(6400, Math.round(Number(body.count) || 1)));
        return command(inst, `give ${name} ${id} ${count}`);
      }
      case 'tp': {
        const target = String(body.target || '');
        if (NAME_RE.test(target)) return command(inst, `tp ${name} ${target}`);
        const c = (body.pos || []).map(Number);
        if (c.length !== 3 || c.some((x) => !Number.isFinite(x))) throw new Error('Ziel fehlt.');
        const dim = /^[a-z0-9_]+:[a-z0-9_/]+$/.test(body.dimension || '') ? body.dimension : 'minecraft:overworld';
        return command(inst, `execute in ${dim} run tp ${name} ${c.join(' ')}`);
      }
      default: throw new Error('Unbekannte Aktion.');
    }
  }

  // Server aus → Listen direkt in den JSON-Dateien pflegen
  const L = lists(inst);
  const same = (e) => (uuid && e.uuid === uuid) || e.name?.toLowerCase() === name.toLowerCase();
  switch (action) {
    case 'op': writeJson(listFile(inst, 'ops.json'), [...L.ops.filter((e) => !same(e)), { uuid, name, level: 4, bypassesPlayerLimit: false }]); break;
    case 'deop': writeJson(listFile(inst, 'ops.json'), L.ops.filter((e) => !same(e))); break;
    case 'whitelist-add': writeJson(listFile(inst, 'whitelist.json'), [...L.whitelist.filter((e) => !same(e)), { uuid, name }]); break;
    case 'whitelist-remove': writeJson(listFile(inst, 'whitelist.json'), L.whitelist.filter((e) => !same(e))); break;
    case 'ban': writeJson(listFile(inst, 'banned-players.json'), [...L.bans.filter((e) => !same(e)), { uuid, name, created: mcDate(), source: actor, expires: 'forever', reason: reason || 'Gebannt über Orbit' }]); break;
    case 'pardon': writeJson(listFile(inst, 'banned-players.json'), L.bans.filter((e) => !same(e))); break;
    default: throw new Error('Dafür muss der Server laufen.');
  }
  return { ok: true, file: true };
}
