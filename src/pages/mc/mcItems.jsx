import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/* ── Item-Katalog (Namen, Icons, Übersetzungen) pro MC-Version ── */
const catalogs = new Map();
const listeners = new Map();

function loadCatalog(ver) {
  if (catalogs.has(ver)) return;
  catalogs.set(ver, null);
  const tick = async (n = 0) => {
    try {
      const d = await api(`/api/mc/assets/${encodeURIComponent(ver)}/catalog`);
      if (d.pending && n < 60) { setTimeout(() => tick(n + 1), 2500); return; }
      if (d.items) {
        catalogs.set(ver, d);
        (listeners.get(ver) || []).forEach((fn) => fn(d));
      }
    } catch { catalogs.delete(ver); }
  };
  tick();
}

export function useCatalog(ver) {
  const [cat, setCat] = useState(() => catalogs.get(ver) || null);
  useEffect(() => {
    if (!ver) return undefined;
    loadCatalog(ver);
    if (catalogs.get(ver)) setCat(catalogs.get(ver));
    const fn = (d) => setCat(d);
    listeners.set(ver, [...(listeners.get(ver) || []), fn]);
    return () => listeners.set(ver, (listeners.get(ver) || []).filter((x) => x !== fn));
  }, [ver]);
  return cat;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n) => ROMAN[n] || String(n);

export function itemName(cat, id) {
  return cat?.items?.[id]?.n || prettyId(id);
}
export function prettyId(id) {
  const s = String(id || '').replace(/^minecraft:/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function langName(cat, prefix, id) {
  const key = `${prefix}.${String(id).replace(':', '.')}`;
  return cat?.lang?.[key] || prettyId(id);
}
export function advTitle(cat, id) {
  const k = String(id).replace(/^minecraft:/, '').replace(/\//g, '.');
  return { title: cat?.lang?.[`advancements.${k}.title`] || prettyId(k.split('.').pop()), desc: cat?.lang?.[`advancements.${k}.description`] || '', cat: k.split('.')[0] };
}

/* ── Icon-Rendering (Canvas → Data-URL, gecacht) ── */
const imgCache = new Map();
const iconCache = new Map();

function loadImg(ver, tex) {
  const key = `${ver}|${tex}`;
  if (!imgCache.has(key)) {
    imgCache.set(key, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `/api/mc/assets/${encodeURIComponent(ver)}/tex?p=${encodeURIComponent(tex)}`;
    }));
  }
  return imgCache.get(key);
}

/** Erstes 16×16-Frame (animierte Texturen sind vertikale Streifen), optional eingefärbt */
function frame(img, tint, half = false) {
  const c = document.createElement('canvas');
  const w = img.naturalWidth || 16;
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (half) g.drawImage(img, 0, w / 2, w, w / 2, 0, 8, 16, 8);
  else g.drawImage(img, 0, 0, w, w, 0, 0, 16, 16);
  if (tint) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = tint;
    g.fillRect(0, 0, 16, 16);
    g.globalCompositeOperation = 'destination-in';
    if (half) g.drawImage(img, 0, w / 2, w, w / 2, 0, 8, 16, 8);
    else g.drawImage(img, 0, 0, w, w, 0, 0, 16, 16);
  }
  return c;
}

async function renderIcon(ver, d) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (d.k === 'i') {
    const img = await loadImg(ver, d.t);
    g.drawImage(frame(img, d.tint), 0, 0, 16, 16, 4, 4, 56, 56);
    return c.toDataURL();
  }
  const [top, left, right] = await Promise.all([loadImg(ver, d.top), loadImg(ver, d.left), loadImg(ver, d.right)]);
  const slab = d.s === 'slab';
  const H = slab ? 15 : 30; // Höhe der Seitenflächen
  const y0 = slab ? 19 : 4;
  const topF = frame(top, d.tint);
  const leftF = frame(left, d.tintSide);
  const rightF = frame(right, d.tintSide);
  // Seitenflächen einzeln abdunkeln (eigene Canvas, sonst trifft source-atop den ganzen Würfel)
  const shadeFace = (src, alpha) => {
    const fc = document.createElement('canvas');
    fc.width = 16; fc.height = 16;
    const fg = fc.getContext('2d');
    fg.imageSmoothingEnabled = false;
    fg.drawImage(src, 0, 0);
    fg.globalCompositeOperation = 'source-atop';
    fg.fillStyle = `rgba(0,0,0,${alpha})`;
    fg.fillRect(0, 0, 16, 16);
    return fc;
  };
  g.setTransform(28 / 16, 14 / 16, 0, H / 16, 4, y0 + 14);
  g.drawImage(shadeFace(leftF, 0.22), 0, slab ? 8 : 0, 16, slab ? 8 : 16, 0, 0, 16, 16);
  g.setTransform(28 / 16, -14 / 16, 0, H / 16, 32, y0 + 28);
  g.drawImage(shadeFace(rightF, 0.4), 0, slab ? 8 : 0, 16, slab ? 8 : 16, 0, 0, 16, 16);
  g.setTransform(28 / 16, 14 / 16, -28 / 16, 14 / 16, 32, y0);
  g.drawImage(topF, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL();
}

function iconUrl(ver, id, d) {
  const key = `${ver}|${id}`;
  if (!iconCache.has(key)) iconCache.set(key, renderIcon(ver, d).catch(() => null));
  return iconCache.get(key);
}

export function ItemIcon({ id, cat, size = 32, className = '' }) {
  const d = cat?.items?.[id]?.i;
  const ver = cat?.version;
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (d && ver) iconUrl(ver, id, d).then((u) => { if (alive) setSrc(u); });
    return () => { alive = false; };
  }, [id, ver, d]);
  if (!src) {
    const n = String(id || '?').replace(/^.*:/, '');
    return <span className={`mci-fallback ${className}`} style={{ width: size, height: size }} title={id}>{n.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className={`mci-icon ${className}`} src={src} width={size} height={size} alt="" draggable="false" />;
}

/* ── Skins: Kopf + Körper aus der Skin-Textur ── */
const skinCache = new Map();
function loadSkin(uuid, ver) {
  const key = `${uuid}|${ver}`;
  if (!skinCache.has(key)) {
    skinCache.set(key, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `/api/mc/skin/${uuid}?v=${encodeURIComponent(ver || '')}`;
    }));
  }
  return skinCache.get(key);
}

function useSkinCanvas(uuid, ver, draw, deps) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    loadSkin(uuid, ver).then((img) => {
      if (!alive || !img) return;
      setSrc(draw(img));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, ver, ...deps]);
  return src;
}

export function McHead({ uuid, name, ver, size = 36, className = '' }) {
  const src = useSkinCanvas(uuid, ver, (img) => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 80;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 8, 8, 8, 8, 4, 4, 72, 72);
    g.drawImage(img, 40, 8, 8, 8, 0, 0, 80, 80);
    return c.toDataURL();
  }, []);
  return (
    <span className={`mcp-head ${className}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" draggable="false" /> : <b>{String(name || '?').slice(0, 1).toUpperCase()}</b>}
    </span>
  );
}

export function McBody({ uuid, ver, scale = 8, slim = false }) {
  const src = useSkinCanvas(uuid, ver, (img) => {
    const legacy = img.naturalHeight === 32;
    const s = img.naturalWidth / 64;
    const c = document.createElement('canvas');
    c.width = 16 * scale; c.height = 32 * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const aw = slim ? 3 : 4;
    const part = (sx, sy, w, h, dx, dy, mirror = false) => {
      g.save();
      if (mirror) { g.translate((dx + w) * scale, dy * scale); g.scale(-1, 1); g.drawImage(img, sx * s, sy * s, w * s, h * s, 0, 0, w * scale, h * scale); }
      else g.drawImage(img, sx * s, sy * s, w * s, h * s, dx * scale, dy * scale, w * scale, h * scale);
      g.restore();
    };
    part(8, 8, 8, 8, 4, 0); // Kopf
    part(20, 20, 8, 12, 4, 8); // Körper
    part(44, 20, aw, 12, 4 - aw, 8); // rechter Arm
    if (legacy) part(44, 20, aw, 12, 12, 8, true); else part(36, 52, aw, 12, 12, 8);
    part(4, 20, 4, 12, 4, 20); // rechtes Bein
    if (legacy) part(4, 20, 4, 12, 8, 20, true); else part(20, 52, 4, 12, 8, 20);
    // zweite Ebene
    part(40, 8, 8, 8, 4, 0);
    if (!legacy) {
      part(20, 36, 8, 12, 4, 8);
      part(44, 36, aw, 12, 4 - aw, 8);
      part(52, 52, aw, 12, 12, 8);
      part(4, 36, 4, 12, 4, 20);
      part(4, 52, 4, 12, 8, 20);
    }
    return c.toDataURL();
  }, [scale, slim]);
  return src ? <img className="mcp-body" src={src} alt="" draggable="false" style={{ width: 16 * scale, height: 32 * scale }} /> : <span className="mcp-body ph" style={{ width: 16 * scale, height: 32 * scale }} />;
}

/* ── Formatierung ── */
export function fmtTicks(t) {
  const sec = Math.floor((t || 0) / 20);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} T ${h % 24} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
export function fmtNum(n) {
  return Number(n || 0).toLocaleString('de-DE');
}
export function fmtAgo(t) {
  if (!t) return '—';
  const d = Date.now() - t;
  if (d < 90_000) return 'gerade eben';
  if (d < 3600_000) return `vor ${Math.round(d / 60_000)} min`;
  if (d < 86_400_000) return `vor ${Math.round(d / 3600_000)} h`;
  if (d < 30 * 86_400_000) return `vor ${Math.round(d / 86_400_000)} Tagen`;
  return new Date(t).toLocaleDateString('de-DE');
}
export function fmtDate(t) {
  return t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
export const DIM = { 'minecraft:overworld': 'Oberwelt', 'minecraft:the_nether': 'Nether', 'minecraft:the_end': 'Ende' };
export const GM = { survival: 'Überleben', creative: 'Kreativ', adventure: 'Abenteuer', spectator: 'Zuschauer' };
