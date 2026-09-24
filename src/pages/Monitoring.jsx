import { useEffect, useRef, useState } from 'react';
import { fmtBytes } from '../format.js';
import FxStatusStrip from '../components/FxStatusStrip.jsx';
import { AreaChart, Gauge, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';

const pctAxis = (v) => `${Math.round(v)}%`;
const intAxis = (v) => `${Math.round(v)}`;
const getCpu = (d) => d.cpu;
const getRam = (d) => d.ram;
const getPlayers = (d) => d.players;

function stateKey(s) {
  if (!s) return '';
  const h = s.host || {};
  const series = s.series || [];
  const last = series[series.length - 1];
  return [
    s.clients, s.maxClients, s.online, s.status,
    h.cpu, h.ramPct, h.ramUsed, series.length,
    last?.t, last?.cpu, last?.ram, last?.players,
    s.fxCommandReady, s.processActive ?? s.unitActive,
    (s.instances || []).map((i) => `${i.id}:${i.clients}:${i.online}`).join(','),
  ].join('|');
}

export default function Monitoring() {
  const { t } = useI18n();
  const [state, setState] = useState(null);
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

  const host = state?.host || { cpu: 0, ramPct: 0, ramUsed: 0, ramTotal: 0 };
  const clients = state?.clients || 0;
  const maxClients = state?.maxClients || 0;
  const playerPct = maxClients ? (clients / maxClients) * 100 : 0;
  const series = state?.series || [];
  const ramHead = `${Number(host.ramPct || 0).toFixed(0)}% · ${fmtBytes(host.ramUsed)} / ${fmtBytes(host.ramTotal)}`;

  return (
    <Page>
      <PageHeader
        eyebrow={t('mon.eyebrow')}
        title={t('page.monitoring')}
        description={t('mon.desc')}
      />
      <div className="mon-page">
        <FxStatusStrip
          fxControlMode={state?.fxControlMode}
          fxCommandReady={state?.fxCommandReady}
          processActive={state?.processActive ?? state?.unitActive}
          online={state?.online}
          compact
        />
        <section className="gauges">
          <Gauge label="CPU" value={host.cpu} />
          <Gauge label="RAM" value={host.ramPct} tone="#8eb6ff" />
          <Gauge label={t('settings.slots')} value={playerPct} suffix="%" tone="#3dd68c" />
        </section>
        <section className="mon-charts grid-2">
          <PanelCard className="mon-chart-card">
            <div className="spread mon-chart-head">
              <h3>CPU</h3>
              <b className="mon-chart-val">{Number(host.cpu || 0).toFixed(1)}%</b>
            </div>
            <AreaChart
              data={series}
              accessor={getCpu}
              yMax={100}
              formatY={pctAxis}
              ariaLabel={t('mon.cpuAria')}
            />
          </PanelCard>
          <PanelCard className="mon-chart-card">
            <div className="spread mon-chart-head">
              <h3>RAM</h3>
              <b className="mon-chart-val">{ramHead}</b>
            </div>
            <AreaChart
              data={series}
              accessor={getRam}
              color="#8eb6ff"
              yMax={100}
              formatY={pctAxis}
              ariaLabel={t('mon.ramAria')}
            />
          </PanelCard>
        </section>
        <PanelCard className="mon-chart-card">
          <div className="spread mon-chart-head">
            <h3>{t('mon.players')}</h3>
            <b className="mon-chart-val">{clients} / {maxClients || '–'}</b>
          </div>
          <AreaChart
            data={series}
            accessor={getPlayers}
            color="#3dd68c"
            yMax={Math.max(maxClients, 1)}
            formatY={intAxis}
            ariaLabel={t('mon.playersAria')}
          />
        </PanelCard>
        {(state?.instances?.length > 0) && (
          <PanelCard padded={false}>
            <div style={{ padding: 16 }}>
              <h3>{t('mon.instances')}</h3>
              <p className="muted" style={{ fontSize: 13 }}>{t('mon.instancesHint')}</p>
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
                      <td>{i.name}{i.isActive ? ' ★' : ''}</td>
                      <td className="mono">{i.port}</td>
                      <td>{i.supervisorPhase}</td>
                      <td>{i.online ? <span className="badge ok">{t('status.online')}</span> : <span className="badge">{t('status.offline')}</span>}</td>
                      <td>{i.clients}/{i.maxClients}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PanelCard>
        )}
      </div>
    </Page>
  );
}
