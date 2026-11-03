import { useEffect, useMemo, useRef, useState } from 'react';
import { api, sameJson } from '../api.js';
import { Page, PageHeader } from '../components/Ui.jsx';
import { toast } from '../components/toast.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './resources.css';

const FILTERS = ['all', 'started', 'stopped'];
const OPEN_KEY = 'orbit.res.closed';

function statusTone(actual) {
  if (actual === 'started') return 'ok';
  if (actual === 'stopped') return 'bad';
  if (actual === 'offline') return 'warn';
  return 'idle';
}

function readClosed() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); }
}

export default function Resources() {
  const { t } = useI18n();
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const [online, setOnline] = useState(false);
  const [fxReady, setFxReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [closed, setClosed] = useState(readClosed);
  const [busy, setBusy] = useState('');
  const snapRef = useRef(null);
  const searchRef = useRef(null);

  function load() {
    return api('/api/resources').then((d) => {
      const next = { groups: d.groups || [], online: !!d.online, fxReady: !!d.fxCommandReady };
      setLoaded(true);
      if (sameJson(snapRef.current, next)) return;
      snapRef.current = next;
      setGroups(next.groups);
      setOnline(next.online);
      setFxReady(next.fxReady);
    }).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setQLive(q), 160);
    return () => clearTimeout(id);
  }, [q]);

  /* „/“ fokussiert hier die Suche statt der globalen Palette */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo(() => groups.flatMap((g) => g.resources || []), [groups]);
  const totals = useMemo(() => ({
    all: all.length,
    started: all.filter((r) => r.actual === 'started').length,
    stopped: all.filter((r) => r.actual === 'stopped').length,
    folders: groups.length,
  }), [all, groups]);

  const filtered = useMemo(() => {
    const needle = qLive.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        resources: (g.resources || []).filter((r) => {
          if (filter !== 'all' && r.actual !== filter) return false;
          if (!needle) return true;
          return r.name.toLowerCase().includes(needle) || String(g.folder).toLowerCase().includes(needle);
        }),
      }))
      .filter((g) => g.resources.length > 0);
  }, [groups, qLive, filter]);

  const shown = filtered.reduce((n, g) => n + g.resources.length, 0);
  const searching = !!qLive.trim() || filter !== 'all';

  function toggle(folder) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }

  function setAll(open) {
    const next = open ? new Set() : new Set(groups.map((g) => g.folder));
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* */ }
    setClosed(next);
  }

  async function act(name, action) {
    setErr('');
    setBusy(`${name}:${action}`);
    try {
      await api('/api/resources/action', { method: 'POST', body: { name, action } });
      toast.ok(t(`res.toast.${action}`, { name }));
      setTimeout(load, 1200);
    } catch (error) {
      toast.err(t('res.toast.fail', { name }), { text: error.message });
    } finally {
      setBusy('');
    }
  }

  const canAct = fxReady && online;
  const pct = totals.all ? Math.round((totals.started / totals.all) * 100) : 0;

  return (
    <Page className="res-page">
      <PageHeader
        eyebrow={t('resources.eyebrow')}
        title={t('page.resources')}
        description={online ? t('res.lead') : t('resources.descOffline')}
        actions={(
          <button type="button" className="btn btn-sm" onClick={() => { load(); toast(t('res.reloaded')); }}>
            <NavIcon name="refresh" />{t('res.reload')}
          </button>
        )}
      />

      <div className="res-stats">
        <div className="res-stat">
          <span className="res-stat-ico"><NavIcon name="box" /></span>
          <div><b>{totals.all}</b><span>{t('res.total')}</span></div>
        </div>
        <div className="res-stat tone-ok">
          <span className="res-stat-ico"><NavIcon name="play" /></span>
          <div><b>{totals.started}</b><span>{t('res.running')}</span></div>
        </div>
        <div className="res-stat tone-bad">
          <span className="res-stat-ico"><NavIcon name="stop" /></span>
          <div><b>{totals.stopped}</b><span>{t('res.stopped')}</span></div>
        </div>
        <div className="res-stat res-stat-health">
          <div className="res-health-head"><span>{t('res.health')}</span><b>{pct}%</b></div>
          <div className="res-health-bar"><i style={{ width: `${pct}%` }} /></div>
          <span className="muted">{t('res.folders', { n: totals.folders })}</span>
        </div>
      </div>

      <div className="res-toolbar">
        <div className="res-search">
          <NavIcon name="search" />
          <input
            ref={searchRef}
            placeholder={t('resources.searchPh')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('resources.searchAria')}
          />
          {q ? (
            <button type="button" className="res-search-clear" onClick={() => setQ('')} title={t('resources.clearSearch')}>
              <NavIcon name="x" />
            </button>
          ) : <kbd>Ctrl F</kbd>}
        </div>
        <div className="seg" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {t(`res.filter.${f}`)}
              <span className="res-seg-n">{f === 'all' ? totals.all : totals[f]}</span>
            </button>
          ))}
        </div>
        <div className="res-toolbar-end">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(true)}>{t('res.expandAll')}</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(false)}>{t('res.collapseAll')}</button>
        </div>
      </div>

      {!canAct && loaded && (
        <div className="banner warn">{online ? t('res.noConsole') : t('resources.descOffline')}</div>
      )}
      {err && <div className="err">{err}</div>}

      {!loaded ? (
        <div className="res-grid">
          {[0, 1, 2].map((i) => <div key={i} className="res-group skeleton" style={{ height: 180 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card o-empty">
          <strong>{qLive ? t('resources.emptyQ', { q: qLive }) : t('resources.empty')}</strong>
          {searching ? <button type="button" className="btn btn-sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('res.reset')}</button> : null}
        </div>
      ) : (
        <>
          {searching ? <p className="res-count muted">{t('res.matches', { n: shown })}</p> : null}
          <div className="res-grid">
            {filtered.map((group) => {
              const expanded = searching || !closed.has(group.folder);
              const started = group.resources.filter((r) => r.actual === 'started').length;
              const gp = group.resources.length ? (started / group.resources.length) * 100 : 0;
              return (
                <section key={group.folder} className={`res-group card${expanded ? ' open' : ''}`}>
                  <button type="button" className="res-group-head" onClick={() => toggle(group.folder)} aria-expanded={expanded}>
                    <span className="res-folder-ico"><NavIcon name="folder" /></span>
                    <span className="res-group-title">
                      <b className="mono">{group.folder}</b>
                      <span className="res-group-meter"><i style={{ width: `${gp}%` }} /></span>
                    </span>
                    <span className="res-group-count mono">{started}/{group.resources.length}</span>
                    <span className="res-chev"><NavIcon name="chevronDown" /></span>
                  </button>
                  {expanded && (
                    <ul className="res-list">
                      {group.resources.map((r) => {
                        const tone = statusTone(r.actual);
                        return (
                          <li key={r.name} className={`res-row tone-${tone}`}>
                            <span className="res-dot" aria-hidden="true" />
                            <span className="res-name mono" title={r.name}>{r.name}</span>
                            <span className="res-state">{['started', 'stopped', 'offline'].includes(r.actual) ? t(`resources.status.${r.actual}`) : '—'}</span>
                            <span className="res-acts" role="group" aria-label={t('resources.actions', { name: r.name })}>
                              {r.actual !== 'started' ? (
                                <button type="button" className="res-act go" disabled={!canAct || !!busy} title={t('ctl.start')} onClick={() => act(r.name, 'start')}>
                                  <NavIcon name="play" />
                                </button>
                              ) : (
                                <button type="button" className="res-act" disabled={!canAct || !!busy} title={t('resources.restart')} onClick={() => act(r.name, 'restart')}>
                                  <NavIcon name="restart" />
                                </button>
                              )}
                              <button type="button" className="res-act stop" disabled={!canAct || !!busy || r.actual === 'stopped'} title={t('ctl.stop')} onClick={() => act(r.name, 'stop')}>
                                <NavIcon name="stop" />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </Page>
  );
}
