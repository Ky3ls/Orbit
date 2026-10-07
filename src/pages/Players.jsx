import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, sameJson } from '../api.js';
import { fmtFull, fmtPlaytime } from '../format.js';
import { AreaChart, Badge, Empty, Modal, Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import PlayerIdentifiers from '../components/PlayerIdentifiers.jsx';
import {
  BAN_DURATION_PRESETS,
  banDurationLabel,
  customDurationToId,
  durationIdToCustomParts,
} from './banPresets.js';
import './players.css';
import { useI18n } from '../i18n/I18nProvider.jsx';

function playerIds(p) {
  if (Array.isArray(p.identifiers) && p.identifiers.length) return p.identifiers;
  try {
    const parsed = JSON.parse(p.ids || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* */ }
  return p.identifier ? [p.identifier] : [];
}

const FILTERS = [
  { id: 'all', labelKey: 'players.filter.all' },
  { id: 'online', labelKey: 'players.filter.online' },
  { id: 'offline', labelKey: 'players.filter.offline' },
  { id: 'banned', labelKey: 'players.filter.banned' },
  { id: 'allowlist', labelKey: 'players.filter.allowlist' },
];

const SECTIONS = [
  { id: 'info', labelKey: 'players.section.info' },
  { id: 'ids', labelKey: 'players.section.ids' },
  { id: 'history', labelKey: 'players.section.history' },
  { id: 'ban', labelKey: 'players.section.ban' },
];

const intAxis = (v) => `${Math.round(v)}`;
const seriesPlayers = (d) => d.players;
const seriesDrops = (d) => d.drops;

function playerFingerprint(p) {
  if (!p) return '';
  return `${p.identifier}|${p.name}|${p.online ? 1 : 0}|${p.serverId || ''}|${p.ping ?? ''}|${p.banned ? 1 : 0}|${p.whitelisted ? 1 : 0}|${p.play_ms || 0}|${p.last_seen || 0}|${p.note || ''}`;
}

/** Ban-Dauer aus created/expires (z. B. „2 Tage“). */
function banLengthLabel(created, expires, t) {
  if (!expires) return t('common.permanent');
  const ms = Math.max(0, Number(expires) - Number(created || 0));
  const day = 86_400_000;
  const hour = 3_600_000;
  const days = Math.round(ms / day);
  if (days >= 1 && Math.abs(ms - days * day) < hour) {
    return days === 1 ? t('players.histLenDay') : t('players.histLenDays', { n: days });
  }
  const hours = Math.round(ms / hour);
  if (hours >= 1 && Math.abs(ms - hours * hour) < 60_000) {
    return hours === 1 ? t('players.histLenHour') : t('players.histLenHours', { n: hours });
  }
  const mins = Math.max(1, Math.round(ms / 60_000));
  return mins === 1 ? t('players.histLenMin') : t('players.histLenMins', { n: mins });
}

export default function Players({ user }) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = FILTERS.some((f) => f.id === searchParams.get('filter'))
    ? searchParams.get('filter')
    : 'all';
  const deepOpen = searchParams.get('open') || searchParams.get('name') || '';
  const deepSid = searchParams.get('sid') || '';

  const [data, setData] = useState({
    online: false, players: [], list: [], series: [], stats: {}, maxClients: 48, fxCommandReady: false,
  });
  const [drops, setDrops] = useState({ rows: [], stats: [], series: [], total: 0, hours: 72 });
  const [bans, setBans] = useState([]);
  const [wlEntries, setWlEntries] = useState([]);
  const [wlForm, setWlForm] = useState({ identifier: '', note: '' });
  const [q, setQ] = useState(deepOpen);
  const [filter, setFilter] = useState(initialFilter);
  const pendingOpen = useRef(
    deepOpen || deepSid ? { open: deepOpen, sid: deepSid } : null,
  );
  const [pick, setPick] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('info');
  const [banReason, setBanReason] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState('');
  const [durationId, setDurationId] = useState('2d');
  const [customDays, setCustomDays] = useState('');
  const [customHhmm, setCustomHhmm] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [banTemplates, setBanTemplates] = useState([]);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('status');
  const [busy, setBusy] = useState(false);
  const [histQ, setHistQ] = useState('');
  const qRef = useRef(q);
  qRef.current = q;
  const dataRef = useRef(data);
  dataRef.current = data;
  const dropsRef = useRef(drops);
  dropsRef.current = drops;
  const noteSavedRef = useRef('');
  const noteTimerRef = useRef(null);
  const noteReqIdRef = useRef(0);
  const noteRef = useRef('');
  noteRef.current = note;
  const notePlayerRef = useRef(null);

  /** Sofort speichern wenn dirty (Blur / Tab / Modal-Close). Still — kein Status-Label. */
  const flushNoteSave = useCallback(() => {
    if (noteTimerRef.current) {
      clearTimeout(noteTimerRef.current);
      noteTimerRef.current = null;
    }
    const player = notePlayerRef.current;
    const payload = noteRef.current;
    if (!player?.identifier || payload === noteSavedRef.current) return;
    const { identifier, name } = player;
    const reqId = ++noteReqIdRef.current;
    api('/api/players/note', {
      method: 'POST',
      body: { identifier, name, note: payload },
    })
      .then(() => {
        if (reqId !== noteReqIdRef.current) return;
        if (notePlayerRef.current?.identifier !== identifier) return;
        noteSavedRef.current = payload;
        setNoteErr('');
        setPick((cur) => (cur && cur.identifier === identifier ? { ...cur, note: payload } : cur));
        loadPlayers(true);
      })
      .catch((e) => {
        if (reqId !== noteReqIdRef.current) return;
        if (notePlayerRef.current?.identifier !== identifier) return;
        setNoteErr(e.message || t('common.error'));
      });
  }, [t]);

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

  const loadBanTemplates = useCallback(() => {
    api('/api/ban-templates')
      .then((d) => setBanTemplates(Array.isArray(d.templates) ? d.templates : []))
      .catch(() => setBanTemplates([]));
  }, []);

  async function openPlayer(row, { keepTab = false } = {}) {
    flushNoteSave();
    setPick(row);
    if (!keepTab) {
      setTab('info');
      setBanReason('');
      setActionReason('');
      setTemplateId('');
      setDurationId('2d');
      setCustomDays('');
      setCustomHhmm('');
      setHistQ('');
    }
    setErr('');
    loadBanTemplates();
    try {
      const d = await api(`/api/players/detail?id=${encodeURIComponent(row.identifier)}`);
      setDetail(d);
      const nextNote = d.player?.note || '';
      noteSavedRef.current = nextNote;
      setNote(nextNote);
      setNoteErr('');
      /* Ban-Vorlagen nur aus Settings-/API-Liste — nie Kick/Warn-Gründe */
      if (Array.isArray(d.banTemplates)) setBanTemplates(d.banTemplates);
      if (d.player) {
        setPick((cur) => (cur && cur.identifier === d.player.identifier
          ? { ...cur, ...d.player }
          : cur));
      }
    } catch (e) {
      setDetail(null);
      setErr(e.message);
    }
  }

  /* Deep-Link aus Live-Konsole: /players?open=Name&sid=1 → Modal */
  useEffect(() => {
    const open = searchParams.get('open') || searchParams.get('name') || '';
    const sid = searchParams.get('sid') || '';
    if (open || sid) pendingOpen.current = { open, sid };
  }, [searchParams]);

  useEffect(() => {
    const pending = pendingOpen.current;
    if (!pending) return;
    const list = data.list || [];
    if (!list.length) return;
    let match = null;
    if (pending.sid) {
      const n = Number(pending.sid);
      if (Number.isFinite(n)) match = list.find((p) => Number(p.serverId) === n) || null;
    }
    if (!match && pending.open) {
      const needle = String(pending.open).toLowerCase();
      match = list.find((p) => String(p.name || '').toLowerCase() === needle)
        || list.find((p) => String(p.name || '').toLowerCase().includes(needle))
        || null;
    }
    if (!match) return;
    pendingOpen.current = null;
    openPlayer(match);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    next.delete('name');
    next.delete('sid');
    setSearchParams(next, { replace: true });
  }, [data.list, searchParams, setSearchParams]);

  function applyTemplate(id, opt) {
    setTemplateId(id);
    if (!id) return;
    const fromList = banTemplates.find((x) => String(x.id) === String(id));
    const reasonText = opt?.reason ?? fromList?.reason;
    const dur = opt?.durationId ?? opt?.duration_id ?? fromList?.duration_id;
    if (reasonText) setBanReason(reasonText);
    if (!dur) return;
    if (BAN_DURATION_PRESETS.some((p) => p.id === dur)) {
      setDurationId(dur);
      return;
    }
    const parts = durationIdToCustomParts(dur);
    if (parts) {
      setDurationId('custom');
      setCustomDays(parts.days);
      setCustomHhmm(parts.hhmm);
      return;
    }
    setDurationId(dur);
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

  useEffect(() => {
    if (tab === 'ban' && pick) loadBanTemplates();
  }, [tab, pick, loadBanTemplates]);

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
  notePlayerRef.current = p ? { identifier: p.identifier, name: p.name } : null;
  const ids = p ? playerIds(p) : [];
  const activeBan = detail?.activeBan
    || (p?.banned && p?.banId
      ? { id: p.banId, reason: p.banReason || '', expires: p.banExpires ?? null, author: '' }
      : null);
  const isBanned = !!(activeBan || p?.banned);
  const presets = detail?.banPresets || [];
  const durationList = useMemo(() => {
    const list = (presets.length ? presets : BAN_DURATION_PRESETS).map((pr) => ({
      id: pr.id,
      label: pr.labelKey ? t(pr.labelKey) : (pr.label || banDurationLabel(pr.id, t)),
    }));
    list.push({ id: 'custom', label: t('players.custom') });
    return list;
  }, [presets, t]);
  const templateList = useMemo(() => banTemplates.map((tpl) => ({
    id: String(tpl.id),
    label: tpl.title || tpl.reason,
    reason: tpl.reason,
    durationId: tpl.duration_id,
  })), [banTemplates]);
  const durationLabel = useMemo(
    () => durationList.find((d) => d.id === durationId)?.label || banDurationLabel(durationId, t),
    [durationList, durationId, t],
  );

  /* Interne Notiz: Debounce Auto-Save an /api/players/note (ohne UI-Status) */
  useEffect(() => {
    if (!p?.identifier) return undefined;
    if (note === noteSavedRef.current) {
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        noteTimerRef.current = null;
      }
      return undefined;
    }
    const identifier = p.identifier;
    const name = p.name;
    setNoteErr('');
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null;
      const reqId = ++noteReqIdRef.current;
      const payload = note;
      api('/api/players/note', {
        method: 'POST',
        body: { identifier, name, note: payload },
      })
        .then(() => {
          if (reqId !== noteReqIdRef.current) return;
          if (notePlayerRef.current?.identifier !== identifier) return;
          noteSavedRef.current = payload;
          setNoteErr('');
          setPick((cur) => (cur && cur.identifier === identifier ? { ...cur, note: payload } : cur));
          loadPlayers(true);
        })
        .catch((e) => {
          if (reqId !== noteReqIdRef.current) return;
          if (notePlayerRef.current?.identifier !== identifier) return;
          setNoteErr(e.message || t('common.error'));
        });
    }, 500);
    return () => {
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        noteTimerRef.current = null;
      }
    };
  }, [note, p?.identifier, p?.name, t]);

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
      setErr(t('players.errOffline'));
      return;
    }
    if (actionReason.length < 2) { setErr(t('players.errReason')); return; }
    setBusy(true);
    setErr('');
    try {
      await api('/api/players/action', {
        method: 'POST',
        body: { action, id: p.serverId, reason: actionReason },
      });
      setActionReason('');
      loadPlayers(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function applyBan() {
    if (!p || banReason.length < 3) { setErr(t('players.errBanReason')); return; }
    if (isBanned) { setErr(t('players.errAlreadyBanned')); return; }
    let resolvedId = durationId;
    if (durationId === 'custom') {
      const mapped = customDurationToId(customDays, customHhmm);
      if (!mapped.ok) {
        setErr(t(mapped.error === 'hhmm' ? 'players.errBanHhmm' : 'players.errBanDuration'));
        return;
      }
      resolvedId = mapped.id;
    }
    setBusy(true);
    setErr('');
    try {
      await api('/api/bans', {
        method: 'POST',
        body: {
          identifiers: ids,
          identifier: p.identifier,
          name: p.name,
          reason: banReason,
          durationId: resolvedId,
          id: p.serverId,
        },
      });
      setBanReason('');
      setTemplateId('');
      await openPlayer(p, { keepTab: true });
      loadPlayers(true);
      if (filter === 'banned') loadBans(true);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function revokeBan(id) {
    setBusy(true);
    setErr('');
    try {
      await api(`/api/bans/${id}/revoke`, { method: 'POST', body: {} });
      if (pick) await openPlayer(pick, { keepTab: true });
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
        eyebrow={t('players.eyebrow')}
        title={t('page.players')}
        description={t('players.desc', { online: onlineCount, offline: Math.max(0, totalKnown - onlineCount), drops: dropTotal })}
        actions={(
          <Badge tone={data.online ? 'ok' : 'bad'}>{t('players.live', { n: onlineCount })}</Badge>
        )}
      />

      <section className="pl-hub-charts" aria-label={t('common.trends')}>
        <PanelCard className="pl-hub-chart">
          <div className="spread mon-chart-head">
            <div>
              <h3>{t('players.count')}</h3>
              <p className="pl-hub-hint">{t('players.countHint')}</p>
            </div>
            <b className="mon-chart-val">{onlineCount} / {maxClients}</b>
          </div>
          <AreaChart
            data={playerSeries}
            accessor={seriesPlayers}
            yMax={maxClients}
            formatY={intAxis}
            ariaLabel={t('players.countAria')}
          />
        </PanelCard>
        <PanelCard className="pl-hub-chart">
          <div className="spread mon-chart-head">
            <div>
              <h3>{t('players.drops')}</h3>
              <p className="pl-hub-hint">{t('players.dropsHint')}</p>
            </div>
            <b className="mon-chart-val">{dropTotal}</b>
          </div>
          <AreaChart
            data={dropSeries}
            accessor={seriesDrops}
            color="var(--bad)"
            formatY={intAxis}
            ariaLabel={t('players.dropsAria')}
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
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        <input
          className="search grow"
          placeholder={filter === 'banned' ? t('players.searchBan') : filter === 'allowlist' ? t('players.searchWl') : t('players.search')}
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
            <option value="status">{t('players.sort.status')}</option>
            <option value="last">{t('players.sort.last')}</option>
            <option value="play">{t('players.sort.play')}</option>
            <option value="name">{t('players.sort.name')}</option>
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
          {t('common.refresh')}
        </button>
      </div>

      {err && !pick && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {filter === 'banned' ? (
        <PanelCard padded={false} className="pl-manage">
          <div className="table-wrap">
            {banRows.length === 0 ? (
              <Empty title={t('players.emptyBans')} text={t('players.emptyBansText')} />
            ) : (
              <table className="o-table">
                <thead>
                  <tr><th>{t('common.name')}</th><th>{t('common.identifier')}</th><th>{t('common.reason')}</th><th>{t('common.until')}</th><th></th></tr>
                </thead>
                <tbody>
                  {banRows.map((ban) => (
                    <tr key={ban.id}>
                      <td data-label={t('common.name')}>{ban.name || '–'}</td>
                      <td className="mono" data-label={t('common.identifier')}>{ban.identifier}</td>
                      <td data-label={t('common.reason')}>{ban.reason}</td>
                      <td data-label={t('common.until')}>{ban.expires ? fmtFull(ban.expires) : t('common.permanent')}</td>
                      <td className="td-actions" data-label="">
                        {canRevoke && (
                          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => revokeBan(ban.id)}>
                            {t('players.revokeBan')}
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
                  placeholder={t('players.wlPh')}
                  value={wlForm.identifier}
                  onChange={(e) => setWlForm({ ...wlForm, identifier: e.target.value })}
                  required
                />
                <input
                  className="grow"
                  placeholder={t('common.note')}
                  value={wlForm.note}
                  onChange={(e) => setWlForm({ ...wlForm, note: e.target.value })}
                />
                <button className="btn btn-primary" style={{ width: 'auto' }} type="submit" disabled={busy}>
                  {t('common.add')}
                </button>
              </form>
            </PanelCard>
          )}
          <PanelCard padded={false}>
            <div className="table-wrap">
              {wlRows.length === 0 ? (
                <Empty title={t('players.emptyWl')} text={t('players.emptyWlText')} />
              ) : (
                <table className="o-table">
                  <thead>
                    <tr><th>{t('common.identifier')}</th><th>{t('common.note')}</th><th>{t('common.by')}</th><th>{t('common.since')}</th><th></th></tr>
                  </thead>
                  <tbody>
                    {wlRows.map((row) => (
                      <tr key={row.id}>
                        <td className="mono" data-label={t('common.identifier')}>{row.identifier}</td>
                        <td data-label={t('common.note')}>{row.note || '–'}</td>
                        <td data-label={t('common.by')}>{row.author}</td>
                        <td data-label={t('common.since')}>{fmtFull(row.created)}</td>
                        <td className="td-actions" data-label="">
                          {canWlWrite && (
                            <button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => removeWl(row.id)}>
                              {t('common.remove')}
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
        <Empty title={t('players.empty')} text={t('players.emptyText')} />
      ) : (
        <div className="pl-grid">
          {rows.map((row) => (
            <article
              key={row.identifier}
              className={`pl-card${row.online ? ' online' : ''}${row.banned ? ' banned' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => openPlayer(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openPlayer(row);
                }
              }}
            >
              <div className="pl-card-top">
                <div className="pl-card-identity">
                  <strong className="pl-card-name">{row.name}</strong>
                  <div className="pl-card-meta">
                    {row.online
                      ? (
                        <>
                          <span>ID {row.serverId}</span>
                          <span className="pl-meta-sep" aria-hidden="true">·</span>
                          <span>{row.ping ?? 0} ms</span>
                          <span className="pl-meta-sep" aria-hidden="true">·</span>
                          <span>{fmtPlaytime(row.play_ms)}</span>
                        </>
                      )
                      : (
                        <>
                          <span>{t('status.offline')}</span>
                          <span className="pl-meta-sep" aria-hidden="true">·</span>
                          <span>{fmtPlaytime(row.play_ms)}</span>
                        </>
                      )}
                  </div>
                </div>
                <div className="pl-card-badges">
                  {row.banned && <Badge tone="bad">Ban</Badge>}
                  {row.whitelisted && <Badge tone="ok">WL</Badge>}
                  {row.online
                    ? <span className="pl-status online">{t('status.online')}</span>
                    : <span className="pl-status">{t('status.offline')}</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {pick && p && (
        <Modal
          title={t('players.modal')}
          onClose={() => {
            flushNoteSave();
            setPick(null);
            setDetail(null);
            setErr('');
          }}
          wide
          aside={tab === 'ban' && !isBanned ? (
            <aside className="pl-ban-aside" aria-label={t('players.banAside')}>
              <div className="pl-ban-aside-block">
                <h4 className="pl-ban-aside-title">{t('common.templates')}</h4>
                <div className="pl-ban-tags" role="listbox" aria-label={t('players.banTemplates')}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={!templateId}
                    className={`pl-ban-tag${!templateId ? ' active' : ''}`}
                    onClick={() => applyTemplate('')}
                  >
                    {t('players.noTemplate')}
                  </button>
                  {templateList.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      role="option"
                      aria-selected={templateId === tpl.id}
                      className={`pl-ban-tag${templateId === tpl.id ? ' active' : ''}`}
                      onClick={() => applyTemplate(tpl.id, tpl)}
                      title={tpl.reason || tpl.label}
                    >
                      {tpl.label}
                    </button>
                  ))}
                  {templateList.length === 0 && (
                    <p className="pl-ban-aside-empty">{t('players.noTemplates')}</p>
                  )}
                </div>
              </div>
              <div className="pl-ban-aside-block">
                <h4 className="pl-ban-aside-title">{t('common.duration')}</h4>
                <div className="pl-ban-aside-list" role="listbox" aria-label={t('players.banDuration')}>
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
                    ? <span className="pl-live">{t('players.liveId', { id: p.serverId })}</span>
                    : <span className="pl-off">{t('status.offline')}</span>}
                  {isBanned && <span className="pl-banned-badge">{t('players.banned')}</span>}
                </div>
                <p className="pl-hero-sub">
                  {p.online ? t('players.session', { ping: p.ping ?? 0, session: fmtPlaytime(p.session_ms || detail?.player?.session_ms) }) : t('players.lastSeen', { when: fmtFull(p.last_seen) })}
                  {' · '}
                  {t('players.totalPlay', { play: fmtPlaytime(p.play_ms) })}
                </p>
              </div>
              <button
                type="button"
                className={`pl-allow${p.whitelisted ? ' on' : ''}`}
                disabled={busy || !canWlWrite}
                onClick={toggleWl}
              >
                {p.whitelisted ? t('players.onAllowlist') : t('players.toAllowlist')}
              </button>
            </header>

            {isBanned && activeBan && (
              <div className="pl-ban-banner" role="status">
                <div>
                  <strong>{t('players.activeBan')}</strong>
                  <p>{activeBan.reason || '—'}</p>
                  <small>
                    {activeBan.author ? `${activeBan.author} · ` : ''}
                    {activeBan.expires
                      ? t('players.banUntil', { when: fmtFull(activeBan.expires) })
                      : t('common.permanent')}
                  </small>
                </div>
                {canRevoke && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => revokeBan(activeBan.id)}
                  >
                    {t('players.revokeBan')}
                  </button>
                )}
              </div>
            )}

            <div className="pl-rail" aria-hidden="true">
              <div><small>{t('players.joined')}</small><strong>{fmtFull(p.first_seen)}</strong></div>
              <div><small>Bans</small><strong>{p.bans ?? 0}</strong></div>
              <div><small>Warns</small><strong>{p.warns ?? 0}</strong></div>
              <div><small>IDs</small><strong>{ids.length}</strong></div>
            </div>

            <div className="pl-seg" role="tablist" aria-label={t('players.viewAria')}>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === s.id}
                  className={tab === s.id ? 'active' : ''}
                  onClick={() => {
                    if (s.id !== tab) flushNoteSave();
                    setTab(s.id);
                  }}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>

            {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}

            <div className="pl-body">
              {tab === 'info' && (
                <div className="pl-panel">
                  <label className="field">
                    <span className="pl-note-label">
                      <span>{t('players.note')}</span>
                      {noteErr && (
                        <span className="pl-note-status is-err" role="alert">{noteErr}</span>
                      )}
                    </span>
                    <textarea
                      rows={4}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onBlur={() => flushNoteSave()}
                      placeholder={t('players.notePh')}
                    />
                  </label>
                </div>
              )}

              {tab === 'ids' && (
                ids.length === 0 ? (
                  <p className="muted">{t('players.noIds')}</p>
                ) : (
                  <PlayerIdentifiers
                    ids={ids}
                    mask
                    copyable
                    className="pl-ids-sheet"
                    copyLabel={t('common.copy')}
                    copiedLabel={t('common.copied')}
                  />
                )
              )}

              {tab === 'history' && (
                <div className="pl-hist">
                  {(() => {
                    const bans = detail?.history?.bans || [];
                    const warns = detail?.history?.warns || [];
                    if (!bans.length && !warns.length) {
                      return <p className="pl-hist-empty muted">{t('players.noHistory')}</p>;
                    }
                    const entries = [
                      ...bans.map((b) => ({
                        kind: 'ban',
                        id: b.id,
                        created: b.created || 0,
                        reason: b.reason,
                        author: b.author,
                        expires: b.expires,
                        revoked: !!b.revoked,
                        revokedBy: b.revoked_by || '',
                        revokedAt: b.revoked_at || 0,
                        live: !b.revoked && (!b.expires || b.expires > Date.now()),
                      })),
                      ...warns.map((w) => ({
                        kind: 'warn',
                        id: w.id,
                        created: w.created || 0,
                        reason: w.reason,
                        author: w.author,
                      })),
                    ].sort((a, b) => (b.created || 0) - (a.created || 0));

                    const needle = histQ.trim().toLowerCase();
                    const visible = needle
                      ? entries.filter((e) => {
                          const hay = [
                            e.kind,
                            String(e.id),
                            e.reason,
                            e.author,
                            e.revokedBy,
                            e.kind === 'ban' ? t('players.histBan') : t('players.histWarn'),
                          ].join(' ').toLowerCase();
                          return hay.includes(needle);
                        })
                      : entries;
                    const liveBans = entries.filter((e) => e.kind === 'ban' && e.live).length;
                    return (
                      <>
                        <div className="pl-hist-bar">
                          <div className="pl-hist-summary">
                            <span>{t('players.histBans', { n: bans.length })}</span>
                            <span className="pl-hist-dot" aria-hidden="true">·</span>
                            <span>{t('players.histWarns', { n: warns.length })}</span>
                            {liveBans > 0 && (
                              <>
                                <span className="pl-hist-dot" aria-hidden="true">·</span>
                                <span className="pl-hist-live">{t('players.histActive', { n: liveBans })}</span>
                              </>
                            )}
                          </div>
                          <input
                            className="search pl-hist-search"
                            type="search"
                            value={histQ}
                            onChange={(e) => setHistQ(e.target.value)}
                            placeholder={t('players.histSearch')}
                            aria-label={t('players.histSearch')}
                          />
                        </div>
                        {visible.length === 0 ? (
                          <p className="pl-hist-empty muted">{t('players.histNoMatch')}</p>
                        ) : (
                        <ol className="pl-hist-list">
                          {visible.map((e) => (
                            <li
                              key={`${e.kind}-${e.id}`}
                              className={`pl-hist-item ${e.kind}${e.live ? ' live' : ''}${e.revoked ? ' revoked' : ''}`}
                            >
                              <div className="pl-hist-rail" aria-hidden="true" />
                              <article className="pl-hist-card">
                                <div className="pl-hist-main">
                                  <div className="pl-hist-body">
                                    <div className="pl-hist-row">
                                      <span className={`pl-hist-type ${e.kind}`}>
                                        {e.kind === 'ban' ? t('players.histBan') : t('players.histWarn')}
                                      </span>
                                      <span className="pl-hist-id">#{e.id}</span>
                                      {e.kind === 'ban' && e.live && (
                                        <span className="pl-hist-pill">{t('players.banned')}</span>
                                      )}
                                      {e.kind === 'ban' && e.revoked && (
                                        <span className="pl-hist-pill off">{t('players.banRevoked')}</span>
                                      )}
                                      {e.kind === 'ban' && !e.live && !e.revoked && e.expires && (
                                        <span className="pl-hist-pill off">{t('players.histExpired')}</span>
                                      )}
                                      <p className="pl-hist-reason">{e.reason || '—'}</p>
                                      {e.kind === 'ban' && e.live && canRevoke && (
                                        <button
                                          type="button"
                                          className="btn btn-sm pl-hist-revoke"
                                          disabled={busy}
                                          onClick={() => revokeBan(e.id)}
                                        >
                                          {t('players.revokeBan')}
                                        </button>
                                      )}
                                    </div>
                                    <div className="pl-hist-meta">
                                      {e.author && (
                                        <span>
                                          {e.kind === 'ban'
                                            ? t('players.histBannedBy', { name: e.author })
                                            : t('players.histWarnedBy', { name: e.author })}
                                        </span>
                                      )}
                                      {e.kind === 'ban' && e.revoked && e.revokedBy && (
                                        <span>{t('players.histRevokedBy', { name: e.revokedBy })}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="pl-hist-when">
                                    <time dateTime={e.created ? new Date(e.created).toISOString() : undefined}>
                                      {fmtFull(e.created)}
                                    </time>
                                    {e.kind === 'ban' && (
                                      <>
                                        <span className="pl-hist-len">
                                          {banLengthLabel(e.created, e.expires, t)}
                                        </span>
                                        {e.expires ? (
                                          <span className="pl-hist-until">
                                            {t('players.banUntil', { when: fmtFull(e.expires) })}
                                          </span>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                </div>
                              </article>
                            </li>
                          ))}
                        </ol>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {tab === 'ban' && (
                <div className="pl-panel pl-ban">
                  <div className="pl-ban-summary" aria-live="polite">
                    <span className="pl-ban-label">{t('players.selection')}</span>
                    <strong>{durationLabel}</strong>
                    {templateId ? (
                      <em>{templateList.find((tpl) => tpl.id === templateId)?.label || t('players.template')}</em>
                    ) : (
                      <em>{t('players.noTemplate')}</em>
                    )}
                  </div>
                  <label className="pl-ban-field">
                    <span className="pl-ban-label">{t('common.reason')}</span>
                    <textarea
                      rows={3}
                      value={banReason}
                      onChange={(e) => { setBanReason(e.target.value); setTemplateId(''); }}
                      placeholder={t('players.reasonPh')}
                      disabled={isBanned}
                    />
                  </label>
                  {durationId === 'custom' && !isBanned && (
                    <div className="pl-ban-custom-row">
                      <label className="pl-ban-field pl-ban-amt">
                        <span className="pl-ban-label">{t('common.days')}</span>
                        <input
                          type="number"
                          min={0}
                          max={9999}
                          inputMode="numeric"
                          placeholder={t('ban.daysPh')}
                          value={customDays}
                          onChange={(e) => setCustomDays(e.target.value)}
                        />
                      </label>
                      <label className="pl-ban-field pl-ban-amt">
                        <span className="pl-ban-label">{t('ban.hhmm')}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder={t('ban.hhmmPh')}
                          value={customHhmm}
                          onChange={(e) => setCustomHhmm(e.target.value)}
                          maxLength={5}
                          autoComplete="off"
                        />
                      </label>
                    </div>
                  )}
                  {isBanned && activeBan && canRevoke ? (
                    <button
                      type="button"
                      className="btn pl-ban-btn"
                      disabled={busy}
                      onClick={() => revokeBan(activeBan.id)}
                    >
                      {t('players.revokeBan')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn pl-ban-btn"
                      disabled={busy || isBanned}
                      onClick={applyBan}
                    >
                      {t('players.applyBan')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {tab !== 'ban' && (
              <div className="pl-actions">
                <input
                  className="pl-actions-reason"
                  placeholder={t('players.actionPh')}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
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
