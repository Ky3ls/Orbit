import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer.jsx';
import { toast } from '../../../components/toast.jsx';
import { NavIcon } from '../../../layout/icons.jsx';
import { cellText, fmtNum, keyOf, parseFilter, sapi, studioPath, typeTone } from './studioApi.js';

const PAGE_SIZES = [50, 100, 250, 500];

/** Daten-Tabelle mit Inline-Bearbeitung, Filtern, Sortierung, Mehrfachauswahl */
export default function StudioGrid({ db, table, writable, unlock, onJump, initialFilter, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState(null);
  const [dir, setDir] = useState('asc');
  const [q, setQ] = useState('');
  const [colFilters, setColFilters] = useState(() => (initialFilter ? { [initialFilter.col]: initialFilter.contains ?? `=${initialFilter.val}` } : {}));
  const [sel, setSel] = useState(() => new Set());
  const [edits, setEdits] = useState({}); // rowIndex → { col: value }
  const [editing, setEditing] = useState(null); // { r, c }
  const [rowForm, setRowForm] = useState(null); // { mode: 'edit'|'new', row }
  const [cell, setCell] = useState(null); // Detailansicht
  const qTimer = useRef(null);
  const [qLive, setQLive] = useState('');

  const filters = useMemo(() => Object.entries(colFilters).map(([c, v]) => parseFilter(c, v)).filter(Boolean), [colFilters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ offset, limit, dir, q: qLive });
      if (sort) params.set('sort', sort);
      if (filters.length) params.set('filters', JSON.stringify(filters));
      const d = await sapi(studioPath(db, `/t/${encodeURIComponent(table)}/rows?${params}`));
      setData(d);
      setErr('');
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [db, table, offset, limit, sort, dir, qLive, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSel(new Set()); setEdits({}); setEditing(null); }, [data?.rows]);
  useEffect(() => { setOffset(0); }, [qLive, filters, limit, sort, dir]);

  const cols = data?.columns || [];
  const fkMap = useMemo(() => Object.fromEntries((data?.foreignKeys || []).map((f) => [f.col, f])), [data]);
  const dirty = Object.keys(edits).length;

  function toggleSort(c) {
    if (sort !== c) { setSort(c); setDir('asc'); } else if (dir === 'asc') setDir('desc'); else { setSort(null); setDir('asc'); }
  }

  function setEdit(r, c, v) {
    setEdits((e) => {
      const orig = data.rows[r][c];
      const next = { ...e, [r]: { ...(e[r] || {}), [c]: v } };
      if ((v === null && orig === null) || (v !== null && orig !== null && String(v) === String(orig))) {
        delete next[r][c];
        if (!Object.keys(next[r]).length) delete next[r];
      }
      return next;
    });
  }

  async function saveEdits() {
    let ok = 0;
    for (const [r, changes] of Object.entries(edits)) {
      try {
        await sapi(studioPath(db, `/t/${encodeURIComponent(table)}/rows`), { method: 'PATCH', unlock, body: { key: keyOf(data.rows[r], data.pk), changes } });
        ok += 1;
      } catch (e) { toast.err(`Zeile ${Number(r) + 1}: ${e.message}`); }
    }
    if (ok) toast.ok(`${ok} Zeile${ok === 1 ? '' : 'n'} gespeichert`);
    setEdits({});
    load();
    onChanged?.();
  }

  async function deleteSelected() {
    const rows = [...sel].map((i) => data.rows[i]);
    if (!window.confirm(`${rows.length} Zeile${rows.length === 1 ? '' : 'n'} endgültig löschen?`)) return;
    try {
      const out = await sapi(studioPath(db, `/t/${encodeURIComponent(table)}/rows`), { method: 'DELETE', unlock, body: { keys: rows.map((r) => keyOf(r, data.pk)) } });
      toast.ok(`${out.affected} gelöscht`);
      load();
      onChanged?.();
    } catch (e) { toast.err(e.message); }
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && dirty) { e.preventDefault(); saveEdits(); }
      if (e.key === 'Escape' && editing) setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const total = data?.total;
  const pages = total != null ? Math.max(1, Math.ceil(total / limit)) : null;
  const page = Math.floor(offset / limit) + 1;
  const allSel = data?.rows.length && sel.size === data.rows.length;
  const exportUrl = (format) => `${studioPath(db, '/export')}?table=${encodeURIComponent(table)}&format=${format}`;

  return (
    <div className="sg">
      <div className="sg-bar">
        <div className="lg-search sg-search"><NavIcon name="search" /><input placeholder="In allen Spalten suchen…" value={q} onChange={(e) => { setQ(e.target.value); clearTimeout(qTimer.current); const v = e.target.value; qTimer.current = setTimeout(() => setQLive(v), 300); }} /></div>
        {filters.length > 0 && <button type="button" className="mcp-chip warn sg-clear" onClick={() => setColFilters({})}><NavIcon name="x" />{filters.length} Filter</button>}
        <span className="grow" />
        {sel.size > 0 && writable && <button type="button" className="btn btn-sm btn-danger" onClick={deleteSelected}><NavIcon name="trash" />{sel.size} löschen</button>}
        {sel.size === 1 && writable && <button type="button" className="btn btn-sm" onClick={() => { const r = data.rows[[...sel][0]]; const copy = { ...r }; for (const c of cols) if (c.autoIncrement) delete copy[c.name]; setRowForm({ mode: 'new', row: copy }); }}><NavIcon name="copy" />Duplizieren</button>}
        {writable && <button type="button" className="btn btn-sm btn-primary" onClick={() => setRowForm({ mode: 'new', row: {} })}><NavIcon name="plus" />Zeile</button>}
        <div className="sg-export">
          <button type="button" className="btn btn-sm"><NavIcon name="download" />Export</button>
          <div className="pop sg-export-pop">
            <a className="pop-item" href={exportUrl('csv')}>CSV (Excel)</a>
            <a className="pop-item" href={exportUrl('json')}>JSON</a>
            <a className="pop-item" href={exportUrl('sql')}>SQL (Struktur + Daten)</a>
          </div>
        </div>
        <button type="button" className="o-icon-btn" title="Neu laden" onClick={load}><NavIcon name="refresh" /></button>
      </div>

      {err && <div className="err">{err}</div>}

      <div className={`sg-wrap${loading ? ' loading' : ''}`}>
        <table className="sg-table">
          <thead>
            <tr>
              <th className="sg-chk"><input type="checkbox" checked={!!allSel} onChange={() => setSel(allSel ? new Set() : new Set(data.rows.map((_, i) => i)))} /></th>
              <th className="sg-act" />
              {cols.map((c) => (
                <th key={c.name} className={`t-${typeTone(c.dataType)}`}>
                  <button type="button" className="sg-th" onClick={() => toggleSort(c.name)} title={`${c.type}${c.nullable ? ' · NULL erlaubt' : ''}${c.comment ? ` · ${c.comment}` : ''}`}>
                    {data.pk.includes(c.name) && <NavIcon name="lock" />}
                    {fkMap[c.name] && <NavIcon name="switch" />}
                    <span>{c.name}</span>
                    <small>{c.type.replace(/\(.*$/, '')}</small>
                    {sort === c.name && <i className={`sg-sort ${dir}`} />}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="sg-filters">
              <th /><th />
              {cols.map((c) => (
                <th key={c.name}>
                  <input value={colFilters[c.name] || ''} placeholder="Filter" title="z. B. >10, =abc, ~regex, ^anfang, null, !null, a,b,c" onChange={(e) => setColFilters((f) => ({ ...f, [c.name]: e.target.value }))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((row, r) => (
              <tr key={r} className={`${sel.has(r) ? 'sel' : ''}${edits[r] ? ' dirty' : ''}`}>
                <td className="sg-chk"><input type="checkbox" checked={sel.has(r)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; })} /></td>
                <td className="sg-act"><button type="button" className="o-icon-btn" title="Zeile öffnen" onClick={() => setRowForm({ mode: 'edit', row, index: r })}><NavIcon name="expand" /></button></td>
                {cols.map((c) => {
                  const edited = edits[r] && c.name in edits[r];
                  const v = edited ? edits[r][c.name] : row[c.name];
                  const txt = cellText(v);
                  const isEditing = editing && editing.r === r && editing.c === c.name;
                  const fk = fkMap[c.name];
                  return (
                    <td
                      key={c.name}
                      className={`t-${typeTone(c.dataType)}${edited ? ' edited' : ''}${txt === null ? ' null' : ''}`}
                      onDoubleClick={() => { if (writable && !c.generated && !(v && typeof v === 'object' && v.__bin)) setEditing({ r, c: c.name }); else setCell({ col: c, value: v }); }}
                    >
                      {isEditing ? (
                        <CellEditor col={c} value={v} onDone={(nv) => { if (nv !== undefined) setEdit(r, c.name, nv); setEditing(null); }} />
                      ) : (
                        <span className="sg-cell">
                          {txt === null ? <em>NULL</em> : <span className="sg-val">{txt.length > 140 ? `${txt.slice(0, 140)}…` : txt}</span>}
                          {fk && txt !== null && <button type="button" className="sg-fk" title={`→ ${fk.refTable}.${fk.refCol}`} onClick={() => onJump?.(fk.refTable, { col: fk.refCol, val: txt })}><NavIcon name="arrowRight" /></button>}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <div className="sg-empty">{filters.length || qLive ? 'Keine Treffer für die Filter.' : 'Die Tabelle ist leer.'}</div>}
        {!data && !err && <div className="sg-empty">Lädt…</div>}
      </div>

      <div className="sg-foot">
        <span className="muted">{total != null ? `${fmtNum(total)} Zeilen` : ''}{data ? ` · ${data.ms} ms` : ''}{writable ? ' · Doppelklick zum Bearbeiten' : ' · schreibgeschützt'}</span>
        <span className="grow" />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / Seite</option>)}</select>
        <button type="button" className="o-icon-btn" disabled={offset === 0} onClick={() => setOffset(0)} title="Erste Seite"><NavIcon name="collapse" /></button>
        <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Zurück</button>
        <span className="sg-page">Seite {page}{pages ? ` / ${fmtNum(pages)}` : ''}</span>
        <button type="button" className="btn btn-sm" disabled={!data || (total != null ? offset + limit >= total : data.rows.length < limit)} onClick={() => setOffset(offset + limit)}>Weiter</button>
        <button type="button" className="o-icon-btn" disabled={!pages || page >= pages} onClick={() => setOffset((pages - 1) * limit)} title="Letzte Seite"><NavIcon name="expand" /></button>
      </div>

      {dirty > 0 && (
        <div className="sg-savebar">
          <span><b>{dirty}</b> Zeile{dirty === 1 ? '' : 'n'} geändert</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdits({})}>Verwerfen</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={saveEdits}><NavIcon name="check" />Speichern <kbd>Strg S</kbd></button>
        </div>
      )}

      {rowForm && data && (
        <RowForm
          mode={rowForm.mode}
          row={rowForm.row}
          cols={cols}
          pk={data.pk}
          writable={writable}
          onClose={() => setRowForm(null)}
          onSave={async (values) => {
            try {
              if (rowForm.mode === 'new') {
                const out = await sapi(studioPath(db, `/t/${encodeURIComponent(table)}/rows`), { method: 'POST', unlock, body: { values } });
                toast.ok('Zeile eingefügt', { text: out.insertId ? `ID ${out.insertId}` : undefined });
              } else {
                await sapi(studioPath(db, `/t/${encodeURIComponent(table)}/rows`), { method: 'PATCH', unlock, body: { key: keyOf(rowForm.row, data.pk), changes: values } });
                toast.ok('Zeile gespeichert');
              }
              setRowForm(null);
              load();
              onChanged?.();
            } catch (e) { toast.err(e.message); }
          }}
        />
      )}
      {cell && (
        <Drawer onClose={() => setCell(null)} label="Wert" width={620}>
          <div className="mcp-form">
            <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>{cell.col.name}</h2><div className="pp-sub"><span className="muted mono">{cell.col.type}</span></div></div><button type="button" className="pp-close" onClick={() => setCell(null)}><NavIcon name="x" /></button></div></header>
            <pre className="hx-cfg sg-cellview">{prettyValue(cell.value)}</pre>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function prettyValue(v) {
  const t = cellText(v);
  if (t === null) return 'NULL';
  try { if (/^[[{]/.test(t)) return JSON.stringify(JSON.parse(t), null, 2); } catch { /* */ }
  return t;
}

function enumValues(type) {
  const m = String(type).match(/^(?:enum|set)\((.*)\)$/i);
  return m ? [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")) : null;
}

function CellEditor({ col, value, onDone }) {
  const ref = useRef(null);
  const [v, setV] = useState(value === null ? '' : cellText(value));
  const [isNull, setIsNull] = useState(value === null);
  const opts = enumValues(col.type);
  const big = /text|json|blob/i.test(col.dataType) || (v && v.length > 60);
  useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
  const commit = () => onDone(isNull ? null : v);
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onDone(undefined); }
    if (e.key === 'Enter' && (!big || e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  };
  return (
    <div className="sg-editor" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commit(); }}>
      {opts ? (
        <select ref={ref} value={isNull ? '' : v} onChange={(e) => { setIsNull(false); setV(e.target.value); }} onKeyDown={keys}>
          {col.nullable && <option value="">NULL</option>}
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : big ? (
        <textarea ref={ref} value={isNull ? '' : v} rows={4} onChange={(e) => { setIsNull(false); setV(e.target.value); }} onKeyDown={keys} placeholder={isNull ? 'NULL' : ''} />
      ) : (
        <input ref={ref} value={isNull ? '' : v} onChange={(e) => { setIsNull(false); setV(e.target.value); }} onKeyDown={keys} placeholder={isNull ? 'NULL' : ''} />
      )}
      {col.nullable && <button type="button" className={`sg-null${isNull ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setIsNull(!isNull)}>NULL</button>}
    </div>
  );
}

function RowForm({ mode, row, cols, pk, writable, onClose, onSave }) {
  const [vals, setVals] = useState(() => Object.fromEntries(cols.map((c) => [c.name, row[c.name] === undefined ? undefined : row[c.name]])));
  const [busy, setBusy] = useState(false);
  const changed = (c) => mode === 'new' ? vals[c] !== undefined : vals[c] !== row[c] && !(vals[c] !== null && row[c] !== null && String(vals[c]) === String(row[c]));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const out = {};
    for (const c of cols) if (changed(c.name)) out[c.name] = vals[c.name];
    await onSave(out);
    setBusy(false);
  }
  return (
    <Drawer onClose={onClose} label="Zeile" width={640}>
      <form className="mcp-form" onSubmit={submit}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>{mode === 'new' ? 'Neue Zeile' : 'Zeile bearbeiten'}</h2><div className="pp-sub"><span className="muted">{mode === 'new' ? 'Leere Felder nutzen den Standardwert der Spalte' : pk.length ? pk.map((k) => `${k} = ${row[k]}`).join(', ') : 'ohne Primärschlüssel'}</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll sg-form">
          {cols.map((c) => {
            const v = vals[c.name];
            const opts = enumValues(c.type);
            const bin = v && typeof v === 'object' && v.__bin;
            const ro = !writable || c.generated || bin || (mode === 'edit' && c.autoIncrement);
            const big = /text|json/i.test(c.dataType);
            const set = (x) => setVals((s) => ({ ...s, [c.name]: x }));
            return (
              <label key={c.name} className={`sg-field${changed(c.name) ? ' changed' : ''}`}>
                <span className="sg-field-head">
                  <b>{c.name}</b>
                  {pk.includes(c.name) && <NavIcon name="lock" />}
                  <small className={`t-${typeTone(c.dataType)}`}>{c.type}</small>
                  {c.autoIncrement && <small>auto</small>}
                  {c.nullable && !ro && <button type="button" className={`sg-null${v === null ? ' on' : ''}`} onClick={() => set(v === null ? '' : null)}>NULL</button>}
                </span>
                {bin ? <code className="muted">{cellText(v)}</code> : opts ? (
                  <select disabled={ro} value={v ?? ''} onChange={(e) => set(e.target.value)}>
                    {mode === 'new' && <option value="">— Standard —</option>}
                    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : big ? (
                  <textarea disabled={ro} rows={c.dataType === 'json' ? 6 : 3} value={v === null ? '' : (v ?? '')} placeholder={v === null ? 'NULL' : c.default != null ? `Standard: ${c.default}` : ''} onChange={(e) => set(e.target.value)} className={c.dataType === 'json' ? 'mono' : ''} />
                ) : (
                  <input disabled={ro} value={v === null ? '' : (v ?? '')} placeholder={v === null ? 'NULL' : c.autoIncrement ? 'automatisch' : c.default != null ? `Standard: ${c.default}` : ''} onChange={(e) => set(e.target.value)} type={/^(int|bigint|smallint|tinyint|mediumint|decimal|float|double)$/.test(c.dataType) ? 'text' : 'text'} inputMode={/int|decimal|float|double/.test(c.dataType) ? 'decimal' : undefined} />
                )}
                {c.comment && <small className="muted">{c.comment}</small>}
              </label>
            );
          })}
          {writable && <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Speichert…' : mode === 'new' ? 'Einfügen' : 'Speichern'}</button>}
        </div>
      </form>
    </Drawer>
  );
}
