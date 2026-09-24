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

const SECTIONS = [
  { id: 'info', label: 'Übersicht' },
  { id: 'ids', label: 'Identifier' },
  { id: 'history', label: 'Verlauf' },
  { id: 'ban', label: 'Sperre' },
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
  const initial = (p?.name || '?').slice(0, 1).toUpperCase();

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
        <Modal title="Spieler" onClose={() => { setPick(null); setDetail(null); setErr(''); }} wide>
          <div className="pl-sheet">
            <header className="pl-hero">
              <div className="pl-hero-mark" aria-hidden="true">{initial}</div>
              <div className="pl-hero-copy">
                <div className="pl-hero-row">
                  <h2>{p.name}</h2>
                  {p.online
                    ? <span className="pl-live">Live · #{p.serverId}</span>
                    : <span className="pl-off">Offline</span>}
                </div>
                <p className="pl-hero-sub">
                  {p.online ? `${p.ping ?? 0} ms · Session ${fmtPlaytime(p.session_ms || detail?.player?.session_ms)}` : `Zuletzt ${fmtFull(p.last_seen)}`}
                  {' · '}
                  Gesamt {fmtPlaytime(p.play_ms)}
                </p>
              </div>
              <button
                type="button"
                className={`pl-allow${p.whitelisted ? ' on' : ''}`}
                disabled={busy}
                onClick={toggleWl}
              >
                {p.whitelisted ? 'Allowlist ✓' : 'Auf Allowlist'}
              </button>
            </header>

            <div className="pl-rail" aria-hidden="true">
              <div><small>Beigetreten</small><strong>{fmtFull(p.first_seen)}</strong></div>
              <div><small>Bans</small><strong>{p.bans ?? 0}</strong></div>
              <div><small>Warns</small><strong>{p.warns ?? 0}</strong></div>
              <div><small>IDs</small><strong>{ids.length}</strong></div>
            </div>

            <div className="pl-seg" role="tablist" aria-label="Ansicht">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === s.id}
                  className={tab === s.id ? 'active' : ''}
                  onClick={() => setTab(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}

            <div className="pl-body">
              {tab === 'info' && (
                <div className="pl-panel">
                  <label className="field">
                    <span>Interne Notiz</span>
                    <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nur für Admins sichtbar…" />
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveNote}>
                    Speichern
                  </button>
                </div>
              )}

              {tab === 'ids' && (
                <div className="pl-id-stack">
                  {ids.length === 0 ? (
                    <p className="muted">Keine Identifier</p>
                  ) : ids.map((id) => (
                    <div key={id} className="pl-id-row">
                      <span>{idLabel(id)}</span>
                      <code className="mono">{id}</code>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'history' && (
                <div className="pl-hist">
                  {(detail?.history?.bans || []).length === 0 && (detail?.history?.warns || []).length === 0 ? (
                    <p className="muted">Noch keine Einträge.</p>
                  ) : (
                    <>
                      {(detail?.history?.bans || []).map((b) => (
                        <article key={`b${b.id}`} className="pl-hist-card ban">
                          <header><strong>Ban #{b.id}</strong><span>{fmtFull(b.created)}</span></header>
                          <p>{b.reason}</p>
                          <footer>{b.author}</footer>
                        </article>
                      ))}
                      {(detail?.history?.warns || []).map((w) => (
                        <article key={`w${w.id}`} className="pl-hist-card">
                          <header><strong>Warn #{w.id}</strong><span>{fmtFull(w.created)}</span></header>
                          <p>{w.reason}</p>
                          <footer>{w.author}</footer>
                        </article>
                      ))}
                    </>
                  )}
                </div>
              )}

              {tab === 'ban' && (
                <div className="pl-panel pl-ban">
                  <label className="field">
                    <span>Grund</span>
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Regel, Kontext…" />
                  </label>
                  <div className="pl-ban-row">
                    <label className="field grow">
                      <span>Dauer</span>
                      <select value={durationId} onChange={(e) => setDurationId(e.target.value)}>
                        {presets.map((pr) => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
                        <option value="custom">Benutzerdefiniert</option>
                      </select>
                    </label>
                    {durationId === 'custom' && (
                      <>
                        <label className="field" style={{ maxWidth: 100 }}>
                          <span>Wert</span>
                          <input type="number" min={1} value={customAmt} onChange={(e) => setCustomAmt(e.target.value)} />
                        </label>
                        <label className="field" style={{ maxWidth: 120 }}>
                          <span>Einheit</span>
                          <select value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                            <option value="hours">Stunden</option>
                            <option value="days">Tage</option>
                            <option value="weeks">Wochen</option>
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  <button type="button" className="btn pl-ban-btn" disabled={busy} onClick={applyBan}>
                    Sperre setzen
                  </button>
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>Auch offline — Online-Spieler werden gekickt.</p>
                </div>
              )}
            </div>

            {tab !== 'ban' && (
              <div className="pl-actions">
                <input
                  className="pl-actions-reason"
                  placeholder="Grund für DM / Kick / Warn…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="pl-actions-btns">
                  <button type="button" className="btn btn-sm" disabled={!p.online || busy} onClick={() => act('message')}>DM</button>
                  <button type="button" className="btn btn-sm" disabled={!p.online || busy} onClick={() => act('kick')}>Kick</button>
                  <button type="button" className="btn btn-sm" disabled={!p.online || busy} onClick={() => act('warn')}>Warn</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </Page>
  );
}
