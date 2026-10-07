import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import OrbitSelect from '../components/OrbitSelect.jsx';
import { Badge, Page, PageHeader } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import './database.css';

const PAGE_SIZES = [25, 50, 100, 250];
const PAGE_SIZE_OPTS = PAGE_SIZES.map((n) => ({ value: n, label: String(n) }));

const TYPE_SUGGESTIONS = [
  'int', 'bigint', 'tinyint(1)', 'varchar(50)', 'varchar(255)', 'text', 'longtext',
  'decimal(10,2)', 'float', 'double', 'datetime', 'timestamp', 'date', 'json',
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

function rowSelKey(row, primaryKey, rowIdx) {
  const pk = rowPk(row, primaryKey);
  if (pk) return primaryKey.map((k) => `${k}:${pk[k]}`).join('|');
  return `idx:${rowIdx}`;
}

function isAutoInc(col) {
  return Boolean(col?.extra?.includes('auto_increment'));
}

function isLongCol(col) {
  return /text|blob|json/i.test(String(col?.type || ''));
}

function valuesForCopy(row, structure) {
  const out = {};
  for (const col of structure || []) {
    if (isAutoInc(col)) continue;
    out[col.field] = row[col.field] === undefined ? null : row[col.field];
  }
  return out;
}

/** Seed für Insert/Copy-Formular. Bei Copy: PK-Felder leeren (kein Duplicate). */
function buildInsertDraft(structure, seed = null, { clearPrimary = false } = {}) {
  const values = {};
  const nulls = {};
  for (const col of structure || []) {
    if (isAutoInc(col)) continue;
    const allowNull = String(col.null).toUpperCase() === 'YES';
    const isPk = col.key === 'PRI';
    if (clearPrimary && isPk) {
      values[col.field] = '';
      nulls[col.field] = false;
      continue;
    }
    let raw;
    if (seed && Object.prototype.hasOwnProperty.call(seed, col.field)) {
      raw = seed[col.field];
    } else if (col.default != null && String(col.default).toUpperCase() !== 'NULL') {
      raw = col.default;
    } else {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      values[col.field] = '';
      nulls[col.field] = allowNull;
    } else {
      values[col.field] = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
      nulls[col.field] = false;
    }
  }
  return { values, nulls };
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
  onCopyRow,
  onCopyMany,
  onDeleteMany,
  t,
}) {
  const [edit, setEdit] = useState(null);
  const [draft, setDraft] = useState('');
  const [asNull, setAsNull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const inputRef = useRef(null);
  const pkSet = useMemo(() => new Set(primaryKey || []), [primaryKey]);
  const nullable = useMemo(() => {
    const map = new Map();
    for (const col of structure || []) map.set(col.field, String(col.null).toUpperCase() === 'YES');
    return map;
  }, [structure]);

  const rowKeys = useMemo(
    () => rows.map((row, i) => rowSelKey(row, primaryKey, i)),
    [rows, primaryKey],
  );

  useEffect(() => {
    setSelected(new Set());
  }, [rows]);

  useEffect(() => {
    if (edit && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [edit]);

  const allSelected = rows.length > 0 && rowKeys.every((k) => selected.has(k));
  const someSelected = selected.size > 0;

  function toggleAll(checked) {
    setSelected(checked ? new Set(rowKeys) : new Set());
  }

  function toggleOne(key, checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

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
    <div className="db-browse-wrap">
      <div className="db-scroll">
        <table className="ws-table db-grid db-browse-grid">
          <thead>
            <tr>
              {canEdit && (
                <th className="db-act-col">
                  <div className="db-act-head">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={!rows.length || busy}
                      onChange={(e) => toggleAll(e.target.checked)}
                      title={t('db.selectAll')}
                      aria-label={t('db.selectAll')}
                    />
                    <span>{t('db.actions')}</span>
                  </div>
                </th>
              )}
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
            ) : rows.map((row, rowIdx) => {
              const key = rowKeys[rowIdx];
              return (
                <tr key={key} className={selected.has(key) ? 'is-selected' : undefined}>
                  {canEdit && (
                    <td className="db-act-cell">
                      <div className="db-act-row">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          disabled={busy || saving}
                          onChange={(e) => toggleOne(key, e.target.checked)}
                          aria-label={t('db.selectRow')}
                        />
                        <button
                          type="button"
                          className="db-act-btn"
                          disabled={busy || saving}
                          title={t('db.copyRow')}
                          onClick={() => onCopyRow?.(valuesForCopy(row, structure))}
                        >
                          {t('db.copyRow')}
                        </button>
                        <button
                          type="button"
                          className="db-act-btn danger"
                          disabled={busy || saving || !primaryKey?.length}
                          title={primaryKey?.length ? t('db.deleteRow') : t('db.noPrimaryKey')}
                          onClick={() => {
                            const pk = rowPk(row, primaryKey);
                            if (!pk) return;
                            if (!window.confirm(t('db.deleteConfirm'))) return;
                            onDeleteRow(pk);
                          }}
                        >
                          {t('db.deleteRow')}
                        </button>
                      </div>
                    </td>
                  )}
                  {columns.map((col) => {
                    const isEditing = edit?.rowIdx === rowIdx && edit?.col === col;
                    const { text, null: isNull } = cellValue(row[col]);
                    if (isEditing) {
                      return (
                        <td key={col} className="db-cell-edit">
                          <div
                            className="db-inline-edit"
                            title={t('db.editHint')}
                            onBlur={(e) => {
                              if (e.currentTarget.contains(e.relatedTarget)) return;
                              cancelEdit();
                            }}
                          >
                            {!asNull ? (
                              <input
                                ref={inputRef}
                                className="db-inline-input"
                                type="text"
                                value={draft}
                                disabled={saving}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelEdit();
                                  } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitEdit();
                                  }
                                }}
                              />
                            ) : (
                              <span className="db-inline-nullval">NULL</span>
                            )}
                            {nullable.get(col) && (
                              <label className="db-inline-null" title="NULL">
                                <input
                                  type="checkbox"
                                  checked={asNull}
                                  disabled={saving}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onChange={(e) => setAsNull(e.target.checked)}
                                />
                                <span>N</span>
                              </label>
                            )}
                            <button
                              type="button"
                              className="db-inline-ico ok"
                              disabled={saving}
                              title={t('common.save')}
                              aria-label={t('common.save')}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={commitEdit}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="db-inline-ico"
                              disabled={saving}
                              title={t('common.cancel')}
                              aria-label={t('common.cancel')}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={cancelEdit}
                            >
                              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                                <path d="M18 6 6 18M6 6l12 12" />
                              </svg>
                            </button>
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
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && !primaryKey?.length && (
        <p className="muted db-pk-warn">{t('db.noPrimaryKey')}</p>
      )}
      {canEdit && someSelected && (
        <div className="db-bulk">
          <span>{t('db.selected', { n: selected.size })}</span>
          <button
            type="button"
            className="db-act-btn"
            disabled={busy}
            onClick={() => {
              const picked = rows
                .filter((_, i) => selected.has(rowKeys[i]))
                .map((row) => valuesForCopy(row, structure));
              onCopyMany?.(picked);
            }}
          >
            {t('db.copySelected')}
          </button>
          <button
            type="button"
            className="db-act-btn danger"
            disabled={busy || !primaryKey?.length}
            onClick={() => {
              const pks = rows
                .filter((_, i) => selected.has(rowKeys[i]))
                .map((row) => rowPk(row, primaryKey))
                .filter(Boolean);
              if (!pks.length) return;
              if (!window.confirm(t('db.deleteSelectedConfirm', { n: pks.length }))) return;
              onDeleteMany?.(pks);
            }}
          >
            {t('db.deleteSelected')}
          </button>
          <button type="button" className="db-act-btn" disabled={busy} onClick={() => setSelected(new Set())}>
            {t('db.clearSelection')}
          </button>
        </div>
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
          <button type="submit" className="db-btn db-btn-primary" disabled={busy}>
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

function emptyColumnDraft() {
  return {
    name: '',
    type: 'varchar(50)',
    nullable: true,
    defaultValue: '',
    defaultNull: false,
    autoIncrement: false,
    comment: '',
  };
}

function columnToDraft(col) {
  const def = col.default;
  const isNullDefault = def === null;
  return {
    name: col.field || '',
    type: col.type || 'varchar(50)',
    nullable: String(col.null).toUpperCase() === 'YES',
    defaultValue: isNullDefault ? '' : String(def ?? ''),
    defaultNull: isNullDefault,
    autoIncrement: /\bauto_increment\b/i.test(String(col.extra || '')),
    comment: col.comment || '',
  };
}

function ColumnEditor({ draft, setDraft, busy, t, nameLocked = false }) {
  return (
    <div className="db-col-editor">
      <label className="db-col-field">
        <span>{t('db.column')}</span>
        <input
          className="db-insert-input"
          value={draft.name}
          disabled={busy || nameLocked}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="column_name"
        />
      </label>
      <label className="db-col-field">
        <span>{t('db.col.type')}</span>
        <input
          className="db-insert-input"
          list="db-type-suggestions"
          value={draft.type}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
        />
        <datalist id="db-type-suggestions">
          {TYPE_SUGGESTIONS.map((x) => <option key={x} value={x} />)}
        </datalist>
      </label>
      <label className="db-col-check">
        <input
          type="checkbox"
          checked={draft.nullable}
          disabled={busy || draft.autoIncrement}
          onChange={(e) => setDraft((d) => ({ ...d, nullable: e.target.checked }))}
        />
        <span>{t('db.col.null')}</span>
      </label>
      <label className="db-col-check">
        <input
          type="checkbox"
          checked={draft.autoIncrement}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({
            ...d,
            autoIncrement: e.target.checked,
            nullable: e.target.checked ? false : d.nullable,
          }))}
        />
        <span>AUTO_INCREMENT</span>
      </label>
      <label className="db-col-field">
        <span>{t('db.col.default')}</span>
        <div className="db-col-default">
          <input
            className="db-insert-input"
            value={draft.defaultNull ? '' : draft.defaultValue}
            disabled={busy || draft.defaultNull || draft.autoIncrement}
            onChange={(e) => setDraft((d) => ({ ...d, defaultValue: e.target.value, defaultNull: false }))}
            placeholder={draft.defaultNull ? 'NULL' : ''}
          />
          <label className="db-col-check compact">
            <input
              type="checkbox"
              checked={draft.defaultNull}
              disabled={busy || draft.autoIncrement}
              onChange={(e) => setDraft((d) => ({ ...d, defaultNull: e.target.checked }))}
            />
            <span>NULL</span>
          </label>
        </div>
      </label>
      <label className="db-col-field grow">
        <span>{t('db.col.comment')}</span>
        <input
          className="db-insert-input"
          value={draft.comment}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
        />
      </label>
    </div>
  );
}

function draftToPayload(draft) {
  return {
    name: String(draft.name || '').trim(),
    type: String(draft.type || '').trim(),
    nullable: Boolean(draft.nullable),
    autoIncrement: Boolean(draft.autoIncrement),
    comment: String(draft.comment || ''),
    defaultValue: draft.autoIncrement
      ? undefined
      : (draft.defaultNull ? null : draft.defaultValue),
  };
}

function StructureEditor({
  structure,
  indexes,
  busy,
  canEdit,
  onSaveColumn,
  onAddColumn,
  onDropColumn,
  onDropIndex,
  t,
}) {
  const [editField, setEditField] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState(() => emptyColumnDraft());
  const [afterCol, setAfterCol] = useState('');

  function startEdit(col) {
    setAdding(false);
    setEditField(col.field);
    setEditDraft(columnToDraft(col));
  }

  function cancelEdit() {
    setEditField(null);
    setEditDraft(null);
  }

  const afterOpts = useMemo(
    () => [
      { value: '', label: t('db.afterEnd') },
      { value: 'FIRST', label: t('db.afterFirst') },
      ...structure.map((c) => ({ value: c.field, label: t('db.afterCol', { name: c.field }) })),
    ],
    [structure, t],
  );

  return (
    <div className="db-structure">
      <div className="db-scroll">
        <table className="ws-table db-grid db-structure-grid">
          <thead>
            <tr>
              <th>{t('db.col.field')}</th>
              <th>{t('db.col.type')}</th>
              <th>{t('db.col.null')}</th>
              <th>{t('db.col.key')}</th>
              <th>{t('db.col.default')}</th>
              <th>{t('db.col.extra')}</th>
              {canEdit && <th>{t('db.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {structure.length === 0 ? (
              <tr><td colSpan={canEdit ? 7 : 6} className="muted">{t('db.noColumns')}</td></tr>
            ) : structure.map((col) => (
              <tr key={col.field} className={editField === col.field ? 'is-editing' : undefined}>
                <td className="mono">{col.field}</td>
                <td className="mono muted">{col.type}</td>
                <td>{col.null}</td>
                <td>{col.key || '—'}</td>
                <td className="mono">{col.default === null ? 'NULL' : String(col.default ?? '—')}</td>
                <td className="muted">{col.extra || '—'}</td>
                {canEdit && (
                  <td>
                    <div className="db-act-row">
                      <button type="button" className="db-act-btn" disabled={busy} onClick={() => startEdit(col)}>
                        {t('db.editCol')}
                      </button>
                      <button
                        type="button"
                        className="db-act-btn danger"
                        disabled={busy || structure.length <= 1}
                        onClick={() => {
                          if (!window.confirm(t('db.dropColConfirm', { name: col.field }))) return;
                          onDropColumn(col.field);
                        }}
                      >
                        {t('db.dropCol')}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && editField && editDraft && (
        <div className="db-struct-panel">
          <h4 className="db-insert-title">{t('db.editColTitle', { name: editField })}</h4>
          <ColumnEditor draft={editDraft} setDraft={setEditDraft} busy={busy} t={t} />
          <div className="db-form-actions">
            <button
              type="button"
              className="db-btn db-btn-primary"
              disabled={busy || !editDraft.name.trim() || !editDraft.type.trim()}
              onClick={async () => {
                try {
                  await onSaveColumn(editField, draftToPayload(editDraft));
                  cancelEdit();
                } catch { /* Fehler bereits gesetzt */ }
              }}
            >
              {t('db.saveCol')}
            </button>
            <button type="button" className="db-btn" disabled={busy} onClick={cancelEdit}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="db-struct-panel">
          {!adding ? (
            <button
              type="button"
              className="db-btn db-btn-primary"
              disabled={busy}
              onClick={() => {
                cancelEdit();
                setAddDraft(emptyColumnDraft());
                setAfterCol(structure[structure.length - 1]?.field || '');
                setAdding(true);
              }}
            >
              {t('db.addCol')}
            </button>
          ) : (
            <>
              <h4 className="db-insert-title">{t('db.addCol')}</h4>
              <ColumnEditor draft={addDraft} setDraft={setAddDraft} busy={busy} t={t} />
              <label className="db-col-field">
                <span>{t('db.afterPos')}</span>
                <OrbitSelect
                  className="db-after-select"
                  value={afterCol}
                  options={afterOpts}
                  onChange={(v) => setAfterCol(v)}
                />
              </label>
              <div className="db-form-actions">
                <button
                  type="button"
                  className="db-btn db-btn-primary"
                  disabled={busy || !addDraft.name.trim() || !addDraft.type.trim()}
                  onClick={async () => {
                    try {
                      await onAddColumn(draftToPayload(addDraft), afterCol || null);
                      setAdding(false);
                      setAddDraft(emptyColumnDraft());
                    } catch { /* Fehler bereits gesetzt */ }
                  }}
                >
                  {t('db.addColSave')}
                </button>
                <button type="button" className="db-btn" disabled={busy} onClick={() => setAdding(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="db-struct-panel">
        <h4 className="db-insert-title">{t('db.indexes')}</h4>
        {indexes.length === 0 ? (
          <p className="muted">{t('db.noIndexes')}</p>
        ) : (
          <div className="db-scroll">
            <table className="ws-table db-grid">
              <thead>
                <tr>
                  <th>{t('db.indexName')}</th>
                  <th>{t('db.indexType')}</th>
                  <th>{t('db.indexCols')}</th>
                  {canEdit && <th>{t('db.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {indexes.map((idx) => (
                  <tr key={idx.name}>
                    <td className="mono">{idx.name}</td>
                    <td className="muted">
                      {idx.primary ? 'PRIMARY' : (idx.unique ? 'UNIQUE' : 'INDEX')}
                      {idx.type ? ` · ${idx.type}` : ''}
                    </td>
                    <td className="mono">{(idx.columns || []).join(', ')}</td>
                    {canEdit && (
                      <td>
                        <button
                          type="button"
                          className="db-act-btn danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(t('db.dropIndexConfirm', { name: idx.name }))) return;
                            onDropIndex(idx.name);
                          }}
                        >
                          {t('db.dropIndex')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InsertForm({ structure, busy, onInsert, onCancel, t, mode = 'insert', draft }) {
  const baseline = useMemo(
    () => draft || buildInsertDraft(structure),
    [structure, draft],
  );
  const [values, setValues] = useState(baseline.values);
  const [nulls, setNulls] = useState(baseline.nulls);

  function reset() {
    setValues(baseline.values);
    setNulls(baseline.nulls);
  }

  function setValue(field, text) {
    setValues((v) => ({ ...v, [field]: text }));
    setNulls((n) => ({ ...n, [field]: false }));
  }

  function toggleNull(field, on, allowNull) {
    if (!allowNull) return;
    setNulls((n) => ({ ...n, [field]: on }));
    if (on) setValues((v) => ({ ...v, [field]: '' }));
  }

  return (
    <form
      className="db-insert"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = {};
        for (const col of structure || []) {
          if (isAutoInc(col)) continue;
          const allowNull = String(col.null).toUpperCase() === 'YES';
          if (nulls[col.field]) {
            payload[col.field] = null;
            continue;
          }
          const raw = values[col.field] ?? '';
          if (raw === '' && allowNull) payload[col.field] = null;
          else payload[col.field] = raw;
        }
        onInsert(payload);
      }}
    >
      <div className="db-insert-head">
        <h4 className="db-insert-title">
          {mode === 'copy' ? t('db.copyAsNew') : t('db.insertRow')}
        </h4>
        {mode === 'copy' && (
          <p className="muted db-insert-hint">{t('db.copyPkHint')}</p>
        )}
      </div>
      <div className="db-insert-scroll">
        <table className="db-insert-table">
          <thead>
            <tr>
              <th>{t('db.column')}</th>
              <th>{t('db.col.type')}</th>
              <th>{t('db.col.null')}</th>
              <th>{t('db.value')}</th>
            </tr>
          </thead>
          <tbody>
            {(structure || []).map((col) => {
              const allowNull = String(col.null).toUpperCase() === 'YES';
              const isAi = isAutoInc(col);
              const long = isLongCol(col);
              const isNull = Boolean(nulls[col.field]);
              return (
                <tr key={col.field} className={col.key === 'PRI' ? 'is-pk' : undefined}>
                  <td className="db-insert-name">
                    <code>{col.field}</code>
                    {col.key === 'PRI' ? <span className="db-insert-badge">PK</span> : null}
                    {isAi ? <span className="db-insert-badge ai">AI</span> : null}
                  </td>
                  <td className="db-insert-type muted mono">{col.type || '—'}</td>
                  <td className="db-insert-null">
                    {isAi ? (
                      <span className="muted">—</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isNull}
                        disabled={busy || !allowNull}
                        title={allowNull ? t('db.col.null') : t('db.notNullable')}
                        onChange={(e) => toggleNull(col.field, e.target.checked, allowNull)}
                      />
                    )}
                  </td>
                  <td className="db-insert-val">
                    {isAi ? (
                      <input className="db-insert-input" disabled placeholder="AUTO_INCREMENT" />
                    ) : long ? (
                      <textarea
                        className="db-insert-input db-insert-area"
                        rows={4}
                        value={isNull ? '' : (values[col.field] ?? '')}
                        disabled={busy || isNull}
                        onChange={(e) => setValue(col.field, e.target.value)}
                      />
                    ) : (
                      <input
                        className="db-insert-input"
                        value={isNull ? '' : (values[col.field] ?? '')}
                        disabled={busy || isNull}
                        onChange={(e) => setValue(col.field, e.target.value)}
                        placeholder={col.key === 'PRI' && mode === 'copy' ? t('db.newPkPh') : undefined}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="db-form-actions">
        <button type="submit" className="db-btn db-btn-primary" disabled={busy}>{t('db.insert')}</button>
        <button type="button" className="db-btn" disabled={busy} onClick={reset}>{t('db.insertReset')}</button>
        <button type="button" className="db-btn" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
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
  const [indexes, setIndexes] = useState([]);
  const [browse, setBrowse] = useState({
    rows: [], columns: [], total: 0, offset: 0, limit: 25, primaryKey: [],
  });
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [rowFilter, setRowFilter] = useState('');
  const [insertMode, setInsertMode] = useState('insert');
  const [insertDraft, setInsertDraft] = useState(null);
  const [insertKey, setInsertKey] = useState(0);

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
    setIndexes(d.indexes || []);
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

  async function saveColumn(oldName, def) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api('/api/database/structure', {
        method: 'POST',
        body: { action: 'modify', table, column: oldName, def },
      });
      setMsg(t('db.colSaved'));
      await loadStructure(table);
    } catch (e) {
      setErr(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function addColumn(def, after) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api('/api/database/structure', {
        method: 'POST',
        body: { action: 'add', table, column: def, after: after || null },
      });
      setMsg(t('db.colAdded'));
      await loadStructure(table);
    } catch (e) {
      setErr(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function dropColumn(field) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api('/api/database/structure', {
        method: 'POST',
        body: { action: 'drop', table, column: field },
      });
      setMsg(t('db.colDropped'));
      await loadStructure(table);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dropIndex(name) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api('/api/database/structure', {
        method: 'POST',
        body: { action: 'dropIndex', table, index: name },
      });
      setMsg(t('db.indexDropped'));
      await loadStructure(table);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!table) return;
    setErr('');
    if (tab === 'structure' || tab === 'search' || tab === 'insert') {
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
    setInsertMode('insert');
    setInsertDraft(null);
    setSearchResult({ rows: [], columns: [] });
    setSql(`SELECT * FROM \`${name.replace(/`/g, '')}\` LIMIT 50`);
    setSqlResult(null);
    if (window.matchMedia('(max-width: 900px)').matches) setNavOpen(false);
  }

  function goDatabase() {
    setTable(null);
    setTab('overview');
    setPage(0);
    setInsertMode('insert');
    setInsertDraft(null);
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

  function closeInsert() {
    setInsertDraft(null);
    setInsertMode('insert');
    if (table) setTab('browse');
  }

  async function openInsertEditor(mode = 'insert', seed = null) {
    setErr('');
    setMsg('');
    try {
      let cols = structure;
      if (!cols.length && table) {
        cols = await loadStructure(table);
      }
      const draft = buildInsertDraft(cols, seed, { clearPrimary: mode === 'copy' });
      setInsertMode(mode);
      setInsertDraft(draft);
      setInsertKey((k) => k + 1);
      setTab('insert');
    } catch (e) {
      setErr(e.message);
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
      const copied = insertMode === 'copy';
      setMsg(
        d.insertId
          ? (copied ? t('db.copiedId', { id: d.insertId }) : t('db.insertedId', { id: d.insertId }))
          : (copied ? t('db.copied') : t('db.inserted')),
      );
      closeInsert();
      setPage(0);
      await loadBrowse(table, 0, pageSize);
      return d;
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyRow(values) {
    openInsertEditor('copy', values);
  }

  function copyMany(valueList) {
    if (!valueList?.length) return;
    openInsertEditor('copy', valueList[0]);
    if (valueList.length > 1) {
      setMsg(t('db.copyOneOfMany', { n: valueList.length }));
    }
  }

  async function deleteMany(pks) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      let n = 0;
      for (const pk of pks) {
        await api('/api/database/row', {
          method: 'POST',
          body: { action: 'delete', table, pk },
        });
        n += 1;
      }
      setMsg(t('db.deletedMany', { n }));
      await loadBrowse(table, page * pageSize, pageSize);
    } catch (e) {
      setErr(e.message);
      try { await loadBrowse(table, page * pageSize, pageSize); } catch { /* */ }
    } finally {
      setBusy(false);
    }
  }

  const pageCount = table && tab === 'browse'
    ? Math.max(1, Math.ceil(browse.total / pageSize))
    : 1;

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
              onClick={() => { setTab('overview'); setTable(null); setInsertDraft(null); setInsertMode('insert'); }}
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
                {canEdit && (
                  <button
                    type="button"
                    role="tab"
                    className={`db-tab${tab === 'insert' ? ' active' : ''}`}
                    onClick={() => openInsertEditor('insert')}
                  >
                    {t('db.insertTab')}
                  </button>
                )}
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
              <StructureEditor
                structure={structure}
                indexes={indexes}
                busy={busy}
                canEdit={canEdit}
                onSaveColumn={saveColumn}
                onAddColumn={addColumn}
                onDropColumn={dropColumn}
                onDropIndex={dropIndex}
                t={t}
              />
            )}

            {tab === 'insert' && table && canEdit && (
              <InsertForm
                key={insertKey}
                structure={structure}
                busy={busy}
                mode={insertMode}
                draft={insertDraft || buildInsertDraft(structure)}
                onInsert={insertRow}
                onCancel={closeInsert}
                t={t}
              />
            )}

            {tab === 'browse' && table && (
              <>
                <div className="db-toolbar">
                  <div className="db-toolbar-left">
                    <span className="db-toolbar-meta">
                      {browse.total === 0 ? t('db.rowsZero') : (
                        t('db.rowsRange', {
                          from: browse.offset + 1,
                          to: Math.min(browse.offset + browse.limit, browse.total),
                          total: browse.total,
                        })
                      )}
                    </span>
                    <OrbitSelect
                      className="db-toolbar-limit"
                      value={pageSize}
                      options={PAGE_SIZE_OPTS}
                      placeholder={t('db.limit')}
                      onChange={(v) => { setPageSize(Number(v)); setPage(0); }}
                    />
                    <div className="db-toolbar-pages">
                      <button type="button" className="db-nav-btn" disabled={page <= 0 || busy} onClick={() => setPage((p) => p - 1)} aria-label={t('common.back')}>‹</button>
                      <span>{page + 1}/{pageCount}</span>
                      <button type="button" className="db-nav-btn" disabled={page + 1 >= pageCount || busy} onClick={() => setPage((p) => p + 1)} aria-label={t('db.next')}>›</button>
                    </div>
                  </div>
                  <div className="db-toolbar-right">
                    <input
                      className="db-row-filter"
                      type="search"
                      value={rowFilter}
                      onChange={(e) => setRowFilter(e.target.value)}
                      placeholder={t('db.rowFilterPh')}
                      aria-label={t('db.rowFilterPh')}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        className="db-tool-btn"
                        disabled={busy}
                        onClick={() => openInsertEditor('insert')}
                      >
                        {t('db.insertRow')}
                      </button>
                    )}
                    <button type="button" className="db-tool-btn" disabled={busy} onClick={refreshBrowse}>
                      {t('db.refresh')}
                    </button>
                    <button
                      type="button"
                      className="db-tool-btn"
                      disabled={!browse.rows.length}
                      onClick={() => exportCsv(`${table}.csv`, browse.columns, browse.rows)}
                    >
                      {t('db.csv')}
                    </button>
                  </div>
                </div>

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
                  onCopyRow={copyRow}
                  onCopyMany={copyMany}
                  onDeleteMany={deleteMany}
                  t={t}
                />
              </>
            )}

            {tab === 'search' && table && (
              <>
                <form className="db-search-form" onSubmit={runSearch}>
                  <OrbitSelect
                    className="db-search-col"
                    label={t('db.column')}
                    value={searchCol}
                    options={structure.map((c) => ({ value: c.field, label: c.field }))}
                    onChange={(v) => setSearchCol(v)}
                  />
                  <label className="field grow">
                    <span>{t('db.contains')}</span>
                    <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t('db.searchPh')} />
                  </label>
                  <button type="submit" className="db-btn db-btn-primary" disabled={busy}>{t('db.search')}</button>
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
