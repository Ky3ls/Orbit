import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, Page, PageHeader } from '../components/Ui.jsx';

function matchFilter(text, q) {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}

export default function Resources() {
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [online, setOnline] = useState(false);
  const [fxReady, setFxReady] = useState(false);
  const [open, setOpen] = useState(() => new Set());

  function load() {
    api('/api/resources').then((d) => {
      setGroups(d.groups || []);
      setOnline(d.online);
      setFxReady(!!d.fxCommandReady);
    }).catch((e) => setErr(e.message));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim();
    return (groups || [])
      .map((g) => ({
        ...g,
        resources: (g.resources || []).filter(
          (r) => !needle || matchFilter(r.name, needle) || matchFilter(g.folder, needle),
        ),
      }))
      .filter((g) => g.resources.length > 0);
  }, [groups, q]);

  const folderKey = useMemo(() => filtered.map((g) => g.folder).join('\0'), [filtered]);

  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev);
      for (const g of filtered) next.add(g.folder);
      return next;
    });
  }, [folderKey, filtered]);

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

  return (
    <Page className="res-page ws-module-flush">
      <PageHeader
        eyebrow="Betrieb"
        title="Ressourcen"
        description={
          online
            ? `${totalRes} Scripts in ${filtered.length} Ordnern · Live von info.json`
            : 'Server offline — Ressourcen-Status ist „offline“ (kein Live-Abgleich)'
        }
        actions={(
          <input
            className="search"
            placeholder="Ordner oder Script…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      />
      {err && <div className="err" style={{ margin: 16 }}>{err}</div>}

      <div className="res-page-list">
        {filtered.length === 0 ? (
          <p className="muted res-empty">Keine Ressourcen{q ? ` für „${q}"` : ''}.</p>
        ) : (
          filtered.map((group) => {
            const expanded = open.has(group.folder);
            const started = group.resources.filter((r) => r.actual === 'started').length;
            return (
              <section key={group.folder} className="res-group">
                <button
                  type="button"
                  className={`res-group-head${expanded ? ' open' : ''}`}
                  onClick={() => toggle(group.folder)}
                  aria-expanded={expanded}
                >
                  <span className="res-group-title">
                    <span className="mono res-group-folder">{group.folder}</span>
                    <span className="muted res-group-meta">
                      {started}/{group.resources.length} gestartet
                      {group.count !== group.resources.length ? ` · ${group.resources.length} angezeigt` : ''}
                    </span>
                  </span>
                  <span className="res-group-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
                </button>
                {expanded && (
                  <div className="res-group-body ws-res-list">
                    {group.resources.map((res) => (
                      <div key={res.name} className="ws-res-row res-row">
                        <span className="mono res-row-name">{res.name}</span>
                        <Badge
                          tone={res.actual === 'started' ? 'ok' : res.actual === 'stopped' ? 'bad' : res.actual === 'offline' ? 'warn' : ''}
                        >
                          {res.actual === 'offline' ? 'offline' : res.actual}
                        </Badge>
                        <div className="res-row-actions">
                          <button className="res-act" type="button" disabled={!fxReady || !online} onClick={() => act(res.name, 'start')}>Start</button>
                          <button className="res-act res-act-icon" type="button" disabled={!fxReady || !online} onClick={() => act(res.name, 'restart')} title="Restart" aria-label="Restart">↻</button>
                          <button className="res-act" type="button" disabled={!fxReady || !online} onClick={() => act(res.name, 'stop')}>Stop</button>
                        </div>
                      </div>
                    ))}
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
