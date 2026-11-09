import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { toast } from '../../components/toast.jsx';
import { NavIcon } from '../../layout/icons.jsx';

export function fmtBytes(b) {
  if (b == null || Number.isNaN(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

export function fmtSince(t) {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} Tage`;
}

export function copy(text, label = 'Kopiert') {
  navigator.clipboard?.writeText(text).then(() => toast.ok(label)).catch(() => toast.err('Kopieren nicht möglich'));
}

/** Wert mit Kopieren-Knopf (Passwörter optional verdeckt) */
export function CopyField({ label, value, secret = false, multiline = false }) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="hx-copy">
      {label ? <span className="hx-copy-label">{label}</span> : null}
      <div className={`hx-copy-box${multiline ? ' multi' : ''}`}>
        <code>{show ? value : '•'.repeat(Math.min(24, String(value).length))}</code>
        {secret && <button type="button" className="o-icon-btn" title={show ? 'Verbergen' : 'Anzeigen'} onClick={() => setShow(!show)}><NavIcon name={show ? 'x' : 'search'} /></button>}
        <button type="button" className="o-icon-btn" title="Kopieren" onClick={() => copy(value, `${label || 'Wert'} kopiert`)}><NavIcon name="copy" /></button>
      </div>
    </div>
  );
}

/** Hintergrund-Job verfolgen (Installationen, Domains) */
export function useJob(onDone) {
  const [job, setJob] = useState(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!job || job.done) return undefined;
    const t = setInterval(async () => {
      try {
        const d = await api(`/api/host/jobs/${job.id}`);
        setJob(d.job);
        if (d.job.done) done.current?.(d.job);
      } catch { /* */ }
    }, 800);
    return () => clearInterval(t);
  }, [job?.id, job?.done]); // eslint-disable-line react-hooks/exhaustive-deps
  return [job, setJob];
}

export function JobLog({ job, onClose }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [job?.log?.length]);
  if (!job) return null;
  const tone = job.error ? 'bad' : job.done ? 'ok' : 'run';
  return (
    <section className={`hx-job card ${tone}`}>
      <header>
        <span className="hx-job-ico"><NavIcon name={job.error ? 'x' : job.done ? 'check' : 'refresh'} /></span>
        <span className="hx-job-title"><b>{job.label}</b><small>{job.error ? job.error.split('\n')[0] : job.done ? 'Abgeschlossen' : job.step}</small></span>
        {job.done && onClose && <button type="button" className="o-icon-btn" onClick={onClose} title="Schließen"><NavIcon name="x" /></button>}
      </header>
      {!job.done && <div className="hx-job-bar"><i /></div>}
      <div className="hx-job-log" ref={ref}>
        {job.log.map((l, i) => <div key={i} className={`lv-${l.level}`}>{l.text}</div>)}
      </div>
    </section>
  );
}

export const SVC_TONE = (s) => (!s?.installed ? 'idle' : s.active ? 'ok' : s.state === 'failed' ? 'bad' : 'warn');
export const SVC_LABEL = (s) => (!s?.installed ? 'Nicht installiert' : s.active ? 'Läuft' : s.state === 'failed' ? 'Fehler' : 'Gestoppt');

export function ServiceButtons({ svc, onDone, compact = false }) {
  const [busy, setBusy] = useState('');
  if (!svc?.installed) return null;
  async function act(action) {
    if ((action === 'stop' || action === 'restart') && !window.confirm(`${svc.label} ${action === 'stop' ? 'stoppen' : 'neu starten'}? Alles, was ihn nutzt, ist kurz nicht erreichbar.`)) return;
    setBusy(action);
    try {
      await api(`/api/host/services/${svc.id}/${action}`, { method: 'POST', body: {} });
      toast.ok(`${svc.label}: ${{ start: 'gestartet', stop: 'gestoppt', restart: 'neu gestartet', reload: 'Konfiguration neu geladen' }[action]}`);
      onDone?.();
    } catch (e) { toast.err(`${svc.label}: Aktion fehlgeschlagen`, { text: e.message }); }
    setBusy('');
  }
  return (
    <span className={`hx-svc-btns${compact ? ' compact' : ''}`}>
      {svc.active ? (
        <>
          {['nginx', 'apache', 'caddy', 'php'].includes(svc.id) && <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => act('reload')} title="Konfiguration neu laden ohne Unterbrechung"><NavIcon name="refresh" />{compact ? '' : 'Reload'}</button>}
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => act('restart')}><NavIcon name="restart" />{compact ? '' : 'Neustart'}</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => act('stop')}><NavIcon name="stop" />{compact ? '' : 'Stopp'}</button>
        </>
      ) : (
        <button type="button" className="btn btn-sm hx-start" disabled={!!busy} onClick={() => act('start')}><NavIcon name="play" />Starten</button>
      )}
    </span>
  );
}
