import { Children, isValidElement, useEffect, useId, useState } from 'react';
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

export function Modal({ title, onClose, children, wide, aside }) {
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
          <div className="spread">
            <h3 id="modal-title">{title}</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose} type="button">Schließen</button>
          </div>
          {children}
        </div>
        {aside}
      </div>
    </div>
  );
}

export function AreaChart({ data, color = '#ff7a1a', accessor = (d) => d.v }) {
  const id = useId().replace(/:/g, '');
  const values = (data || []).map(accessor);
  const w = 640;
  const h = 160;
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => [i * step, h - (v / max) * (h - 20) - 8]);
  const d = pts.length
    ? pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    : `M0,${h}`;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="rgba(255,255,255,0.05)" />
      ))}
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Gauge({ label, value, suffix = '%', tone = '#ff7a1a' }) {
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
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <strong>{Math.round(pct)}{suffix === '%' ? '%' : ''}</strong>
      <span className="muted">{label}</span>
    </div>
  );
}

export function useNow(ms = 1000) {
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
