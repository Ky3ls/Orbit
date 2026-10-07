import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, Page, PageHeader } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import './database.css';

const PAGE_SIZES = [25, 50, 100, 250];

const STRUCTURE_COLS = [
  { key: 'field', labelKey: 'db.col.field' },
  { key: 'type', labelKey: 'db.col.type' },
  { key: 'null', labelKey: 'db.col.null' },
  { key: 'key', labelKey: 'db.col.key' },
  { key: 'default', labelKey: 'db.col.default' },
  { key: 'extra', labelKey: 'db.col.extra' },
];

function cellValue(v) {
  if (v === null || v === undefined) return { text: 'NULL', null: true };
  if (v instanceof Date) {
    return { text: v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') };
  }
  if (typeof v === 'object') {
    try {
      return { text: JSON.stringify(v) };
    } catch {
      return { text: String(v) };
    }
  }
  return { text: String(v) };
}

function exportCsv(filename, columns, rows) {
  const esc = (s) => {
    const t = String(s ?? '');
    if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  };
  const lines = [
    columns.map(esc).join(','),
    ...rows.map((row) => columns.map((c) => esc(cellValue(row[c]).text)).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function rowPk(row, primaryKey) {
  if (!primaryKey?.length) return null;
  const pk = {};
  for (const k of primaryKey) pk[k] = row[k];
  return pk;
}

function DataTable({ columns, rows, emptyColumns, emptyRows }) {
  if (!columns.length) {
    return <p className="muted">{emptyColumns}</p>;
  }
  return (
    <div className="db-scroll">
      <table className="ws-table db-grid">
        <thead>
          <tr>{columns.map((c) => <th key={c.key || c}>{c.label || c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="muted">{emptyRows}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const key = c.key || c;
                const { text, null: isNull } = cellValue(row[key]);
                return (
                  <td key={key} className={isNull ? 'null' : ''}>{text}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrowseTable({
  columns,
  rows,
  primaryKey,
  structure,
  emptyColumns,
  emptyRows,
  canEdit,
  busy,
  onSaveCell,
  onDeleteRow,
  t,
}) {
  const [edit, setEdit] = useState(null);
  const [draft, setDraft] = useState('');
  const [asNull, setAsNull] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const pkSet = useMemo(() => new Set(primaryKey || []), [primaryKey]);
  const nullable = useMemo(() => {
    const map = new Map();
    for (const col of structure || []) map.set(col.field, String(col.null).toUpperCase() === 'YES');
    return map;
  }, [structure]);

  useEffect(() => {
    if (edit && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [edit]);

  function startEdit(rowIdx, col) {
    if (!canEdit || busy || saving) return;
    if (!primaryKey?.length) return;
    if (pkSet.has(col) && structure?.find((c) => c.field === col)?.extra?.includes('auto_increment')) return;
    const row = rows[rowIdx];
    const raw = row?.[col];
    const isNull = raw === null || raw === undefined;
    setEdit({ rowIdx, col });
    setAsNull(isNull);
    setDraft(isNull ? '' : cellValue(raw).text);
  }

  function cancelEdit() {
    setEdit(null);
    setDraft('');
    setAsNull(false);
  }

  async function commitEdit() {
    if (!edit || saving) return;
    const row = rows[edit.rowIdx];
    if (!row) return cancelEdit();
    const pk = rowPk(row, primaryKey);
    if (!pk) return cancelEdit();
    const nextVal = asNull ? null : draft;
    const prev = row[edit.col];
    const prevText = prev === null || prev === undefined ? null : cellValue(prev).text;
    const nextText = nextVal === null ? null : String(nextVal);
    if (prevText === nextText || (prev === null && nextVal === null)) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await onSaveCell(pk, edit.col, nextVal);
      cancelEdit();
    } catch {
      /* parent sets err */
    } finally {
      setSaving(false);
    }
  }

  if (!columns.length) {
    return <p className="muted">{emptyColumns}</p>;
  }

  return (
    <div className="db-scroll">
      <table className="ws-table db-grid db-browse-grid">
        <thead>
          <tr>
            {canEdit && <th className="db-act-col">{t('db.actions')}</th>}
            {columns.map((c) => (
              <th key={c} className={pkSet.has(c) ? 'pk' : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (canEdit ? 1 : 0)} className="muted">{emptyRows}</td>
            </tr>
          ) : rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {canEdit && (
                <td className="db-act-cell">
                  <button
                    type="button"
                    className="db-act-btn danger"
                    disabled={busy || saving || !primaryKey?.length}
                    title={primaryKey?.length ? t('db.deleteRow') : t('db.noPrimaryKey')}
                    onClick={() => {
                      const pk = rowPk(row, primaryKey);
                      if (!pk) return;
                      if (!window.confirm(t('db.deleteConfirm'))) return;
                      onDeleteRow(pk, rowIdx);
                    }}
                  >
                    {t('db.deleteRow')}
                  </button>
                </td>
              )}
              {columns.map((col) => {
                const isEditing = edit?.rowIdx === rowIdx && edit?.col === col;
                const { text, null: isNull } = cellValue(row[col]);
                if (isEditing) {
                  return (
                    <td key={col} className="db-cell-edit">
                      <div className="db-inline-edit">
                        {!asNull && (
                          <textarea
                            ref={inputRef}
                            className="db-inline-input"
                            value={draft}
                            rows={Math.min(6, Math.max(1, String(draft).split('\n').length))}
                            disabled={saving}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              } else if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                commitEdit();
                              }
                            }}
                            onBlur={() => {
                              /* Tabs/Klick außerhalb → Edit schließen (Icon-Buttons: onMouseDown preventDefault) */
                              cancelEdit();
                            }}
                          />
                        )}
                        <div className="db-inline-hint">
                          {nullable.get(col) && (
                            <label className="db-inline-null">
                              <input
                                type="checkbox"
                                checked={asNull}
                                disabled={saving}
                                onChange={(e) => setAsNull(e.target.checked)}
                              />
                              NULL
                            </label>
                          )}
                          <span>{t('db.editHint')}</span>
                          <div className="db-inline-actions">
                            <button
                              type="button"
                              className="o-icon-btn db-inline-icon ok"
                              disabled={saving}
                              title={t('common.save')}
                              aria-label={t('common.save')}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={commitEdit}
                            >
                              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="o-icon-btn db-inline-icon"
                              disabled={saving}
                              title={t('common.cancel')}
                              aria-label={t('common.cancel')}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={cancelEdit}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                <path d="M18 6 6 18M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  );
                }
                return (
                  <td
                    key={col}
                    className={`${isNull ? 'null' : ''}${canEdit && primaryKey?.length ? ' db-cell-editable' : ''}`}
                    title={canEdit && primaryKey?.length ? t('db.dblClickEdit') : undefined}
                    onDoubleClick={() => startEdit(rowIdx, col)}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && !primaryKey?.length && (
        <p className="muted db-pk-warn">{t('db.noPrimaryKey')}</p>
      )}
    </div>
  );
}

function SqlWorkspace({ hint, sql, setSql, busy, onRun, sqlResult, t }) {
  const sqlColumns = sqlResult?.kind === 'resultset'
    ? (sqlResult.columns?.length ? sqlResult.columns : Object.keys(sqlResult.rows?.[0] || {}))
    : [];

  return (
    <>
      <form className="db-sql" onSubmit={onRun}>
        <p className="muted db-sql-hint">{hint}</p>
        <label className="field">
          <span>SQL</span>
          <textarea
            className="mono db-sql-area"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            rows={10}
            placeholder={t('db.sqlPlaceholder')}
          />
        </label>
        <div className="db-sql-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('db.running') : t('db.run')}
          </button>
          <span className="muted db-sql-dump-hint">{t('db.sqlDumpHint')}</span>
        </div>
      </form>
      {sqlResult?.kind === 'resultset' && (sqlResult.rows?.length > 0 || sqlColumns.length > 0) && (
        <div className="db-sql-result">
          <DataTable
            columns={sqlColumns}
            rows={sqlResult.rows || []}
            emptyColumns={t('db.noColumns')}
            emptyRows={t('db.noRows')}
          />
        </div>
      )}
    </>
  );
}

function InsertForm({ structure, busy, onInsert, onCancel, t }) {
  const [values, setValues] = useState(() => {
    const init = {};
    for (const col of structure || []) {
      if (col.extra?.includes('auto_increment')) continue;
      init[col.field] = col.default == null ? '' : String(col.default);
    }
    return init;
  });

  return (
    <form
      className="db-insert"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = {};
        for (const col of structure || []) {
          if (col.extra?.includes('auto_increment')) continue;
          const raw = values[col.field];
          if (raw === '' && String(col.null).toUpperCase() === 'YES') payload[col.field] = null;
          else payload[col.field] = raw;
        }
        onInsert(payload);
      }}
    >
      <h4 className="db-insert-title">{t('db.insertRow')}</h4>
      <div className="db-insert-grid">
        {(structure || []).map((col) => {
          if (col.extra?.includes('auto_increment')) {
            return (
              <label key={col.field} className="field">
                <span>{col.field} <em className="muted">AI</em></span>
                <input disabled placeholder="AUTO" />
              </label>
            );
          }
          return (
            <label key={col.field} className="field">
              <span>
                {col.field}
                {col.key === 'PRI' ? ' *' : ''}
              </span>
              <input
                value={values[col.field] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [col.field]: e.target.value }))}
                disabled={busy}
              />
            </label>
          );
        })}
      </div>
      <div className="db-insert-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t('db.insert')}</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

export default function Database({ user }) {
  const { t } = useI18n();
  const isOwner = user?.role === 'owner';
  const canEdit = isOwner
    || user?.role === 'admin'
    || (user?.permissions || []).includes('database')
    || (user?.permissions || []).includes('*');
  const [meta, setMeta] = useState({ database: '', version: '' });
  const [tables, setTables] = useState([]);
  const [overview, setOverview] = useState([]);
  const [filter, setFilter] = useState('');
  const [table, setTable] = useState(null);
  const [tab, setTab] = useState('overview');
  const [navOpen, setNavOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches,
  );
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [structure, setStructure] = useState([]);
  const [browse, setBrowse] = useState({
    rows: [], columns: [], total: 0, offset: 0, limit: 25, primaryKey: [],
  });
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [rowFilter, setRowFilter] = useState('');
  const [insertOpen, setInsertOpen] = useState(false);

  const [searchCol, setSearchCol] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResult, setSearchResult] = useState({ rows: [], columns: [] });

  const [sql, setSql] = useState(() => t('db.sqlDefault'));
  const [sqlResult, setSqlResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const sqlHint = t('db.sqlHintOwner');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const onChange = () => {
      if (mq.matches) setNavOpen(true);
      else setNavOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api('/api/database/meta'),
      api('/api/database/overview'),
    ])
      .then(([m, o]) => {
        if (cancelled) return;
        setMeta({ database: m.database || '', version: m.version || '' });
        const list = o.tables || [];
        setOverview(list);
        setTables(list.map((tbl) => tbl.name));
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredTables = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((name) => name.toLowerCase().includes(q));
  }, [tables, filter]);

  const loadStructure = useCallback(async (name) => {
    const d = await api(`/api/database/structure?table=${encodeURIComponent(name)}`);
    const cols = d.columns || [];
    setStructure(cols);
    if (cols[0]) setSearchCol(cols[0].field);
    return cols;
  }, []);

  const loadBrowse = useCallback(async (name, offset, limit) => {
    const d = await api(
      `/api/database/browse?table=${encodeURIComponent(name)}&offset=${offset}&limit=${limit}`,
    );
    setBrowse({
      rows: d.rows || [],
      columns: d.columns || [],
      total: d.total ?? 0,
      offset: d.offset ?? 0,
      limit: d.limit ?? limit,
      primaryKey: d.primaryKey || [],
    });
    if (Array.isArray(d.structure) && d.structure.length) {
      setStructure(d.structure);
      if (d.structure[0] && !searchCol) setSearchCol(d.structure[0].field);
    }
  }, [searchCol]);

  useEffect(() => {
    if (!table) return;
    setErr('');
    if (tab === 'structure' || tab === 'search') {
      setBusy(true);
      loadStructure(table)
        .catch((e) => setErr(e.message))
        .finally(() => setBusy(false));
    } else if (tab === 'browse') {
      setBusy(true);
      loadBrowse(table, page * pageSize, pageSize)
        .catch((e) => setErr(e.message))
        .finally(() => setBusy(false));
    }
  }, [table, tab, page, pageSize, loadStructure, loadBrowse]);

  function selectTable(name) {
    setTable(name);
    setTab('browse');
    setPage(0);
    setRowFilter('');
    setInsertOpen(false);
    setSearchResult({ rows: [], columns: [] });
    setSql(`SELECT * FROM \`${name.replace(/`/g, '')}\` LIMIT 50`);
    setSqlResult(null);
    if (window.matchMedia('(max-width: 900px)').matches) setNavOpen(false);
  }

  function goDatabase() {
    setTable(null);
    setTab('overview');
    setPage(0);
    setInsertOpen(false);
  }

  async function refreshBrowse() {
    if (!table) return;
    setBusy(true);
    setErr('');
    try {
      await loadBrowse(table, page * pageSize, pageSize);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runSql(e) {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    setSqlResult(null);
    try {
      const d = await api('/api/database/query', { method: 'POST', body: { sql, limit: 500 } });
      const view = d.resultset && d.kind === 'ok' ? d.resultset : d;
      setSqlResult(view?.kind === 'resultset' ? view : (d.kind === 'resultset' ? d : null));
      if (d.kind === 'ok') {
        const parts = [];
        if (d.statements > 1) parts.push(t('db.scriptDone', { n: d.statements }));
        parts.push(t('db.affected', { n: d.affectedRows ?? 0 }));
        if (d.insertId) parts.push(t('db.lastId', { id: d.insertId }));
        if (d.message && !parts.includes(d.message)) parts.push(d.message);
        setMsg(parts.join(' '));
        if (table) refreshBrowse();
        /* Tabellenliste nach CREATE/DROP aktualisieren */
        api('/api/database/overview')
          .then((o) => {
            const list = o.tables || [];
            setOverview(list);
            setTables(list.map((tbl) => tbl.name));
          })
          .catch(() => {});
      } else if (d.kind === 'resultset') {
        setMsg(d.truncated ? t('db.truncated') : t('db.rows', { n: (d.rows || []).length }));
      }
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(e) {
    e?.preventDefault();
    if (!table || !searchCol) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const d = await api('/api/database/search', {
        method: 'POST',
        body: { table, column: searchCol, q: searchQ, limit: 200 },
      });
      setSearchResult({ rows: d.rows || [], columns: d.columns || [] });
      setMsg(t('db.hits', { n: (d.rows || []).length, max: d.limit || 200 }));
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCell(pk, col, value) {
    setErr('');
    setMsg('');
    try {
      await api('/api/database/row', {
        method: 'POST',
        body: { action: 'update', table, pk, set: { [col]: value } },
      });
      setBrowse((b) => {
        const pkKeys = b.primaryKey || [];
        const rows = b.rows.map((row) => {
          const match = pkKeys.every((k) => String(row[k]) === String(pk[k]));
          return match ? { ...row, [col]: value } : row;
        });
        return { ...b, rows };
      });
      setMsg(t('db.saved'));
    } catch (e) {
      setErr(e.message);
      throw e;
    }
  }

  async function deleteRow(pk) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api('/api/database/row', {
        method: 'POST',
        body: { action: 'delete', table, pk },
      });
      setMsg(t('db.deleted'));
      await loadBrowse(table, page * pageSize, pageSize);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function insertRow(values) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const d = await api('/api/database/row', {
        method: 'POST',
        body: { action: 'insert', table, values },
      });
      setMsg(d.insertId ? t('db.insertedId', { id: d.insertId }) : t('db.inserted'));
      setInsertOpen(false);
      setPage(0);
      await loadBrowse(table, 0, pageSize);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pageCount = table && tab === 'browse'
    ? Math.max(1, Math.ceil(browse.total / pageSize))
    : 1;

  const structureCols = STRUCTURE_COLS.map((c) => ({ key: c.key, label: t(c.labelKey) }));
  const structureRows = structure.map((col) => ({
    field: col.field,
    type: col.type,
    null: col.null,
    key: col.key || '—',
    default: col.default === null ? 'NULL' : String(col.default ?? '—'),
    extra: col.extra || '—',
  }));

  const overviewFiltered = overview.filter((tbl) => filteredTables.includes(tbl.name));

  const filteredBrowseRows = useMemo(() => {
    const q = rowFilter.trim().toLowerCase();
    if (!q) return browse.rows;
    return browse.rows.filter((row) => browse.columns.some((c) => {
      const { text } = cellValue(row[c]);
      return text.toLowerCase().includes(q);
    }));
  }, [browse.rows, browse.columns, rowFilter]);

  return (
    <Page className="db-page ws-module-flush">
      <PageHeader
        eyebrow={t('db.eyebrow')}
        title={meta.database || 'MySQL'}
        description={meta.version ? t('db.serverVer', { version: meta.version }) : undefined}
        actions={<Badge tone="info">{t('db.tablesCount', { n: tables.length })}</Badge>}
      />

      <div className="db-shell">
        <aside className={`db-shell-aside${navOpen ? ' is-open' : ''}`} aria-label={t('db.tablesAria')}>
          <div className="db-aside-top">
            <span className="db-aside-label">{t('db.tables')}</span>
            <span className="db-aside-count mono">{tables.length}</span>
          </div>
          <input
            className="search db-aside-search"
            type="search"
            placeholder={t('db.filterPh')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t('db.filterAria')}
          />
          <nav className="db-table-list">
            {filteredTables.length === 0 ? (
              <p className="muted db-aside-empty">{t('db.noMatch')}</p>
            ) : (
              filteredTables.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`db-table-btn${table === name ? ' active' : ''}`}
                  onClick={() => selectTable(name)}
                  title={name}
                >
                  {name}
                </button>
              ))
            )}
          </nav>
        </aside>

        <div className="db-main">
          <div className="db-main-head">
            <div className="db-main-head-start">
              <button
                type="button"
                className="db-nav-toggle btn btn-sm"
                aria-expanded={navOpen}
                onClick={() => setNavOpen((v) => !v)}
              >
                {navOpen ? t('db.hideList') : t('db.showTables', { n: tables.length })}
              </button>
              <nav className="db-crumb" aria-label={t('db.crumbAria')}>
                <button type="button" onClick={goDatabase}>{meta.database || t('db.eyebrow')}</button>
                {table && (
                  <>
                    <span className="sep">›</span>
                    <strong>{table}</strong>
                  </>
                )}
              </nav>
            </div>
            {busy && <span className="muted db-busy">{t('db.loading')}</span>}
          </div>

          <div className="db-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={`db-tab${tab === 'overview' ? ' active' : ''}`}
              onClick={() => { setTab('overview'); setTable(null); setInsertOpen(false); }}
            >
              {t('db.overview')}
            </button>
            <button
              type="button"
              role="tab"
              className={`db-tab${tab === 'sql' ? ' active' : ''}`}
              onClick={() => setTab('sql')}
            >
              SQL
            </button>
            {table && (
              <>
                <button
                  type="button"
                  role="tab"
                  className={`db-tab${tab === 'browse' ? ' active' : ''}`}
                  onClick={() => setTab('browse')}
                >
                  {t('db.browse')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`db-tab${tab === 'structure' ? ' active' : ''}`}
                  onClick={() => setTab('structure')}
                >
                  {t('db.structure')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`db-tab${tab === 'search' ? ' active' : ''}`}
                  onClick={() => setTab('search')}
                >
                  {t('db.searchTab')}
                </button>
              </>
            )}
          </div>

          <div className="db-panel">
            {err && <div className="err">{err}</div>}
            {msg && <div className="banner">{msg}</div>}

            {tab === 'overview' && (
              <>
                <p className="db-lead">
                  {t('db.pickHintBefore')}
                  <button type="button" className="db-link" onClick={() => setTab('sql')}>{t('db.pickHintSql')}</button>
                  {t('db.pickHintAfter')}
                </p>
                <div className="db-scroll">
                  <table className="ws-table db-grid db-overview-table">
                    <thead>
                      <tr>
                        <th>{t('db.table')}</th>
                        <th>{t('db.rowsApprox')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {overviewFiltered.map((row) => (
                        <tr key={row.name}>
                          <td>
                            <button type="button" className="db-link mono" onClick={() => selectTable(row.name)}>
                              {row.name}
                            </button>
                          </td>
                          <td>{row.rows}</td>
                          <td>
                            <button type="button" className="btn btn-sm" onClick={() => selectTable(row.name)}>
                              {t('db.open')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'sql' && (
              <SqlWorkspace
                hint={sqlHint}
                sql={sql}
                setSql={setSql}
                busy={busy}
                onRun={runSql}
                sqlResult={sqlResult}
                t={t}
              />
            )}

            {tab === 'structure' && table && (
              <DataTable
                columns={structureCols}
                rows={structureRows}
                emptyColumns={t('db.noColumns')}
                emptyRows={t('db.noRows')}
              />
            )}

            {tab === 'browse' && table && (
              <>
                <div className="db-toolbar">
                  <div className="db-pager">
                    <span>
                      {browse.total === 0 ? t('db.rowsZero') : (
                        t('db.rowsRange', {
                          from: browse.offset + 1,
                          to: Math.min(browse.offset + browse.limit, browse.total),
                          total: browse.total,
                        })
                      )}
                    </span>
                    <label>
                      {t('db.limit')}
                      <select
                        value={pageSize}
                        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                      >
                        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <button type="button" className="btn btn-sm" disabled={page <= 0 || busy} onClick={() => setPage((p) => p - 1)}>{t('common.back')}</button>
                    <span>{page + 1} / {pageCount}</span>
                    <button type="button" className="btn btn-sm" disabled={page + 1 >= pageCount || busy} onClick={() => setPage((p) => p + 1)}>{t('db.next')}</button>
                  </div>
                  <div className="db-toolbar-actions">
                    <input
                      className="search db-row-filter"
                      type="search"
                      value={rowFilter}
                      onChange={(e) => setRowFilter(e.target.value)}
                      placeholder={t('db.rowFilterPh')}
                      aria-label={t('db.rowFilterPh')}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() => {
                          if (!structure.length) loadStructure(table).then(() => setInsertOpen(true));
                          else setInsertOpen((v) => !v);
                        }}
                      >
                        {t('db.insertRow')}
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={refreshBrowse}>
                      {t('db.refresh')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!browse.rows.length}
                      onClick={() => exportCsv(`${table}.csv`, browse.columns, browse.rows)}
                    >
                      {t('db.csv')}
                    </button>
                  </div>
                </div>

                {insertOpen && canEdit && (
                  <InsertForm
                    structure={structure}
                    busy={busy}
                    onInsert={insertRow}
                    onCancel={() => setInsertOpen(false)}
                    t={t}
                  />
                )}

                <p className="muted db-edit-tip">{t('db.dblClickTip')}</p>

                <BrowseTable
                  columns={browse.columns}
                  rows={filteredBrowseRows}
                  primaryKey={browse.primaryKey}
                  structure={structure}
                  emptyColumns={t('db.noColumns')}
                  emptyRows={t('db.noRows')}
                  canEdit={canEdit}
                  busy={busy}
                  onSaveCell={saveCell}
                  onDeleteRow={(pk) => deleteRow(pk)}
                  t={t}
                />
              </>
            )}

            {tab === 'search' && table && (
              <>
                <form className="db-search-form" onSubmit={runSearch}>
                  <label className="field">
                    <span>{t('db.column')}</span>
                    <select value={searchCol} onChange={(e) => setSearchCol(e.target.value)}>
                      {structure.map((c) => (
                        <option key={c.field} value={c.field}>{c.field}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field grow">
                    <span>{t('db.contains')}</span>
                    <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t('db.searchPh')} />
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t('db.search')}</button>
                </form>
                <DataTable
                  columns={searchResult.columns}
                  rows={searchResult.rows}
                  emptyColumns={t('db.noColumns')}
                  emptyRows={t('db.noRows')}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
