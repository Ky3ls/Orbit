import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { NavIcon } from '../../layout/icons.jsx';
import { LABELS } from '../Audit.jsx';

/* Widgets unter Konsole & Spielerliste: Aktivität, Backups, Spieler */
function rel(ts) {
  if (!ts) return '–';
  const diff = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diff);
  const f = new Intl.RelativeTimeFormat('de', { numeric: 'auto', style: 'short' });
  if (abs < 60) return f.format(diff, 'second');
  if (abs < 3600) return f.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return f.format(Math.round(diff / 3600), 'hour');
  return f.format(Math.round(diff / 86400), 'day');
}
const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round((b || 0) / 1024 ** 2)} MB`);
const fmtHours = (ticks) => {
  const h = (ticks || 0) / 20 / 3600;
  return h >= 1 ? `${Math.round(h)} h` : `${Math.round(h * 60)} min`;
};
function tone(action) {
  if (/\.(stop|kill|delete)|ban/.test(action)) return 'bad';
  if (/restart|restore|kick/.test(action)) return 'warn';
  if (/\.start|backup\.create/.test(action)) return 'ok';
  return 'info';
}
function icon(action) {
  if (action.includes('backup')) return 'archive';
  if (/restart/.test(action)) return 'restart';
  if (/\.start/.test(action)) return 'play';
  if (/\.stop|\.kill/.test(action)) return 'stop';
  if (action.includes('player')) return 'users';
  if (action.includes('mod')) return 'box';
  if (action.includes('command')) return 'term';
  return 'sparkle';
}

export default function McWidgets({ inst, onPlayer }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      api(`/api/mc/instances/${inst.id}/overview`).then((x) => { if (alive) setD(x); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [inst.id]);

  const base = `/mc/${inst.id}`;
  const b = d?.backups;
  const p = d?.players;
  const job = b?.job;
  return (
    <>
      <section className="dash-activity card">
        <header className="dash-card-head">
          <h2>Letzte Aktivität</h2>
          <Link to="/audit" className="btn btn-sm btn-ghost">Alle ansehen<NavIcon name="arrowRight" /></Link>
        </header>
        {!d ? <div className="dash-empty"><span>Lädt…</span></div> : d.feed.length === 0 ? (
          <div className="dash-empty"><NavIcon name="audit" /><span>Noch nichts passiert.</span></div>
        ) : (
          <ol className="dash-feed">
            {d.feed.map((e) => {
              const detail = String(e.detail || '').replace(new RegExp(`^${inst.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*`), '');
              return (
                <li key={e.id} className={`tone-${tone(e.action)}`}>
                  <span className="dash-feed-ico"><NavIcon name={icon(e.action)} /></span>
                  <div className="dash-feed-body">
                    <span><b>{e.user}</b> {LABELS[e.action] || e.action}</span>
                    {detail ? <small title={detail}>{detail}</small> : null}
                  </div>
                  <time title={new Date(e.created).toLocaleString('de-DE')}>{rel(e.created)}</time>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <Link to={`${base}/backups`} className="dash-res card">
        <header className="dash-card-head">
          <h2>Backups</h2>
          <span className="dash-link">Öffnen <NavIcon name="arrowRight" /></span>
        </header>
        <div className="dash-res-big">
          <strong>{b ? b.count : '–'}</strong>
          <span className="muted">gespeichert · {b ? fmtSize(b.totalSize) : '–'}</span>
        </div>
        <div className="dash-res-bar" aria-hidden="true">
          {job ? <><i className="on" style={{ flexGrow: job.progress || 1 }} /><i className="idle" style={{ flexGrow: 100 - (job.progress || 1) }} /></> : <i className={b?.last ? 'on' : 'idle'} style={{ flexGrow: 1 }} />}
        </div>
        <ul className="dash-res-groups mcw-kv-list">
          {job ? <li><span>{job.step || 'Backup läuft'}</span><span /><span className="muted mono">{job.progress || 0}%</span></li> : null}
          <li><span>Letztes</span><span /><span className="muted">{b?.last ? rel(b.last.created) : 'noch keins'}</span></li>
          <li><span>Nächstes</span><span /><span className="muted">{b ? (b.enabled ? (b.next ? rel(b.next) : '–') : 'kein Zeitplan') : '–'}</span></li>
          <li><span>Frei</span><span /><span className="muted mono">{b?.free != null ? fmtSize(b.free) : '–'}</span></li>
        </ul>
      </Link>

      <section className="dash-comm card">
        <header className="dash-card-head">
          <h2>Spieler</h2>
          <Link to={`${base}/players`} className="btn btn-sm btn-ghost">Alle<NavIcon name="arrowRight" /></Link>
        </header>
        <div className="dash-stats">
          <Link to={`${base}/players`} className="dash-stat"><span>Bekannt</span><b>{p ? p.known : '–'}</b></Link>
          <Link to={`${base}/players`} className="dash-stat"><span>Aktiv 24 h</span><b>{p ? p.active24 : '–'}</b></Link>
          <Link to={`${base}/players`} className="dash-stat tone-ok"><span>Neu 24 h</span><b>{p ? `+${p.new24}` : '–'}</b></Link>
          <Link to={`${base}/players`} className="dash-stat tone-bad"><span>Gebannt</span><b>{p ? p.banned : '–'}</b></Link>
          <Link to={`${base}/players`} className="dash-stat tone-warn"><span>OPs</span><b>{p ? p.ops : '–'}</b></Link>
          <Link to={`${base}/players`} className="dash-stat"><span>Whitelist</span><b>{p ? (p.whitelist ? p.whitelisted : 'aus') : '–'}</b></Link>
        </div>
        {p?.top?.length ? (
          <ul className="mcw-top">
            <li className="mcw-top-h"><span>Meiste Spielzeit</span></li>
            {p.top.slice(0, 3).map((x, i) => (
              <li key={x.uuid}>
                <button type="button" onClick={() => onPlayer?.(x.uuid)}>
                  <span className="mcw-rank">{i + 1}</span>
                  <span className="mcw-name">{x.name}{x.online ? <i className="mcw-on" title="Online" /> : null}</span>
                  <span className="mcw-time mono">{fmtHours(x.playTicks)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
