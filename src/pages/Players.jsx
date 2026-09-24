import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull, fmtPlaytime } from '../format.js';
import { Badge, Empty, Modal, Page, PageHeader } from '../components/Ui.jsx';
import './players.css';

export default function Players() {
  const { openConsole } = useOutletContext();
  const [data, setData] = useState({
    online: false, players: [], list: [], history: [], stats: {}, fxCommandReady: false,
  });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | online | offline
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('status');

  function load() {
    const params = new URLSearchParams({
      mode: 'all',
      filter,
      q,
    });
    api(`/api/players?${params}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [filter]);

  const rows = useMemo(() => {
    const list = [...(data.list || data.history || [])];
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === 'play') list.sort((a, b) => (b.play_ms || 0) - (a.play_ms || 0));
    else if (sort === 'last') list.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    else {
      list.sort((a, b) => {
        if (!!a.online !== !!b.online) return a.online ? -1 : 1;
        return (b.last_seen || 0) - (a.last_seen || 0);
      });
    }
    return list;
  }, [data.list, data.history, sort]);

  async function act(action) {
    setErr('');
    try {
      const sid = pick.serverId ?? pick.id;
      await api('/api/players/action', { method: 'POST', body: { action, id: sid, reason } });
      setPick(null);
      setReason('');
      load();
    } catch (error) {
      setErr(error.message);
    }
  }

  const stats = data.stats || {};
  const onlineCount = stats.online ?? (data.players?.length || 0);
  const totalCount = stats.total ?? rows.length;

  return (
    <Page>
      <PageHeader
        eyebrow="Spieler"
        title="Alle Spieler"
        description={`${onlineCount} online · ${Math.max(0, totalCount - onlineCount)} offline · ${totalCount} gesamt`}
        actions={(
          <>
            <Badge tone={data.online ? 'ok' : 'bad'}>{onlineCount} live</Badge>
            <button type="button" className="btn btn-sm" onClick={() => openConsole?.()}>Konsole</button>
          </>
        )}
      />

      <div className="pl-toolbar">
        <div className="pl-filters" role="tablist" aria-label="Status">
          {[
            { id: 'all', label: 'Alle' },
            { id: 'online', label: 'Online' },
            { id: 'offline', label: 'Offline' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`pl-filter${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="search grow"
          placeholder="Name oder Identifier…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="status">Status</option>
          <option value="last">Zuletzt</option>
          <option value="play">Spielzeit</option>
          <option value="name">Name</option>
        </select>
        <button className="btn btn-sm" type="button" onClick={load}>Aktualisieren</button>
      </div>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {rows.length === 0 ? (
        <Empty
          title="Noch keine Spieler"
          text="Sobald jemand joined, erscheint er hier — online und offline (wie txAdmin)."
        />
      ) : (
        <div className="pl-table-wrap">
          <table className="ws-table pl-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>ID</th>
                <th>Ping</th>
                <th>Spielzeit</th>
                <th>Zuletzt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.identifier} className={p.online ? 'pl-row-online' : ''}>
                  <td>
                    {p.online
                      ? <Badge tone="ok">Online</Badge>
                      : <Badge>Offline</Badge>}
                  </td>
                  <td>
                    <b>{p.name}</b>
                    <div className="mono muted" style={{ fontSize: 11 }}>{p.identifier}</div>
                  </td>
                  <td className="mono">{p.online ? (p.serverId ?? '—') : '—'}</td>
                  <td>{p.online ? `${p.ping ?? 0} ms` : '—'}</td>
                  <td>{fmtPlaytime(p.play_ms)}</td>
                  <td>{fmtFull(p.last_seen)}</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setPick(p)}
                    >
                      {p.online ? 'Aktion' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pick && (
        <Modal title={pick.name} onClose={() => setPick(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            {pick.online ? <Badge tone="ok">Online · ID {pick.serverId}</Badge> : <Badge>Offline</Badge>}
            {' · '}
            <span className="mono">{pick.identifier}</span>
          </p>
          {pick.note ? <p>{pick.note}</p> : null}
          {pick.online ? (
            <>
              {!data.fxCommandReady && <p className="err">Konsole nicht verbunden.</p>}
              <label className="field"><span>Grund</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <div className="actions">
                <button className="btn btn-sm" type="button" disabled={!data.fxCommandReady} onClick={() => act('message')}>Say</button>
                <button className="btn btn-sm" type="button" disabled={!data.fxCommandReady} onClick={() => act('kick')}>Kick</button>
              </div>
            </>
          ) : (
            <p className="muted">Offline — Kick/Say nur bei verbundenen Spielern.</p>
          )}
        </Modal>
      )}
    </Page>
  );
}
