import { useEffect, useRef, useState } from 'react';
import { fmtBytes } from '../format.js';
import FxStatusStrip from '../components/FxStatusStrip.jsx';
import { AreaChart, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './monitoring.css';

const SCOPE_KEY = 'orbit.mon.scope';
const SCOPES = ['host', 'fivem'];

const pctAxis = (v) => `${Math.round(v)}%`;
const intAxis = (v) => `${Math.round(v)}`;
const getCpu = (d) => d.cpu;
const getRam = (d) => d.ram;
const getFxCpu = (d) => d.fxCpu ?? 0;
const getFxRam = (d) => d.fxRam ?? 0;
const getPlayers = (d) => d.players;

function seriesStats(series, acc) {
  if (!series.length) return null;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const p of series) {
    const v = Number(acc(p)) || 0;
    sum += v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return { avg: sum / series.length, max, min };
}

function loadScope() {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    if (SCOPES.includes(v)) return v;
  } catch { /* */ }
  return 'host';
}

function stateKey(s) {
  if (!s) return '';
  const h = s.host || {};
  const fx = s.fx || {};
  const series = s.series || [];
  const last = series[series.length - 1];
  return [
    s.clients, s.maxClients, s.online, s.status,
    h.cpu, h.ramPct, h.ramUsed, series.length,
    fx.cpu, fx.ramPct, fx.ramUsed, fx.pid,
    last?.t, last?.cpu, last?.ram, last?.fxCpu, last?.fxRam, last?.players,
    s.fxCommandReady, s.processActive ?? s.unitActive,
    (s.instances || []).map((i) => `${i.id}:${i.clients}:${i.online}`).join(','),
  ].join('|');
}

export default function Monitoring() {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [scope, setScope] = useState(loadScope);
  const keyRef = useRef('');
  const pending = useRef(null);
  const flushTimer = useRef(0);
  const lastApply = useRef(0);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    const apply = (raw) => {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return; }
      const key = stateKey(parsed);
      if (key === keyRef.current) return;
      keyRef.current = key;
      lastApply.current = Date.now();
      setState(parsed);
    };
    const schedule = (raw) => {
      pending.current = raw;
      const wait = Math.max(0, 2000 - (Date.now() - lastApply.current));
      if (flushTimer.current) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = 0;
        if (pending.current != null) apply(pending.current);
        pending.current = null;
      }, wait);
    };
    es.addEventListener('state', (e) => schedule(e.data));
    return () => {
      es.close();
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    };
  }, []);

  const setScopePersist = (next) => {
    setScope(next);
    try { localStorage.setItem(SCOPE_KEY, next); } catch { /* */ }
  };

  const host = state?.host || { cpu: 0, ramPct: 0, ramUsed: 0, ramTotal: 0 };
  const fx = state?.fx || { pid: null, cpu: 0, ramPct: 0, ramUsed: 0, ramTotal: 0 };
  const clients = state?.clients || 0;
  const maxClients = state?.maxClients || 0;
  const series = state?.series || [];
  const isFx = scope === 'fivem';
  const load = isFx ? fx : host;
  const cpuAcc = isFx ? getFxCpu : getCpu;
  const ramAcc = isFx ? getFxRam : getRam;
  const cpuStats = seriesStats(series, cpuAcc);
  const ramStats = seriesStats(series, ramAcc);
  const plStats = seriesStats(series, getPlayers);
  const windowMin = series.length > 1 ? Math.max(1, Math.round((series[series.length - 1].t - series[0].t) / 60000)) : 0;

  const tiles = [
    { key: 'cpu', icon: 'cpu', label: 'CPU', value: `${Number(load.cpu || 0).toFixed(0)}`, unit: '%', pct: load.cpu, color: 'var(--accent)', stats: cpuStats, fmt: (v) => `${v.toFixed(0)}%` },
    { key: 'ram', icon: 'memory', label: 'RAM', value: `${Number(load.ramPct || 0).toFixed(0)}`, unit: '%', pct: load.ramPct, color: 'var(--accent)', stats: ramStats, fmt: (v) => `${v.toFixed(0)}%`, sub: `${fmtBytes(load.ramUsed)} / ${fmtBytes(load.ramTotal || host.ramTotal)}` },
    { key: 'pl', icon: 'users', label: t('mon.players'), value: String(clients), unit: `/ ${maxClients || '–'}`, pct: maxClients ? (clients / maxClients) * 100 : 0, color: 'var(--accent)', stats: plStats, fmt: (v) => v.toFixed(0) },
  ];

  return (
    <Page className="mon-page">
      <PageHeader
        eyebrow={t(isFx ? 'mon.eyebrowFx' : 'mon.eyebrow')}
        title={t('page.monitoring')}
        description={t(isFx ? 'mon.descFx' : 'mon.desc')}
        actions={(
          <div className="mon-scope" role="tablist" aria-label={t('mon.scopeAria')}>
            <button type="button" role="tab" aria-selected={!isFx} className={`mon-scope-btn${!isFx ? ' active' : ''}`} onClick={() => setScopePersist('host')}>
              {t('mon.scopeHost')}
            </button>
            <button type="button" role="tab" aria-selected={isFx} className={`mon-scope-btn${isFx ? ' active' : ''}`} onClick={() => setScopePersist('fivem')}>
              {t('mon.scopeFx')}
            </button>
          </div>
        )}
      />
      <FxStatusStrip
        fxControlMode={state?.fxControlMode}
        fxCommandReady={state?.fxCommandReady}
        processActive={state?.processActive ?? state?.unitActive}
        online={state?.online}
        compact
      />

      <section className="mon-tiles">
        {tiles.map((tile) => (
          <article key={tile.key} className="mon-tile card" style={{ '--mon': tile.color }}>
            <div className="mon-tile-head">
              <span className="mon-tile-ico"><NavIcon name={tile.icon} /></span>
              <span>{tile.label}</span>
              <span className="mon-live"><i />Live</span>
            </div>
            <div className="mon-tile-value"><strong>{tile.value}</strong><span>{tile.unit}</span></div>
            <div className="mon-tile-meter"><i style={{ width: `${Math.max(0, Math.min(100, tile.pct || 0))}%` }} /></div>
            <dl className="mon-tile-stats">
              <div><dt>Ø {windowMin ? `${windowMin} min` : ''}</dt><dd>{tile.stats ? tile.fmt(tile.stats.avg) : '–'}</dd></div>
              <div><dt>Peak</dt><dd>{tile.stats ? tile.fmt(tile.stats.max) : '–'}</dd></div>
              <div><dt>Min</dt><dd>{tile.stats ? tile.fmt(tile.stats.min) : '–'}</dd></div>
            </dl>
            {tile.sub ? <p className="mon-tile-sub mono">{tile.sub}</p> : null}
          </article>
        ))}
      </section>

      <section className="mon-charts grid-2">
        <PanelCard className="mon-chart-card">
          <div className="spread mon-chart-head">
            <h3><i style={{ background: 'var(--accent)' }} />CPU</h3>
            <b className="mon-chart-val">{Number(load.cpu || 0).toFixed(1)}%</b>
          </div>
          <AreaChart data={series} accessor={cpuAcc} yMax={100} formatY={pctAxis} ariaLabel={t('mon.cpuAria')} />
        </PanelCard>
        <PanelCard className="mon-chart-card">
          <div className="spread mon-chart-head">
            <h3><i style={{ background: 'var(--accent)' }} />RAM</h3>
            <b className="mon-chart-val">{Number(load.ramPct || 0).toFixed(0)}%</b>
          </div>
          <AreaChart data={series} accessor={ramAcc} color="var(--accent)" yMax={100} formatY={pctAxis} ariaLabel={t('mon.ramAria')} />
        </PanelCard>
      </section>
      <PanelCard className="mon-chart-card">
        <div className="spread mon-chart-head">
          <h3><i style={{ background: 'var(--accent)' }} />{t('mon.players')}</h3>
          <b className="mon-chart-val">{clients} / {maxClients || '–'}</b>
        </div>
        <AreaChart data={series} accessor={getPlayers} color="var(--accent)" yMax={Math.max(maxClients, 1)} formatY={intAxis} ariaLabel={t('mon.playersAria')} />
      </PanelCard>
      {(state?.instances?.length > 0) && (
        <PanelCard padded={false}>
          <div className="mon-inst-head">
            <h3>{t('mon.instances')}</h3>
            <p className="muted">{t('mon.instancesHint')}</p>
          </div>
          <div className="table-wrap">
            <table className="o-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('common.port')}</th>
                  <th>{t('mon.fxProcess')}</th>
                  <th>{t('mon.fivem')}</th>
                  <th>{t('mon.players')}</th>
                </tr>
              </thead>
              <tbody>
                {state.instances.map((i) => (
                  <tr key={i.id}>
                    <td className="name" data-label={t('common.name')}>{i.name}{i.isActive ? ' ★' : ''}</td>
                    <td className="mono" data-label={t('common.port')}>{i.port ?? '–'}</td>
                    <td data-label={t('mon.fxProcess')}>{i.supervisorPhase ?? i.phase ?? '–'}</td>
                    <td data-label={t('mon.fivem')}>{i.online ? <span className="badge ok">{t('status.online')}</span> : <span className="badge">{t('status.offline')}</span>}</td>
                    <td className="mono" data-label={t('mon.players')}>{i.clients ?? 0}/{i.maxClients ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      )}
    </Page>
  );
}
