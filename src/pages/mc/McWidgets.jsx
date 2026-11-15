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
  return (
    <div className="mcw">
      <section className="mcw-act card">
        <header><h3>Letzte Aktivität</h3><Link to="/audit" className="btn btn-sm btn-ghost">Alle<NavIcon name="arrowRight" /></Link></header>
        {!d ? <div className="mcw-empty">Lädt…</div> : d.feed.length === 0 ? (
          <div className="mcw-empty"><NavIcon name="audit" /><span>Noch nichts passiert.</span></div>
        ) : (
          <ol>
            {d.feed.map((e) => {
              const detail = String(e.detail || '').replace(new RegExp(`^${inst.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*`), '');
              return (
                <li key={e.id} className={`tone-${tone(e.action)}`}>
                  <span className="mcw-ico"><NavIcon name={icon(e.action)} /></span>
                  <div><span><b>{e.user}</b> {LABELS[e.action] || e.action}</span>{detail ? <small title={detail}>{detail}</small> : null}</div>
                  <time title={new Date(e.created).toLocaleString('de-DE')}>{rel(e.created)}</time>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <Link to={`${base}/backups`} className="mcw-bak card">
        <header><h3>Backups</h3><span className="mcw-link">Öffnen <NavIcon name="arrowRight" /></span></header>
        {!b ? <div className="mcw-empty">Lädt…</div> : (
          <div className="mcw-bak-body">
            {b.job ? (
              <div className="mcw-job"><span>{b.job.step || 'Läuft…'}</span><i style={{ width: `${b.job.progress || 0}%` }} /></div>
            ) : null}
            <div className="mcw-kv"><span>Letztes Backup</span><b>{b.last ? rel(b.last.created) : 'Noch keins'}</b></div>
            <div className="mcw-kv"><span>Nächstes</span><b className={b.enabled ? '' : 'muted'}>{b.enabled ? (b.next ? rel(b.next) : '–') : 'Kein Zeitplan'}</b></div>
            <div className="mcw-kv"><span>Gespeichert</span><b>{b.count} · {fmtSize(b.totalSize)}</b></div>
            <div className="mcw-kv"><span>Frei auf der Platte</span><b>{b.free != null ? fmtSize(b.free) : '–'}</b></div>
          </div>
        )}
      </Link>

      <section className="mcw-ply card">
        <header><h3>Spieler</h3><Link to={`${base}/players`} className="btn btn-sm btn-ghost">Alle<NavIcon name="arrowRight" /></Link></header>
        {!p ? <div className="mcw-empty">Lädt…</div> : (<>
          <div className="mcw-stats">
            <div><span>Bekannt</span><b>{p.known}</b></div>
            <div><span>Aktiv 24 h</span><b>{p.active24}</b></div>
            <div className="tone-ok"><span>Neu 24 h</span><b>{p.new24 ? `+${p.new24}` : 0}</b></div>
            <div><span>OPs</span><b>{p.ops}</b></div>
            <div><span>Whitelist</span><b>{p.whitelist ? p.whitelisted : 'aus'}</b></div>
            <div className="tone-bad"><span>Gebannt</span><b>{p.banned}</b></div>
          </div>
          {p.top.length ? (
            <ul className="mcw-top">
              <li className="mcw-top-h"><span>Meiste Spielzeit</span></li>
              {p.top.map((x, i) => (
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
        </>)}
      </section>
    </div>
  );
}
