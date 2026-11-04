import fs from 'node:fs';
import zlib from 'node:zlib';

/*
 * Minimaler NBT-Leser/-Schreiber (Java Edition, Big Endian).
 * Tags bleiben typisiert ({ t, v }), damit Dateien verlustfrei zurückgeschrieben werden können.
 *   t: 1 byte · 2 short · 3 int · 4 long(BigInt) · 5 float · 6 double · 7 byte[] · 8 string
 *      9 list ({ t:9, et, v:[tags] }) · 10 compound ({ t:10, v:{name: tag} }) · 11 int[] · 12 long[]
 */
export const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTES: 7, STRING: 8, LIST: 9, COMPOUND: 10, INTS: 11, LONGS: 12 };

function reader(buf) {
  let o = 0;
  const r = {
    u8: () => buf.readUInt8(o++),
    i8: () => buf.readInt8(o++),
    i16: () => { const v = buf.readInt16BE(o); o += 2; return v; },
    u16: () => { const v = buf.readUInt16BE(o); o += 2; return v; },
    i32: () => { const v = buf.readInt32BE(o); o += 4; return v; },
    i64: () => { const v = buf.readBigInt64BE(o); o += 8; return v; },
    f32: () => { const v = buf.readFloatBE(o); o += 4; return v; },
    f64: () => { const v = buf.readDoubleBE(o); o += 8; return v; },
    str: () => { const n = r.u16(); const s = buf.subarray(o, o + n).toString('utf8'); o += n; return s; },
  };
  return r;
}

function readPayload(r, t, depth = 0) {
  if (depth > 512) throw new Error('NBT zu tief verschachtelt.');
  switch (t) {
    case T.BYTE: return r.i8();
    case T.SHORT: return r.i16();
    case T.INT: return r.i32();
    case T.LONG: return r.i64();
    case T.FLOAT: return r.f32();
    case T.DOUBLE: return r.f64();
    case T.BYTES: { const n = r.i32(); const a = []; for (let i = 0; i < n; i += 1) a.push(r.i8()); return a; }
    case T.STRING: return r.str();
    case T.LIST: {
      const et = r.u8(); const n = r.i32(); const v = [];
      for (let i = 0; i < n; i += 1) v.push({ t: et, v: readPayload(r, et, depth + 1) });
      return { et, v };
    }
    case T.COMPOUND: {
      const v = {};
      for (;;) {
        const ct = r.u8();
        if (ct === T.END) break;
        const name = r.str();
        v[name] = { t: ct, v: readPayload(r, ct, depth + 1) };
      }
      return v;
    }
    case T.INTS: { const n = r.i32(); const a = []; for (let i = 0; i < n; i += 1) a.push(r.i32()); return a; }
    case T.LONGS: { const n = r.i32(); const a = []; for (let i = 0; i < n; i += 1) a.push(r.i64()); return a; }
    default: throw new Error(`Unbekannter NBT-Typ ${t}`);
  }
}

/** Datei lesen → Root-Compound ({ t:10, v }) */
export function readNbtFile(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const r = reader(buf);
  const t = r.u8();
  if (t !== T.COMPOUND) throw new Error('Keine NBT-Datei.');
  r.str();
  const v = readPayload(r, T.COMPOUND);
  // Listen-Wrapper normalisieren
  return { t: T.COMPOUND, v };
}

/* ── Schreiben ── */
function writer() {
  const parts = [];
  const push = (size, fn) => { const b = Buffer.alloc(size); fn(b); parts.push(b); };
  const w = {
    u8: (v) => push(1, (b) => b.writeUInt8(v)),
    i8: (v) => push(1, (b) => b.writeInt8(v)),
    i16: (v) => push(2, (b) => b.writeInt16BE(v)),
    u16: (v) => push(2, (b) => b.writeUInt16BE(v)),
    i32: (v) => push(4, (b) => b.writeInt32BE(v)),
    i64: (v) => push(8, (b) => b.writeBigInt64BE(BigInt(v))),
    f32: (v) => push(4, (b) => b.writeFloatBE(v)),
    f64: (v) => push(8, (b) => b.writeDoubleBE(v)),
    str: (s) => { const b = Buffer.from(String(s), 'utf8'); w.u16(b.length); parts.push(b); },
    done: () => Buffer.concat(parts),
  };
  return w;
}

function writePayload(w, t, v) {
  switch (t) {
    case T.BYTE: w.i8(v); break;
    case T.SHORT: w.i16(v); break;
    case T.INT: w.i32(v); break;
    case T.LONG: w.i64(v); break;
    case T.FLOAT: w.f32(v); break;
    case T.DOUBLE: w.f64(v); break;
    case T.BYTES: w.i32(v.length); v.forEach((x) => w.i8(x)); break;
    case T.STRING: w.str(v); break;
    case T.LIST: {
      const et = v.v.length ? v.et : (v.et || T.END);
      w.u8(et); w.i32(v.v.length);
      v.v.forEach((x) => writePayload(w, et, x.v));
      break;
    }
    case T.COMPOUND:
      for (const [name, tag] of Object.entries(v)) { w.u8(tag.t); w.str(name); writePayload(w, tag.t, tag.v); }
      w.u8(T.END);
      break;
    case T.INTS: w.i32(v.length); v.forEach((x) => w.i32(x)); break;
    case T.LONGS: w.i32(v.length); v.forEach((x) => w.i64(x)); break;
    default: throw new Error(`Unbekannter NBT-Typ ${t}`);
  }
}

/** Root-Compound gzip-komprimiert schreiben (atomar, mit .orbit-bak Sicherung) */
export function writeNbtFile(file, root) {
  const w = writer();
  w.u8(T.COMPOUND); w.str('');
  writePayload(w, T.COMPOUND, root.v);
  const data = zlib.gzipSync(w.done());
  try { fs.copyFileSync(file, `${file}.orbit-bak`); } catch { /* neu */ }
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

/** Typisierten Baum in normales JSON umwandeln (BigInt → Number) */
export function plain(tag) {
  if (!tag) return undefined;
  switch (tag.t) {
    case T.LONG: return Number(tag.v);
    case T.LONGS: return tag.v.map(Number);
    case T.LIST: return tag.v.v.map(plain);
    case T.COMPOUND: return Object.fromEntries(Object.entries(tag.v).map(([k, x]) => [k, plain(x)]));
    default: return tag.v;
  }
}

/** Plain-JSON-Wert in Tag umwandeln (für neue Items) — Zahlen werden als INT geschrieben, außer Hinweis */
export function tagOf(value, hint) {
  if (hint) return { t: hint, v: value };
  if (typeof value === 'string') return { t: T.STRING, v: value };
  if (typeof value === 'boolean') return { t: T.BYTE, v: value ? 1 : 0 };
  if (typeof value === 'number') return Number.isInteger(value) ? { t: T.INT, v: value } : { t: T.DOUBLE, v: value };
  if (Array.isArray(value)) {
    const items = value.map((x) => tagOf(x));
    return { t: T.LIST, v: { et: items[0]?.t || T.END, v: items } };
  }
  return { t: T.COMPOUND, v: Object.fromEntries(Object.entries(value).map(([k, x]) => [k, tagOf(x)])) };
}
