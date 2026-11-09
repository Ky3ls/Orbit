import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import Drawer from '../../components/Drawer.jsx';
import { Page, PageHeader } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { SVC_LABEL, SVC_TONE, ServiceButtons, copy, fmtBytes, fmtSince } from './hostShared.jsx';
import './host.css';

const KIND = { web: 'Webserver', db: 'Datenbank', runtime: 'Laufzeit' };
const KIND_LINK = { web: '/host/web', db: '/host/databases' };
const SVC_ICON = { web: 'globe', db: 'db', runtime: 'cfg' };

export default function Services() {
  const { user } = useOutletContext();
  const isOwner = user.role === 'owner';
  const [d, setD] = useState(null);
  const [log, setLog] = useState(null);

  const load = useCallback(() => {
    if (document.hidden) return;
    api('/api/host/overview').then(setD).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function openLog(s) {
    setLog({ svc: s, lines: null });
    try { const r = await api(`/api/host/services/${s.id}/log?n=200`); setLog({ svc: s, lines: r.lines }); } catch (e) { setLog({ svc: s, lines: [e.message] }); }
  }

  const h = d?.host;
  const memPct = h ? ((h.memTotal - h.memFree) / h.memTotal) * 100 : 0;
  const diskPct = h?.disk ? ((h.disk.total - h.disk.free) / h.disk.total) * 100 : 0;
  const installed = (d?.services || []).filter((s) => s.installed);
  const missing = (d?.services || []).filter((s) => !s.installed);

  return (
    <Page className="hx-page">
      <PageHeader eyebrow="Host" title="Dienste & System" description="Was auf diesem Server läuft — Webserver, Datenbanken und Laufzeiten. Neustarten, Logs ansehen, Status prüfen." />

      {h && (
        <div className="hx-sys">
          <div className="card hx-sys-main">
            <span className="hx-sys-ico"><NavIcon name="cpu" /></span>
            <span><b>{h.hostname}</b><small>{h.os} · {h.cpus} Kerne · Node {h.node}</small></span>
            {d.ip && <button type="button" className="hx-ip mono" onClick={() => copy(d.ip, 'IP kopiert')}><NavIcon name="globe" />{d.ip}</button>}
          </div>
          <div className="card hx-meter-card"><span>Last (1/5/15 min)</span><b>{h.load.map((x) => x.toFixed(2)).join(' · ')}</b><i className="hx-meter"><em style={{ width: `${Math.min(100, (h.load[0] / h.cpus) * 100)}%` }} /></i></div>
          <div className="card hx-meter-card"><span>Arbeitsspeicher</span><b>{fmtBytes(h.memTotal - h.memFree)} <small>/ {fmtBytes(h.memTotal)}</small></b><i className="hx-meter"><em style={{ width: `${memPct}%` }} /></i></div>
          <div className="card hx-meter-card"><span>Speicherplatz</span><b>{h.disk ? <>{fmtBytes(h.disk.total - h.disk.free)} <small>/ {fmtBytes(h.disk.total)}</small></> : '—'}</b><i className={`hx-meter${diskPct > 90 ? ' bad' : ''}`}><em style={{ width: `${diskPct}%` }} /></i></div>
          <div className="card hx-meter-card"><span>Online seit</span><b>{fmtSince(Date.now() - h.uptime * 1000)}</b></div>
        </div>
      )}

      <div className="hx-svcs">
        {installed.map((s) => (
          <article key={s.id} className={`card hx-svc tone-${SVC_TONE(s)}`}>
            <header>
              <span className="hx-svc-ico"><NavIcon name={SVC_ICON[s.kind]} /></span>
              <span className="hx-svc-title"><b>{s.label}</b><small>{KIND[s.kind]}{s.version ? ` · ${s.version}` : ''} · <span className="mono">{s.unit}</span></small></span>
              <span className={`mcx-state tone-${SVC_TONE(s)}`}><i />{SVC_LABEL(s)}</span>
            </header>
            <dl className="hx-svc-facts">
              <div><dt>Läuft seit</dt><dd>{s.active ? fmtSince(s.since) : '—'}</dd></div>
              <div><dt>RAM</dt><dd>{s.memory ? fmtBytes(s.memory) : '—'}</dd></div>
              <div><dt>Ports</dt><dd className="mono">{s.ports?.join(', ') || '—'}</dd></div>
              <div><dt>Autostart</dt><dd>{s.enabled ? 'An' : 'Aus'}</dd></div>
            </dl>
            <footer>
              <button type="button" className="o-icon-btn" title="Log ansehen" onClick={() => openLog(s)}><NavIcon name="log" /></button>
              {KIND_LINK[s.kind] && <Link to={KIND_LINK[s.kind]} className="btn btn-sm btn-ghost">Verwalten<NavIcon name="arrowRight" /></Link>}
              <span className="grow" />
              {isOwner && <ServiceButtons svc={s} onDone={load} compact />}
            </footer>
          </article>
        ))}
      </div>

      {missing.length > 0 && (
        <section className="hx-sec">
          <h3 className="hx-sec-title">Noch nicht installiert</h3>
          <div className="hx-missing">
            {missing.map((s) => (
              <Link key={s.id} to={KIND_LINK[s.kind] ? `${KIND_LINK[s.kind]}${s.kind === 'db' ? `?engine=${s.id === 'mariadb' ? 'mysql' : s.id}` : ''}` : '/host/services'} className="card hx-miss">
                <NavIcon name={SVC_ICON[s.kind]} /><span><b>{s.label}</b><small>{KIND[s.kind]}</small></span><NavIcon name="plus" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {log && (
        <Drawer onClose={() => setLog(null)} label="Log" width={760}>
          <div className="mcp-form">
            <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>{log.svc.label} · Log</h2><div className="pp-sub"><span className="muted mono">journalctl -u {log.svc.unit}</span></div></div><button type="button" className="pp-close" onClick={() => setLog(null)}><NavIcon name="x" /></button></div></header>
            <pre className="hx-cfg hx-log">{log.lines ? log.lines.join('\n') || '(leer)' : 'Lädt…'}</pre>
          </div>
        </Drawer>
      )}
    </Page>
  );
}
