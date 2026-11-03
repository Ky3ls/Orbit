import { memo, useId } from 'react';

/** Kompakte Verlaufslinie für KPI-Karten (ohne Achsen). */
const Sparkline = memo(function Sparkline({ values, max, color = 'var(--accent)', height = 44 }) {
  const id = useId().replace(/:/g, '');
  const vals = (values || []).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return <div className="spark spark-empty" style={{ height }} />;
  const top = max ?? Math.max(...vals, 1) * 1.15;
  const w = 100;
  const h = 40;
  const pts = vals.map((v, i) => [
    (i / (vals.length - 1)) * w,
    h - (Math.max(0, Math.min(v, top)) / (top || 1)) * (h - 3) - 1.5,
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sg${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
});

export default Sparkline;
