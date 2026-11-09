import { useEffect, useMemo, useRef, useState } from 'react';
import { NavIcon } from '../../../layout/icons.jsx';
import { sapi, studioPath, typeTone } from './studioApi.js';

const W = 230;
const ROW = 22;
const HEAD = 34;
const MAXCOLS = 12;
const PKEY = (db) => `orbit.er.${db}`;

/** ER-Diagramm: Tabellen als Karten, Beziehungen als Linien — ziehen, zoomen, verschieben */
export default function StudioEr({ db, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem(PKEY(db)) || '{}'); } catch { return {}; } });
  const [view, setView] = useState({ x: 20, y: 20, k: 0.9 });
  const [hover, setHover] = useState(null);
  const [onlyLinked, setOnlyLinked] = useState(false);
  const drag = useRef(null);
  const svg = useRef(null);

  useEffect(() => { sapi(studioPath(db, '/relations')).then(setData).catch((e) => setErr(e.message)); }, [db]);

  const linked = useMemo(() => {
    const s = new Set();
    for (const r of data?.relations || []) { s.add(r.t); s.add(r.rt); }
    return s;
  }, [data]);

  const tables = useMemo(() => (data?.tables || []).filter((t) => !onlyLinked || linked.has(t.name)), [data, onlyLinked, linked]);

  // Startlayout: verknüpfte Tabellen zuerst, Raster nach Höhe
  const layout = useMemo(() => {
    const out = {};
    const sorted = [...tables].sort((a, b) => Number(linked.has(b.name)) - Number(linked.has(a.name)) || a.name.localeCompare(b.name));
    const perRow = Math.max(3, Math.ceil(Math.sqrt(sorted.length * 1.6)));
    const colY = new Array(perRow).fill(0);
    sorted.forEach((t) => {
      const h = HEAD + Math.min(MAXCOLS, t.columns.length) * ROW + (t.columns.length > MAXCOLS ? ROW : 0) + 8;
      let c = colY.indexOf(Math.min(...colY));
      if (c < 0) c = 0;
      out[t.name] = pos[t.name] || { x: c * (W + 70), y: colY[c] };
      colY[c] += h + 50;
    });
    return out;
  }, [tables, pos, linked]);

  useEffect(() => { try { localStorage.setItem(PKEY(db), JSON.stringify(pos)); } catch { /* */ } }, [pos, db]);

  const colY = (t, col) => {
    const i = t.columns.findIndex((c) => c.name === col);
    return HEAD + (i < 0 || i >= MAXCOLS ? MAXCOLS : i) * ROW + ROW / 2;
  };
  const byName = useMemo(() => Object.fromEntries(tables.map((t) => [t.name, t])), [tables]);

  function onDown(e, name) {
    e.stopPropagation();
    const p = layout[name];
    drag.current = { name, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
  }
  function onBgDown(e) { drag.current = { pan: true, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; }
  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.pan) setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else setPos((p) => ({ ...p, [d.name]: { x: d.ox + dx / view.k, y: d.oy + dy / view.k } }));
  }
  function onUp(e, name) {
    const d = drag.current;
    drag.current = null;
    if (d && name && !d.moved && !d.pan) onOpen?.(name);
    e?.stopPropagation?.();
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = svg.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(2, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  }
  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (err) return <div className="err">{err}</div>;
  if (!data) return <div className="mcx-loading">Lese Beziehungen…</div>;

  const rels = data.relations.filter((r) => byName[r.t] && byName[r.rt]);

  return (
    <div className="er">
      <div className="er-bar">
        <span className="muted">{tables.length} Tabellen · {rels.length} Beziehungen{data.relations.some((r) => r.guessed) ? ' (gestrichelt = vermutet)' : ''}</span>
        <span className="grow" />
        <label className="so-check"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} />Nur verknüpfte</label>
        <button type="button" className="o-icon-btn" title="Verkleinern" onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k * 0.85) }))}><NavIcon name="collapse" /></button>
        <span className="er-zoom">{Math.round(view.k * 100)}%</span>
        <button type="button" className="o-icon-btn" title="Vergrößern" onClick={() => setView((v) => ({ ...v, k: Math.min(2, v.k * 1.15) }))}><NavIcon name="expand" /></button>
        <button type="button" className="btn btn-sm" onClick={() => { setPos({}); setView({ x: 20, y: 20, k: 0.9 }); }}><NavIcon name="refresh" />Anordnen</button>
      </div>
      <svg ref={svg} className="er-canvas" onMouseDown={onBgDown} onMouseMove={onMove} onMouseUp={(e) => onUp(e)} onMouseLeave={() => { drag.current = null; }}>
        <defs>
          <pattern id="er-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="er-dot" /></pattern>
          <marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" className="er-arrowhead" /></marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#er-dots)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {rels.map((r, i) => {
            const a = layout[r.t];
            const b = layout[r.rt];
            if (!a || !b) return null;
            const ay = a.y + colY(byName[r.t], r.c);
            const by = b.y + colY(byName[r.rt], r.rc);
            const aRight = a.x + W < b.x;
            const bRight = b.x + W < a.x;
            const ax = aRight ? a.x + W : a.x;
            const bx = aRight ? b.x : bRight ? b.x + W : b.x;
            const c1 = aRight ? ax + 60 : ax - 60;
            const c2 = aRight ? bx - 60 : bRight ? bx + 60 : bx - 60;
            const hot = hover && (hover === r.t || hover === r.rt);
            return <path key={i} d={`M${ax} ${ay} C${c1} ${ay} ${c2} ${by} ${bx} ${by}`} className={`er-link${r.guessed ? ' guessed' : ''}${hot ? ' hot' : ''}`} markerEnd="url(#er-arrow)" />;
          })}
          {tables.map((t) => {
            const p = layout[t.name];
            const shown = t.columns.slice(0, MAXCOLS);
            const h = HEAD + shown.length * ROW + (t.columns.length > MAXCOLS ? ROW : 0) + 8;
            const fkCols = new Set(rels.filter((r) => r.t === t.name).map((r) => r.c));
            return (
              <g key={t.name} transform={`translate(${p.x} ${p.y})`} className={`er-table${hover === t.name ? ' hot' : ''}${linked.has(t.name) ? ' linked' : ''}`} onMouseDown={(e) => onDown(e, t.name)} onMouseUp={(e) => onUp(e, t.name)} onMouseEnter={() => setHover(t.name)} onMouseLeave={() => setHover(null)}>
                <rect width={W} height={h} rx="10" className="er-box" />
                <rect width={W} height={HEAD} rx="10" className="er-head" />
                <rect y={HEAD - 10} width={W} height="10" className="er-head" />
                <text x="12" y="22" className="er-title">{t.name.length > 24 ? `${t.name.slice(0, 23)}…` : t.name}</text>
                <text x={W - 12} y="22" textAnchor="end" className="er-count">{t.columns.length}</text>
                {shown.map((c, i) => (
                  <g key={c.name} transform={`translate(0 ${HEAD + i * ROW})`}>
                    {i % 2 === 1 && <rect width={W} height={ROW} className="er-zebra" />}
                    <text x="12" y="15" className={`er-col${c.key === 'PRI' ? ' pk' : fkCols.has(c.name) ? ' fk' : ''}`}>{c.key === 'PRI' ? '◆ ' : fkCols.has(c.name) ? '→ ' : ''}{c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name}</text>
                    <text x={W - 12} y="15" textAnchor="end" className={`er-type t-${typeTone(c.type)}`}>{c.type.replace(/\(.*\)/, '').slice(0, 12)}</text>
                  </g>
                ))}
                {t.columns.length > MAXCOLS && <text x="12" y={HEAD + MAXCOLS * ROW + 15} className="er-more">+ {t.columns.length - MAXCOLS} weitere</text>}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
