import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Zeitreihen-Diagramm (SVG): Linien oder gestapelte Flächen, Fadenkreuz + Tooltip, eine y-Achse.
 * series: [{ key, label, color, get: (point) => number }]
 */
export default function TimeChart({ points, series, stacked = false, yMax = null, format = (v) => String(Math.round(v)), height = 170, area = true, ariaLabel }) {
  const wrap = useRef(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((e) => setW(Math.max(200, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const PAD = { l: 52, r: 10, t: 8, b: 22 };
  const iw = w - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;

  const data = useMemo(() => {
    const pts = points.filter((p) => series.some((s) => s.get(p) != null));
    const rows = pts.map((p) => {
      let acc = 0;
      const vals = series.map((s) => {
        const v = Math.max(0, Number(s.get(p)) || 0);
        const lo = stacked ? acc : 0;
        acc = stacked ? acc + v : v;
        return { v, lo, hi: stacked ? acc : v };
      });
      return { t: p.t, vals, total: acc };
    });
    const max = yMax ?? Math.max(1, ...rows.map((r) => (stacked ? r.total : Math.max(...r.vals.map((x) => x.v)))));
    return { rows, max: niceMax(max, yMax != null) };
  }, [points, series, stacked, yMax]);

  const { rows, max } = data;
  const t0 = rows[0]?.t || 0;
  const t1 = rows[rows.length - 1]?.t || 1;
  const x = (t) => PAD.l + (t1 === t0 ? iw : ((t - t0) / (t1 - t0)) * iw);
  const y = (v) => PAD.t + ih - (Math.min(v, max) / max) * ih;

  const paths = series.map((s, si) => {
    if (!rows.length) return { line: '', fill: '' };
    const top = rows.map((r) => `${x(r.t).toFixed(1)},${y(r.vals[si].hi).toFixed(1)}`);
    const line = `M${top.join(' L')}`;
    const bottom = rows.slice().reverse().map((r) => `${x(r.t).toFixed(1)},${y(r.vals[si].lo).toFixed(1)}`);
    const fill = `${line} L${bottom.join(' L')} Z`;
    return { line, fill };
  });

  const ticks = [0, max / 2, max];
  const span = t1 - t0;
  const xLabels = rows.length > 1 ? [t0, t0 + span / 2, t1] : [];

  function onMove(e) {
    if (!rows.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const t = t0 + ((mx - PAD.l) / iw) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < rows.length; i += 1) if (Math.abs(rows[i].t - t) < Math.abs(rows[best].t - t)) best = i;
    setHover(best);
  }

  const hv = hover != null ? rows[hover] : null;

  return (
    <div className="tc" ref={wrap}>
      <svg width={w} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} className={`tc-grid${i === 0 ? ' base' : ''}`} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="tc-ytick">{format(v)}</text>
          </g>
        ))}
        {xLabels.map((t, i) => (
          <text key={i} x={x(t)} y={height - 5} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="tc-xtick">{relTime(t1, t)}</text>
        ))}
        {series.map((s, si) => (
          <g key={s.key}>
            {(area || stacked) && <path d={paths[si].fill} fill={s.color} className={stacked ? 'tc-stack' : 'tc-area'} />}
            <path d={paths[si].line} stroke={s.color} className="tc-line" />
          </g>
        ))}
        {hv && (
          <g>
            <line x1={x(hv.t)} x2={x(hv.t)} y1={PAD.t} y2={PAD.t + ih} className="tc-cross" />
            {series.map((s, si) => <circle key={s.key} cx={x(hv.t)} cy={y(hv.vals[si].hi)} r="4" fill={s.color} className="tc-dot" />)}
          </g>
        )}
      </svg>
      {hv && (
        <div className="tc-tip" style={{ left: Math.min(Math.max(x(hv.t) + 12, 0), w - 190), top: 8 }}>
          <b>{new Date(hv.t).toLocaleTimeString('de-DE')}</b>
          {series.map((s, si) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label}<em>{format(hv.vals[si].v)}</em></span>
          )).reverse()}
          {stacked && <span className="tc-tip-total">Summe<em>{format(hv.total)}</em></span>}
        </div>
      )}
      {!rows.length && <div className="tc-empty">Sammle Daten …</div>}
    </div>
  );
}

function niceMax(v, fixed) {
  if (fixed) return v;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

function relTime(now, t) {
  const s = Math.round((now - t) / 1000);
  if (s <= 1) return 'jetzt';
  if (s < 60) return `−${s} s`;
  return `−${Math.round(s / 60)} min`;
}
