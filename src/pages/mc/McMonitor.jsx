import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Sparkline from '../../components/Sparkline.jsx';
import { toast } from '../../components/toast.jsx';
import { NavIcon } from '../../layout/icons.jsx';

/* Überwachung in der MC-Übersicht: Absturz, Lag, Verlauf, Spieler-Historie, Mod-Updates */

export function useMonitor(inst) {
  const [mon, setMon] = useState(null);
  const load = useCallback(() => {
    if (document.hidden) return;
    api(`/api/mc/instances/${inst.id}/monitor`).then(setMon).catch(() => {});
  }, [inst.id]);
  useEffect(() => {
    setMon(null);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  return [mon, load];
}

const fmtTime = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtMin = (m) => (m == null ? '–' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}

/** Lag als Kachel-Werte */
export function lagTile(lag, running) {
  if (!running || !lag) return { value: '–', unit: '', sub: null, pct: null, tone: null };
  if (lag.tps != null) {
    const tone = lag.tps >= 18 ? 'ok' : lag.tps >= 12 ? 'warn' : 'bad';
    return {
      value: lag.tps.toFixed(1),
      unit: 'TPS',
      sub: [lag.mspt != null ? `${lag.mspt.toFixed(0)} ms/Tick` : null, lag.behind10m ? `${lag.behind10m}× hinterher (10 min)` : null].filter(Boolean).join(' · ') || 'flüssig',
      pct: (lag.tps / 20) * 100,
      tone,
    };
  }
  const tone = lag.behind10m === 0 ? 'ok' : lag.behindMs10m < 20_000 ? 'warn' : 'bad';
  return {
    value: lag.behind10m === 0 ? 'OK' : `${lag.behind10m}×`,
    unit: lag.behind10m ? 'Lag' : '',
    sub: lag.behind10m ? `${(lag.behindMs10m / 1000).toFixed(0)} s hinterher in 10 min` : 'kein „Can\'t keep up“',
    pct: null,
    tone,
  };
}

/* ── Absturz ── */
export function CrashCard({ inst, crash, onDismiss }) {
  const [open, setOpen] = useState(false);
  if (!crash) return null;
  async function dismiss() {
    try { await api(`/api/mc/instances/${inst.id}/crash`, { method: 'DELETE' }); onDismiss?.(); } catch (e) { toast.err(e.message); }
  }
  const sus = crash.suspects || [];
  return (
    <section className="mcm-crash card mci-span">
      <div className="mcm-crash-head">
        <span className="mcm-crash-ico"><NavIcon name="bolt" /></span>
        <div className="mcm-crash-main">
          <h2>{crash.loop ? 'Crash-Schleife — Server bleibt aus' : 'Server ist abgestürzt'} <small>{new Date(crash.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></h2>
          {crash.description ? <p className="mcm-crash-desc">{crash.description}</p> : null}
          {crash.exception ? <code className="mcm-crash-ex">{crash.exception}</code> : null}
          <div className="mcm-crash-sus">
            <span>Verdacht:</span>
            {sus.length ? sus.map((s) => <b key={s} className="mono">{s}</b>) : <em>kein Mod eindeutig erkennbar</em>}
            {crash.suspectSource === 'stacktrace' ? <small>(aus dem Stacktrace geschätzt)</small> : null}
          </div>
        </div>
        <div className="mcm-crash-act">
          {crash.report ? <Link className="btn btn-sm" to={`/mc/${inst.id}/files?dir=crash-reports`} title={crash.report}><NavIcon name="log" />Crash-Report</Link> : null}
          <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? 'Weniger' : 'Letzte Zeilen'}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={dismiss}><NavIcon name="x" />Ausblenden</button>
        </div>
      </div>
      {open && (
        <pre className="mcm-crash-lines">{[...(crash.errors?.length ? crash.errors : []), ...(crash.errors?.length ? ['', '── letzte Ausgabe ──'] : []), ...(crash.lines || [])].join('\n')}</pre>
      )}
    </section>
  );
}

/* ── Mod-Updates ── */
export function ModUpdateBanner({ inst }) {
  const [s, setS] = useState(null);
  const load = useCallback((refresh) => api(`/api/mc/instances/${inst.id}/mods/summary${refresh ? '?refresh=1' : ''}`).then(setS).catch(() => {}), [inst.id]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    if (!s?.job?.running) return undefined;
    const t = setInterval(() => load(false), 2500);
    return () => clearInterval(t);
  }, [s?.job?.running, load]);
  if (!s?.supported) return null;
  const job = s.job;
  async function updateAll() {
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/update-all`, { method: 'POST' });
      setS((x) => ({ ...x, job: d.job }));
      toast.ok('Updates starten', { text: 'Zuerst ein Backup ohne Welten, dann jede Mod einzeln.' });
    } catch (e) { toast.err(e.message); }
  }
  if (job?.running) {
    return (
      <div className="mcm-banner mci-span tone-info">
        <NavIcon name="refresh" />
        <span><b>{s.noun === 'Plugins' ? 'Plugins' : 'Mods'} werden aktualisiert</b> · {job.step}{job.total ? ` (${job.done}/${job.total})` : ''}</span>
        <i className="mcm-banner-bar" style={{ width: `${job.total ? (job.done / job.total) * 100 : 5}%` }} />
      </div>
    );
  }
  if (job && !job.running && Date.now() - job.at < 30 * 60_000 && job.results?.length) {
    const ok = job.results.filter((r) => r.ok).length;
    return (
      <div className={`mcm-banner mci-span tone-${job.error || ok < job.results.length ? 'warn' : 'ok'}`}>
        <NavIcon name="check" />
        <span><b>{ok} von {job.results.length} aktualisiert</b>{job.error ? ` · ${job.error}` : ''}{job.restartNeeded ? ' · Neustart nötig, damit sie greifen.' : ''}</span>
        <Link className="btn btn-sm btn-ghost" to={`/mc/${inst.id}/mods`}>Ansehen</Link>
      </div>
    );
  }
  if (job?.error) return <div className="mcm-banner mci-span tone-bad"><NavIcon name="x" /><span><b>Mod-Updates abgebrochen</b> · {job.error}</span></div>;
  if (!s.count) return null;
  const names = Object.keys(s.updates).slice(0, 3).map((f) => f.replace(/\.jar$/, ''));
  return (
    <div className="mcm-banner mci-span tone-accent">
      <NavIcon name="sparkle" />
      <span><b>{s.count} {s.noun === 'Plugins' ? (s.count === 1 ? 'Plugin hat' : 'Plugins haben') : (s.count === 1 ? 'Mod hat' : 'Mods haben')} Updates</b> · <span className="muted">{names.join(', ')}{s.count > 3 ? ` und ${s.count - 3} weitere` : ''}</span></span>
      <Link className="btn btn-sm btn-ghost" to={`/mc/${inst.id}/mods`}>Einzeln</Link>
      <button type="button" className="btn btn-sm btn-primary" onClick={updateAll}><NavIcon name="refresh" />Alle aktualisieren</button>
    </div>
  );
}

/* ── Verlauf 24 h ── */
function Mini({ label, values, max, color, now, unit, fmt = (v) => v }) {
  const vals = values.filter((v) => v != null);
  const hi = vals.length ? Math.max(...vals) : null;
  const lo = vals.length ? Math.min(...vals) : null;
  return (
    <div className="mcm-mini">
      <div className="mcm-mini-top">
        <span>{label}</span>
        <b>{now != null ? fmt(now) : '–'}<small>{unit}</small></b>
      </div>
      <Sparkline values={values.map((v) => (v == null ? 0 : v))} max={max} color={color} height={46} />
      <div className="mcm-mini-foot"><span>min {lo != null ? fmt(lo) : '–'}</span><span>max {hi != null ? fmt(hi) : '–'}</span></div>
    </div>
  );
}

export function HistoryCard({ history }) {
  const h = history || [];
  const last = h[h.length - 1] || {};
  const tpsVals = h.map((x) => x.tps);
  return (
    <section className="dash-history card">
      <header className="dash-card-head">
        <h2>Verlauf · 24 h</h2>
        <span className="muted mcm-small">{h.length ? `seit ${fmtTime(h[0].t)} Uhr · alle 5 min` : 'sammelt Daten …'}</span>
      </header>
      {h.length < 2 ? (
        <div className="dash-empty"><NavIcon name="chart" /><span>Orbit zeichnet ab jetzt jede Minute auf — in ein paar Minuten siehst du hier den Verlauf.</span></div>
      ) : (
        <div className="mcm-minis">
          <Mini label="Spieler" values={h.map((x) => x.players)} color="var(--accent)" now={last.players} unit="" />
          <Mini label="TPS" values={tpsVals} max={20} color="var(--ok)" now={last.tps} unit="" fmt={(v) => Number(v).toFixed(1)} />
          <Mini label="CPU" values={h.map((x) => x.cpu)} color="var(--info, var(--accent))" now={last.cpu} unit="%" />
          <Mini label="RAM" values={h.map((x) => x.ram)} color="var(--warn)" now={last.ram} unit=" MB" fmt={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}`.replace('.', ',') : v)} />
        </div>
      )}
    </section>
  );
}

/* ── Spieler-Historie ── */
export function PlayerHistoryCard({ inst, onPlayer }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => { if (!document.hidden) api(`/api/mc/instances/${inst.id}/players/history`).then((x) => { if (alive) setD(x); }).catch(() => {}); };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [inst.id]);
  const days = d?.days || [];
  const maxPeak = Math.max(1, ...days.map((x) => x.peak), ...days.map((x) => x.players));
  const today = days[days.length - 1];
  return (
    <section className="dash-phist card">
      <header className="dash-card-head">
        <h2>Spieler-Historie</h2>
        <span className="muted mcm-small">7 Tage</span>
      </header>
      {!d ? <div className="dash-empty"><span>Lädt…</span></div> : (
        <>
          <div className="mcm-phist-kpis">
            <div><span>Peak heute</span><b>{today?.peak || 0}</b><small>{today?.peakAt ? `um ${fmtTime(today.peakAt)}` : '–'}</small></div>
            <div><span>Spieler heute</span><b>{today?.players || 0}</b><small>{fmtMin(today?.minutes || 0)} gespielt</small></div>
            <div><span>Ø Sitzung</span><b>{fmtMin(d.avgMinutes)}</b><small>letzte 7 Tage</small></div>
          </div>
          <div className="mcm-days" role="img" aria-label="Spieler pro Tag">
            {days.map((x) => (
              <div key={x.day} className="mcm-day" title={`${fmtDay(x.day)}: ${x.players} Spieler, Peak ${x.peak}, ${fmtMin(x.minutes)}`}>
                <i style={{ height: `${Math.max(4, (Math.max(x.peak, x.players) / maxPeak) * 100)}%` }} />
                <span>{fmtDay(x.day).slice(0, 2)}</span>
              </div>
            ))}
          </div>
          {d.sessions.length ? (
            <ul className="mcm-sessions">
              {d.sessions.slice(0, 6).map((s) => (
                <li key={`${s.name}-${s.joined}`}>
                  <button type="button" disabled={!s.uuid} onClick={() => s.uuid && onPlayer?.(s.uuid)}>
                    <span className={`mcm-dot${s.left ? '' : ' on'}`} />
                    <span className="mcm-sname">{s.name}</span>
                    <span className="mcm-stime">{s.left ? `${fmtTime(s.joined)}–${fmtTime(s.left)}` : `seit ${fmtTime(s.joined)}`}</span>
                    <span className="mcm-sdur mono">{fmtMin(Math.round(((s.left || Date.now()) - s.joined) / 60_000))}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <div className="dash-empty"><span>Noch keine Sitzungen aufgezeichnet.</span></div>}
        </>
      )}
    </section>
  );
}

export { ago };
