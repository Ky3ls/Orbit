import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import CfgCode from '../../components/CfgCode.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';

function SaveBar({ count, busy, onSave, onDiscard }) {
  if (!count) return null;
  return (
    <div className="sx-savebar" role="status">
      <span className="sx-savebar-dot" />
      <span className="sx-savebar-text">{count} ungespeicherte Änderung{count === 1 ? '' : 'en'}</span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onDiscard}>Verwerfen</button>
      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onSave}>{busy ? 'Speichert…' : 'Speichern'}</button>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} />;
}

/* ── server.properties ── */
function Properties({ inst }) {
  const [schema, setSchema] = useState([]);
  const [saved, setSaved] = useState(null);
  const [values, setValues] = useState({});
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

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
  if (!Object.keys(saved).length) return <Empty title="Noch keine server.properties" text="Die Datei entsteht beim ersten Start des Servers." />;

  const field = (f) => {
    const v = values[f.key] ?? '';
    if (f.type === 'bool') return <Toggle on={v === 'true'} label={f.label} onChange={(on) => set(f.key, on ? 'true' : 'false')} />;
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
  const keys = Object.keys(values).sort().filter((k) => !q || k.includes(q.toLowerCase()));

  return (
    <div className="sx-stack">
      <div className="mcs-bar">
        <div className="seg">
          <button type="button" className={all ? '' : 'active'} onClick={() => setAll(false)}>Wichtige</button>
          <button type="button" className={all ? 'active' : ''} onClick={() => setAll(true)}>Alle Schlüssel ({Object.keys(values).length})</button>
        </div>
        {all ? <div className="lg-search"><NavIcon name="search" /><input placeholder="Schlüssel suchen…" value={q} onChange={(e) => setQ(e.target.value)} /></div> : <span className="muted">Port ändert man unter „Instanz“.</span>}
      </div>
      {!all ? groups.map(([g, fields]) => (
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
            {keys.map((k) => (
              <div key={k} className="sx-row">
                <div className="sx-row-text"><b className="mono">{k}</b></div>
                <div className="sx-row-ctl">
                  {values[k] === 'true' || values[k] === 'false'
                    ? <Toggle on={values[k] === 'true'} label={k} onChange={(on) => set(k, on ? 'true' : 'false')} />
                    : <input className="mono" value={values[k] ?? ''} readOnly={k === 'server-port' || k === 'query.port'} onChange={(e) => set(k, e.target.value)} />}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <SaveBar count={dirtyKeys.length} busy={busy} onSave={save} onDiscard={() => setValues(saved)} />
    </div>
  );
}

/* ── YAML-Configs (Paper/Spigot/Bukkit/Purpur) ── */
function YamlConfig({ inst, meta }) {
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (d) => {
    setData(d);
    setText(d.raw || '');
    setValues(Object.fromEntries(d.groups.flatMap((g) => g.fields).map((f) => [f.path, f.value])));
  };
  useEffect(() => {
    setData(null);
    setRaw(false);
    api(`/api/mc/instances/${inst.id}/configs/${meta.id}`).then(apply).catch((e) => toast.err(e.message));
  }, [inst.id, meta.id]);

  if (!data) return <div className="mcx-loading">Lädt…</div>;
  if (!data.exists) return <Empty title={`${meta.file} existiert noch nicht`} text="Die Datei wird beim ersten Start des Servers angelegt. Danach kannst du sie hier einstellen." />;

  const fields = data.groups.flatMap((g) => g.fields);
  const dirtyKeys = fields.filter((f) => String(values[f.path]) !== String(f.value)).map((f) => f.path);
  const rawDirty = text !== data.raw;

  async function save() {
    setBusy(true);
    try {
      const body = raw ? { raw: text } : { values: Object.fromEntries(dirtyKeys.map((k) => [k, values[k]])) };
      const d = await api(`/api/mc/instances/${inst.id}/configs/${meta.id}`, { method: 'PUT', body });
      apply(d);
      toast.ok(`${meta.label} gespeichert`, { text: d.restartNeeded ? 'Greift nach einem Neustart.' : undefined });
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  return (
    <div className="sx-stack">
      <div className="mcs-bar">
        <div className="seg">
          <button type="button" className={raw ? '' : 'active'} onClick={() => { if (!rawDirty || window.confirm('Ungespeicherte Änderungen im Editor verwerfen?')) { setRaw(false); setText(data.raw); } }}>Wichtige Einstellungen</button>
          <button type="button" className={raw ? 'active' : ''} onClick={() => { if (!dirtyKeys.length || window.confirm('Ungespeicherte Formular-Änderungen verwerfen?')) { setRaw(true); apply(data); } }}>Datei bearbeiten</button>
        </div>
        <code className="mono muted">{meta.file}</code>
      </div>
      {!raw ? (
        data.groups.length === 0 ? (
          <Empty title="Keine bekannten Einstellungen gefunden" text="Diese Version nutzt andere Schlüssel — über „Datei bearbeiten“ hast du vollen Zugriff." />
        ) : data.groups.map((g) => (
          <section key={g.label} className="sx-card">
            <header className="sx-card-head"><div><h3>{g.label}</h3></div></header>
            <div className="sx-card-body">
              {g.fields.map((f) => (
                <div key={f.path} className="sx-row">
                  <div className="sx-row-text"><b>{f.label}</b><span>{f.hint ? `${f.hint} · ` : ''}<code className="mono">{f.path}</code></span></div>
                  <div className="sx-row-ctl">
                    {f.type === 'bool' ? (
                      <Toggle on={values[f.path] === true || values[f.path] === 'true'} label={f.label} onChange={(on) => setValues((x) => ({ ...x, [f.path]: on }))} />
                    ) : f.type === 'select' ? (
                      <select value={String(values[f.path])} onChange={(e) => setValues((x) => ({ ...x, [f.path]: e.target.value }))}>
                        {f.options.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input type="number" step={f.step || 1} className="sx-num" value={values[f.path] ?? ''} onChange={(e) => setValues((x) => ({ ...x, [f.path]: e.target.value }))} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="mcs-editor card">
          <CfgCode value={text} onChange={(e) => setText(e.target.value)} dirty={rawDirty} lang="data" langLabel="YAML" ariaLabel={meta.file} footerHint="Wird vor dem Speichern auf gültiges YAML geprüft" />
        </div>
      )}
      <SaveBar
        count={raw ? (rawDirty ? 1 : 0) : dirtyKeys.length}
        busy={busy}
        onSave={save}
        onDiscard={() => apply(data)}
      />
    </div>
  );
}

export default function McSettings({ inst }) {
  const [configs, setConfigs] = useState([]);
  const [sel, setSel] = useState('properties');

  useEffect(() => {
    api(`/api/mc/instances/${inst.id}/configs`).then((d) => setConfigs(d.configs || [])).catch(() => setConfigs([]));
  }, [inst.id]);

  const items = [
    { id: 'properties', label: 'server.properties', hint: 'Spielmodus, Slots, Welt, Zugang', file: 'server.properties', exists: true },
    ...configs,
  ];
  const meta = items.find((i) => i.id === sel) || items[0];

  return (
    <div className="mcs">
      <nav className="mcs-nav" aria-label="Konfigurationsdateien">
        <span className="sx-nav-label">Konfiguration</span>
        {items.map((i) => (
          <button key={i.id} type="button" className={`mcs-item${sel === i.id ? ' active' : ''}${i.exists ? '' : ' missing'}`} onClick={() => setSel(i.id)}>
            <NavIcon name="cfg" />
            <span><b>{i.label}</b><small>{i.exists ? i.hint : 'Wird beim ersten Start angelegt'}</small></span>
          </button>
        ))}
        {!configs.length && inst.modKind === 'Mods' ? (
          <p className="mcs-note">Mod-Configs liegen im Ordner <code>config/</code> — bearbeitbar über den Tab „Dateien“.</p>
        ) : null}
      </nav>
      <div className="mcs-main">
        {meta.id === 'properties' ? <Properties inst={inst} /> : <YamlConfig key={meta.id} inst={inst} meta={meta} />}
      </div>
    </div>
  );
}
