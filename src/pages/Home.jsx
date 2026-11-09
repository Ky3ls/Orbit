import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import GameMark from '../components/GameMark.jsx';
import { toast } from '../components/toast.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import { GAMES, GAME_ORDER, PHASE_LABEL } from '../games.js';
import { NavIcon } from '../layout/icons.jsx';
import { fmtDur, fmtMb } from './mc/mcShared.js';
import LiveStats from './home/LiveStats.jsx';
import './home.css';

/** Startseite: alle Server dieses Hosts, egal welches Spiel */
export default function Home() {
  const navigate = useNavigate();
  const { user, servers, refreshServers, refreshStatus, serverStatus } = useOutletContext();
  const [mc, setMc] = useState({});
  const [host, setHost] = useState(null);
  const [cpu, setCpu] = useState(null);
  const [fxProc, setFxProc] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const canControl = user.role === 'owner' || user.role === 'admin';

  const load = useCallback(() => {
    if (document.hidden) return;
    api('/api/mc/instances').then((d) => {
      const m = {};
      for (const i of d.instances || []) m[i.id] = i;
      setMc(m);
    }).catch(() => {});
    api('/api/mc/host').then(setHost).catch(() => {});
    api('/api/overview').then((d) => {
      if (d.state?.host?.cpu != null) setCpu(d.state.host.cpu);
      setFxProc(d.state?.fx || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const games = useMemo(() => GAME_ORDER.filter((g) => servers.some((s) => s.game === g)), [servers]);
  const shown = servers.filter((s) => filter === 'all' || s.game === filter);
  const online = servers.filter((s) => s.phase === 'running');
  const players = online.reduce((n, s) => n + (s.players || 0), 0);
  const slots = online.reduce((n, s) => n + (s.max || 0), 0);
  const ramUsed = host ? host.totalMb - host.availableMb : null;
  const ramPct = host ? (ramUsed / host.totalMb) * 100 : null;

  async function control(s, action) {
    setBusy(`${s.key}:${action}`);
    try {
      if (s.game === 'minecraft') await api(`/api/mc/instances/${s.id}/control`, { method: 'POST', body: { action } });
      else await api('/api/server/control', { method: 'POST', body: { action } });
      toast.ok(`${s.name}: ${action === 'start' ? 'startet' : action === 'stop' ? 'wird gestoppt' : 'Neustart'}`);
      refreshServers?.();
      refreshStatus?.();
      load();
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }

  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

  return (
    <Page className="home-page">
      <PageHeader
        eyebrow={`${hello}, ${user.username}`}
        title="Deine Server"
        description={servers.length ? `${servers.length} Server auf diesem Host · ${games.map((g) => GAMES[g].label).join(', ')}` : 'Lege deinen ersten Gameserver an.'}
        actions={canControl ? (
          <>
            <Link to="/instances/import" className="btn btn-sm"><NavIcon name="switch" />Importieren</Link>
            <Link to="/instances/new" className="btn btn-primary btn-sm"><NavIcon name="plus" />Neuer Server</Link>
          </>
        ) : null}
      />

      {servers.length === 0 && canControl && (
        <Link to="/welcome" className="card home-setup">
          <span className="home-setup-ico"><NavIcon name="sparkle" /></span>
          <span><b>Orbit einrichten</b><small>Datenbanken, Webserver, Panel-Domain und der erste Gameserver — in drei Schritten.</small></span>
          <NavIcon name="arrowRight" />
        </Link>
      )}

      <div className="home-kpis">
        <div className="home-kpi tone-ok">
          <span className="home-kpi-ico"><NavIcon name="layers" /></span>
          <span><b>{online.length}<small> / {servers.length}</small></b><em>Server online</em></span>
        </div>
        <div className="home-kpi tone-accent">
          <span className="home-kpi-ico"><NavIcon name="users" /></span>
          <span><b>{players}<small>{slots ? ` / ${slots}` : ''}</small></b><em>Spieler gerade online</em></span>
        </div>
        <div className="home-kpi tone-info">
          <span className="home-kpi-ico"><NavIcon name="cpu" /></span>
          <span><b>{cpu != null ? `${Math.round(cpu)}%` : '–'}</b><em>CPU des Hosts</em></span>
          {cpu != null && <i className="home-meter"><em style={{ width: `${Math.min(100, cpu)}%` }} /></i>}
        </div>
        <div className={`home-kpi ${ramPct > 85 ? 'tone-bad' : 'tone-warn'}`}>
          <span className="home-kpi-ico"><NavIcon name="memory" /></span>
          <span><b>{host ? fmtMb(ramUsed) : '–'}<small>{host ? ` / ${fmtMb(host.totalMb)}` : ''}</small></b><em>Arbeitsspeicher</em></span>
          {ramPct != null && <i className="home-meter"><em style={{ width: `${Math.min(100, ramPct)}%` }} /></i>}
        </div>
      </div>

      {canControl && <LiveStats servers={servers} />}

      {games.length > 1 && (
        <div className="seg home-filter">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Alle<span className="seg-n">{servers.length}</span></button>
          {games.map((g) => (
            <button key={g} type="button" className={filter === g ? 'active' : ''} onClick={() => setFilter(g)}>
              <GameMark game={g} size={16} />{GAMES[g].label}<span className="seg-n">{servers.filter((s) => s.game === g).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="home-grid">
        {shown.map((s) => {
          const inst = s.game === 'minecraft' ? mc[s.id] : null;
          const st = inst?.status;
          const running = s.phase === 'running' || s.phase === 'starting';
          const fxActive = s.game === 'fivem' && s.active;
          const facts = s.game === 'minecraft'
            ? [
              ['Spieler', s.players != null ? `${s.players} / ${s.max ?? '–'}` : '–'],
              ['RAM', st?.pid ? fmtMb(st.rssMb) : inst ? fmtMb(inst.ramMb) : '–'],
              ['CPU', st?.pid ? `${st.cpu}%` : '–'],
              ['Uptime', st?.startedAt ? fmtDur(Date.now() - st.startedAt) : '–'],
            ]
            : [
              ['Spieler', s.players != null ? `${s.players} / ${s.max ?? '–'}` : `– / ${s.max ?? '–'}`],
              ['RAM', fxActive && fxProc?.ramUsed ? fmtMb(fxProc.ramUsed / 1048576) : '–'],
              ['CPU', fxActive && fxProc?.cpu != null ? `${Math.round(fxProc.cpu)}%` : '–'],
              ['Panel', fxActive ? 'Aktiv' : 'Inaktiv'],
            ];
          const fill = s.players != null && s.max ? Math.min(100, (s.players / s.max) * 100) : 0;
          return (
            <article key={s.key} className={`home-card card tone-${s.tone}`} style={{ '--game': GAMES[s.game]?.color }}>
              <Link to={s.to} className="home-card-head">
                <GameMark game={s.game} size={44} />
                <span className="home-card-title">
                  <b>{s.name}</b>
                  <small>{GAMES[s.game]?.label} · {s.game === 'minecraft' ? `${inst?.type ? inst.type[0].toUpperCase() + inst.type.slice(1) : ''} ${inst?.mcVersion || ''}` : s.sub.replace(/^FiveM · /, '')}</small>
                </span>
                <span className={`mcx-state tone-${s.tone}`}><i />{PHASE_LABEL[s.phase] || s.phase}</span>
              </Link>
              <div className="home-card-bar" aria-hidden="true"><i style={{ width: `${fill}%` }} /></div>
              <dl className="home-facts">
                {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              <footer>
                {s.address || (s.game === 'minecraft' && inst?.address) ? (
                  <button type="button" className="home-addr" title="Adresse kopieren" onClick={() => { const a = s.address || inst.address; navigator.clipboard?.writeText(a).then(() => toast.ok('Adresse kopiert', { text: a })); }}>
                    <NavIcon name="globe" /><span className="mono">{s.address || inst.address}</span>
                  </button>
                ) : <span className="grow" />}
                {canControl && (s.game === 'minecraft' ? inst?.state === 'ready' : fxActive) && (running ? (
                  <>
                    <button type="button" className="o-icon-btn" title="Neustart" disabled={!!busy} onClick={() => control(s, 'restart')}><NavIcon name="restart" /></button>
                    <button type="button" className="o-icon-btn danger" title="Stoppen" disabled={!!busy || (s.game === 'fivem' && serverStatus !== 'online')} onClick={() => control(s, 'stop')}><NavIcon name="stop" /></button>
                  </>
                ) : (
                  <button type="button" className="o-icon-btn ok" title="Starten" disabled={!!busy} onClick={() => control(s, 'start')}><NavIcon name="play" /></button>
                ))}
                <button type="button" className="btn btn-sm" onClick={() => navigate(s.to)}>{s.game === 'fivem' && !s.active ? 'Verwalten' : 'Öffnen'}<NavIcon name="arrowRight" /></button>
              </footer>
            </article>
          );
        })}

        {canControl && filter === 'all' && (
          <Link to="/instances/new" className="home-card home-add">
            <span className="home-add-marks">
              {GAME_ORDER.map((g) => <GameMark key={g} game={g} size={30} />)}
            </span>
            <b>Neuen Server erstellen</b>
            <small>Minecraft und FiveM — Terraria und Rust folgen</small>
          </Link>
        )}
      </div>
    </Page>
  );
}
