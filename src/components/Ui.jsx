import { Children, isValidElement, memo, useEffect, useId, useState } from 'react';
import { ModuleShell } from '../workspace/Module.jsx';

export function Mark() {
  return (
    <div className="mark" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
        <path d="M6 25 L16 6 L26 25" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="16" cy="20" r="2.3" fill="currentColor" />
      </svg>
    </div>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ title, text }) {
  return (
    <div className="o-empty">
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

function isPageHeaderEl(el) {
  return isValidElement(el) && el.type?.displayName === 'OrbitPageHeader';
}

/** Seiten-Wrapper — extrahiert PageHeader in das neue os-screen-Gerüst */
export function Page({ children, className = '' }) {
  const items = Children.toArray(children);
  const headEl = items.find(isPageHeaderEl);
  const body = items.filter((c) => c !== headEl);
  const p = headEl?.props ?? {};
  return (
    <ModuleShell
      className={className}
      kicker={p.eyebrow}
      title={p.title}
      lead={p.description}
      actions={p.actions}
    >
      {body}
    </ModuleShell>
  );
}

/** Nur innerhalb von &lt;Page&gt; — Metadaten, kein eigenes DOM */
export function PageHeader(_props) {
  return null;
}
PageHeader.displayName = 'OrbitPageHeader';

export { Zone, Split } from '../workspace/Module.jsx';

export function Section({ title, action, children, className = '' }) {
  return (
    <section className={`o-section ${className}`.trim()}>
      {(title || action) && (
        <div className="o-section-head">
          {title ? <h2>{title}</h2> : <span />}
          {action || null}
        </div>
      )}
      {children}
    </section>
  );
}

export function PanelCard({ children, className = '', padded = true }) {
  return (
    <article className={`ob-tile o-card${padded ? '' : ' o-card-flush'} ${className}`.trim()}>
      {children}
    </article>
  );
}

export function Metric({ label, value, hint, pct }) {
  const width = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <article className="o-metric">
      <span className="o-metric-label">{label}</span>
      <strong className="o-metric-value">{value}</strong>
      {hint ? <em className="o-metric-hint">{hint}</em> : null}
      <i className="o-metric-bar" style={{ width: `${width}%` }} aria-hidden="true" />
    </article>
  );
}

export function Toolbar({ children, className = '' }) {
  return <div className={`o-toolbar ${className}`.trim()}>{children}</div>;
}

/**
 * @param {{ title: string, onClose: () => void, children: import('react').ReactNode, wide?: boolean, aside?: import('react').ReactNode, showClose?: boolean }} props
 * showClose: Header-X zum Schließen (default true).
 */
export function Modal({ title, onClose, children, wide, aside, showClose = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose} role="presentation">
      <div
        className={`modal-cluster${aside ? ' with-aside' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`modal${wide ? ' palette' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="spread modal-head">
            <h3 id="modal-title">{title}</h3>
            {showClose ? (
              <button
                className="modal-x"
                onClick={onClose}
                type="button"
                aria-label="Schließen"
                title="Schließen"
              >
                ×
              </button>
            ) : <span />}
          </div>
          {children}
        </div>
        {aside}
      </div>
    </div>
  );
}

function chartClock(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(ts);
}

function niceYTicks(scaleMax, fixed) {
  if (fixed === 100) return [100, 75, 50, 25, 0];
  if (fixed != null && fixed > 0) {
    const mid = Math.round(fixed / 2);
    return mid === 0 || mid === fixed ? [fixed, 0] : [fixed, mid, 0];
  }
  const m = Math.max(1, scaleMax);
  const mid = Math.round(m / 2);
  return mid === 0 || mid === m ? [m, 0] : [m, mid, 0];
}

/** Monitor-Chart mit Y-Skala, Grid und Zeitachse (Labels außerhalb SVG → kein Stretch). */
export const AreaChart = memo(function AreaChart({
  data,
  color = '#ff7a1a',
  accessor = (d) => d.v,
  yMax,
  formatY = (v) => `${Math.round(v)}`,
  ariaLabel = 'Diagramm',
}) {
  const id = useId().replace(/:/g, '');
  const series = data || [];
  const values = series.map(accessor);
  const rawMax = values.length ? Math.max(...values, 0) : 0;
  const scaleMax = yMax != null ? Math.max(yMax, 1) : Math.max(Math.ceil(rawMax * 1.15) || 1, 1);
  const yTicks = niceYTicks(scaleMax, yMax);
  const top = yTicks[0] || 1;

  const w = 100;
  const h = 100;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * w;
    const y = h - (Math.max(0, Math.min(v, top)) / top) * h;
    return [x, y];
  });
  const line = pts.length
    ? pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')
    : `M0,${h}`;
  const area = pts.length ? `${line} L${w},${h} L0,${h} Z` : `M0,${h} L${w},${h} Z`;

  const xCount = Math.min(4, Math.max(n, 1));
  const xLabels = [];
  if (n === 0) {
    xLabels.push({ key: 'e', label: '–' });
  } else {
    for (let i = 0; i < xCount; i += 1) {
      const idx = xCount === 1 ? 0 : Math.round((i / (xCount - 1)) * (n - 1));
      xLabels.push({ key: `${idx}-${i}`, label: chartClock(series[idx]?.t) || '–' });
    }
  }

  return (
    <div className="chart-frame" role="img" aria-label={ariaLabel}>
      <div className="chart-y" aria-hidden="true">
        {yTicks.map((t) => (
          <span key={t}>{formatY(t)}</span>
        ))}
      </div>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.slice(1, -1).map((t) => {
            const y = h - (t / top) * h;
            return (
              <line
                key={`g-${t}`}
                x1="0"
                x2={w}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <line x1="0" x2={w} y1={h} y2={h} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          <path d={area} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {n === 0 ? <span className="chart-empty muted">Keine Samples</span> : null}
      </div>
      <div className="chart-x" aria-hidden="true">
        {xLabels.map((x) => (
          <span key={x.key}>{x.label}</span>
        ))}
      </div>
    </div>
  );
});

export const Gauge = memo(function Gauge({ label, value, suffix = '%', tone = '#ff7a1a' }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="gauge card o-card">
      <svg viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} stroke="rgba(255,255,255,0.06)" strokeWidth="10" fill="none" />
        <circle
          cx="70" cy="70" r={r} stroke={tone} strokeWidth="10" fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 70 70)"
        />
      </svg>
      <strong>{Math.round(pct)}{suffix === '%' ? '%' : ''}</strong>
      <span className="muted">{label}</span>
    </div>
  );
});

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function Icon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'grid') return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
  if (name === 'pulse') return <svg viewBox="0 0 24 24" {...common}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
  if (name === 'term') return <svg viewBox="0 0 24 24" {...common}><path d="M4 6h16v12H4z" /><path d="M7 10l3 2-3 2M12 14h5" /></svg>;
  if (name === 'users') return <svg viewBox="0 0 24 24" {...common}><path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="8" r="3" /><path d="M20 20v-1a3.5 3.5 0 0 0-2.5-3.3M16 5.2a3 3 0 0 1 0 5.6" /></svg>;
  if (name === 'ban') return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /><path d="M7 7l10 10" /></svg>;
  if (name === 'list') return <svg viewBox="0 0 24 24" {...common}><path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" /></svg>;
  if (name === 'box') return <svg viewBox="0 0 24 24" {...common}><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /></svg>;
  if (name === 'clock') return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
  if (name === 'shield') return <svg viewBox="0 0 24 24" {...common}><path d="M12 3l8 3v6c0 5-3.4 7.8-8 9-4.6-1.2-8-4-8-9V6l8-3z" /></svg>;
  if (name === 'gear') return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>;
  return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /></svg>;
}
