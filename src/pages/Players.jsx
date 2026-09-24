import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull, fmtPlaytime } from '../format.js';
import { Badge, Empty, Modal, Page, PageHeader } from '../components/Ui.jsx';
import './players.css';

const ID_LABELS = {
  license: 'License',
  license2: 'License 2',
  discord: 'Discord',
  steam: 'Steam',
  fivem: 'Cfx.re',
  xbl: 'Xbox',
  live: 'Microsoft',
  ip: 'IP',
  hardware: 'HWID',
};

function idKind(id) {
  const i = String(id || '').indexOf(':');
  return i > 0 ? id.slice(0, i) : 'id';
}

function idLabel(id) {
  return ID_LABELS[idKind(id)] || idKind(id);
}

function playerIds(p) {
  if (Array.isArray(p.identifiers) && p.identifiers.length) return p.identifiers;
  try {
    const parsed = JSON.parse(p.ids || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* */ }
  return p.identifier ? [p.identifier] : [];
}

export default function Players() {
  const { openConsole } = useOutletContext();
  const [data, setData] = useState({
    online: false, players: [], list: [], history: [], stats: {}, fxCommandReady: false,
  });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('status');

  function load(silent = false) {
    const params = new URLSearchParams({ filter, q });
    api(`/api/players?${params}`)
      .then((d) => {
        setData(d);
        setPick((cur) => {
          if (!cur) return null;
          const next = (d.list || []).find((p) => p.identifier === cur.identifier
            || (p.identifiers || []).includes(cur.identifier));
          return next || cur;
        });
      })
      .catch((e) => { if (!silent) setErr(e.message); });
  }

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 3000);
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
      setReason('');
      load();
    } catch (error) {
      setErr(error.message);
    }
  }

  const stats = data.stats || {};
  const onlineCount = stats.online ?? (data.players?.length || 0);
  const totalCount = stats.total ?? rows.length;
  const pickIds = pick ? playerIds(pick) : [];

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
        <button className="btn btn-sm" type="button" onClick={() => load()}>Aktualisieren</button>
      </div>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {rows.length === 0 ? (
        <Empty
          title="Noch keine Spieler"
          text="Sobald jemand joined, erscheint er hier — online und offline (wie txAdmin)."
        />
      ) : (
        <div className="pl-grid">
          {rows.map((p) => {
            const ids = playerIds(p);
            const preview = ids.filter((id) => !id.startsWith('ip:')).slice(0, 3);
            return (
              <button
                key={p.identifier}
                type="button"
                className={`pl-card${p.online ? ' online' : ''}`}
                onClick={() => setPick(p)}
              >
                <div className="pl-card-top">
                  <div>
                    <strong>{p.name}</strong>
                    <div className="pl-card-meta">
                      {p.online ? `ID ${p.serverId} · ${p.ping ?? 0} ms` : 'Offline'}
                      {' · '}
                      {fmtPlaytime(p.play_ms)}
                    </div>
                  </div>
                  {p.online ? <Badge tone="ok">Online</Badge> : <Badge>Offline</Badge>}
                </div>
                <div className="pl-card-ids">
                  {preview.length ? preview.map((id) => (
                    <span key={id} className="pl-id-chip" title={id}>
                      <em>{idLabel(id)}</em>
                      {id.slice(id.indexOf(':') + 1, id.indexOf(':') + 11)}…
                    </span>
                  )) : (
                    <span className="muted" style={{ fontSize: 12 }}>Keine Identifier</span>
                  )}
                  {ids.length > preview.length ? (
                    <span className="pl-id-more">+{ids.length - preview.length}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pick && (
        <Modal title={pick.name} onClose={() => { setPick(null); setReason(''); }} wide>
          <div className="pl-ov">
            <div className="pl-ov-status">
              {pick.online
                ? <Badge tone="ok">Online · ID {pick.serverId}</Badge>
                : <Badge>Offline</Badge>}
              {pick.online ? <span className="pl-ov-ping">{pick.ping ?? 0} ms</span> : null}
            </div>

            <section className="pl-mod">
              <h4>Übersicht</h4>
              <div className="pl-mod-grid">
                <div><span>Spielzeit</span><b>{fmtPlaytime(pick.play_ms)}</b></div>
                <div><span>Zuletzt gesehen</span><b>{fmtFull(pick.last_seen)}</b></div>
                <div><span>Erstmals gesehen</span><b>{fmtFull(pick.first_seen)}</b></div>
                <div><span>Warnungen</span><b>—</b></div>
              </div>
              {pick.note ? <p className="pl-note">{pick.note}</p> : null}
            </section>

            <section className="pl-mod">
              <h4>Identifier</h4>
              <ul className="pl-id-list">
                {pickIds.length === 0 ? (
                  <li className="muted">Noch keine Identifier</li>
                ) : pickIds.map((id) => (
                  <li key={id}>
                    <span className="pl-id-kind">{idLabel(id)}</span>
                    <code className="mono">{id}</code>
                  </li>
                ))}
              </ul>
            </section>

            {pick.online ? (
              <section className="pl-mod">
                <h4>Aktionen</h4>
                {!data.fxCommandReady && <p className="err">Konsole nicht verbunden.</p>}
                <label className="field"><span>Grund</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                <div className="actions">
                  <button className="btn btn-sm" type="button" disabled={!data.fxCommandReady || reason.length < 2} onClick={() => act('message')}>Say</button>
                  <button className="btn btn-sm" type="button" disabled={!data.fxCommandReady || reason.length < 2} onClick={() => act('kick')}>Kick</button>
                </div>
              </section>
            ) : (
              <p className="muted">Offline — Kick/Say nur bei verbundenen Spielern.</p>
            )}
          </div>
        </Modal>
      )}
    </Page>
  );
}
