import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../../components/Drawer.jsx';
import { toast } from '../../../components/toast.jsx';
import { NavIcon } from '../../../layout/icons.jsx';
import { copy } from '../hostShared.jsx';
import { TYPE_GROUPS, fmtBytes, fmtNum, sapi, studioPath, typeTone } from './studioApi.js';

function useStructure(db, table) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    sapi(studioPath(db, `/t/${encodeURIComponent(table)}/structure`)).then((d) => { setS(d); setErr(''); }).catch((e) => setErr(e.message));
  }, [db, table]);
  useEffect(() => { setS(null); load(); }, [load]);
  return [s, err, load];
}

async function alter(db, table, unlock, body, okText) {
  const out = await sapi(studioPath(db, `/t/${encodeURIComponent(table)}/alter`), { method: 'POST', unlock, body });
  toast.ok(okText, { text: out.sql?.slice(0, 160) });
  return out;
}

export function StudioStructure({ db, table, writable, unlock, tables, onChanged }) {
  const [s, err, load] = useStructure(db, table);
  const [colEdit, setColEdit] = useState(null);
  const [idxNew, setIdxNew] = useState(false);
  const [fkNew, setFkNew] = useState(false);

  async function run(body, okText) {
    try { await alter(db, table, unlock, body, okText); load(); onChanged?.(); } catch (e) { toast.err('Fehlgeschlagen', { text: e.message }); }
  }

  if (err) return <div className="err">{err}</div>;
  if (!s) return <div className="mcx-loading">Lädt Struktur…</div>;

  return (
    <div className="ss">
      <section className="card ss-card">
        <header className="ss-head">
          <h3>Spalten <span className="seg-n">{s.columns.length}</span></h3>
          {writable && <button type="button" className="btn btn-sm btn-primary" onClick={() => setColEdit({ mode: 'new' })}><NavIcon name="plus" />Spalte</button>}
        </header>
        <div className="ss-cols">
          <div className="ss-col th"><span>#</span><span>Name</span><span>Typ</span><span>Null</span><span>Standard</span><span>Extra</span><span /></div>
          {s.columns.map((c, i) => {
            const fk = s.foreignKeys.find((f) => f.col === c.name);
            return (
              <div key={c.name} className="ss-col">
                <span className="muted">{i + 1}</span>
                <span className="ss-name">
                  {s.pk.includes(c.name) && <span className="ss-key pk" title="Primärschlüssel"><NavIcon name="lock" /></span>}
                  {fk && <span className="ss-key fk" title={`→ ${fk.refTable}.${fk.refCol}`}><NavIcon name="switch" /></span>}
                  {!s.pk.includes(c.name) && c.key === 'UNI' && <span className="ss-key uni" title="Eindeutig">U</span>}
                  {!s.pk.includes(c.name) && c.key === 'MUL' && !fk && <span className="ss-key idx" title="Index">I</span>}
                  <b className="mono">{c.name}</b>
                  {c.comment && <small className="muted" title={c.comment}>{c.comment}</small>}
                </span>
                <span><code className={`ss-type t-${typeTone(c.dataType)}`} title={c.type}>{c.type}</code></span>
                <span>{c.nullable ? <span className="mcp-chip">NULL</span> : <span className="muted">—</span>}</span>
                <span className="mono ss-def">{c.default === null ? (c.nullable ? <em className="muted">NULL</em> : <span className="muted">—</span>) : c.default}</span>
                <span className="muted ss-extra">{c.extra}</span>
                <span className="hx-acts">
                  {writable && <button type="button" className="o-icon-btn" title="Bearbeiten" onClick={() => setColEdit({ mode: 'edit', col: c })}><NavIcon name="cfg" /></button>}
                  {writable && <button type="button" className="o-icon-btn danger" title="Löschen" onClick={() => { if (window.confirm(`Spalte „${c.name}“ mit allen Werten löschen?`)) run({ op: 'dropColumn', column: c.name }, `Spalte ${c.name} gelöscht`); }}><NavIcon name="trash" /></button>}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="ss-grid">
        <section className="card ss-card">
          <header className="ss-head">
            <h3>Indizes <span className="seg-n">{s.indexes.length}</span></h3>
            {writable && <button type="button" className="btn btn-sm" onClick={() => setIdxNew(true)}><NavIcon name="plus" />Index</button>}
          </header>
          {s.indexes.length === 0 ? <p className="hx-hint ss-pad">Keine Indizes — Abfragen auf großen Tabellen werden langsam.</p> : s.indexes.map((ix) => (
            <div key={ix.name} className="ss-row">
              <span className={`ss-key ${ix.name === 'PRIMARY' ? 'pk' : ix.unique ? 'uni' : 'idx'}`}>{ix.name === 'PRIMARY' ? <NavIcon name="lock" /> : ix.unique ? 'U' : 'I'}</span>
              <span className="ss-row-main"><b className="mono">{ix.name}</b><small>{ix.columns.join(', ')} · {ix.type}{ix.cardinality ? ` · ~${fmtNum(ix.cardinality)} Werte` : ''}</small></span>
              {writable && <button type="button" className="o-icon-btn danger" onClick={() => { if (window.confirm(`Index ${ix.name} löschen?`)) run({ op: 'dropIndex', name: ix.name }, 'Index gelöscht'); }}><NavIcon name="trash" /></button>}
            </div>
          ))}
        </section>

        <section className="card ss-card">
          <header className="ss-head">
            <h3>Beziehungen <span className="seg-n">{s.foreignKeys.length + s.referencedBy.length}</span></h3>
            {writable && <button type="button" className="btn btn-sm" onClick={() => setFkNew(true)}><NavIcon name="plus" />Fremdschlüssel</button>}
          </header>
          {s.foreignKeys.map((f) => (
            <div key={f.name + f.col} className="ss-row">
              <span className="ss-key fk"><NavIcon name="arrowRight" /></span>
              <span className="ss-row-main"><b className="mono">{f.col} → {f.refTable}.{f.refCol}</b><small>{f.name} · beim Löschen {f.onDelete} · beim Ändern {f.onUpdate}</small></span>
              {writable && <button type="button" className="o-icon-btn danger" onClick={() => { if (window.confirm(`Fremdschlüssel ${f.name} entfernen?`)) run({ op: 'dropForeignKey', name: f.name }, 'Fremdschlüssel entfernt'); }}><NavIcon name="trash" /></button>}
            </div>
          ))}
          {s.referencedBy.map((f) => (
            <div key={`r${f.name}${f.tbl}`} className="ss-row">
              <span className="ss-key ref"><NavIcon name="collapse" /></span>
              <span className="ss-row-main"><b className="mono">{f.tbl}.{f.col} → {f.refCol}</b><small>verweist auf diese Tabelle · {f.name}</small></span>
            </div>
          ))}
          {!s.foreignKeys.length && !s.referencedBy.length && <p className="hx-hint ss-pad">Keine Fremdschlüssel. Im ER-Diagramm zeigt Orbit vermutete Beziehungen (z. B. <span className="mono">user_id</span>).</p>}
        </section>
      </div>

      <section className="card ss-card">
        <header className="ss-head"><h3>CREATE-Statement</h3><button type="button" className="btn btn-sm" onClick={() => copy(s.create, 'SQL kopiert')}><NavIcon name="copy" />Kopieren</button></header>
        <pre className="hx-cfg ss-create">{s.create}</pre>
      </section>

      {colEdit && <ColumnForm mode={colEdit.mode} col={colEdit.col} cols={s.columns} onClose={() => setColEdit(null)} onSave={async (body) => { await run(body, colEdit.mode === 'new' ? 'Spalte hinzugefügt' : 'Spalte geändert'); setColEdit(null); }} />}
      {idxNew && <IndexForm cols={s.columns} onClose={() => setIdxNew(false)} onSave={async (b) => { await run({ op: 'addIndex', ...b }, 'Index angelegt'); setIdxNew(false); }} />}
      {fkNew && <FkForm db={db} cols={s.columns} tables={tables} onClose={() => setFkNew(false)} onSave={async (b) => { await run({ op: 'addForeignKey', ...b }, 'Fremdschlüssel angelegt'); setFkNew(false); }} />}
    </div>
  );
}

function splitType(t) {
  const m = String(t || '').match(/^(\w+)(\(.*\))?\s*(unsigned)?/i);
  return m ? { base: `${m[1].toUpperCase()}${m[2] || ''}`, unsigned: !!m[3] } : { base: 'VARCHAR(255)', unsigned: false };
}

export function ColumnForm({ mode, col, cols, onClose, onSave, inline = false }) {
  const st = col ? splitType(col.type) : { base: 'VARCHAR(255)', unsigned: false };
  const [f, setF] = useState({
    name: col?.name || '',
    type: st.base,
    unsigned: st.unsigned,
    nullable: col ? col.nullable : true,
    default: col?.default ?? '',
    autoIncrement: !!col?.autoIncrement,
    comment: col?.comment || '',
    after: '',
    onUpdateNow: /on update/i.test(col?.extra || ''),
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const body = (
    <>
      <label className="mcp-field"><span>Name</span><input autoFocus value={f.name} onChange={(e) => set('name', e.target.value.replace(/[`\s]/g, '_'))} placeholder="z. B. created_at" required /></label>
      <label className="mcp-field"><span>Typ</span><input list="sx-types" value={f.type} onChange={(e) => set('type', e.target.value.toUpperCase())} className="mono" /></label>
      <datalist id="sx-types">{TYPE_GROUPS.flatMap(([, ts]) => ts).map((t) => <option key={t} value={t} />)}</datalist>
      <div className="ss-typechips">
        {TYPE_GROUPS.map(([g, ts]) => (
          <div key={g}><small>{g}</small>{ts.map((t) => <button key={t} type="button" className={`mcp-chip${f.type === t ? ' info' : ''}`} onClick={() => set('type', t)}>{t}</button>)}</div>
        ))}
      </div>
      <label className="mcp-field"><span>Standardwert</span><input value={f.default ?? ''} onChange={(e) => set('default', e.target.value)} placeholder="leer = keiner · CURRENT_TIMESTAMP · NULL" /></label>
      <div className="ss-toggles">
        <label><input type="checkbox" checked={f.nullable} onChange={(e) => set('nullable', e.target.checked)} />NULL erlaubt</label>
        {/int/i.test(f.type) && <label><input type="checkbox" checked={f.autoIncrement} onChange={(e) => set('autoIncrement', e.target.checked)} />Auto-Increment</label>}
        {/int|decimal|float|double/i.test(f.type) && <label><input type="checkbox" checked={f.unsigned} onChange={(e) => set('unsigned', e.target.checked)} />Unsigned</label>}
        {/timestamp|datetime/i.test(f.type) && <label><input type="checkbox" checked={f.onUpdateNow} onChange={(e) => set('onUpdateNow', e.target.checked)} />Bei Änderung aktualisieren</label>}
      </div>
      {mode === 'new' && cols && (
        <label className="mcp-field"><span>Position</span>
          <select value={f.after} onChange={(e) => set('after', e.target.value)}>
            <option value="">Am Ende</option>
            <option value="__first">Ganz vorne</option>
            {cols.map((c) => <option key={c.name} value={c.name}>nach {c.name}</option>)}
          </select>
        </label>
      )}
      <label className="mcp-field"><span>Kommentar</span><input value={f.comment} onChange={(e) => set('comment', e.target.value)} /></label>
    </>
  );
  if (inline) return body;
  return (
    <Drawer onClose={onClose} label="Spalte" width={520}>
      <form className="mcp-form" onSubmit={(e) => { e.preventDefault(); const column = { ...f, default: f.default === '' ? (f.nullable ? null : undefined) : f.default }; onSave(mode === 'new' ? { op: 'addColumn', column, after: f.after } : { op: 'modifyColumn', from: col.name, column }); }}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>{mode === 'new' ? 'Neue Spalte' : `Spalte ${col.name}`}</h2><div className="pp-sub"><span className="muted">ALTER TABLE — bei großen Tabellen kann das dauern</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">{body}<button type="submit" className="btn btn-primary">{mode === 'new' ? 'Hinzufügen' : 'Speichern'}</button></div>
      </form>
    </Drawer>
  );
}

function IndexForm({ cols, onClose, onSave }) {
  const [kind, setKind] = useState('index');
  const [sel, setSel] = useState([]);
  const [name, setName] = useState('');
  return (
    <Drawer onClose={onClose} label="Index" width={460}>
      <form className="mcp-form" onSubmit={(e) => { e.preventDefault(); onSave({ kind, columns: sel, name: name || undefined }); }}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Neuer Index</h2><div className="pp-sub"><span className="muted">Reihenfolge der Spalten = Klick-Reihenfolge</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          <div className="seg">{[['index', 'Index'], ['unique', 'Eindeutig'], ['primary', 'Primärschlüssel'], ['fulltext', 'Volltext']].map(([k, l]) => <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
          <div className="ss-pick">
            {cols.map((c) => {
              const i = sel.indexOf(c.name);
              return <button key={c.name} type="button" className={`ss-pickcol${i >= 0 ? ' on' : ''}`} onClick={() => setSel((s) => (i >= 0 ? s.filter((x) => x !== c.name) : [...s, c.name]))}>{i >= 0 && <span>{i + 1}</span>}<b className="mono">{c.name}</b><small>{c.type}</small></button>;
            })}
          </div>
          {kind !== 'primary' && <label className="mcp-field"><span>Name (optional)</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`idx_${sel.join('_')}`} /></label>}
          <button type="submit" className="btn btn-primary" disabled={!sel.length}>Anlegen</button>
        </div>
      </form>
    </Drawer>
  );
}

function FkForm({ db, cols, tables, onClose, onSave }) {
  const [f, setF] = useState({ column: cols[0]?.name || '', refTable: '', refCol: '', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
  const [refCols, setRefCols] = useState([]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!f.refTable) return;
    sapi(studioPath(db, `/t/${encodeURIComponent(f.refTable)}/structure`)).then((s) => { setRefCols(s.columns); set('refCol', s.pk[0] || s.columns[0]?.name || ''); }).catch(() => setRefCols([]));
  }, [db, f.refTable]);
  const rules = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];
  return (
    <Drawer onClose={onClose} label="Fremdschlüssel" width={480}>
      <form className="mcp-form" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Fremdschlüssel</h2><div className="pp-sub"><span className="muted">Verknüpft eine Spalte mit einer anderen Tabelle</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          <label className="mcp-field"><span>Spalte</span><select value={f.column} onChange={(e) => set('column', e.target.value)}>{cols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}</select></label>
          <label className="mcp-field"><span>Verweist auf Tabelle</span><select value={f.refTable} onChange={(e) => set('refTable', e.target.value)} required><option value="">— wählen —</option>{tables.filter((t) => !t.view).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></label>
          {refCols.length > 0 && <label className="mcp-field"><span>Spalte dort</span><select value={f.refCol} onChange={(e) => set('refCol', e.target.value)}>{refCols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}</select></label>}
          <label className="mcp-field"><span>Beim Löschen</span><select value={f.onDelete} onChange={(e) => set('onDelete', e.target.value)}>{rules.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="mcp-field"><span>Beim Ändern</span><select value={f.onUpdate} onChange={(e) => set('onUpdate', e.target.value)}>{rules.map((r) => <option key={r}>{r}</option>)}</select></label>
          <p className="hx-hint">Typen beider Spalten müssen exakt passen (z. B. beide INT UNSIGNED) und die Zielspalte braucht einen Index.</p>
          <button type="submit" className="btn btn-primary" disabled={!f.refTable || !f.refCol}>Anlegen</button>
        </div>
      </form>
    </Drawer>
  );
}

/** Tabellen-Operationen */
export function StudioOps({ db, table, view, writable, unlock, info, onRenamed, onDropped, onChanged }) {
  const [to, setTo] = useState(table);
  const [copyTo, setCopyTo] = useState(`${table}_kopie`);
  const [withData, setWithData] = useState(true);
  const [comment, setComment] = useState(info?.comment || '');
  async function run(body, okText, after) {
    try { const out = await alter(db, table, unlock, body, okText); after?.(out); onChanged?.(); } catch (e) { toast.err('Fehlgeschlagen', { text: e.message }); }
  }
  return (
    <div className="so">
      <div className="so-facts">
        <div><span>Zeilen</span><b>{fmtNum(info?.rows)}</b></div>
        <div><span>Größe</span><b>{fmtBytes(info?.size)}</b></div>
        <div><span>Engine</span><b>{info?.engine || '—'}</b></div>
        <div><span>Kollation</span><b className="mono">{info?.collation || '—'}</b></div>
        <div><span>Auto-Increment</span><b>{info?.autoInc ? fmtNum(info.autoInc) : '—'}</b></div>
        <div><span>Ungenutzt</span><b>{fmtBytes(info?.free)}</b></div>
      </div>
      {!writable && <div className="mcp-note"><NavIcon name="lock" /><span>Schreibgeschützt — Operationen erst nach dem Freischalten.</span></div>}
      <div className="so-grid">
        <section className="card so-card">
          <h4><NavIcon name="cfg" />Umbenennen</h4>
          <div className="so-row"><input value={to} onChange={(e) => setTo(e.target.value)} disabled={!writable} /><button type="button" className="btn btn-sm" disabled={!writable || !to || to === table} onClick={() => run({ op: 'rename', to }, 'Umbenannt', () => onRenamed?.(to))}>Umbenennen</button></div>
        </section>
        {!view && (
          <section className="card so-card">
            <h4><NavIcon name="copy" />Kopieren</h4>
            <div className="so-row"><input value={copyTo} onChange={(e) => setCopyTo(e.target.value)} disabled={!writable} /><button type="button" className="btn btn-sm" disabled={!writable || !copyTo} onClick={() => run({ op: 'copy', to: copyTo, withData }, `Kopie ${copyTo} angelegt`)}>Kopieren</button></div>
            <label className="so-check"><input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} />mit allen Daten</label>
          </section>
        )}
        {!view && (
          <section className="card so-card">
            <h4><NavIcon name="log" />Kommentar</h4>
            <div className="so-row"><input value={comment} onChange={(e) => setComment(e.target.value)} disabled={!writable} placeholder="Wofür ist die Tabelle?" /><button type="button" className="btn btn-sm" disabled={!writable} onClick={() => run({ op: 'comment', comment }, 'Kommentar gespeichert')}>Speichern</button></div>
          </section>
        )}
        {!view && (
          <section className="card so-card">
            <h4><NavIcon name="bolt" />Wartung</h4>
            <div className="so-btns">
              <button type="button" className="btn btn-sm" disabled={!writable} onClick={() => run({ op: 'optimize' }, 'Optimiert')}>Optimieren</button>
              <button type="button" className="btn btn-sm" disabled={!writable} onClick={() => run({ op: 'analyze' }, 'Analysiert')}>Analysieren</button>
              {['InnoDB', 'MyISAM'].filter((e) => e !== info?.engine).map((e) => <button key={e} type="button" className="btn btn-sm" disabled={!writable} onClick={() => { if (window.confirm(`Engine auf ${e} umstellen?`)) run({ op: 'engine', engine: e }, `Engine: ${e}`); }}>→ {e}</button>)}
            </div>
          </section>
        )}
      </div>
      <section className="card so-card danger">
        <h4><NavIcon name="trash" />Gefahrenzone</h4>
        <div className="so-btns">
          {!view && <button type="button" className="btn btn-sm hx-warnbtn" disabled={!writable} onClick={() => { if (window.prompt(`Alle Zeilen aus „${table}“ löschen (TRUNCATE)? Name eingeben:`) === table) run({ op: 'truncate' }, 'Tabelle geleert'); }}>Leeren (TRUNCATE)</button>}
          <button type="button" className="btn btn-sm btn-danger" disabled={!writable} onClick={() => { if (window.prompt(`${view ? 'View' : 'Tabelle'} „${table}“ endgültig löschen? Name eingeben:`) === table) run({ op: 'drop', view }, 'Gelöscht', () => onDropped?.()); }}>{view ? 'View löschen' : 'Tabelle löschen'}</button>
        </div>
      </section>
    </div>
  );
}
