import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import Drawer from '../../components/Drawer.jsx';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty, Page } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META, fmtDur, fmtMb, phaseOf, serverAddress } from './mcShared.js';
import './mc.css';

const TABS = [
  { id: 'console', label: 'Übersicht & Konsole', icon: 'term' },
  { id: 'mods', label: 'Mods', icon: 'box' },
  { id: 'properties', label: 'server.properties', icon: 'cfg' },
  { id: 'instance', label: 'Instanz', icon: 'gear' },
];
const QUICK = ['list', 'save-all', 'time set day', 'weather clear', 'tps'];

function fmtCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Mio.`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/* ── Konsole ── */
function Console({ inst }) {
  const [lines, setLines] = useState([]);
  const [cmd, setCmd] = useState('');
  const [hist, setHist] = useState([]);
  const [hi, setHi] = useState(-1);
  const [follow, setFollow] = useState(true);
  const offset = useRef(null);
  const box = useRef(null);
  const running = !!inst.status.pid;

  useEffect(() => {
    let alive = true;
    offset.current = null;
    setLines([]);
    const tick = () => {
      const q = offset.current == null ? '' : `?offset=${offset.current}`;
      api(`/api/mc/instances/${inst.id}/console${q}`).then((d) => {
        if (!alive) return;
        offset.current = d.offset;
        if (d.reset) setLines(d.lines);
        else if (d.lines.length) setLines((prev) => [...prev, ...d.lines].slice(-1500));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [inst.id]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  async function send(text) {
    const c = String(text ?? cmd).trim().replace(/^\//, '');
    if (!c) return;
    try {
      await api(`/api/mc/instances/${inst.id}/command`, { method: 'POST', body: { command: c } });
      setHist((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50));
      setHi(-1);
      if (text == null) setCmd('');
    } catch (e) {
      toast.err(e.message);
    }
  }

  return (
    <section className="mci-console card">
      <header>
        <span className={`lg-live${running ? '' : ' paused'}`}><i />{running ? 'Live' : 'Offline'}</span>
        <div className="mci-quick">
          {QUICK.map((q) => <button key={q} type="button" className="lc-chip" disabled={!running} onClick={() => send(q)}>{q}</button>)}
        </div>
        <button type="button" className={`btn btn-sm${follow ? ' mci-on' : ''}`} onClick={() => setFollow((v) => !v)}>Auto-Scroll</button>
      </header>
      <div
        className="mci-term"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {lines.length === 0 ? <div className="lc-empty">{running ? 'Warte auf Ausgabe…' : 'Server ist offline. Starte ihn, um die Konsole zu sehen.'}</div> : null}
        {lines.map((l, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className={`mci-line lvl-${l.level}`}>{l.t}</div>
        ))}
      </div>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="mono"
          value={cmd}
          disabled={!running}
          placeholder={running ? 'Befehl eingeben (ohne /) — ↑ für Verlauf' : 'Server ist offline'}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); const n = Math.min(hi + 1, hist.length - 1); setHi(n); setCmd(hist[n]); }
            if (e.key === 'ArrowDown' && hi >= 0) { e.preventDefault(); const n = hi - 1; setHi(n); setCmd(n < 0 ? '' : hist[n]); }
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </section>
  );
}

/* ── Mods / Plugins ── */
function Mods({ inst, noun }) {
  const [data, setData] = useState(null);
  const [updates, setUpdates] = useState(null);
  const [browse, setBrowse] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('');
  const fileRef = useRef(null);
  const one = noun === 'Plugins' ? 'Plugin' : 'Mod';

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

  const restartHint = (d) => { if (d?.restartNeeded) toast.warn('Neustart nötig', { text: 'Änderungen greifen nach einem Server-Neustart.' }); };

  async function install(hit) {
    setBusy(hit.id);
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/install`, { method: 'POST', body: { projectId: hit.id } });
      toast.ok(`${hit.title} installiert`, { text: d.added.length > 1 ? `Inkl. Abhängigkeiten: ${d.added.slice(1).join(', ')}` : undefined });
      restartHint(d);
      setResults((r) => r && { ...r, hits: r.hits.map((h) => (h.id === hit.id ? { ...h, installed: true } : h)) });
      load();
    } catch (e) {
      toast.err(`${hit.title}: ${e.message}`);
    }
    setBusy('');
  }

  async function toggle(m) {
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/toggle`, { method: 'POST', body: { file: m.file, enabled: !m.enabled } });
      restartHint(d);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function remove(m) {
    if (!window.confirm(`${m.title} entfernen?`)) return;
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods?file=${encodeURIComponent(m.file)}`, { method: 'DELETE' });
      toast.ok(`${m.title} entfernt`);
      restartHint(d);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function checkUpdates() {
    setBusy('updates');
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/updates`);
      setUpdates(d.updates || {});
      const n = Object.keys(d.updates || {}).length;
      toast(n ? `${n} Update${n === 1 ? '' : 's'} verfügbar` : 'Alles aktuell');
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }

  async function update(m) {
    const u = updates?.[m.file];
    if (!u) return;
    setBusy(m.file);
    try {
      const d = await api(`/api/mc/instances/${inst.id}/mods/update`, { method: 'POST', body: { file: m.file, projectId: u.projectId } });
      toast.ok(`${m.title} → ${u.version}`);
      restartHint(d);
      setUpdates((x) => { const n = { ...x }; delete n[m.file]; return n; });
      load();
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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
      restartHint(d);
      load();
    } catch (err) { toast.err(err.message); }
    setBusy('');
  }

  const items = (data?.items || []).filter((m) => !filter || m.title.toLowerCase().includes(filter.toLowerCase()));
  const enabled = (data?.items || []).filter((m) => m.enabled).length;

  return (
    <>
      <section className="mci-mods card">
        <header className="mci-mods-head">
          <div>
            <h2>Installierte {noun}</h2>
            <p>{data ? `${data.items.length} gesamt · ${enabled} aktiv` : 'Lädt…'}</p>
          </div>
          <div className="mci-mods-actions">
            <div className="lg-search"><NavIcon name="search" /><input placeholder="Filtern…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
            <button type="button" className="btn btn-sm" disabled={busy === 'updates'} onClick={checkUpdates}><NavIcon name="refresh" />Updates prüfen</button>
            <button type="button" className="btn btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}><NavIcon name="external" />.jar hochladen</button>
            <input ref={fileRef} type="file" accept=".jar" hidden onChange={upload} />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setBrowse(true)}><NavIcon name="plus" />{one} hinzufügen</button>
          </div>
        </header>
        {data && data.items.length === 0 ? (
          <div className="sch2-empty">
            <NavIcon name="box" />
            <b>Noch keine {noun}</b>
            <span>Durchsuche Modrinth — Orbit zeigt nur {noun}, die zu {TYPE_META[inst.type]?.label} {inst.mcVersion} passen.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setBrowse(true)}><NavIcon name="search" />{noun} durchsuchen</button>
          </div>
        ) : (
          <ul className="mci-modlist">
            {items.map((m) => (
              <li key={m.file} className={m.enabled ? '' : 'off'}>
                {m.icon ? <img src={m.icon} alt="" loading="lazy" /> : <span className="mci-modico"><NavIcon name="box" /></span>}
                <div className="mci-modtext">
                  <b>{m.title}{m.dependency ? <em>Abhängigkeit</em> : null}{m.manual ? <em>manuell</em> : null}</b>
                  <span className="mono">{m.version || m.file}</span>
                </div>
                {updates?.[m.file] ? (
                  <button type="button" className="btn btn-sm mci-upd" disabled={busy === m.file} onClick={() => update(m)}><NavIcon name="refresh" />{updates[m.file].version}</button>
                ) : null}
                <span className="mci-size">{fmtMb(Math.round(m.size / 1048576 * 10) / 10)}</span>
                <button type="button" role="switch" aria-checked={m.enabled} aria-label={m.enabled ? 'Deaktivieren' : 'Aktivieren'} className={`switch${m.enabled ? ' on' : ''}`} onClick={() => toggle(m)} />
                <button type="button" className="o-icon-btn" title="Entfernen" onClick={() => remove(m)}><NavIcon name="x" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {browse && (
        <Drawer label={`${noun} hinzufügen`} width={640} onClose={() => setBrowse(false)}>
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
              <input autoFocus placeholder={`${one} suchen, z. B. ${noun === 'Plugins' ? 'LuckPerms, EssentialsX' : 'Lithium, Create, JEI'}`} value={q} onChange={(e) => setQ(e.target.value)} />
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
    </>
  );
}

/* ── server.properties ── */
function Properties({ inst }) {
  const [schema, setSchema] = useState([]);
  const [saved, setSaved] = useState(null);
  const [values, setValues] = useState({});
  const [raw, setRaw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/mc/instances/${inst.id}/properties`).then((d) => {
      setSchema(d.schema || []);
      setSaved(d.values || {});
      setValues(d.values || {});
    }).catch((e) => toast.err(e.message));
  }, [inst.id]);

  const groups = useMemo(() => {
    const out = new Map();
    for (const f of schema) {
      if (!out.has(f.group)) out.set(f.group, []);
      out.get(f.group).push(f);
    }
    return [...out.entries()];
  }, [schema]);
  const known = new Set(schema.map((f) => f.key));
  const extra = Object.keys(values).filter((k) => !known.has(k)).sort();
  const dirtyKeys = saved ? Object.keys(values).filter((k) => values[k] !== saved[k]) : [];
  const set = (k, v) => setValues((x) => ({ ...x, [k]: String(v) }));

  async function save() {
    setBusy(true);
    try {
      const patch = Object.fromEntries(dirtyKeys.map((k) => [k, values[k]]));
      const d = await api(`/api/mc/instances/${inst.id}/properties`, { method: 'PUT', body: { values: patch } });
      setSaved(d.values);
      setValues(d.values);
      toast.ok('server.properties gespeichert', { text: d.restartNeeded ? 'Greift nach einem Neustart.' : undefined });
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  if (!saved) return <div className="mcx-loading">Lädt…</div>;
  if (!Object.keys(saved).length) return <div className="card"><Empty title="Noch keine server.properties" text="Die Datei entsteht beim ersten Start des Servers." /></div>;

  const field = (f) => {
    const v = values[f.key] ?? '';
    if (f.type === 'bool') {
      return <button type="button" role="switch" aria-checked={v === 'true'} className={`switch${v === 'true' ? ' on' : ''}`} onClick={() => set(f.key, v === 'true' ? 'false' : 'true')} />;
    }
    if (f.type === 'select') {
      return (
        <select value={v} onChange={(e) => set(f.key, e.target.value)}>
          {!f.options.includes(v) && v ? <option value={v}>{v}</option> : null}
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return <input type={f.type === 'number' ? 'number' : 'text'} min={f.min} max={f.max} value={v} readOnly={f.readonly} onChange={(e) => set(f.key, e.target.value)} className={f.type === 'number' ? 'sx-num' : ''} />;
  };

  return (
    <div className="sx-stack">
      <div className="mci-props-bar">
        <div className="seg">
          <button type="button" className={raw ? '' : 'active'} onClick={() => setRaw(false)}>Formular</button>
          <button type="button" className={raw ? 'active' : ''} onClick={() => setRaw(true)}>Alle Schlüssel</button>
        </div>
        <span className="muted">Port ändert man unter „Instanz“.</span>
      </div>
      {!raw ? groups.map(([g, fields]) => (
        <section key={g} className="sx-card">
          <header className="sx-card-head"><div><h3>{g}</h3></div></header>
          <div className="sx-card-body">
            {fields.map((f) => (
              <div key={f.key} className="sx-row">
                <div className="sx-row-text"><b>{f.label}</b><span className="mono">{f.key}</span></div>
                <div className="sx-row-ctl">{field(f)}</div>
              </div>
            ))}
          </div>
        </section>
      )) : (
        <section className="sx-card">
          <div className="sx-card-body">
            {[...schema.map((f) => f.key), ...extra].filter((k) => k in values).map((k) => (
              <div key={k} className="sx-row">
                <div className="sx-row-text"><b className="mono">{k}</b></div>
                <div className="sx-row-ctl"><input className="mono" value={values[k] ?? ''} readOnly={k === 'server-port' || k === 'query.port'} onChange={(e) => set(k, e.target.value)} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
      {dirtyKeys.length > 0 && (
        <div className="sx-savebar" role="status">
          <span className="sx-savebar-dot" />
          <span className="sx-savebar-text">{dirtyKeys.length} ungespeicherte Änderung{dirtyKeys.length === 1 ? '' : 'en'}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setValues(saved)}>Verwerfen</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? 'Speichert…' : 'Speichern'}</button>
        </div>
      )}
    </div>
  );
}

/* ── Instanz-Einstellungen ── */
function InstanceSettings({ inst, onChange }) {
  const navigate = useNavigate();
  const [ram, setRam] = useState(null);
  const [ramMb, setRamMb] = useState(inst.ramMb);
  const [name, setName] = useState(inst.name);
  const [port, setPort] = useState(inst.port);
  const [java, setJava] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/mc/ram-suggest?id=${inst.id}`).then(setRam).catch(() => {});
    api(`/api/mc/java?mc=${encodeURIComponent(inst.mcVersion)}`).then(setJava).catch(() => {});
  }, [inst.id, inst.mcVersion]);

  async function patch(body, msg) {
    setBusy(true);
    try {
      const d = await api(`/api/mc/instances/${inst.id}`, { method: 'PATCH', body });
      onChange(d.instance);
      toast.ok(msg, { text: inst.status.pid ? 'Greift nach einem Neustart.' : undefined });
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  async function del() {
    const files = window.confirm(`„${inst.name}“ löschen?\n\nOK = inklusive aller Dateien (Welt, Mods, Configs)\nAbbrechen = nichts tun`);
    if (!files) return;
    const typed = window.prompt(`Zum Bestätigen den Namen eingeben: ${inst.name}`);
    if (typed !== inst.name) { toast.err('Abgebrochen — Name stimmt nicht.'); return; }
    try {
      await api(`/api/mc/instances/${inst.id}`, { method: 'DELETE', body: { deleteFiles: true } });
      toast.ok(`${inst.name} gelöscht`);
      navigate('/instances');
    } catch (e) { toast.err(e.message); }
  }

  const max = Math.max(ram?.max || 16384, ramMb);
  return (
    <div className="sx-stack">
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Arbeitsspeicher</h3><p>Orbit empfiehlt anhand von Typ, installierten {inst.modKind || 'Erweiterungen'}, Slots und Sichtweite.</p></div></header>
        <div className="sx-card-body mci-ram">
          <div className="mci-ram-row">
            <b>{fmtMb(ramMb)}</b>
            {ram ? (ramMb === ram.recommended
              ? <span className="badge ok">Empfehlung</span>
              : <button type="button" className="mcx-reset" onClick={() => setRamMb(ram.recommended)}>Empfehlung: {fmtMb(ram.recommended)}</button>) : null}
            <span className="grow" />
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || ramMb === inst.ramMb} onClick={() => patch({ ramMb }, 'RAM gespeichert')}>Übernehmen</button>
          </div>
          <input
            type="range"
            className="mcx-ram-slider"
            min={1024}
            max={max}
            step={512}
            value={ramMb}
            onChange={(e) => setRamMb(Number(e.target.value))}
            style={{ '--pct': `${((ramMb - 1024) / (max - 1024)) * 100}%`, '--rec': `${(((ram?.recommended || 1024) - 1024) / (max - 1024)) * 100}%` }}
          />
          {ram ? <ul className="mci-reasons">{ram.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
        </div>
      </section>
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Allgemein</h3></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>Name</b></div>
            <div className="sx-row-ctl mci-inline"><input value={name} onChange={(e) => setName(e.target.value)} /><button type="button" className="btn btn-sm" disabled={busy || name === inst.name} onClick={() => patch({ name }, 'Name gespeichert')}>Speichern</button></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Port</b><span>Nur bei gestopptem Server änderbar.</span></div>
            <div className="sx-row-ctl mci-inline"><input type="number" value={port} className="sx-num" disabled={!!inst.status.pid} onChange={(e) => setPort(Number(e.target.value))} /><button type="button" className="btn btn-sm" disabled={busy || port === inst.port || !!inst.status.pid} onClick={() => patch({ port }, 'Port gespeichert')}>Speichern</button></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Java</b><span>{java?.required ? `Minecraft ${inst.mcVersion} braucht Java ${java.required}` : ''}</span></div>
            <div className="sx-row-ctl">
              <select value={inst.javaMajor || ''} disabled={busy} onChange={(e) => patch({ javaMajor: Number(e.target.value) }, `Java ${e.target.value} gesetzt`)}>
                {[...new Set([...(java?.installed || []).map((j) => j.major), java?.required].filter(Boolean))].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>Java {m}{m === java?.required ? ' (empfohlen)' : ''}{(java?.installed || []).some((j) => j.major === m) ? '' : ' — wird geladen'}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Autostart</b><span>Startet automatisch, wenn Orbit startet.</span></div>
            <div className="sx-row-ctl"><button type="button" role="switch" aria-checked={inst.autostart} className={`switch${inst.autostart ? ' on' : ''}`} onClick={() => patch({ autostart: !inst.autostart }, 'Autostart gespeichert')} /></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Crash-Neustart</b><span>Nach einem Absturz automatisch neu starten (max. 3× in 10 Min.).</span></div>
            <div className="sx-row-ctl"><button type="button" role="switch" aria-checked={inst.autoRestart} className={`switch${inst.autoRestart ? ' on' : ''}`} onClick={() => patch({ autoRestart: !inst.autoRestart }, 'Gespeichert')} /></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Ordner</b></div>
            <div className="sx-row-ctl"><code className="mci-path">{inst.path}</code></div>
          </div>
        </div>
      </section>
      <section className="sx-card tone-bad">
        <header className="sx-card-head"><div><h3>Gefahrenzone</h3><p>Löscht die Instanz samt Welt, Mods und Configs. Nicht umkehrbar.</p></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>Instanz löschen</b><span>{inst.status.pid ? 'Zuerst den Server stoppen.' : ''}</span></div>
            <div className="sx-row-ctl"><button type="button" className="btn btn-sm btn-danger" disabled={!!inst.status.pid} onClick={del}>Löschen</button></div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function McInstance() {
  const { id, tab = 'console' } = useParams();
  const navigate = useNavigate();
  const [inst, setInst] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api(`/api/mc/instances/${id}`).then((d) => { setInst(d.instance); setErr(''); }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    setInst(null);
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function control(action) {
    setBusy(action);
    try {
      await api(`/api/mc/instances/${id}/control`, { method: 'POST', body: { action } });
      toast.ok({ start: 'Server startet', stop: 'Server gestoppt', restart: 'Server neu gestartet', kill: 'Prozess beendet' }[action]);
      load();
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }

  if (err && !inst) return <Page><div className="err">{err}</div><Link to="/instances" className="btn">Zur Übersicht</Link></Page>;
  if (!inst) return <Page><div className="mcx-loading">Lädt…</div></Page>;

  const tm = TYPE_META[inst.type] || {};
  const ph = phaseOf(inst);
  const st = inst.status;
  const tabs = TABS.filter((t) => t.id !== 'mods' || inst.modKind).map((t) => (t.id === 'mods' ? { ...t, label: inst.modKind } : t));
  const addr = serverAddress(inst);

  return (
    <Page className="mcx-page mci-page">
      <section className={`mci-hero card tone-${ph.tone}`}>
        <GameMark game="minecraft" color={tm.color} size={60} />
        <div className="mci-hero-main">
          <div className="mci-hero-top">
            <h1>{inst.name}</h1>
            <span className={`mcx-state tone-${ph.tone}`}><i />{ph.label}</span>
          </div>
          <div className="mci-hero-facts">
            <span className="tag" style={{ color: tm.color, borderColor: `${tm.color}66` }}>{tm.label}</span>
            <span>Minecraft {inst.mcVersion}</span>
            {inst.loaderVersion ? <span className="mono">{inst.type === 'paper' || inst.type === 'purpur' ? `Build ${inst.loaderVersion}` : `${TYPE_META[inst.type]?.label} ${inst.loaderVersion}`}</span> : null}
            <button type="button" className="mci-addr" title="Adresse kopieren" onClick={() => navigator.clipboard?.writeText(addr).then(() => toast.ok('Adresse kopiert', { text: addr }))}>
              <NavIcon name="globe" /><span className="mono">{addr}</span><NavIcon name="copy" />
            </button>
          </div>
        </div>
        <div className="mci-hero-ctl">
          {inst.state !== 'ready' ? null : st.pid ? (
            <>
              <button type="button" className="btn" disabled={!!busy} onClick={() => control('restart')}><NavIcon name="restart" />Neustart</button>
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => control('stop')}><NavIcon name="stop" />{busy === 'stop' ? 'Stoppt…' : 'Stoppen'}</button>
              {st.phase === 'stopping' || busy === 'stop' ? <button type="button" className="btn btn-ghost" onClick={() => control('kill')}>Erzwingen</button> : null}
            </>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => control('start')}><NavIcon name="play" />{busy === 'start' ? 'Startet…' : 'Starten'}</button>
          )}
        </div>
      </section>

      {inst.state === 'failed' && <div className="err">Die Installation ist fehlgeschlagen. Lösche die Instanz unter „Instanz“ und lege sie neu an.</div>}

      <div className="mci-kpis">
        <div><span><NavIcon name="users" />Spieler</span><b>{st.online ? st.players : '–'}<small> / {st.maxPlayers ?? '–'}</small></b></div>
        <div><span><NavIcon name="cpu" />CPU</span><b>{st.pid ? `${st.cpu}%` : '–'}</b></div>
        <div>
          <span><NavIcon name="memory" />RAM</span>
          <b>{st.pid ? fmtMb(st.rssMb) : '–'}<small> · Heap-Limit {fmtMb(inst.ramMb)}</small></b>
          <i className="mci-meter"><em style={{ width: `${st.pid ? Math.min(100, (st.rssMb / (inst.ramMb * 1.35)) * 100) : 0}%` }} /></i>
        </div>
        <div><span><NavIcon name="clock" />Uptime</span><b>{st.startedAt ? fmtDur(Date.now() - st.startedAt) : '–'}</b></div>
      </div>

      <div className="pp-tabs mci-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => navigate(`/mc/${inst.id}${t.id === 'console' ? '' : `/${t.id}`}`)}>
            <NavIcon name={t.icon} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'console' && (
        <div className="mci-overview">
          <Console inst={inst} />
          <aside className="mci-players card">
            <header><h3>Spieler online</h3><span className="dash-count">{st.online ? st.players : 0}</span></header>
            {!st.online ? (
              <div className="dash-empty"><NavIcon name="power" /><span>{st.pid ? 'Server startet…' : 'Server ist offline.'}</span></div>
            ) : st.sample.length === 0 ? (
              <div className="dash-empty"><NavIcon name="users" /><span>{st.players ? `${st.players} Spieler online` : 'Niemand online.'}</span></div>
            ) : (
              <ul>
                {st.sample.map((n) => (
                  <li key={n}>
                    <img src={`https://mc-heads.net/avatar/${encodeURIComponent(n)}/28`} alt="" loading="lazy" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
            {st.version ? <footer><span>Version</span><b>{st.version}</b></footer> : null}
          </aside>
        </div>
      )}
      {tab === 'mods' && inst.modKind && <Mods inst={inst} noun={inst.modKind} />}
      {tab === 'properties' && <Properties inst={inst} />}
      {tab === 'instance' && <InstanceSettings inst={inst} onChange={setInst} />}
    </Page>
  );
}
