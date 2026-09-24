import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull, fmtPlaytime } from '../format.js';
import { Badge, Empty, Modal, Page, PageHeader } from '../components/Ui.jsx';
import './players.css';

const ID_LABELS = {
  license: 'License', license2: 'License 2', discord: 'Discord', steam: 'Steam',
  fivem: 'Cfx.re', xbl: 'Xbox', live: 'Microsoft', ip: 'IP', hardware: 'HWID',
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

const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'history', label: 'History' },
  { id: 'ids', label: 'IDs' },
  { id: 'ban', label: 'Ban' },
];

export default function Players() {
  const { openConsole } = useOutletContext();
  const [data, setData] = useState({
    online: false, players: [], list: [], history: [], stats: {}, fxCommandReady: false,
  });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [pick, setPick] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('info');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [durationId, setDurationId] = useState('2d');
  const [customAmt, setCustomAmt] = useState('');
  const [customUnit, setCustomUnit] = useState('days');
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('status');
  const [busy, setBusy] = useState(false);

  function load(silent = false) {
    api(`/api/players?${new URLSearchParams({ filter, q })}`)
      .then((d) => {
        setData(d);
        setPick((cur) => {
          if (!cur) return null;
          return (d.list || []).find((p) => p.identifier === cur.identifier) || cur;
        });
      })
      .catch((e) => { if (!silent) setErr(e.message); });
  }

  async function openPlayer(p) {
    setPick(p);
    setTab('info');
    setReason('');
    setErr('');
    try {
      const d = await api(`/api/players/detail?id=${encodeURIComponent(p.identifier)}`);
      setDetail(d);
      setNote(d.player?.note || '');
    } catch (e) {
      setDetail(null);
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 3000);
    return () => clearInterval(id);
  }, [filter]);

  const rows = useMemo(() => {
    const list = [...(data.list || [])];
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === 'play') list.sort((a, b) => (b.play_ms || 0) - (a.play_ms || 0));
    else if (sort === 'last') list.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    else list.sort((a, b) => (!!a.online === !!b.online ? (b.last_seen || 0) - (a.last_seen || 0) : a.online ? -1 : 1));
    return list;
  }, [data.list, sort]);

  const p = detail?.player || pick;
  const ids = p ? playerIds(p) : [];
  const presets = detail?.banPresets || [];

  async function saveNote() {
    if (!p) return;
    setBusy(true);
    try {
      await api('/api/players/note', { method: 'POST', body: { identifier: p.identifier, name: p.name, note } });
      load(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function toggleWl() {
    if (!p) return;
    setBusy(true);
    try {
      await api('/api/players/whitelist', {
        method: 'POST',
        body: { identifier: p.identifier, enable: !p.whitelisted },
      });
      await openPlayer(p);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function act(action) {
    if (!p?.online || !p.serverId) {
      setErr('Spieler ist offline.');
      return;
    }
    if (reason.length < 2) { setErr('Bitte einen Grund angeben.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api('/api/players/action', {
        method: 'POST',
        body: { action, id: p.serverId, reason },
      });
      setReason('');
      load(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function applyBan() {
    if (!p || reason.length < 3) { setErr('Ban-Grund mind. 3 Zeichen.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api('/api/bans', {
        method: 'POST',
        body: {
          identifiers: ids,
          identifier: p.identifier,
          name: p.name,
          reason,
          durationId: durationId === 'custom' ? undefined : durationId,
          amount: durationId === 'custom' ? customAmt : undefined,
          unit: durationId === 'custom' ? customUnit : undefined,
          id: p.serverId,
        },
      });
      setReason('');
      await openPlayer(p);
      load(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const stats = data.stats || {};
  const onlineCount = stats.online ?? 0;
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
        <div className="pl-filters" role="tablist">
          {[{ id: 'all', label: 'Alle' }, { id: 'online', label: 'Online' }, { id: 'offline', label: 'Offline' }].map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id}
              className={`pl-filter${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <input className="search grow" placeholder="Name oder Identifier…" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="status">Status</option>
          <option value="last">Zuletzt</option>
          <option value="play">Spielzeit</option>
          <option value="name">Name</option>
        </select>
        <button className="btn btn-sm" type="button" onClick={() => load()}>Aktualisieren</button>
      </div>

      {err && !pick && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {rows.length === 0 ? (
        <Empty title="Noch keine Spieler" text="Sobald jemand joined, erscheint er hier." />
      ) : (
        <div className="pl-grid">
          {rows.map((row) => {
            const preview = playerIds(row).filter((id) => !id.startsWith('ip:')).slice(0, 3);
            return (
              <button key={row.identifier} type="button" className={`pl-card${row.online ? ' online' : ''}`} onClick={() => openPlayer(row)}>
                <div className="pl-card-top">
                  <div>
                    <strong>{row.name}</strong>
                    <div className="pl-card-meta">
                      {row.online ? `ID ${row.serverId} · ${row.ping ?? 0} ms` : 'Offline'} · {fmtPlaytime(row.play_ms)}
                    </div>
                  </div>
                  {row.online ? <Badge tone="ok">Online</Badge> : <Badge>Offline</Badge>}
                </div>
                <div className="pl-card-ids">
                  {preview.map((id) => (
                    <span key={id} className="pl-id-chip" title={id}>
                      <em>{idLabel(id)}</em>{id.slice(id.indexOf(':') + 1, id.indexOf(':') + 9)}…
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pick && p && (
        <Modal
          title={(
            <span className="pl-modal-title">
              {p.online ? <em>[{p.serverId}]</em> : null} {p.name}
            </span>
          )}
          onClose={() => { setPick(null); setDetail(null); setErr(''); }}
          wide
        >
          <div className="pl-modal">
            <nav className="pl-side" aria-label="Spieler-Tabs">
              {TABS.map((t) => (
                <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="pl-main">
              {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}

              {tab === 'info' && (
                <>
                  <div className="pl-stats">
                    <div><span>Session</span><b>{p.online ? fmtPlaytime(p.session_ms || detail?.player?.session_ms) : '—'}</b></div>
                    <div><span>Spielzeit</span><b>{fmtPlaytime(p.play_ms)}</b></div>
                    <div><span>Beigetreten</span><b>{fmtFull(p.first_seen)}</b></div>
                    <div>
                      <span>Allowlist</span>
                      <b className="pl-wl-row">
                        {p.whitelisted ? 'ja' : 'noch nicht'}
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={toggleWl}>
                          {p.whitelisted ? 'Entfernen' : 'Allow'}
                        </button>
                      </b>
                    </div>
                    <div>
                      <span>Sanktionen</span>
                      <b>
                        <Badge tone="bad">{p.bans ?? 0} Bans</Badge>
                        {' '}
                        <Badge>{p.warns ?? 0} Warns</Badge>
                      </b>
                    </div>
                  </div>
                  <label className="field">
                    <span>Notizen</span>
                    <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notizen zum Spieler…" />
                  </label>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={saveNote}>Notiz speichern</button>
                </>
              )}

              {tab === 'history' && (
                <div className="pl-hist">
                  {(detail?.history?.bans || []).length === 0 && (detail?.history?.warns || []).length === 0 ? (
                    <p className="muted">Keine Bans/Warns gefunden.</p>
                  ) : (
                    <>
                      {(detail?.history?.bans || []).map((b) => (
                        <div key={`b${b.id}`} className="pl-hist-row">
                          <Badge tone="bad">Ban #{b.id}</Badge>
                          <span>{b.reason}</span>
                          <em>{fmtFull(b.created)} · {b.author}</em>
                        </div>
                      ))}
                      {(detail?.history?.warns || []).map((w) => (
                        <div key={`w${w.id}`} className="pl-hist-row">
                          <Badge>Warn #{w.id}</Badge>
                          <span>{w.reason}</span>
                          <em>{fmtFull(w.created)} · {w.author}</em>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {tab === 'ids' && (
                <ul className="pl-id-list">
                  {ids.length === 0 ? <li className="muted">Keine Identifier</li> : ids.map((id) => (
                    <li key={id}>
                      <span className="pl-id-kind">{idLabel(id)}</span>
                      <code className="mono">{id}</code>
                    </li>
                  ))}
                </ul>
              )}

              {tab === 'ban' && (
                <div className="pl-ban">
                  <label className="field">
                    <span>Grund</span>
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Regelverstoß, Grund…" />
                  </label>
                  <label className="field">
                    <span>Dauer</span>
                    <select value={durationId} onChange={(e) => setDurationId(e.target.value)}>
                      {presets.map((pr) => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
                      <option value="custom">Benutzerdefiniert</option>
                    </select>
                  </label>
                  {durationId === 'custom' && (
                    <div className="pl-ban-custom">
                      <input type="number" min={1} value={customAmt} onChange={(e) => setCustomAmt(e.target.value)} placeholder="123" />
                      <select value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                        <option value="hours">Stunden</option>
                        <option value="days">Tage</option>
                        <option value="weeks">Wochen</option>
                      </select>
                    </div>
                  )}
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={applyBan}>Ban anwenden</button>
                  <p className="muted" style={{ fontSize: 12 }}>Funktioniert auch offline — Online-Spieler werden gekickt.</p>
                </div>
              )}
            </div>
          </div>

          <div className="pl-footer">
            <button type="button" className="btn btn-sm" disabled title="Demnächst">Give Admin</button>
            <div className="pl-footer-actions">
              <button type="button" className="btn btn-sm" disabled={!p.online || busy} onClick={() => act('message')}>DM</button>
              <button type="button" className="btn btn-sm" disabled={!p.online || busy} onClick={() => act('kick')}>Kick</button>
              <button type="button" className="btn btn-sm" disabled={!p.online || busy} onClick={() => act('warn')}>Warn</button>
            </div>
          </div>
          {(tab !== 'ban') && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>Grund (für DM/Kick/Warn)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
        </Modal>
      )}
    </Page>
  );
}
