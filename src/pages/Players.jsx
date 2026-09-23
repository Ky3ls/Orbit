import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull, fmtPlaytime } from '../format.js';
import { Split } from '../workspace/Module.jsx';
import { Badge, Empty, Modal, Page, PageHeader } from '../components/Ui.jsx';

export default function Players() {
  const { openConsole } = useOutletContext();
  const [data, setData] = useState({ online: false, players: [], history: [], stats: {}, fxCommandReady: false });
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('last');

  function load() {
    api(`/api/players?mode=history&q=${encodeURIComponent(q)}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const list = [...(data.history || [])];
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === 'play') list.sort((a, b) => (b.play_ms || 0) - (a.play_ms || 0));
    else if (sort === 'first') list.sort((a, b) => (a.first_seen || 0) - (b.first_seen || 0));
    else list.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    return list;
  }, [data.history, sort]);

  async function act(action) {
    setErr('');
    try {
      await api('/api/players/action', { method: 'POST', body: { action, id: pick.id, reason } });
      setPick(null);
      setReason('');
      load();
    } catch (error) {
      setErr(error.message);
    }
  }

  const stats = data.stats || {};

  return (
    <Page className="ws-module-flush">
      <PageHeader
        eyebrow="Live"
        title="Spieler"
        description={`${stats.total ?? 0} im Verlauf · ${data.players?.length || 0} verbunden`}
        actions={(
          <>
            <Badge tone={data.online ? 'ok' : 'bad'}>{data.players?.length || 0} live</Badge>
            <button type="button" className="btn btn-sm" onClick={() => openConsole?.()}>Konsole</button>
          </>
        )}
      />

      <Split
        aside={(
          <>
            <p className="muted" style={{ fontSize: 11, fontWeight: 700, margin: '0 0 10px' }}>JETZT ONLINE</p>
            {(data.players || []).length === 0 ? (
              <Empty title="Leer" text="Niemand online." />
            ) : (
              data.players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`ws-online-chip${pick?.id === p.id ? ' active' : ''}`}
                  onClick={() => setPick(p)}
                >
                  <span><b>{p.name}</b><br /><span className="mono muted" style={{ fontSize: 11 }}>{p.ping} ms</span></span>
                </button>
              ))
            )}
            <div style={{ marginTop: 16 }}>
              <p className="muted" style={{ fontSize: 11, fontWeight: 700 }}>STATS</p>
              <p style={{ fontSize: 13 }}>24h: {stats.last24 ?? 0} · Neu: +{stats.new24 ?? 0}</p>
            </div>
          </>
        )}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="search grow"
            placeholder="Verlauf durchsuchen…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="last">Zuletzt</option>
            <option value="play">Spielzeit</option>
            <option value="name">Name</option>
          </select>
          <button className="btn btn-sm" type="button" onClick={load}>Suchen</button>
        </div>
        {rows.length === 0 ? (
          <Empty title="Keine Treffer" text="Verlauf leer oder Filter zu streng." />
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Spielzeit</th>
                <th>Zuletzt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const live = (data.players || []).some((o) => (o.identifiers || []).includes(p.identifier));
                return (
                  <tr key={p.identifier}>
                    <td>{p.name} {live && <Badge tone="ok">live</Badge>}</td>
                    <td>{fmtPlaytime(p.play_ms)}</td>
                    <td>{fmtFull(p.last_seen)}</td>
                    <td>
                      {live && (
                        <button className="btn btn-sm" type="button" onClick={() => {
                          const o = data.players.find((x) => (x.identifiers || []).includes(p.identifier));
                          if (o) setPick(o);
                        }}>Aktion</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Split>

      {err && <div className="err" style={{ margin: 16 }}>{err}</div>}

      {pick && (
        <Modal title={pick.name} onClose={() => setPick(null)}>
          {!data.fxCommandReady && <p className="err">Konsole nicht verbunden.</p>}
          <label className="field"><span>Grund</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions">
            <button className="btn btn-sm" type="button" disabled={!data.fxCommandReady} onClick={() => act('message')}>Say</button>
            <button className="btn btn-sm" type="button" disabled={!data.fxCommandReady} onClick={() => act('kick')}>Kick</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
