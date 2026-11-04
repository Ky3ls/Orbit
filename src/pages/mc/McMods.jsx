import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import Drawer from '../../components/Drawer.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META } from './mcShared.js';

function fmtCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Mio.`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
function fmtSize(b) {
  if (!b) return '';
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

export default function McMods({ inst, noun, onRestart }) {
  const [data, setData] = useState(null);
  const [updates, setUpdates] = useState(null);
  const [browse, setBrowse] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('');
  const [view, setView] = useState('all');
  const [pending, setPending] = useState(false);
  const fileRef = useRef(null);
  const one = noun === 'Plugins' ? 'Plugin' : 'Mod';
  const running = !!inst.status.pid;

  const load = useCallback(() => {
    api(`/api/mc/instances/${inst.id}/mods`).then(setData).catch((e) => toast.err(e.message));
  }, [inst.id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!browse) return undefined;
    const id = setTimeout(() => {
      setResults(null);
      api(`/api/mc/instances/${inst.id}/mods/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch((e) => { setResults({ hits: [], total: 0 }); toast.err(e.message); });
    }, 250);
    return () => clearTimeout(id);
  }, [browse, q, inst.id]);

  const changed = (d) => { if (d?.restartNeeded) setPending(true); };

  async function install(hit) {
    setBusy(hit.id);
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/install`, { method: 'POST', body: { projectId: hit.id } });
      toast.ok(`${hit.title} installiert`, { text: d.added.length > 1 ? `Inkl. Abhängigkeiten: ${d.added.slice(1).join(', ')}` : undefined });
      changed(d);
      setResults((r) => r && { ...r, hits: r.hits.map((h) => (h.id === hit.id ? { ...h, installed: true } : h)) });
      load();
    } catch (e) { toast.err(`${hit.title}: ${e.message}`); }
    setBusy('');
  }
  async function toggle(m) {
    try {
      changed(await api(`/api/mc/instances/${inst.id}/mods/toggle`, { method: 'POST', body: { file: m.file, enabled: !m.enabled } }));
      load();
    } catch (e) { toast.err(e.message); }
  }
  async function remove(m) {
    if (!window.confirm(`${m.title} entfernen?`)) return;
    try {
      changed(await api(`/api/mc/instances/${inst.id}/mods?file=${encodeURIComponent(m.file)}`, { method: 'DELETE' }));
      toast.ok(`${m.title} entfernt`);
      load();
    } catch (e) { toast.err(e.message); }
  }
  async function checkUpdates() {
    setBusy('updates');
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/updates`);
      setUpdates(d.updates || {});
      const n = Object.keys(d.updates || {}).length;
      toast(n ? `${n} Update${n === 1 ? '' : 's'} verfügbar` : `Alle ${noun} sind aktuell`);
      if (n) setView('updates');
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }
  async function update(m) {
    const u = updates?.[m.file];
    if (!u) return;
    setBusy(m.file);
    try {
      changed(await api(`/api/mc/instances/${inst.id}/mods/update`, { method: 'POST', body: { file: m.file, projectId: u.projectId } }));
      toast.ok(`${m.title} → ${u.version}`);
      setUpdates((x) => { const n = { ...x }; delete n[m.file]; return n; });
      load();
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }
  async function updateAll() {
    for (const m of (data?.items || []).filter((x) => updates?.[x.file])) {
      // eslint-disable-next-line no-await-in-loop
      await update(m);
    }
  }
  async function upload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      setBusy('upload');
      try {
        const res = await fetch(`/api/mc/instances/${inst.id}/mods/upload?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'X-TX2-Client': '1' },
          body: file,
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Upload fehlgeschlagen');
        toast.ok(`${d.file} hochgeladen`);
        changed(d);
      } catch (err) { toast.err(err.message); }
    }
    setBusy('');
    load();
  }

  const all = data?.items || [];
  const counts = {
    all: all.length,
    on: all.filter((m) => m.enabled).length,
    off: all.filter((m) => !m.enabled).length,
    updates: updates ? Object.keys(updates).length : null,
  };
  const items = useMemo(() => all.filter((m) => {
    if (view === 'on' && !m.enabled) return false;
    if (view === 'off' && m.enabled) return false;
    if (view === 'updates' && !updates?.[m.file]) return false;
    if (view === 'manual' && !m.manual) return false;
    return !filter || `${m.title} ${m.file} ${m.description}`.toLowerCase().includes(filter.toLowerCase());
  }), [all, view, filter, updates]);

  const tiles = [
    { id: 'all', label: `${noun} gesamt`, value: counts.all, icon: 'box' },
    { id: 'on', label: 'Aktiv', value: counts.on, icon: 'check', tone: 'ok' },
    { id: 'off', label: 'Deaktiviert', value: counts.off, icon: 'stop', tone: 'idle' },
    { id: 'updates', label: 'Updates', value: counts.updates ?? '?', icon: 'refresh', tone: counts.updates ? 'warn' : 'idle' },
  ];

  return (
    <div className="mm">
      {pending && running && (
        <div className="mm-restart banner warn">
          <NavIcon name="restart" />
          <span>Änderungen an {noun} werden erst nach einem Neustart aktiv.</span>
          <button type="button" className="btn btn-sm" onClick={() => { onRestart?.(); setPending(false); }}>Jetzt neu starten</button>
        </div>
      )}

      <div className="mm-tiles">
        {tiles.map((t) => (
          <button key={t.id} type="button" className={`mm-tile tone-${t.tone || 'accent'}${view === t.id ? ' active' : ''}`} onClick={() => (t.id === 'updates' && counts.updates === null ? checkUpdates() : setView(view === t.id && t.id !== 'all' ? 'all' : t.id))}>
            <span className="mm-tile-ico"><NavIcon name={t.icon} /></span>
            <span><b>{t.value}</b><small>{t.label}{t.id === 'updates' && counts.updates === null ? ' — prüfen' : ''}</small></span>
          </button>
        ))}
      </div>

      <div className="mm-bar">
        <div className="lg-search"><NavIcon name="search" /><input placeholder={`${noun} filtern…`} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="seg">
          {[['all', 'Alle'], ['on', 'Aktiv'], ['off', 'Aus'], ['manual', 'Manuell']].map(([id, l]) => (
            <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{l}</button>
          ))}
        </div>
        <span className="grow" />
        {counts.updates ? <button type="button" className="btn btn-sm mci-upd" disabled={!!busy} onClick={updateAll}><NavIcon name="refresh" />Alle aktualisieren</button> : null}
        <button type="button" className="btn btn-sm" disabled={busy === 'updates'} onClick={checkUpdates}><NavIcon name="refresh" />{busy === 'updates' ? 'Prüft…' : 'Updates prüfen'}</button>
        <button type="button" className="btn btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}><NavIcon name="external" />.jar hochladen</button>
        <input ref={fileRef} type="file" accept=".jar" multiple hidden onChange={upload} />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setBrowse(true)}><NavIcon name="plus" />{one} hinzufügen</button>
      </div>

      {!data ? <div className="mcx-loading">Lädt…</div> : all.length === 0 ? (
        <div className="card sch2-empty mm-empty">
          <NavIcon name="box" />
          <b>Noch keine {noun}</b>
          <span>Durchsuche Modrinth — Orbit zeigt nur {noun}, die zu {TYPE_META[inst.type]?.label} {inst.mcVersion} passen, und installiert Abhängigkeiten automatisch.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setBrowse(true)}><NavIcon name="search" />{noun} durchsuchen</button>
        </div>
      ) : items.length === 0 ? (
        <div className="card"><Empty title="Keine Treffer" text="Filter ändern oder zurücksetzen." /></div>
      ) : (
        <div className="mm-grid">
          {items.map((m) => (
            <article key={m.file} className={`mm-card card${m.enabled ? '' : ' off'}${updates?.[m.file] ? ' upd' : ''}`}>
              <div className="mm-card-top">
                {m.icon ? <img src={m.icon} alt="" loading="lazy" /> : <span className="mm-ico"><NavIcon name="box" /></span>}
                <div className="mm-card-title">
                  <b title={m.title}>{m.title}</b>
                  <span className="mono" title={m.file}>{m.version || m.file}</span>
                </div>
                <button type="button" role="switch" aria-checked={m.enabled} aria-label={m.enabled ? 'Deaktivieren' : 'Aktivieren'} className={`switch${m.enabled ? ' on' : ''}`} onClick={() => toggle(m)} />
              </div>
              {m.description ? <p className="mm-desc">{m.description}</p> : <p className="mm-desc muted">{m.manual ? 'Manuell hinzugefügte Datei' : 'Keine Beschreibung'}</p>}
              <div className="mm-tags">
                {!m.enabled && <span className="tag">deaktiviert</span>}
                {m.dependency && <span className="tag mm-dep">Abhängigkeit</span>}
                {m.manual && <span className="tag">manuell</span>}
                {(m.categories || []).slice(0, 3).map((c) => <span key={c} className="tag">{c}</span>)}
              </div>
              <footer className="mm-card-foot">
                <span className="muted">{fmtSize(m.size)}</span>
                <span className="grow" />
                {updates?.[m.file] ? (
                  <button type="button" className="btn btn-sm mci-upd" disabled={busy === m.file} onClick={() => update(m)}><NavIcon name="refresh" />{updates[m.file].version}</button>
                ) : null}
                {m.slug ? (
                  <a className="o-icon-btn" href={`https://modrinth.com/${noun === 'Plugins' ? 'plugin' : 'mod'}/${m.slug}`} target="_blank" rel="noreferrer" title="Auf Modrinth öffnen"><NavIcon name="external" /></a>
                ) : null}
                <button type="button" className="o-icon-btn" title="Entfernen" onClick={() => remove(m)}><NavIcon name="x" /></button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {browse && (
        <Drawer label={`${noun} hinzufügen`} width={680} onClose={() => setBrowse(false)}>
          <header className="pp-head">
            <div className="pp-top">
              <span className="mci-mr"><NavIcon name="search" /></span>
              <div className="pp-title">
                <h2>{noun} hinzufügen</h2>
                <div className="pp-sub"><span className="pp-state">Modrinth · passend zu {TYPE_META[inst.type]?.label} {inst.mcVersion}</span></div>
              </div>
              <button type="button" className="pp-close" aria-label="Schließen" onClick={() => setBrowse(false)}><NavIcon name="x" /></button>
            </div>
            <div className="pl-search mci-browse-search">
              <NavIcon name="search" />
              <input autoFocus placeholder={`${one} suchen, z. B. ${noun === 'Plugins' ? 'LuckPerms, EssentialsX, WorldEdit' : 'Lithium, Create, JEI'}`} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </header>
          <div className="pp-scroll">
            {!results ? <div className="mcx-loading">Suche…</div> : results.hits.length === 0 ? (
              <Empty title="Nichts gefunden" text="Andere Suchbegriffe probieren — es werden nur kompatible Versionen angezeigt." />
            ) : (
              <>
                <p className="muted mci-count">{q ? `${results.total} Treffer` : 'Beliebteste'}</p>
                <ul className="mci-results">
                  {results.hits.map((h) => (
                    <li key={h.id}>
                      {h.icon ? <img src={h.icon} alt="" loading="lazy" /> : <span className="mci-modico"><NavIcon name="box" /></span>}
                      <div className="mci-res-text">
                        <b>{h.title}<small> von {h.author}</small></b>
                        <p>{h.description}</p>
                        <div className="mci-res-meta">
                          <span><NavIcon name="external" />{fmtCount(h.downloads)}</span>
                          {h.categories.map((c) => <span key={c} className="tag">{c}</span>)}
                        </div>
                      </div>
                      {h.installed ? (
                        <span className="badge ok">Installiert</span>
                      ) : (
                        <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => install(h)}>
                          {busy === h.id ? 'Lädt…' : 'Installieren'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
