import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, sameJson } from '../api.js';
import { fmtBytes, fmtTime, fmtUptime } from '../format.js';
import { fxModeShort } from '../fxMeta.js';
import LiveConsole from '../components/LiveConsole.jsx';
import ServerControls, { statusLabel, statusTone } from '../components/ServerControls.jsx';
import Sparkline from '../components/Sparkline.jsx';
import { useNow } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import GameMark from '../components/GameMark.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './cockpit.css';

function greetingKey(d) {
  const h = d.getHours();
  if (h < 11) return 'dash.morning';
  if (h < 18) return 'dash.day';
  return 'dash.evening';
}

function pingTone(ms) {
  if (ms == null) return '';
  if (ms < 60) return 'ok';
  if (ms < 120) return 'warn';
  return 'bad';
}

function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Audit-Aktion → Icon + Ton */
function auditMeta(action = '') {
  const a = String(action);
  if (a.startsWith('server.start')) return { icon: 'play', tone: 'ok' };
  if (a.startsWith('server.stop')) return { icon: 'stop', tone: 'bad' };
  if (a.includes('restart')) return { icon: 'restart', tone: 'warn' };
  if (a.includes('ban')) return { icon: 'ban', tone: 'bad' };
  if (a.includes('kick') || a.includes('warn')) return { icon: 'bolt', tone: 'warn' };
  if (a.startsWith('login') || a.includes('auth')) return { icon: 'logout', tone: 'info' };
  if (a.startsWith('resource')) return { icon: 'box', tone: 'accent' };
  if (a.startsWith('schedule') || a.includes('backup')) return { icon: 'calendar', tone: 'accent' };
  if (a.startsWith('settings') || a.startsWith('cfg')) return { icon: 'gear', tone: 'accent' };
  return { icon: 'sparkle', tone: 'muted' };
}

function relTime(ts, now, locale) {
  if (!ts) return '';
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function Kpi({ icon, label, value, unit, sub, values, max, color, pct, to }) {
  return (
    <Link to={to} className="kpi card" style={{ '--kpi': color }}>
      <div className="kpi-top">
        <span className="kpi-ico"><NavIcon name={icon} /></span>
        <span className="kpi-label">{label}</span>
        <span className="kpi-go"><NavIcon name="arrowRight" /></span>
      </div>
      <div className="kpi-value">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      <div className="kpi-sub">{sub}</div>
      {pct != null && (
        <div className="kpi-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
      )}
      <div className="kpi-spark"><Sparkline values={values} max={max} color={color} height={52} /></div>
    </Link>
  );
}

export default function Cockpit() {
  const { user, refreshStatus, fxMeta, serverStatus, controlEnabled, live } = useOutletContext();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [res, setRes] = useState(null);
  const now = useNow(1000);
  const canControl = user?.role === 'owner' || user?.role === 'admin';

  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (document.hidden) return;
      api('/api/overview')
        .then((d) => { if (!stop) setData((prev) => (sameJson(prev, d) ? prev : d)); })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      api('/api/resources')
        .then((d) => {
          if (stop) return;
          const list = d.resources || [];
          const next = {
            total: list.length,
            started: list.filter((r) => r.actual === 'started').length,
            stopped: list.filter((r) => r.actual === 'stopped').length,
            groups: (d.groups || []).slice(0, 5).map((g) => ({ folder: g.folder, count: g.count, started: g.started })),
          };
          setRes((prev) => (sameJson(prev, next) ? prev : next));
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const state = data?.state;
  const status = serverStatus || state?.status || 'offline';
  const tone = statusTone(status);
  const online = status === 'online';
  const series = useMemo(() => state?.series || [], [state?.series]);
  const fx = useMemo(() => ({
    fxControlMode: state?.fxControlMode || fxMeta?.fxControlMode,
    fxCommandReady: state?.fxCommandReady ?? fxMeta?.fxCommandReady,
  }), [state, fxMeta]);

  const clients = state?.clients ?? live?.clients ?? 0;
  const maxClients = state?.maxClients ?? live?.maxClients ?? 48;
  const host = state?.host || {};
  const fxProc = state?.fx || {};
  const playersSeries = useMemo(() => series.map((s) => s.players || 0), [series]);
  const cpuSeries = useMemo(() => series.map((s) => s.cpu || 0), [series]);
  const ramSeries = useMemo(() => series.map((s) => s.ram || 0), [series]);
  const fxSeries = useMemo(() => series.map((s) => s.fxCpu || 0), [series]);
  const peak = playersSeries.length ? Math.max(...playersSeries, clients) : clients;
  const players = useMemo(
    () => [...(data?.players || [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
    [data?.players],
  );

  const next = data?.nextRestart;
  const nextIn = next?.at ? next.at - now.getTime() : null;
  const dayPct = nextIn != null ? Math.max(0, Math.min(1, 1 - nextIn / 86_400_000)) : 0;
  const ringC = 2 * Math.PI * 42;
  const serverName = live?.serverLabel || state?.hostname || 'Server';
  const hostname = state?.hostname || live?.hostname || '';
  const stats = data?.stats || {};

  return (
    <div className="dash">
      {/* ── Hero ── */}
      <section className={`dash-hero card tone-${tone}`}>
        <div className="dash-hero-glow" aria-hidden="true" />
        <span className="dash-hero-game" aria-hidden="true"><GameMark game="fivem" size={120} /></span>
        <div className="dash-hero-main">
          <p className="dash-greet">{t(greetingKey(now))}, <b>{user?.username}</b></p>
          <h1 className="dash-title">{serverName}</h1>
          {hostname && hostname !== serverName ? <p className="dash-host" title={hostname}>{hostname}</p> : null}
          <div className="dash-facts">
            <span className={`dash-status tone-${tone}`}><i />{statusLabel(status)}</span>
            {online && state?.onlineSince ? (
              <span className="dash-fact"><NavIcon name="clock" />{t('dash.uptime')} <b>{fmtUptime(state.onlineSince)}</b></span>
            ) : null}
            {data?.versions?.fx ? (
              <span className="dash-fact"><NavIcon name="bolt" />{t('dash.build')} <b className="mono">{data.versions.fx}</b></span>
            ) : null}
            <span className="dash-fact"><NavIcon name="cpu" />{t('dash.mode')} <b>{fxModeShort(fx.fxControlMode)}</b></span>
            {data ? (
              <span className="dash-fact"><NavIcon name="megaphone" />{t('dash.discord')} <b>{data.discordBot ? t('dash.active') : t('dash.inactive')}</b></span>
            ) : null}
          </div>
        </div>
        {canControl && (
          <div className="dash-hero-ctl">
            <ServerControls
              compact
              status={status}
              controlEnabled={controlEnabled}
              canControl={canControl}
              fxControlMode={fx.fxControlMode}
              fxCommandReady={fx.fxCommandReady}
              onDone={() => { refreshStatus?.(); api('/api/overview').then(setData).catch(() => {}); }}
            />
          </div>
        )}
      </section>

      {/* ── Restart-Countdown ── */}
      <Link to="/schedule" className="dash-restart card">
        <div className="dash-restart-ring" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" className="ring-track" />
            <circle
              cx="50" cy="50" r="42" className="ring-fill"
              style={{ strokeDasharray: `${dayPct * ringC} ${ringC}` }}
            />
          </svg>
          <NavIcon name="restart" />
        </div>
        <div className="dash-restart-text">
          <span className="dash-card-label">{t('dash.nextRestart')}</span>
          {nextIn != null ? (
            <>
              <strong className="mono">{countdown(nextIn)}</strong>
              <span className="muted">
                {next.label ? `${next.label} · ` : ''}
                {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(next.at)}
              </span>
            </>
          ) : (
            <>
              <strong className="dash-restart-none">{t('dash.noRestart')}</strong>
              <span className="dash-link">{t('dash.planRestart')} <NavIcon name="arrowRight" /></span>
            </>
          )}
        </div>
      </Link>

      {/* ── KPIs ── */}
      <div className="dash-kpis">
        <Kpi
          icon="users"
          label={t('dash.players')}
          value={clients}
          unit={`/ ${maxClients}`}
          sub={t('dash.peak', { n: peak })}
          values={playersSeries}
          max={Math.max(maxClients, 1)}
          color="var(--accent)"
          pct={maxClients ? (clients / maxClients) * 100 : 0}
          to="/players?filter=online"
        />
        <Kpi
          icon="cpu"
          label={t('dash.cpu')}
          value={Math.round(host.cpu || 0)}
          unit="%"
          sub={`FX ${Math.round(fxProc.cpu || 0)}%`}
          values={cpuSeries}
          max={100}
          color="var(--accent)"
          pct={host.cpu || 0}
          to="/monitoring"
        />
        <Kpi
          icon="memory"
          label={t('dash.ram')}
          value={Math.round(host.ramPct || 0)}
          unit="%"
          sub={host.ramTotal ? `${fmtBytes(host.ramUsed)} / ${fmtBytes(host.ramTotal)}` : '–'}
          values={ramSeries}
          max={100}
          color="var(--accent)"
          pct={host.ramPct || 0}
          to="/monitoring"
        />
        <Kpi
          icon="bolt"
          label={t('dash.fxCpu')}
          value={Math.round(fxProc.cpu || 0)}
          unit="%"
          sub={fxProc.ramUsed ? `RAM ${fmtBytes(fxProc.ramUsed)}` : (fxProc.pid ? `PID ${fxProc.pid}` : '–')}
          values={fxSeries}
          max={100}
          color="var(--accent)"
          pct={fxProc.cpu || 0}
          to="/monitoring"
        />
      </div>

      {/* ── Konsole + Spieler ── */}
      <section className="dash-console card">
        <LiveConsole variant="cockpit" open />
      </section>

      <section className="dash-players card">
        <header className="dash-card-head">
          <div className="dash-card-title">
            <h2>{t('dash.online')}</h2>
            <span className="dash-count">{clients}</span>
          </div>
          <Link to="/players" className="btn btn-sm btn-ghost">{t('dash.allPlayers')}<NavIcon name="arrowRight" /></Link>
        </header>
        {!online ? (
          <div className="dash-empty">
            <NavIcon name="power" />
            <b>{t('dash.offlineTitle')}</b>
            <span>{t('dash.offlineText')}</span>
          </div>
        ) : players.length === 0 ? (
          <div className="dash-empty">
            <NavIcon name="users" />
            <span>{t('dash.noPlayers')}</span>
          </div>
        ) : (
          <ul className="dash-plist">
            {players.map((p) => (
              <li key={`${p.id}-${p.name}`}>
                <button type="button" onClick={() => navigate(`/players?open=${encodeURIComponent(p.name)}&sid=${p.id ?? ''}`)}>
                  <span className="dash-pavatar">{String(p.name || '?').slice(0, 1).toUpperCase()}</span>
                  <span className="dash-pname">{p.name}</span>
                  <span className="dash-pid mono">#{p.id}</span>
                  <span className={`dash-ping tone-${pingTone(p.ping)}`}><NavIcon name="signal" />{p.ping ?? '–'}<small>ms</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Aktivität ── */}
      <section className="dash-activity card">
        <header className="dash-card-head">
          <h2>{t('dash.activity')}</h2>
          <Link to="/audit" className="btn btn-sm btn-ghost">{t('dash.viewAll')}<NavIcon name="arrowRight" /></Link>
        </header>
        {(data?.feed || []).length === 0 ? (
          <div className="dash-empty"><NavIcon name="audit" /><span>{t('dash.noActivity')}</span></div>
        ) : (
          <ol className="dash-feed">
            {data.feed.map((e) => {
              const m = auditMeta(e.action);
              return (
                <li key={e.id} className={`tone-${m.tone}`}>
                  <span className="dash-feed-ico"><NavIcon name={m.icon} /></span>
                  <div className="dash-feed-body">
                    <span><b>{e.user}</b> <code>{e.action}</code></span>
                    {e.detail ? <small title={e.detail}>{e.detail}</small> : null}
                  </div>
                  <time title={fmtTime(e.created)}>{relTime(e.created, now.getTime(), locale)}</time>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ── Ressourcen ── */}
      <Link to="/resources" className="dash-res card">
        <header className="dash-card-head">
          <h2>{t('dash.resources')}</h2>
          <span className="dash-link">{t('dash.viewAll')} <NavIcon name="arrowRight" /></span>
        </header>
        <div className="dash-res-big">
          <strong>{res ? res.started : (data?.resourceCount ?? '–')}</strong>
          <span className="muted">/ {res ? res.total : data?.resourceCount ?? '–'} {t('dash.resRunning')}</span>
          {res?.stopped ? <span className="badge bad">{res.stopped} {t('dash.resStopped')}</span> : null}
        </div>
        <div className="dash-res-bar" aria-hidden="true">
          <i className="on" style={{ flexGrow: res?.started || 0 }} />
          <i className="off" style={{ flexGrow: res?.stopped || 0 }} />
          <i className="idle" style={{ flexGrow: res ? Math.max(0, res.total - res.started - res.stopped) : 1 }} />
        </div>
        <ul className="dash-res-groups">
          {(res?.groups || []).map((g) => (
            <li key={g.folder}>
              <span className="mono">{g.folder}</span>
              <span className="dash-res-mini" aria-hidden="true"><i style={{ width: `${g.count ? (g.started / g.count) * 100 : 0}%` }} /></span>
              <span className="muted mono">{g.started}/{g.count}</span>
            </li>
          ))}
        </ul>
      </Link>

      {/* ── Community ── */}
      <section className="dash-comm card">
        <header className="dash-card-head">
          <h2>{t('dash.moderation')}</h2>
        </header>
        <div className="dash-stats">
          <Link to="/players" className="dash-stat"><span>{t('dash.total')}</span><b>{stats.total ?? '–'}</b></Link>
          <Link to="/players" className="dash-stat"><span>{t('dash.unique24')}</span><b>{stats.last24 ?? '–'}</b></Link>
          <Link to="/players" className="dash-stat tone-ok"><span>{t('dash.new24')}</span><b>{stats.new24 != null ? `+${stats.new24}` : '–'}</b></Link>
          <Link to="/players?filter=banned" className="dash-stat tone-bad"><span>{t('dash.bans')}</span><b>{data?.bans ?? '–'}</b></Link>
          <Link to="/players" className="dash-stat tone-warn"><span>{t('dash.warns')}</span><b>{data?.warns ?? '–'}</b></Link>
          <Link to="/players?filter=allowlist" className="dash-stat"><span>{t('dash.allowlist')}</span><b>{data?.whitelist ?? '–'}</b></Link>
        </div>
      </section>
    </div>
  );
}
