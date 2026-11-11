import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Modal } from '../../components/Ui.jsx';
import GameMark from '../../components/GameMark.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import TimeChart from './TimeChart.jsx';
import './livestats.css';

/* Farben je Bereich: geprüfte, farbenblind-sichere Reihenfolge (dataviz-Validator), „Andere“ neutral */
const CAT = {
  minecraft: { label: 'Minecraft', icon: 'cube', dark: '#199e70', light: '#1baf7a' },
  fivem: { label: 'FiveM', icon: 'power', dark: '#d95926', light: '#eb6834' },
  database: { label: 'Datenbanken', icon: 'db', dark: '#3987e5', light: '#2a78d6' },
  web: { label: 'Web & PHP', icon: 'globe', dark: '#c98500', light: '#eda100' },
  orbit: { label: 'Orbit', icon: 'sparkle', dark: '#d55181', light: '#e87ba4' },
  other: { label: 'Andere', icon: 'layers', dark: '#7c7b75', light: '#9a9993' },
};
const NET = { rx: { dark: '#3987e5', light: '#2a78d6' }, tx: { dark: '#d95926', light: '#eb6834' } };
const RANGES = [['5', '5 min', 5 * 60_000], ['15', '15 min', 15 * 60_000], ['60', '1 h', 60 * 60_000]];

export function fmtB(b, digits = 1) {
  if (b == null) return '—';
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 100 * 1024 ** 2 ? digits : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(digits)} GB`;
}
const fmtRate = (b) => `${fmtB(b)}/s`;

function useTheme() {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === 'light');
  useEffect(() => {
    const mo = new MutationObserver(() => setLight(document.documentElement.dataset.theme === 'light'));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return light ? 'light' : 'dark';
}

export default function LiveStats({ servers = [], canKill = false }) {
  const theme = useTheme();
  const [snap, setSnap] = useState(null);
  const [hist, setHist] = useState([]);
  const [range, setRange] = useState('15');
  const [denied, setDenied] = useState(false);
  const [showProcs, setShowProcs] = useState(false);
  const [kill, setKill] = useState(null);
  const [flash, setFlash] = useState(null);
  const reload = useRef(() => {});
  const lastT = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      api(`/api/host/stats${lastT.current ? `?since=${lastT.current}` : ''}`).then((d) => {
        if (!alive) return;
        setSnap(d);
        if (d.history.length) {
          lastT.current = d.history[d.history.length - 1].t;
          setHist((h) => (h.length ? [...h, ...d.history.filter((p) => p.t > h[h.length - 1].t)] : d.history).slice(-720));
        }
      }).catch((e) => { if (e.status === 403) setDenied(true); });
    };
    reload.current = load;
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const shown = useMemo(() => {
    const ms = RANGES.find((r) => r[0] === range)[2];
    const from = Date.now() - ms;
    return hist.filter((p) => p.t >= from);
  }, [hist, range]);

  if (denied) return null;
  if (!snap) return <section className="card ls-loading"><div className="mcx-loading">Live-Statistik startet …</div></section>;

  const c = (k) => CAT[k][theme];
  const cur = snap.now || {};
  const mem = snap.mem;
  const memPct = mem.total ? (mem.used / mem.total) * 100 : 0;
  const cores = snap.cores || 1;
  const consumers = snap.consumers || [];
  const totalRam = mem.total || 1;
  const byCat = Object.fromEntries(Object.keys(CAT).map((k) => [k, consumers.filter((x) => x.cat === k).reduce((s, x) => s + x.rss, 0)]));
  const catSum = Object.values(byCat).reduce((a, b) => a + b, 0);
  const free = Math.max(0, totalRam - mem.used);
  const peakCpu = Math.max(0, ...shown.map((p) => p.cpu || 0));
  const srvByKey = Object.fromEntries(servers.map((s) => [s.key, s]));

  const catSeries = Object.keys(CAT).map((k) => ({ key: k, label: CAT[k].label, color: c(k), get: (p) => p.cats?.[k] ?? null }));

  return (
    <section className="ls">
      <header className="ls-head">
        <span className="ls-live"><i />Live</span>
        <h2>Auslastung</h2>
        <small>{snap.cpuModel} · {cores} Kerne · alle 5 s</small>
        <span className="grow" />
        <div className="seg">{RANGES.map(([k, l]) => <button key={k} type="button" className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
      </header>

      <div className="ls-grid">
        <article className="card ls-card">
          <header>
            <span className="ls-title"><NavIcon name="cpu" />CPU</span>
            <b className="ls-big">{cur.cpu != null ? `${cur.cpu.toFixed(0)}%` : '—'}</b>
            <span className="ls-sub">Spitze {peakCpu.toFixed(0)}% · Last {snap.load.map((l) => l.toFixed(2)).join(' / ')}{cur.iowait > 2 ? ` · IO-Wait ${cur.iowait.toFixed(0)}%` : ''}</span>
          </header>
          <TimeChart points={shown} series={[{ key: 'cpu', label: 'CPU', color: 'var(--accent)', get: (p) => p.cpu }]} yMax={100} format={(v) => `${Math.round(v)}%`} ariaLabel="CPU-Auslastung" />
        </article>

        <article className="card ls-card">
          <header>
            <span className="ls-title"><NavIcon name="memory" />Arbeitsspeicher</span>
            <b className="ls-big">{fmtB(mem.used)}<small> / {fmtB(mem.total)}</small></b>
            <span className="ls-sub">{memPct.toFixed(0)}% belegt · {fmtB(mem.cache)} Cache{mem.swapTotal ? ` · Swap ${fmtB(mem.swapUsed)} / ${fmtB(mem.swapTotal)}` : ''}</span>
          </header>
          <div className="ls-legend">
            {Object.keys(CAT).filter((k) => byCat[k] > 0).map((k) => <span key={k}><i style={{ background: c(k) }} />{CAT[k].label}<em>{fmtB(byCat[k])}</em></span>)}
          </div>
          <TimeChart points={shown} series={catSeries} stacked yMax={mem.total} format={(v) => fmtB(v, 0)} ariaLabel="RAM nach Bereich" />
        </article>

        <article className="card ls-card">
          <header>
            <span className="ls-title"><NavIcon name="globe" />Netzwerk</span>
            <b className="ls-big ls-pair"><span><i style={{ background: NET.rx[theme] }} />↓ {fmtRate(cur.rx || 0)}</span><span><i style={{ background: NET.tx[theme] }} />↑ {fmtRate(cur.tx || 0)}</span></b>
            <span className="ls-sub">Empfangen und gesendet, alle Schnittstellen außer lo</span>
          </header>
          <TimeChart points={shown} area={false} series={[{ key: 'rx', label: 'Empfangen', color: NET.rx[theme], get: (p) => p.rx }, { key: 'tx', label: 'Gesendet', color: NET.tx[theme], get: (p) => p.tx }]} format={(v) => fmtRate(v)} ariaLabel="Netzwerk" />
        </article>

        <article className="card ls-card">
          <header>
            <span className="ls-title"><NavIcon name="db" />Datenträger</span>
            <b className="ls-big ls-pair"><span><i style={{ background: NET.rx[theme] }} />Lesen {fmtRate(cur.dr || 0)}</span><span><i style={{ background: NET.tx[theme] }} />Schreiben {fmtRate(cur.dw || 0)}</span></b>
            <span className="ls-sub">{snap.disk ? `${fmtB(snap.disk.total - snap.disk.free)} von ${fmtB(snap.disk.total)} belegt` : ''}</span>
          </header>
          <TimeChart points={shown} area={false} series={[{ key: 'dr', label: 'Lesen', color: NET.rx[theme], get: (p) => p.dr }, { key: 'dw', label: 'Schreiben', color: NET.tx[theme], get: (p) => p.dw }]} format={(v) => fmtRate(v)} ariaLabel="Datenträger" />
        </article>
      </div>

      <article className="card ls-ram">
        <header>
          <span className="ls-title"><NavIcon name="memory" />Was zieht am meisten RAM?</span>
          <span className="grow" />
          <div className="seg"><button type="button" className={!showProcs ? 'active' : ''} onClick={() => setShowProcs(false)}>Nach Server &amp; Dienst</button><button type="button" className={showProcs ? 'active' : ''} onClick={() => setShowProcs(true)}>Prozesse</button></div>
        </header>

        <div className="ls-stackbar" role="img" aria-label="RAM-Aufteilung">
          {Object.keys(CAT).filter((k) => byCat[k] > 0).map((k) => (
            <span key={k} style={{ width: `${(byCat[k] / totalRam) * 100}%`, background: c(k) }} title={`${CAT[k].label}: ${fmtB(byCat[k])}`} />
          ))}
          <span className="free" style={{ width: `${(free / totalRam) * 100}%` }} title={`Frei: ${fmtB(free)}`} />
        </div>
        <div className="ls-stacklabels">
          {Object.keys(CAT).filter((k) => byCat[k] > 0).map((k) => <span key={k}><i style={{ background: c(k) }} />{CAT[k].label} <b>{((byCat[k] / totalRam) * 100).toFixed(0)}%</b></span>)}
          <span><i className="free" />Frei <b>{((free / totalRam) * 100).toFixed(0)}%</b></span>
          {catSum < mem.used && <span className="muted">Kernel &amp; Puffer {fmtB(Math.max(0, mem.used - catSum))}</span>}
        </div>

        {!showProcs ? (
          <div className="ls-list">
            {consumers.slice(0, 12).map((x, i) => {
              const srv = srvByKey[x.key] || (x.key === 'fivem' ? servers.find((s) => s.game === 'fivem' && s.active) : null);
              const pct = (x.rss / totalRam) * 100;
              const row = (
                <>
                  <span className="ls-rank">{i + 1}</span>
                  <span className="ls-ico" style={{ '--cc': c(x.cat) }}>{x.game ? <GameMark game={x.game} size={30} /> : <NavIcon name={CAT[x.cat].icon} />}</span>
                  <span className="ls-name"><b>{x.name}</b><small>{CAT[x.cat].label}{x.pids > 1 ? ` · ${x.pids} Prozesse` : ''}</small></span>
                  <span className="ls-bar"><i style={{ width: `${Math.max(1, (x.rss / (consumers[0]?.rss || 1)) * 100)}%`, background: c(x.cat) }} /></span>
                  <span className="ls-val"><b>{fmtB(x.rss)}</b><small>{pct.toFixed(1)}% vom RAM</small></span>
                  <span className="ls-cpu" title={`${x.cpu}% eines Kerns`}><b>{(x.cpu / cores).toFixed(1)}%</b><small>CPU</small></span>
                  {canKill && <KillButton x={x} srv={srv} onKill={setKill} />}
                </>
              );
              return srv ? <Link key={x.key} to={srv.to} className="ls-row link">{row}</Link> : <div key={x.key} className="ls-row">{row}</div>;
            })}
          </div>
        ) : (
          <div className="ls-procs">
            <div className="ls-proc th"><span>PID</span><span>Prozess</span><span>Gehört zu</span><span>Benutzer</span><span>RAM</span><span>CPU</span>{canKill && <span />}</div>
            {(snap.processes || []).map((p) => (
              <div key={p.pid} className="ls-proc">
                <span className="mono muted">{p.pid}</span>
                <span className="ls-proc-cmd" title={p.args}><b className="mono">{p.comm}</b><small className="mono">{p.args}</small></span>
                <span><i className="ls-dot" style={{ background: c(p.cat || 'other') }} />{p.owner}</span>
                <span className="mono muted">{p.user}</span>
                <span className="mono"><b>{fmtB(p.rss)}</b></span>
                <span className="mono">{(p.cpu / cores).toFixed(1)}%</span>
                {canKill && (
                  <span className="ls-act">
                    <button type="button" className="ls-kill" disabled={!!p.protect} title={p.protect || `${p.comm} (PID ${p.pid}) beenden`} aria-label={`${p.comm} beenden`}
                      onClick={() => setKill({ pid: p.pid, comm: p.comm, name: p.comm, kind: 'proc', rss: p.rss, args: p.args })}><NavIcon name="power" /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {flash && <div className={`ls-flash ${flash.tone}`} role="status">{flash.text}</div>}
        <p className="ls-foot">CPU-Werte relativ zum ganzen Server ({cores} Kerne = 100%). RAM ist der residente Speicher (RSS) aller zugehörigen Prozesse.</p>
      </article>
      {kill && <KillDialog target={kill} onClose={() => setKill(null)} onDone={(text) => { setKill(null); setFlash({ text, tone: 'ok' }); setTimeout(() => setFlash(null), 6000); setTimeout(() => reload.current(), 600); }} />}
    </section>
  );
}

function KillButton({ x, srv, onKill }) {
  if (x.key === 'other:rest') return <span className="ls-act" />;
  const isGame = !!x.protect && !x.service && !!srv;
  const blocked = !!x.protect && !x.service && !srv;
  const title = x.service ? `${x.name} stoppen oder neu starten` : isGame ? 'Gameserver — öffnen und dort stoppen' : blocked ? x.protect : `${x.name} beenden${x.pids > 1 ? ` (${x.pids} Prozesse)` : ''}`;
  return (
    <span className="ls-act">
      <button type="button" className="ls-kill" disabled={blocked} title={title} aria-label={title}
        onClick={(e) => {
          if (isGame) return; // Klick fällt auf den Zeilen-Link → Server öffnen
          e.preventDefault(); e.stopPropagation();
          onKill({ key: x.key, name: x.name, kind: x.service ? 'service' : 'group', service: x.service, pids: x.pids, rss: x.rss });
        }}>
        <NavIcon name="power" />
      </button>
    </span>
  );
}

function KillDialog({ target, onClose, onDone }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [stuck, setStuck] = useState(false);

  async function go(force) {
    setBusy(force ? 'kill' : 'term'); setErr('');
    try {
      const body = target.key ? { key: target.key, name: target.name, force } : { pid: target.pid, comm: target.comm, name: target.name, force };
      const r = await api('/api/host/processes/kill', { method: 'POST', body });
      if (r.remaining?.length) { setStuck(true); setErr(`${r.remaining.length} von ${r.pids.length} Prozess${r.pids.length > 1 ? 'en' : ''} läuft noch — reagiert nicht auf Beenden. Hart beenden?`); return; }
      onDone(`${target.name} ${force ? 'hart beendet' : 'beendet'} · ca. ${fmtB(target.rss)} RAM frei`);
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(''); }
  }
  async function svc(action) {
    setBusy(action); setErr('');
    try {
      await api(`/api/host/services/${target.service}/${action}`, { method: 'POST', body: {} });
      onDone(`${target.name} ${action === 'stop' ? 'gestoppt' : 'neu gestartet'}`);
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(''); }
  }
  const n = target.pids || 1;

  return (
    <Modal title={target.kind === 'service' ? `${target.name} steuern` : `${target.name} beenden?`} onClose={() => { if (!busy) onClose(); }}>
      <div className="ls-killdlg">
        <div className="ls-killdlg-what">
          <span className="ls-killdlg-ico"><NavIcon name="power" /></span>
          <div>
            <b>{target.name}</b>
            <small>{target.pid ? `PID ${target.pid}` : `${n} Prozess${n > 1 ? 'e' : ''}`} · {fmtB(target.rss)} RAM</small>
            {target.args && <code>{target.args}</code>}
          </div>
        </div>
        {target.kind === 'service' ? (
          <p className="muted">Systemdienst — er wird sauber über systemd gesteuert (einfaches Killen würde ihn sofort neu starten). Seiten und Apps, die ihn brauchen, sind beim Stoppen nicht erreichbar.</p>
        ) : (
          <p className="muted">„Beenden“ schickt SIGTERM, damit {n > 1 ? 'die Prozesse' : 'der Prozess'} sauber schließen {n > 1 ? 'können' : 'kann'}. „Hart beenden“ (SIGKILL) wirkt sofort — ungespeicherte Daten gehen dabei verloren.</p>
        )}
        {err && <div className="ls-killdlg-err">{err}</div>}
        <div className="ls-killdlg-btns">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={!!busy}>Abbrechen</button>
          {target.kind === 'service' ? (
            <>
              <button type="button" className="btn" onClick={() => svc('restart')} disabled={!!busy}>{busy === 'restart' ? 'Startet neu …' : 'Neu starten'}</button>
              <button type="button" className="btn btn-danger" onClick={() => svc('stop')} disabled={!!busy}>{busy === 'stop' ? 'Stoppt …' : 'Dienst stoppen'}</button>
            </>
          ) : (
            <>
              <button type="button" className={stuck ? 'btn btn-danger' : 'btn ls-btn-hard'} onClick={() => go(true)} disabled={!!busy}>{busy === 'kill' ? 'Erzwinge …' : 'Hart beenden'}</button>
              {!stuck && <button type="button" className="btn btn-danger" onClick={() => go(false)} disabled={!!busy}>{busy === 'term' ? 'Beendet …' : 'Beenden'}</button>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
