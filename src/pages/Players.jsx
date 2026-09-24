import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, sameJson } from '../api.js';
import { fmtFull, fmtPlaytime } from '../format.js';
import { AreaChart, Badge, Empty, Modal, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import OrbitSelect from '../components/OrbitSelect.jsx';
import { BAN_DURATION_PRESETS, banDurationLabel } from './banPresets.js';
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

const FILTERS = [
  { id: 'all', label: 'Alle' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'banned', label: 'Gebannt' },
  { id: 'allowlist', label: 'Allowlist' },
];

const SECTIONS = [
  { id: 'info', label: 'Übersicht' },
  { id: 'ids', label: 'Identifier' },
  { id: 'history', label: 'Verlauf' },
  { id: 'ban', label: 'Sperre' },
];

const intAxis = (v) => `${Math.round(v)}`;
const seriesPlayers = (d) => d.players;
const seriesDrops = (d) => d.drops;

function playerFingerprint(p) {
  if (!p) return '';
  return `${p.identifier}|${p.name}|${p.online ? 1 : 0}|${p.serverId || ''}|${p.ping ?? ''}|${p.banned ? 1 : 0}|${p.whitelisted ? 1 : 0}|${p.play_ms || 0}|${p.last_seen || 0}|${p.note || ''}`;
}

export default function Players({ user }) {
  const { openConsole } = useOutletContext() || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = FILTERS.some((f) => f.id === searchParams.get('filter'))
    ? searchParams.get('filter')
    : 'all';

  const [data, setData] = useState({
    online: false, players: [], list: [], series: [], stats: {}, maxClients: 48, fxCommandReady: false,
  });
  const [drops, setDrops] = useState({ rows: [], stats: [], series: [], total: 0, hours: 72 });
  const [bans, setBans] = useState([]);
  const [wlEntries, setWlEntries] = useState([]);
  const [wlForm, setWlForm] = useState({ identifier: '', note: '' });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [pick, setPick] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('info');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [durationId, setDurationId] = useState('2d');
  const [customAmt, setCustomAmt] = useState('');
  const [customUnit, setCustomUnit] = useState('days');
  const [templateId, setTemplateId] = useState('');
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('status');
  const [busy, setBusy] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;
  const dataRef = useRef(data);
  dataRef.current = data;
  const dropsRef = useRef(drops);
  dropsRef.current = drops;

  const canRevoke = user?.role === 'owner' || user?.role === 'admin'
    || (user?.permissions || []).includes('bans.revoke')
    || (user?.permissions || []).includes('*');
  const canWlWrite = user?.role === 'owner' || user?.role === 'admin'
    || (user?.permissions || []).includes('whitelist.write')
    || (user?.permissions || []).includes('*');

  const setHubFilter = useCallback((id) => {
    setFilter(id);
    const next = new URLSearchParams(searchParams);
    if (id === 'all') next.delete('filter');
    else next.set('filter', id);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  function loadPlayers(silent = false) {
    const params = new URLSearchParams({
      filter: ['banned', 'allowlist'].includes(filter) ? 'all' : filter,
      q: qRef.current,
    });
    api(`/api/players?${params}`)
      .then((d) => {
        if (sameJson(dataRef.current, d)) return;
        setData(d);
        setPick((cur) => {
          if (!cur) return null;
          const next = (d.list || []).find((p) => p.identifier === cur.identifier) || cur;
          return playerFingerprint(next) === playerFingerprint(cur) ? cur : next;
        });
      })
      .catch((e) => { if (!silent) setErr(e.message); });
  }

  function loadDrops(silent = false) {
    api('/api/drops?hours=72')
      .then((d) => {
        if (sameJson(dropsRef.current, d)) return;
        setDrops(d);
      })
      .catch((e) => { if (!silent) setErr(e.message); });
  }

  function loadBans(silent = false) {
    api('/api/bans')
      .then((d) => setBans((prev) => {
        const next = d.bans || [];
        return sameJson(prev, next) ? prev : next;
      }))
      .catch((e) => { if (!silent) setErr(e.message); });
  }

  function loadWl(silent = false) {
    api('/api/whitelist')
      .then((d) => setWlEntries((prev) => {
        const next = d.entries || [];
        return sameJson(prev, next) ? prev : next;
      }))
      .catch((e) => { if (!silent) setErr(e.message); });
  }

  async function openPlayer(p) {
    setPick(p);
    setTab('info');
    setReason('');
    setTemplateId('');
    setDurationId('2d');
    setCustomAmt('');
    setCustomUnit('days');
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

  function applyTemplate(id, opt) {
    setTemplateId(id);
    if (!id) return;
    const reasonText = opt?.reason ?? (detail?.banTemplates || []).find((x) => String(x.id) === String(id))?.reason;
    const dur = opt?.durationId ?? (detail?.banTemplates || []).find((x) => String(x.id) === String(id))?.duration_id;
    if (reasonText) setReason(reasonText);
    if (dur) setDurationId(dur);
  }

  useEffect(() => {
    loadPlayers();
    const id = setInterval(() => loadPlayers(true), 12_000);
    return () => clearInterval(id);
  }, [filter]);

  useEffect(() => {
    loadDrops();
    const id = setInterval(() => loadDrops(true), 60_000);
    return () => clearInterval(id);
  }, []);

  /* Suche: API erst nach Pause (Enter bleibt sofort) — nicht beim ersten Mount */
  const qBoot = useRef(true);
  useEffect(() => {
    if (['banned', 'allowlist'].includes(filter)) return undefined;
    if (qBoot.current) {
      qBoot.current = false;
      return undefined;
    }
    const id = setTimeout(() => loadPlayers(true), 280);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (filter === 'banned') loadBans();
    if (filter === 'allowlist') loadWl();
  }, [filter]);

  const rows = useMemo(() => {
    let list = [...(data.list || [])];
    if (filter === 'banned') list = list.filter((r) => r.banned);
    if (filter === 'allowlist') list = list.filter((r) => r.whitelisted);
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === 'play') list.sort((a, b) => (b.play_ms || 0) - (a.play_ms || 0));
    else if (sort === 'last') list.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    else list.sort((a, b) => (!!a.online === !!b.online ? (b.last_seen || 0) - (a.last_seen || 0) : a.online ? -1 : 1));
    return list;
  }, [data.list, sort, filter]);

  const banRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = bans.filter((b) => !b.revoked && (!b.expires || b.expires > Date.now()));
    if (needle) {
      list = list.filter((b) => `${b.name} ${b.identifier} ${b.reason}`.toLowerCase().includes(needle));
    }
    return list;
  }, [bans, q]);

  const wlRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return wlEntries;
    return wlEntries.filter((e) => `${e.identifier} ${e.note || ''} ${e.author || ''}`.toLowerCase().includes(needle));
  }, [wlEntries, q]);

  const p = detail?.player || pick;
  const ids = p ? playerIds(p) : [];
  const presets = detail?.banPresets || [];
  const durationList = useMemo(() => {
    const list = (presets.length ? presets : BAN_DURATION_PRESETS).map((pr) => ({
      id: pr.id,
      label: pr.label,
    }));
    list.push({ id: 'custom', label: 'Benutzerdefiniert' });
    return list;
  }, [presets]);
  const templateList = useMemo(() => {
    const tpls = detail?.banTemplates || [];
    return tpls.map((t) => ({
      id: String(t.id),
      label: t.reason,
      hint: banDurationLabel(t.duration_id),
      reason: t.reason,
      durationId: t.duration_id,
    }));
  }, [detail?.banTemplates]);
  const durationLabel = useMemo(
    () => durationList.find((d) => d.id === durationId)?.label || banDurationLabel(durationId),
    [durationList, durationId],
  );

  async function saveNote() {
    if (!p) return;
    setBusy(true);
    try {
      await api('/api/players/note', { method: 'POST', body: { identifier: p.identifier, name: p.name, note } });
      loadPlayers(true);
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
      if (filter === 'allowlist') loadWl(true);
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
      loadPlayers(true);
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
      loadPlayers(true);
      if (filter === 'banned') loadBans(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function revokeBan(id) {
    setBusy(true);
    try {
      await api(`/api/bans/${id}/revoke`, { method: 'POST', body: {} });
      loadBans(true);
      loadPlayers(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function addWl(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/whitelist', { method: 'POST', body: wlForm });
      setWlForm({ identifier: '', note: '' });
      loadWl(true);
      loadPlayers(true);
    } catch (error) { setErr(error.message); }
    setBusy(false);
  }

  async function removeWl(id) {
    setBusy(true);
    try {
      await api(`/api/whitelist/${id}`, { method: 'DELETE' });
      loadWl(true);
      loadPlayers(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const stats = data.stats || {};
  const onlineCount = stats.online ?? 0;
  const totalKnown = stats.total ?? (data.list || []).length;
  const initial = (p?.name || '?').slice(0, 1).toUpperCase();
  const playerSeries = data.series || [];
  const dropSeries = drops.series || [];
  const maxClients = Math.max(data.maxClients || 48, 1);
  const dropTotal = drops.total ?? (drops.rows || []).length;

  return (
    <Page>
      <PageHeader
        eyebrow="Spieler-Hub"
        title="Spieler"
        description={`${onlineCount} online · ${Math.max(0, totalKnown - onlineCount)} offline · Drops 72h: ${dropTotal}`}
        actions={(
          <>
            <Badge tone={data.online ? 'ok' : 'bad'}>{onlineCount} live</Badge>
            <button type="button" className="btn btn-sm" onClick={() => openConsole?.()}>Konsole</button>
          </>
        )}
      />

      <section className="pl-hub-charts" aria-label="Trends">
        <PanelCard className="pl-hub-chart">
          <div className="spread mon-chart-head">
            <div>
              <h3>Spieleranzahl</h3>
              <p className="pl-hub-hint">Live-Trend (Monitoring-Samples)</p>
            </div>
            <b className="mon-chart-val">{onlineCount} / {maxClients}</b>
          </div>
          <AreaChart
            data={playerSeries}
            accessor={seriesPlayers}
            color="#ff7a1a"
            yMax={maxClients}
            formatY={intAxis}
            ariaLabel="Spieleranzahl über Zeit"
          />
        </PanelCard>
        <PanelCard className="pl-hub-chart">
          <div className="spread mon-chart-head">
            <div>
              <h3>Player Drops</h3>
              <p className="pl-hub-hint">Crashes & Disconnects · 72h</p>
            </div>
            <b className="mon-chart-val">{dropTotal}</b>
          </div>
          <AreaChart
            data={dropSeries}
            accessor={seriesDrops}
            color="#e85d4a"
            formatY={intAxis}
            ariaLabel="Player Drops über Zeit"
          />
          {(drops.stats || []).length > 0 && (
            <div className="pl-drop-tags">
              {(drops.stats || []).slice(0, 6).map((s) => (
                <span key={s.reason} className="pl-drop-tag" title={s.reason}>
                  <em>{s.c}</em> {String(s.reason).slice(0, 28)}{String(s.reason).length > 28 ? '…' : ''}
                </span>
              ))}
            </div>
          )}
        </PanelCard>
      </section>

      <div className="pl-toolbar">
        <div className="pl-filters" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`pl-filter${filter === f.id ? ' active' : ''}`}
              onClick={() => setHubFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="search grow"
          placeholder={filter === 'banned' ? 'Ban suchen…' : filter === 'allowlist' ? 'Allowlist suchen…' : 'Name oder Identifier…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (filter === 'banned') loadBans();
              else if (filter === 'allowlist') loadWl();
              else loadPlayers();
            }
          }}
        />
        {!['banned', 'allowlist'].includes(filter) && (
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="status">Status</option>
            <option value="last">Zuletzt</option>
            <option value="play">Spielzeit</option>
            <option value="name">Name</option>
          </select>
        )}
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => {
            if (filter === 'banned') loadBans();
            else if (filter === 'allowlist') loadWl();
            else loadPlayers();
            loadDrops(true);
          }}
        >
          Aktualisieren
        </button>
      </div>

      {err && !pick && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {filter === 'banned' ? (
        <PanelCard padded={false} className="pl-manage">
          <div className="table-wrap">
            {banRows.length === 0 ? (
              <Empty title="Keine aktiven Bans" text="Gebannte Spieler erscheinen hier — Unban direkt aus der Liste." />
            ) : (
              <table className="o-table">
                <thead>
                  <tr><th>Name</th><th>Identifier</th><th>Grund</th><th>Bis</th><th></th></tr>
                </thead>
                <tbody>
                  {banRows.map((ban) => (
                    <tr key={ban.id}>
                      <td data-label="Name">{ban.name || '–'}</td>
                      <td className="mono" data-label="Identifier">{ban.identifier}</td>
                      <td data-label="Grund">{ban.reason}</td>
                      <td data-label="Bis">{ban.expires ? fmtFull(ban.expires) : 'Permanent'}</td>
                      <td className="td-actions" data-label="">
                        {canRevoke && (
                          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => revokeBan(ban.id)}>
                            Unban
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </PanelCard>
      ) : filter === 'allowlist' ? (
        <div className="pl-manage-stack">
          {canWlWrite && (
            <PanelCard>
              <form className="row" onSubmit={addWl}>
                <input
                  className="grow"
                  placeholder="license:… / discord:… / steam:…"
                  value={wlForm.identifier}
                  onChange={(e) => setWlForm({ ...wlForm, identifier: e.target.value })}
                  required
                />
                <input
                  className="grow"
                  placeholder="Notiz"
                  value={wlForm.note}
                  onChange={(e) => setWlForm({ ...wlForm, note: e.target.value })}
                />
                <button className="btn btn-primary" style={{ width: 'auto' }} type="submit" disabled={busy}>
                  Hinzufügen
                </button>
              </form>
            </PanelCard>
          )}
          <PanelCard padded={false}>
            <div className="table-wrap">
              {wlRows.length === 0 ? (
                <Empty title="Allowlist leer" text="Freigaben anlegen oder Spieler im Modal auf die Allowlist setzen." />
              ) : (
                <table className="o-table">
                  <thead>
                    <tr><th>Identifier</th><th>Notiz</th><th>Von</th><th>Seit</th><th></th></tr>
                  </thead>
                  <tbody>
                    {wlRows.map((row) => (
                      <tr key={row.id}>
                        <td className="mono" data-label="Identifier">{row.identifier}</td>
                        <td data-label="Notiz">{row.note || '–'}</td>
                        <td data-label="Von">{row.author}</td>
                        <td data-label="Seit">{fmtFull(row.created)}</td>
                        <td className="td-actions" data-label="">
                          {canWlWrite && (
                            <button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => removeWl(row.id)}>
                              Entfernen
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </PanelCard>
        </div>
      ) : rows.length === 0 ? (
        <Empty title="Noch keine Spieler" text="Sobald jemand joined, erscheint er hier." />
      ) : (
        <div className="pl-grid">
          {rows.map((row) => {
            const preview = playerIds(row).filter((id) => !id.startsWith('ip:')).slice(0, 3);
            return (
              <button key={row.identifier} type="button" className={`pl-card${row.online ? ' online' : ''}${row.banned ? ' banned' : ''}`} onClick={() => openPlayer(row)}>
                <div className="pl-card-top">
                  <div>
                    <strong>{row.name}</strong>
                    <div className="pl-card-meta">
                      {row.online ? `ID ${row.serverId} · ${row.ping ?? 0} ms` : 'Offline'} · {fmtPlaytime(row.play_ms)}
                    </div>
                  </div>
                  <div className="pl-card-badges">
                    {row.banned && <Badge tone="bad">Ban</Badge>}
                    {row.whitelisted && <Badge tone="ok">WL</Badge>}
                    {row.online ? <Badge tone="ok">Online</Badge> : <Badge>Offline</Badge>}
                  </div>
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
          title="Spieler"
          onClose={() => { setPick(null); setDetail(null); setErr(''); }}
          wide
          aside={tab === 'ban' ? (
            <aside className="pl-ban-aside" aria-label="Ban-Auswahl">
              <div className="pl-ban-aside-block">
                <h4 className="pl-ban-aside-title">Vorlagen</h4>
                <div className="pl-ban-aside-list" role="listbox" aria-label="Ban-Vorlagen">
                  <button
                    type="button"
                    role="option"
                    aria-selected={!templateId}
                    className={`pl-ban-aside-item${!templateId ? ' active' : ''}`}
                    onClick={() => applyTemplate('')}
                  >
                    <span className="pl-ban-aside-item-label">Keine Vorlage</span>
                    <span className="pl-ban-aside-item-hint">Manuell ausfüllen</span>
                  </button>
                  {templateList.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={templateId === t.id}
                      className={`pl-ban-aside-item${templateId === t.id ? ' active' : ''}`}
                      onClick={() => applyTemplate(t.id, t)}
                    >
                      <span className="pl-ban-aside-item-label">{t.label}</span>
                      {t.hint && <span className="pl-ban-aside-item-hint">{t.hint}</span>}
                    </button>
                  ))}
                  {templateList.length === 0 && (
                    <p className="pl-ban-aside-empty">Keine Vorlagen hinterlegt</p>
                  )}
                </div>
              </div>
              <div className="pl-ban-aside-block">
                <h4 className="pl-ban-aside-title">Dauer</h4>
                <div className="pl-ban-aside-list" role="listbox" aria-label="Ban-Dauer">
                  {durationList.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={durationId === d.id}
                      className={`pl-ban-aside-item${durationId === d.id ? ' active' : ''}`}
                      onClick={() => { setDurationId(d.id); setTemplateId(''); }}
                    >
                      <span className="pl-ban-aside-item-label">{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          ) : null}
        >
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
                disabled={busy || !canWlWrite}
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
                  <div className="pl-ban-summary" aria-live="polite">
                    <span className="pl-ban-label">Auswahl</span>
                    <strong>{durationLabel}</strong>
                    {templateId ? (
                      <em>{templateList.find((t) => t.id === templateId)?.label || 'Vorlage'}</em>
                    ) : (
                      <em>Keine Vorlage</em>
                    )}
                  </div>
                  <label className="pl-ban-field">
                    <span className="pl-ban-label">Grund</span>
                    <textarea
                      rows={3}
                      value={reason}
                      onChange={(e) => { setReason(e.target.value); setTemplateId(''); }}
                      placeholder="Regel, Kontext…"
                    />
                  </label>
                  {durationId === 'custom' && (
                    <div className="pl-ban-row custom">
                      <label className="pl-ban-field pl-ban-amt">
                        <span className="pl-ban-label">Wert</span>
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          placeholder="z. B. 3"
                          value={customAmt}
                          onChange={(e) => setCustomAmt(e.target.value)}
                        />
                      </label>
                      <OrbitSelect
                        label="Einheit"
                        value={customUnit}
                        onChange={setCustomUnit}
                        options={[
                          { value: 'hours', label: 'Stunden' },
                          { value: 'days', label: 'Tage' },
                          { value: 'weeks', label: 'Wochen' },
                        ]}
                        className="pl-ban-unit"
                      />
                    </div>
                  )}
                  <button type="button" className="btn pl-ban-btn" disabled={busy} onClick={applyBan}>
                    Sperre setzen
                  </button>
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
