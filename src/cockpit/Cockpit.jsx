import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { fmtUptime } from '../format.js';
import { fxModeShort } from '../fxMeta.js';
import LiveConsole from '../components/LiveConsole.jsx';
import ServerControls from '../components/ServerControls.jsx';

function OrbitRing({ value, max, online }) {
  const pct = max ? Math.min(1, value / max) : 0;
  const deg = pct * 360;
  return (
    <div className="ck-ring" aria-hidden="true">
      <div className="ck-ring-glow" />
      <svg viewBox="0 0 200 200" className="ck-ring-svg">
        <circle cx="100" cy="100" r="88" className="ck-ring-track" />
        <circle
          cx="100"
          cy="100"
          r="88"
          className="ck-ring-fill"
          style={{ strokeDasharray: `${deg * 1.38} 999` }}
        />
        <circle cx="100" cy="100" r="72" className="ck-ring-inner" />
      </svg>
      <div className="ck-ring-core">
        <span className={`ck-live-dot${online ? ' on' : ''}`} />
        <strong className="ck-ring-num">{value}</strong>
        <span className="ck-ring-cap">SPIELER</span>
        <span className="ck-ring-sub">max {max}</span>
      </div>
    </div>
  );
}

export default function Cockpit() {
  const { user, refreshStatus, fxMeta, serverStatus, controlEnabled, live } = useOutletContext();
  const [data, setData] = useState(null);
  const canControl = user?.role === 'owner' || user?.role === 'admin';

  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (document.hidden) return;
      api('/api/overview').then((d) => { if (!stop) setData(d); }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const state = data?.state;
  const online = state?.online;
  const fx = useMemo(() => ({
    fxControlMode: state?.fxControlMode || fxMeta?.fxControlMode,
    fxCommandReady: state?.fxCommandReady ?? fxMeta?.fxCommandReady,
  }), [state, fxMeta]);

  const hostname = state?.hostname || live?.hostname || 'SERVER';
  const clients = state?.clients ?? live?.clients ?? 0;
  const maxClients = state?.maxClients ?? live?.maxClients ?? 48;

  return (
    <div className="ck">
      <section className="ck-hud">
        <header className="ck-hud-top">
          <div>
            <p className="ck-tag">Übersicht</p>
            <h1 className="ck-host">{hostname}</h1>
            <p className="ck-meta">
              {fxModeShort(fx.fxControlMode)}
              {online && state?.onlineSince ? ` · ${fmtUptime(state.onlineSince)}` : ''}
              {' · '}
              {fx.fxCommandReady ? 'FX LINK OK' : 'FX LINK DOWN'}
            </p>
          </div>
          <OrbitRing value={clients} max={maxClients} online={online} />
        </header>

        <div className="ck-tiles">
          {[
            ['CPU', `${Math.round(state?.host?.cpu || 0)}%`, state?.host?.cpu],
            ['RAM', `${Math.round(state?.host?.ramPct || 0)}%`, state?.host?.ramPct],
            ['QUEUE', String(data?.queued ?? 0), data?.queued ? 50 : 0],
            ['BANS', String(data?.bans ?? 0), Math.min((data?.bans || 0) * 8, 100)],
          ].map(([k, v, bar]) => (
            <div key={k} className="ck-tile">
              <span>{k}</span>
              <strong>{v}</strong>
              <i style={{ width: `${Math.min(100, bar || 0)}%` }} />
            </div>
          ))}
        </div>

        {canControl && (
          <div className="ck-power">
            <ServerControls
              compact
              status={serverStatus || state?.status}
              controlEnabled={controlEnabled}
              canControl={canControl}
              fxControlMode={fx.fxControlMode}
              fxCommandReady={fx.fxCommandReady}
              onDone={() => { refreshStatus?.(); api('/api/overview').then(setData); }}
            />
          </div>
        )}

        <nav className="ck-jump">
          <Link to="/players">Spieler</Link>
          <Link to="/resources">Scripts</Link>
          <Link to="/monitoring">Monitoring</Link>
          <Link to="/cfg">CFG</Link>
        </nav>

        <div className="ck-feed">
          <p className="ck-feed-label">ONLINE</p>
          <div className="ck-feed-scroll">
            {(data?.players || []).length === 0 ? (
              <span className="ck-feed-empty">— niemand im Orbit —</span>
            ) : (
              data.players.map((p) => (
                <Link key={p.id} to="/players" className="ck-chip">
                  {p.name} <em>{p.ping}ms</em>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="ck-terminal" aria-label="Live-Konsole">
        <div className="ck-term-frame">
          <LiveConsole variant="cockpit" open />
        </div>
      </section>
    </div>
  );
}
