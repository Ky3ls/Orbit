import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, Page, PageHeader } from '../components/Ui.jsx';
import './database.css';

const PAGE_SIZES = [25, 50, 100, 250];

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

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
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

function DataTable({ columns, rows }) {
  if (!columns.length) {
    return <p className="muted">Keine Spalten.</p>;
  }
  return (
    <div className="db-scroll">
      <table className="ws-table">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="muted">Keine Zeilen</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const { text, null: isNull } = cellValue(row[c]);
                return (
                  <td key={c} className={isNull ? 'null' : ''}>{text}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SqlWorkspace({ hint, sql, setSql, busy, onRun, sqlResult }) {
  const sqlColumns = sqlResult?.kind === 'resultset'
    ? (sqlResult.columns?.length ? sqlResult.columns : Object.keys(sqlResult.rows?.[0] || {}))
    : [];

  return (
    <>
      <form className="db-sql" onSubmit={onRun}>
        <p className="muted db-sql-hint">{hint}</p>
        <label className="field">
          <span>SQL-Befehl</span>
          <textarea
            className="mono db-sql-area"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            rows={10}
            placeholder="SELECT …"
          />
        </label>
        <div className="db-sql-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Läuft…' : 'Ausführen'}
          </button>
        </div>
      </form>
      {sqlResult?.kind === 'resultset' && (sqlResult.rows?.length > 0 || sqlColumns.length > 0) && (
        <div className="db-sql-result">
          <DataTable columns={sqlColumns} rows={sqlResult.rows || []} />
        </div>
      )}
    </>
  );
}

export default function Database({ user }) {
  const isOwner = user?.role === 'owner';
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
  const [browse, setBrowse] = useState({ rows: [], columns: [], total: 0, offset: 0, limit: 25 });
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const [searchCol, setSearchCol] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResult, setSearchResult] = useState({ rows: [], columns: [] });

  const [sql, setSql] = useState('-- SQL-Befehl hier eingeben\nSELECT 1');
  const [sqlResult, setSqlResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const sqlHint = isOwner
    ? 'Eine Anweisung ohne Semikolon — SELECT, INSERT, UPDATE, DELETE, …'
    : 'Nur SELECT, eine Anweisung ohne Semikolon.';

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
        setTables(list.map((t) => t.name));
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
    });
  }, []);

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
    setSearchResult({ rows: [], columns: [] });
    setSql(`SELECT * FROM \`${name.replace(/`/g, '')}\` LIMIT 50`);
    setSqlResult(null);
    if (window.matchMedia('(max-width: 900px)').matches) setNavOpen(false);
  }

  function goDatabase() {
    setTable(null);
    setTab('overview');
    setPage(0);
  }

  async function runSql(e) {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    setSqlResult(null);
    try {
      const d = await api('/api/database/query', { method: 'POST', body: { sql, limit: 500 } });
      setSqlResult(d);
      if (d.kind === 'ok') {
        const parts = [`${d.affectedRows} Zeile(n) betroffen.`];
        if (d.insertId) parts.push(`Letzte ID: ${d.insertId}.`);
        if (d.message) parts.push(d.message);
        setMsg(parts.join(' '));
      } else {
        setMsg(d.truncated ? 'Ergebnis gekürzt (max. 500).' : `${(d.rows || []).length} Zeile(n).`);
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
      setMsg(`${(d.rows || []).length} Treffer (max. ${d.limit || 200}).`);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  const pageCount = table && tab === 'browse'
    ? Math.max(1, Math.ceil(browse.total / pageSize))
    : 1;

  const structureRows = structure.map((col) => ({
    Feld: col.field,
    Typ: col.type,
    Null: col.null,
    Schlüssel: col.key || '—',
    Standard: col.default === null ? 'NULL' : String(col.default ?? '—'),
    Extra: col.extra || '—',
  }));

  const overviewRows = overview
    .filter((t) => filteredTables.includes(t.name))
    .map((t) => ({
      Tabelle: t.name,
      Zeilen: t.rows,
      Engine: t.engine || '—',
      Größe: fmtBytes(t.size),
      _name: t.name,
    }));

  return (
    <Page className="db-page ws-module-flush">
      <PageHeader
        eyebrow="Datenbank"
        title={meta.database || 'MySQL'}
        description={meta.version ? `Server: MySQL ${meta.version}` : undefined}
        actions={<Badge tone="info">{tables.length} Tabellen</Badge>}
      />

      <div className="db-shell">
        <aside className={`db-shell-aside${navOpen ? ' is-open' : ''}`} aria-label="Tabellen">
          <div className="db-aside-top">
            <span className="db-aside-label">Tabellen</span>
            <span className="db-aside-count mono">{tables.length}</span>
          </div>
          <input
            className="search db-aside-search"
            type="search"
            placeholder="Filtern…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Tabellen filtern"
          />
          <nav className="db-table-list">
            {filteredTables.length === 0 ? (
              <p className="muted db-aside-empty">Keine Treffer</p>
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
                {navOpen ? '« Listen' : `Tabellen (${tables.length})`}
              </button>
              <nav className="db-crumb" aria-label="Kontext">
                <button type="button" onClick={goDatabase}>{meta.database || 'Datenbank'}</button>
                {table && (
                  <>
                    <span className="sep">›</span>
                    <strong>{table}</strong>
                  </>
                )}
              </nav>
            </div>
            {busy && <span className="muted db-busy">Lädt…</span>}
          </div>

          <div className="db-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={`db-tab${tab === 'overview' ? ' active' : ''}`}
              onClick={() => { setTab('overview'); setTable(null); }}
            >
              Übersicht
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
                  Durchsuchen
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`db-tab${tab === 'structure' ? ' active' : ''}`}
                  onClick={() => setTab('structure')}
                >
                  Struktur
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`db-tab${tab === 'search' ? ' active' : ''}`}
                  onClick={() => setTab('search')}
                >
                  Suchen
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
                  Links alle Tabellen — wähle eine aus oder nutze <button type="button" className="db-link" onClick={() => setTab('sql')}>SQL</button>
                  für eigene Abfragen.
                </p>
                <div className="db-scroll">
                  <table className="ws-table db-overview-table">
                    <thead>
                      <tr>
                        <th>Tabelle</th>
                        <th>Zeilen (ca.)</th>
                        <th>Engine</th>
                        <th>Größe</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {overviewRows.map((row) => (
                        <tr key={row._name}>
                          <td className="mono">{row.Tabelle}</td>
                          <td>{row.Zeilen}</td>
                          <td>{row.Engine}</td>
                          <td>{row.Größe}</td>
                          <td>
                            <button type="button" className="btn btn-sm" onClick={() => selectTable(row._name)}>
                              Öffnen
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
              />
            )}

            {tab === 'structure' && table && (
              <DataTable
                columns={['Feld', 'Typ', 'Null', 'Schlüssel', 'Standard', 'Extra']}
                rows={structureRows}
              />
            )}

            {tab === 'browse' && table && (
              <>
                <div className="db-pager">
                  <span>
                    {browse.total === 0 ? '0 Zeilen' : (
                      <>
                        {browse.offset + 1}–{Math.min(browse.offset + browse.limit, browse.total)} / {browse.total}
                      </>
                    )}
                  </span>
                  <label>
                    Limit
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                    >
                      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-sm" disabled={page <= 0 || busy} onClick={() => setPage((p) => p - 1)}>Zurück</button>
                  <span>{page + 1} / {pageCount}</span>
                  <button type="button" className="btn btn-sm" disabled={page + 1 >= pageCount || busy} onClick={() => setPage((p) => p + 1)}>Weiter</button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!browse.rows.length}
                    onClick={() => exportCsv(`${table}.csv`, browse.columns, browse.rows)}
                  >
                    CSV Export
                  </button>
                </div>
                <DataTable columns={browse.columns} rows={browse.rows} />
              </>
            )}

            {tab === 'search' && table && (
              <>
                <form className="db-search-form" onSubmit={runSearch}>
                  <label className="field">
                    <span>Spalte</span>
                    <select value={searchCol} onChange={(e) => setSearchCol(e.target.value)}>
                      {structure.map((c) => (
                        <option key={c.field} value={c.field}>{c.field}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field grow">
                    <span>Enthält</span>
                    <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Suchtext…" />
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Suchen</button>
                </form>
                <DataTable columns={searchResult.columns} rows={searchResult.rows} />
              </>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
