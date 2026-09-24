import { useEffect, useMemo, useRef, useState } from 'react';
import { api, sameJson } from '../api.js';
import { Page, PageHeader } from '../components/Ui.jsx';

function matchFilter(text, q) {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}

function statusLabel(actual) {
  if (actual === 'started') return 'läuft';
  if (actual === 'stopped') return 'stopp';
  if (actual === 'offline') return 'offline';
  return actual || '—';
}

function statusTone(actual) {
  if (actual === 'started') return 'ok';
  if (actual === 'stopped') return 'bad';
  if (actual === 'offline') return 'warn';
  return '';
}

export default function Resources() {
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [err, setErr] = useState('');
  const [online, setOnline] = useState(false);
  const [fxReady, setFxReady] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const snapRef = useRef({ groups: [], online: false, fxReady: false });

  function load() {
    api('/api/resources').then((d) => {
      const next = {
        groups: d.groups || [],
        online: d.online,
        fxReady: !!d.fxCommandReady,
      };
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
    const id = setTimeout(() => setQLive(q), 200);
    return () => clearTimeout(id);
  }, [q]);

  const filtered = useMemo(() => {
    const needle = qLive.trim();
    return (groups || [])
      .map((g) => ({
        ...g,
        resources: (g.resources || []).filter(
          (r) => !needle || matchFilter(r.name, needle) || matchFilter(g.folder, needle),
        ),
      }))
      .filter((g) => g.resources.length > 0);
  }, [groups, qLive]);

  const folderKey = useMemo(() => filtered.map((g) => g.folder).join('\0'), [filtered]);

  useEffect(() => {
    setOpen((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const folder of folderKey ? folderKey.split('\0') : []) {
        if (folder && !next.has(folder)) {
          next.add(folder);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folderKey]);

  const totalRes = useMemo(
    () => filtered.reduce((n, g) => n + g.resources.length, 0),
    [filtered],
  );

  function toggle(folder) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function act(name, action) {
    setErr('');
    try {
      await api('/api/resources/action', { method: 'POST', body: { name, action } });
      load();
    } catch (error) { setErr(error.message); }
  }

  const canAct = fxReady && online;

  return (
    <Page className="res-page ws-module-flush">
      <PageHeader
        eyebrow="Betrieb"
        title="Ressourcen"
        description={
          online
            ? `${totalRes} Scripts · ${filtered.length} Ordner · Live`
            : 'Server offline — Status ohne Live-Abgleich'
        }
      />

      <div className="res-toolbar">
        <input
          className="search res-search"
          placeholder="Ordner oder Script suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Ressourcen suchen"
        />
        {q.trim() ? (
          <button type="button" className="res-search-clear" onClick={() => setQ('')} title="Suche leeren">
            ✕
          </button>
        ) : null}
      </div>

      {err && <div className="err res-err">{err}</div>}

      <div className="res-page-list">
        {filtered.length === 0 ? (
          <p className="muted res-empty">Keine Ressourcen{q ? ` für „${q}"` : ''}.</p>
        ) : (
          filtered.map((group) => {
            const expanded = open.has(group.folder);
            const started = group.resources.filter((r) => r.actual === 'started').length;
            const shown = group.resources.length;
            const total = group.count ?? shown;
            return (
              <section key={group.folder} className={`res-group${expanded ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className={`res-group-head${expanded ? ' open' : ''}`}
                  onClick={() => toggle(group.folder)}
                  aria-expanded={expanded}
                >
                  <span className="res-group-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <span className="res-group-title">
                    <span className="mono res-group-folder">{group.folder}</span>
                    <span className="res-group-meta">
                      <span className="res-group-pill">{started}/{shown} läuft</span>
                      {total !== shown ? (
                        <span className="muted res-group-filter">{shown} von {total}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="res-group-body ws-res-list">
                    {group.resources.map((res) => {
                      const tone = statusTone(res.actual);
                      return (
                        <div key={res.name} className="ws-res-row res-row">
                          <span className="mono res-row-name" title={res.name}>{res.name}</span>
                          <span className={`res-status${tone ? ` tone-${tone}` : ''}`}>
                            <i className="res-status-dot" aria-hidden="true" />
                            {statusLabel(res.actual)}
                          </span>
                          <div className="res-row-actions" role="group" aria-label={`Aktionen ${res.name}`}>
                            <button
                              className="res-act res-act-start"
                              type="button"
                              disabled={!canAct}
                              onClick={() => act(res.name, 'start')}
                            >
                              Start
                            </button>
                            <button
                              className="res-act res-act-restart"
                              type="button"
                              disabled={!canAct}
                              onClick={() => act(res.name, 'restart')}
                              title="Neustart"
                              aria-label="Neustart"
                            >
                              ↻
                            </button>
                            <button
                              className="res-act res-act-stop"
                              type="button"
                              disabled={!canAct}
                              onClick={() => act(res.name, 'stop')}
                            >
                              Stop
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </Page>
  );
}
