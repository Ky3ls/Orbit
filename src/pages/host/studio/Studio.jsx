import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Drawer from '../../../components/Drawer.jsx';
import { toast } from '../../../components/toast.jsx';
import { NavIcon } from '../../../layout/icons.jsx';
import StudioEr from './StudioEr.jsx';
import StudioGrid from './StudioGrid.jsx';
import StudioSql, { StudioSearch } from './StudioSql.jsx';
import { ColumnForm, StudioOps, StudioStructure } from './StudioStructure.jsx';
import { fmtBytes, fmtNum, sapi, studioPath } from './studioApi.js';
import '../host.css';
import './studio.css';

const UKEY = (db) => `orbit.studio.unlock.${db}`;

export default function Studio() {
  const { db, table } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [unlock, setUnlock] = useState(() => { try { return sessionStorage.getItem(UKEY(db)) === '1'; } catch { return false; } });
  const [newTable, setNewTable] = useState(false);
  const [jump, setJump] = useState(null);
  const [schema, setSchema] = useState(null);
  const [importing, setImporting] = useState(null);
  const fileRef = useRef(null);
  const view = params.get('view') || (table ? 'data' : 'overview');

  const load = useCallback(() => {
    sapi(studioPath(db)).then((d) => { setInfo(d); setErr(''); }).catch((e) => setErr(e.message));
  }, [db]);
  useEffect(() => { setInfo(null); load(); }, [load]);
  useEffect(() => { if (view === 'sql' && !schema) sapi(studioPath(db, '/relations')).then(setSchema).catch(() => {}); }, [view, db, schema]);

  const writable = !!info && !info.system && (info.managed || unlock);
  const tInfo = info?.tables.find((t) => t.name === table);
  const shown = useMemo(() => (info?.tables || []).filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase())), [info, filter]);
  const maxSize = Math.max(1, ...(info?.tables || []).map((t) => t.size));

  function go(t, v = null, extra = null) {
    navigate(`/host/databases/mysql/${encodeURIComponent(db)}${t ? `/${encodeURIComponent(t)}` : ''}${v ? `?view=${v}` : ''}`);
    setJump(extra);
  }
  function setView(v) { setParams(v === (table ? 'data' : 'overview') ? {} : { view: v }); }

  function toggleUnlock() {
    if (unlock) { setUnlock(false); try { sessionStorage.removeItem(UKEY(db)); } catch { /* */ } return; }
    if (!window.confirm(`„${db}“ wurde nicht von Orbit angelegt — vermutlich nutzt sie eine App oder ein Gameserver.\n\nBearbeiten für diese Sitzung freischalten? Änderungen wirken sofort und lassen sich nicht rückgängig machen.`)) return;
    setUnlock(true);
    try { sessionStorage.setItem(UKEY(db), '1'); } catch { /* */ }
  }

  async function doImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(`${file.name} (${fmtBytes(file.size)}) in „${db}“ einspielen? Vorhandene Tabellen mit gleichem Namen können überschrieben werden.`)) return;
    setImporting(file.name);
    try {
      const out = await sapi(`${studioPath(db, '/import')}${/\.gz$/i.test(file.name) ? '?gz=1' : ''}`, { method: 'POST', raw: file, unlock });
      toast.ok('Import abgeschlossen', { text: `${fmtBytes(out.bytes)} eingespielt` });
      load();
    } catch (er) { toast.err('Import fehlgeschlagen', { text: er.message }); }
    setImporting(null);
  }

  if (err && !info) return <div className="st-page"><div className="err">{err}</div><Link to="/host/databases" className="btn">Zurück</Link></div>;

  return (
    <div className="st-page">
      <header className="st-head">
        <Link to="/host/databases" className="o-icon-btn" title="Zurück zu den Datenbanken"><NavIcon name="collapse" /></Link>
        <span className="st-dbico"><NavIcon name="db" /></span>
        <div className="st-title">
          <h1><Link to={`/host/databases/mysql/${encodeURIComponent(db)}`}>{db}</Link>{table && <><NavIcon name="chevron" /><span>{table}</span></>}</h1>
          <small>
            {info ? `${fmtNum(info.tables.length)} Tabellen · ${fmtNum(info.rows)} Zeilen · ${fmtBytes(info.size)} · ${info.collation}` : 'Lädt…'}
          </small>
        </div>
        {info && (info.system
          ? <span className="mcp-chip warn"><NavIcon name="lock" />Systemdatenbank · nur lesen</span>
          : info.managed
            ? <span className="mcp-chip ok"><i />Von Orbit verwaltet</span>
            : <button type="button" className={`st-lock${unlock ? ' open' : ''}`} onClick={toggleUnlock}><NavIcon name="lock" />{unlock ? 'Bearbeiten freigeschaltet' : 'Schreibgeschützt · freischalten'}</button>)}
        <span className="grow" />
        <input ref={fileRef} type="file" hidden accept=".sql,.gz" onChange={doImport} />
        <button type="button" className="btn btn-sm" disabled={!writable || !!importing} onClick={() => fileRef.current?.click()}><NavIcon name="upload" />{importing ? 'Importiert…' : 'Import'}</button>
        <a className="btn btn-sm" href={`${studioPath(db, '/export')}?format=sql`}><NavIcon name="download" />Dump</a>
      </header>

      <div className="st-body">
        <aside className="st-side card">
          <div className="st-side-search"><NavIcon name="search" /><input placeholder="Tabellen filtern…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <nav className="st-dbnav">
            {[['overview', 'dashboard', 'Übersicht'], ['sql', 'term', 'SQL-Konsole'], ['er', 'layers', 'ER-Diagramm'], ['search', 'search', 'Suche']].map(([v, ic, l]) => (
              <button key={v} type="button" className={!table && view === v ? 'active' : ''} onClick={() => go(null, v === 'overview' ? null : v)}><NavIcon name={ic} />{l}</button>
            ))}
          </nav>
          <div className="st-side-label">
            <span>Tabellen <b>{info?.tables.length ?? ''}</b></span>
            {writable && <button type="button" className="o-icon-btn" title="Neue Tabelle" onClick={() => setNewTable(true)}><NavIcon name="plus" /></button>}
          </div>
          <div className="st-tables">
            {shown.map((t) => (
              <button key={t.name} type="button" className={`st-table${t.name === table ? ' active' : ''}`} onClick={() => go(t.name)} title={t.comment || t.name}>
                <NavIcon name={t.view ? 'layers' : 'list'} />
                <span className="st-table-name">{t.name}</span>
                <small>{t.view ? 'View' : `${t.exact ? '' : '~'}${fmtNum(t.rows)}`}</small>
                <i className="st-table-bar" style={{ width: `${Math.max(2, (t.size / maxSize) * 100)}%` }} />
              </button>
            ))}
            {info && shown.length === 0 && <div className="muted st-none">Keine Tabellen.</div>}
          </div>
        </aside>

        <main className="st-main">
          {table ? (
            <>
              <div className="st-tabs">
                {[['data', 'list', 'Daten'], ['structure', 'cfg', 'Struktur'], ['ops', 'wrench', 'Operationen'], ['sql', 'term', 'SQL']].map(([v, ic, l]) => (
                  <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)}><NavIcon name={ic} />{l}</button>
                ))}
                <span className="grow" />
                {tInfo && <span className="muted st-tabinfo">{tInfo.engine} · {fmtBytes(tInfo.size)}{tInfo.comment ? ` · ${tInfo.comment}` : ''}</span>}
              </div>
              {view === 'data' && <StudioGrid key={`${table}-${JSON.stringify(jump)}`} db={db} table={table} writable={writable && !tInfo?.view} unlock={unlock} initialFilter={jump} onJump={(t, f) => go(t, null, f)} onChanged={load} />}
              {view === 'structure' && <StudioStructure db={db} table={table} writable={writable && !tInfo?.view} unlock={unlock} tables={info?.tables || []} onChanged={load} />}
              {view === 'ops' && <StudioOps db={db} table={table} view={tInfo?.view} writable={writable} unlock={unlock} info={tInfo} onRenamed={(n) => { load(); go(n, 'ops'); }} onDropped={() => { load(); go(null); }} onChanged={load} />}
              {view === 'sql' && <StudioSql db={db} writable={writable} unlock={unlock} tables={info?.tables || []} schema={schema} initial={`SELECT *\nFROM \`${table}\`\nLIMIT 100;`} />}
            </>
          ) : view === 'sql' ? (
            <StudioSql db={db} writable={writable} unlock={unlock} tables={info?.tables || []} schema={schema} />
          ) : view === 'er' ? (
            <StudioEr db={db} onOpen={(t) => go(t, 'structure')} />
          ) : view === 'search' ? (
            <StudioSearch db={db} onOpen={(t, f) => go(t, null, f)} />
          ) : (
            info && <DbOverview db={db} info={info} onOpen={go} maxSize={maxSize} />
          )}
        </main>
      </div>

      {newTable && <NewTable db={db} unlock={unlock} onClose={() => setNewTable(false)} onCreated={(n) => { setNewTable(false); load(); go(n, 'structure'); }} />}
    </div>
  );
}

function DbOverview({ db, info, onOpen, maxSize }) {
  const [users, setUsers] = useState(null);
  useEffect(() => { sapi(studioPath(db, '/users')).then((d) => setUsers(d.users)).catch(() => setUsers([])); }, [db]);
  const top = [...info.tables].sort((a, b) => b.size - a.size).slice(0, 10);
  const recent = [...info.tables].filter((t) => t.updated).sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, 6);
  return (
    <div className="st-ov">
      <div className="st-tiles">
        {[['list', 'Tabellen', fmtNum(info.tables.filter((t) => !t.view).length), `${info.tables.filter((t) => t.view).length} Views`], ['layers', 'Zeilen', fmtNum(info.rows), 'gesamt'], ['db', 'Größe', fmtBytes(info.size), info.charset], ['switch', 'Fremdschlüssel', fmtNum(info.foreignKeys), `${info.routines.length} Routinen · ${info.triggers.length} Trigger`]].map(([ic, l, v, s]) => (
          <div key={l} className="card st-tile"><span className="st-tile-ico"><NavIcon name={ic} /></span><span><b>{v}</b><em>{l}</em><small>{s}</small></span></div>
        ))}
      </div>
      <div className="st-ov-grid">
        <section className="card st-ov-card">
          <h3>Größte Tabellen</h3>
          {top.map((t) => (
            <button key={t.name} type="button" className="st-bar-row" onClick={() => onOpen(t.name)}>
              <span className="mono">{t.name}</span>
              <span className="st-bar"><i style={{ width: `${(t.size / maxSize) * 100}%` }} /></span>
              <small>{fmtBytes(t.size)}</small>
              <small className="muted">{fmtNum(t.rows)}</small>
            </button>
          ))}
          {!top.length && <p className="hx-hint">Noch keine Tabellen.</p>}
        </section>
        <div className="st-ov-col">
          <section className="card st-ov-card">
            <h3>Zuletzt geändert</h3>
            {recent.length ? recent.map((t) => (
              <button key={t.name} type="button" className="st-recent" onClick={() => onOpen(t.name)}><span className="mono">{t.name}</span><small>{new Date(String(t.updated).replace(' ', 'T')).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></button>
            )) : <p className="hx-hint">MySQL liefert dafür keine Zeiten (InnoDB).</p>}
          </section>
          <section className="card st-ov-card">
            <h3>Benutzer mit Zugriff</h3>
            {users === null ? <p className="hx-hint">Lädt…</p> : users.length ? users.map((u) => (
              <div key={`${u.user}@${u.host}`} className="st-user">
                <span className="mono">{u.user}<span className="muted">@{u.host}</span></span>
                <span className="st-privs">{u.privileges.length >= 8 ? <span className="mcp-chip ok">Alle Rechte</span> : u.privileges.map((p) => <span key={p} className="mcp-chip">{p}</span>)}</span>
              </div>
            )) : <p className="hx-hint">Nur root.</p>}
          </section>
          {(info.routines.length > 0 || info.triggers.length > 0) && (
            <section className="card st-ov-card">
              <h3>Routinen &amp; Trigger</h3>
              {info.routines.map((r) => <div key={r.name} className="st-recent"><span className="mono">{r.name}</span><small>{r.type}</small></div>)}
              {info.triggers.map((t) => <div key={t.name} className="st-recent"><span className="mono">{t.name}</span><small>{t.timing} {t.ev} · {t.tbl}</small></div>)}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_COLS = [
  { name: 'id', type: 'INT', unsigned: true, autoIncrement: true, primary: true, nullable: false },
  { name: 'name', type: 'VARCHAR(255)', nullable: false },
  { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP', nullable: false },
];

function NewTable({ db, unlock, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [engine, setEngine] = useState('InnoDB');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const set = (i, patch) => setCols((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await sapi(studioPath(db, '/tables'), { method: 'POST', unlock, body: { name, columns: cols, engine } });
      toast.ok(`Tabelle ${name} angelegt`, { text: out.sql.split('\n')[0] });
      onCreated(name);
    } catch (er) { toast.err(er.message); }
    setBusy(false);
  }
  return (
    <Drawer onClose={onClose} label="Neue Tabelle" width={720}>
      <form className="mcp-form" onSubmit={submit}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Neue Tabelle</h2><div className="pp-sub"><span className="muted">utf8mb4 · Spalten lassen sich später jederzeit ändern</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          <div className="nt-top">
            <label className="mcp-field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/[`\s]/g, '_'))} placeholder="z. B. player_vehicles" required /></label>
            <label className="mcp-field"><span>Engine</span><select value={engine} onChange={(e) => setEngine(e.target.value)}><option>InnoDB</option><option>MyISAM</option></select></label>
          </div>
          <div className="nt-cols">
            <div className="nt-col th"><span>Name</span><span>Typ</span><span>PK</span><span>AI</span><span>NULL</span><span>Standard</span><span /></div>
            {cols.map((c, i) => (
              <div key={i} className="nt-col">
                <input value={c.name} onChange={(e) => set(i, { name: e.target.value.replace(/[`\s]/g, '_') })} placeholder="spalte" />
                <input value={c.type} list="sx-types" onChange={(e) => set(i, { type: e.target.value.toUpperCase() })} className="mono" />
                <input type="checkbox" checked={!!c.primary} onChange={(e) => set(i, { primary: e.target.checked, nullable: e.target.checked ? false : c.nullable })} />
                <input type="checkbox" checked={!!c.autoIncrement} disabled={!/int/i.test(c.type)} onChange={(e) => set(i, { autoIncrement: e.target.checked })} />
                <input type="checkbox" checked={!!c.nullable} disabled={c.primary} onChange={(e) => set(i, { nullable: e.target.checked })} />
                <input value={c.default ?? ''} onChange={(e) => set(i, { default: e.target.value })} placeholder="—" />
                <span className="nt-acts">
                  <button type="button" className="o-icon-btn" title="Mehr Optionen" onClick={() => setEdit(i)}><NavIcon name="cfg" /></button>
                  <button type="button" className="o-icon-btn danger" title="Entfernen" onClick={() => setCols((x) => x.filter((_, j) => j !== i))}><NavIcon name="trash" /></button>
                </span>
              </div>
            ))}
            <datalist id="sx-types">{['INT', 'BIGINT', 'TINYINT(1)', 'DECIMAL(10,2)', 'VARCHAR(255)', 'VARCHAR(64)', 'CHAR(36)', 'TEXT', 'LONGTEXT', 'JSON', 'DATETIME', 'TIMESTAMP', 'DATE', 'BOOLEAN', 'BLOB'].map((t) => <option key={t} value={t} />)}</datalist>
            <button type="button" className="btn btn-sm nt-add" onClick={() => setCols((c) => [...c, { name: '', type: 'VARCHAR(255)', nullable: true }])}><NavIcon name="plus" />Spalte</button>
          </div>
          <div className="nt-presets">
            <span>Vorlagen:</span>
            <button type="button" className="mcp-chip" onClick={() => setCols(DEFAULT_COLS)}>Standard</button>
            <button type="button" className="mcp-chip" onClick={() => setCols([{ name: 'identifier', type: 'VARCHAR(64)', primary: true, nullable: false }, { name: 'data', type: 'JSON', nullable: true }, { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP', onUpdateNow: true, nullable: false }])}>Spieler-Daten (FiveM)</button>
            <button type="button" className="mcp-chip" onClick={() => setCols([{ name: 'uuid', type: 'CHAR(36)', primary: true, nullable: false }, { name: 'name', type: 'VARCHAR(16)', index: true, nullable: false }, { name: 'balance', type: 'DECIMAL(15,2)', default: '0', nullable: false }])}>Minecraft-Plugin</button>
            <button type="button" className="mcp-chip" onClick={() => setCols([{ name: 'id', type: 'BIGINT', unsigned: true, autoIncrement: true, primary: true, nullable: false }, { name: 'level', type: "ENUM('info','warn','error')", default: 'info', nullable: false }, { name: 'message', type: 'TEXT', nullable: false }, { name: 'created_at', type: 'DATETIME', default: 'CURRENT_TIMESTAMP', nullable: false }])}>Log</button>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !name || !cols.some((c) => c.name)}>{busy ? 'Legt an…' : 'Tabelle anlegen'}</button>
        </div>
      </form>
      {edit !== null && cols[edit] && (
        <Drawer onClose={() => setEdit(null)} label="Spalte" width={500}>
          <form className="mcp-form" onSubmit={(e) => { e.preventDefault(); setEdit(null); }}>
            <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Spalte {cols[edit].name}</h2></div><button type="button" className="pp-close" onClick={() => setEdit(null)}><NavIcon name="x" /></button></div></header>
            <div className="pp-scroll">
              <ColumnEditInline col={cols[edit]} onChange={(patch) => set(edit, patch)} />
              <label className="so-check"><input type="checkbox" checked={!!cols[edit].unique} onChange={(e) => set(edit, { unique: e.target.checked })} />Eindeutig (UNIQUE)</label>
              <label className="so-check"><input type="checkbox" checked={!!cols[edit].index} onChange={(e) => set(edit, { index: e.target.checked })} />Index</label>
              <button type="submit" className="btn btn-primary">Fertig</button>
            </div>
          </form>
        </Drawer>
      )}
    </Drawer>
  );
}

function ColumnEditInline({ col, onChange }) {
  return (
    <>
      <label className="mcp-field"><span>Kommentar</span><input value={col.comment || ''} onChange={(e) => onChange({ comment: e.target.value })} /></label>
      {/int|decimal|float|double/i.test(col.type) && <label className="so-check"><input type="checkbox" checked={!!col.unsigned} onChange={(e) => onChange({ unsigned: e.target.checked })} />Unsigned (keine negativen Werte)</label>}
      {/timestamp|datetime/i.test(col.type) && <label className="so-check"><input type="checkbox" checked={!!col.onUpdateNow} onChange={(e) => onChange({ onUpdateNow: e.target.checked })} />Bei Änderung automatisch aktualisieren</label>}
    </>
  );
}

export { ColumnForm };
