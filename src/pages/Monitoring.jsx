import { useEffect, useState } from 'react';
import { fmtBytes } from '../format.js';
import FxStatusStrip from '../components/FxStatusStrip.jsx';
import { AreaChart, Gauge, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Monitoring() {
  const [state, setState] = useState(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('state', (e) => setState(JSON.parse(e.data)));
    return () => es.close();
  }, []);

  const host = state?.host || { cpu: 0, ramPct: 0, ramUsed: 0, ramTotal: 0 };
  const playerPct = state?.maxClients ? (state.clients / state.maxClients) * 100 : 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Host"
        title="Monitoring"
        description="Host-Last und Spielerzahl · Spielstatus vom FiveM-Endpunkt."
      />
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
        <Gauge label="Slots" value={playerPct} suffix="%" tone="#3dd68c" />
      </section>
      <section className="grid-2">
        <PanelCard>
          <div className="spread"><h3>CPU</h3><b>{host.cpu.toFixed(1)}%</b></div>
          <AreaChart data={state?.series || []} accessor={(d) => d.cpu} />
        </PanelCard>
        <PanelCard>
          <div className="spread"><h3>RAM</h3><b>{fmtBytes(host.ramUsed)} / {fmtBytes(host.ramTotal)}</b></div>
          <AreaChart data={state?.series || []} accessor={(d) => d.ram} color="#8eb6ff" />
        </PanelCard>
      </section>
      <PanelCard>
        <div className="spread"><h3>Spieler</h3><b>{state?.clients || 0} / {state?.maxClients || 0}</b></div>
        <AreaChart data={state?.series || []} accessor={(d) => d.players} color="#3dd68c" />
      </PanelCard>
      {(state?.instances?.length > 0) && (
        <PanelCard padded={false}>
          <div style={{ padding: 16 }}>
            <h3>Instanzen (Multi-Server)</h3>
            <p className="muted" style={{ fontSize: 13 }}>Live-Probe pro Port — unabhängig vom „aktiven“ Panel-Server.</p>
          </div>
          <div className="table-wrap">
            <table className="o-table">
              <thead>
                <tr><th>Name</th><th>Port</th><th>FX-Prozess</th><th>FiveM</th><th>Spieler</th></tr>
              </thead>
              <tbody>
                {state.instances.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}{i.isActive ? ' ★' : ''}</td>
                    <td className="mono">{i.port}</td>
                    <td>{i.supervisorPhase}</td>
                    <td>{i.online ? <span className="badge ok">online</span> : <span className="badge">offline</span>}</td>
                    <td>{i.clients}/{i.maxClients}</td>
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
