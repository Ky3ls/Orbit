import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Page, PageHeader, Split } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function findMatches(text, query, caseSensitive) {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const out = [];
  let from = 0;
  while (from <= hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + Math.max(1, needle.length);
    if (out.length > 2000) break;
  }
  return out;
}

function normalizeCfgName(raw) {
  let name = String(raw || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!name) return '';
  if (!/\.cfg$/i.test(name)) name = `${name}.cfg`;
  return name;
}

export default function CfgEditor() {
  const { t } = useI18n();
  const [files, setFiles] = useState([]);
  const [root, setRoot] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState('minimal');
  const [creating, setCreating] = useState(false);

  const taRef = useRef(null);
  const searchRef = useRef(null);
  const newNameRef = useRef(null);

  const matches = useMemo(
    () => findMatches(content, search, caseSensitive),
    [content, search, caseSensitive],
  );

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.rel.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
  }, [files, filter]);

  const loadList = useCallback(async () => {
    const d = await api('/api/cfg/list');
    setFiles(d.files || []);
    setRoot(d.root || '');
    return d.files || [];
  }, []);

  const loadFile = useCallback(async (rel, { soft } = {}) => {
    if (!soft) setLoading(true);
    setErr('');
    setMsg('');
    try {
      const q = rel ? `?file=${encodeURIComponent(rel)}` : '';
      const d = await api(`/api/cfg${q}`);
      setContent(d.content || '');
      setMeta(d);
      setActiveFile(d.file || rel || 'server.cfg');
      setDirty(false);
      setMatchIdx(0);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadList();
        if (cancelled) return;
        const primary = list.find((f) => f.primary) || list[0];
        await loadFile(primary?.rel || '');
      } catch (e) {
        if (!cancelled) {
          setErr(e.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadList, loadFile]);

  function onContentChange(e) {
    setContent(e.target.value);
    setDirty(true);
    setMsg('');
  }

  async function reloadAll() {
    if (dirty && !window.confirm(t('cfg.discard'))) return;
    setErr('');
    setMsg('');
    try {
      const list = await loadList();
      const stillThere = list.find((f) => f.rel === activeFile);
      const next = stillThere?.rel || list.find((f) => f.primary)?.rel || list[0]?.rel || '';
      await loadFile(next);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function selectFile(rel) {
    if (rel === activeFile) return;
    if (dirty && !window.confirm(t('cfg.discard'))) return;
    await loadFile(rel);
  }

  function openCreate() {
    setCreateOpen(true);
    setNewName('');
    setNewTemplate('minimal');
    setErr('');
    requestAnimationFrame(() => newNameRef.current?.focus());
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
  }

  async function createCfg(e, { overwrite = false } = {}) {
    e?.preventDefault?.();
    const file = normalizeCfgName(newName);
    if (!file) {
      setErr(t('cfg.newName'));
      return;
    }
    if (dirty && !overwrite && !window.confirm(t('cfg.discard'))) return;
    setCreating(true);
    setErr('');
    setMsg('');
    try {
      let d;
      try {
        d = await api('/api/cfg', {
          method: 'POST',
          body: { file, template: newTemplate, overwrite },
        });
      } catch (apiErr) {
        if (apiErr.status === 409 || /existiert bereits|already exists/i.test(apiErr.message || '')) {
          if (!window.confirm(t('cfg.newExists'))) {
            setCreating(false);
            return;
          }
          d = await api('/api/cfg', {
            method: 'POST',
            body: { file, template: newTemplate, overwrite: true },
          });
        } else {
          throw apiErr;
        }
      }
      const rel = d.file || file;
      setCreateOpen(false);
      setMsg(d.overwritten ? t('cfg.newOverwritten', { file: rel }) : t('cfg.newCreated', { file: rel }));
      await loadList();
      await loadFile(rel);
    } catch (error) {
      setErr(error.message);
    } finally {
      setCreating(false);
    }
  }

  async function save(e) {
    e?.preventDefault?.();
    setErr('');
    setMsg('');
    setSaving(true);
    try {
      const d = await api('/api/cfg', {
        method: 'PUT',
        body: { content, file: activeFile },
      });
      const savedName = d.file || activeFile;
      setMsg(
        d.resources
          ? `${t('cfg.saved', { file: savedName })} · ${t('cfg.ensures', { n: d.resources })}`
          : t('cfg.saved', { file: savedName }),
      );
      setDirty(false);
      await loadList();
      await loadFile(activeFile || d.file, { soft: true });
    } catch (error) {
      setErr(error.message);
    } finally {
      setSaving(false);
    }
  }

  function jumpToMatch(index) {
    if (!matches.length || !taRef.current) return;
    const i = ((index % matches.length) + matches.length) % matches.length;
    setMatchIdx(i);
    const start = matches[i];
    const end = start + search.length;
    const el = taRef.current;
    el.focus();
    el.setSelectionRange(start, end);
    const before = content.slice(0, start);
    const line = before.split('\n').length;
    const lineHeight = 18.5;
    el.scrollTop = Math.max(0, (line - 4) * lineHeight);
  }

  function findNext(dir = 1) {
    if (!matches.length) return;
    jumpToMatch(matchIdx + dir);
  }

  useEffect(() => {
    if (!search) {
      setMatchIdx(0);
      return;
    }
    setMatchIdx(0);
  }, [search, caseSensitive, activeFile]);

  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving && dirty) {
          document.querySelector('.cfg-workspace')?.requestSubmit?.();
        }
        return;
      }
      if (e.key === 'F3' || (mod && e.key.toLowerCase() === 'g')) {
        if (!search && !searchOpen) return;
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        if (!matches.length || !taRef.current) return;
        setMatchIdx((prev) => {
          const next = ((prev + dir) % matches.length + matches.length) % matches.length;
          const start = matches[next];
          const end = start + search.length;
          const el = taRef.current;
          el.focus();
          el.setSelectionRange(start, end);
          const before = content.slice(0, start);
          const line = before.split('\n').length;
          el.scrollTop = Math.max(0, (line - 4) * 18.5);
          return next;
        });
        return;
      }
      if (e.key === 'Escape' && searchOpen) setSearchOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, dirty, search, searchOpen, matches, content]);

  const aside = (
    <div className="cfg-side">
      <div className="cfg-side-head">
        <span className="cfg-side-title">{t('cfg.files')}</span>
        <button
          type="button"
          className="btn btn-sm btn-primary cfg-side-new"
          onClick={openCreate}
          title={t('cfg.newTitle')}
        >
          {t('cfg.new')}
        </button>
      </div>
      <input
        className="cfg-side-filter"
        type="search"
        placeholder={t('cfg.filterPh')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label={t('cfg.filterAria')}
      />
      <div className="cfg-side-list" role="listbox" aria-label={t('cfg.files')}>
        {filteredFiles.length === 0 && (
          <p className="cfg-side-empty">{loading ? t('common.loading') : t('cfg.empty')}</p>
        )}
        {filteredFiles.map((f) => (
          <button
            key={f.rel}
            type="button"
            role="option"
            aria-selected={f.rel === activeFile}
            className={`cfg-side-item${f.rel === activeFile ? ' active' : ''}${f.primary ? ' primary' : ''}`}
            onClick={() => selectFile(f.rel)}
            title={f.rel}
          >
            <span className="cfg-side-item-name">{f.name}</span>
            {f.rel !== f.name && <span className="cfg-side-item-path">{f.rel}</span>}
            <span className="cfg-side-item-meta">
              {f.primary ? t('cfg.active') : formatBytes(f.size)}
            </span>
          </button>
        ))}
      </div>
      {root && (
        <div className="cfg-side-foot" title={root}>
          <span className="muted">{files.length === 1 ? t('cfg.fileCount', { n: files.length }) : t('cfg.fileCountPlural', { n: files.length })}</span>
        </div>
      )}
    </div>
  );

  return (
    <Page className="cfg-page ws-module-flush">
      <PageHeader
        eyebrow={t('cfg.eyebrow')}
        title={t('cfg.title')}
        description={
          activeFile
            ? `${activeFile}${meta && !meta.writable ? ` · ${t('cfg.readonly')}` : ''}${meta?.primary ? ` · ${t('cfg.ensures', { n: meta.resources })}` : ''}${dirty ? ` · ${t('cfg.unsaved')}` : ''}`
            : t('cfg.desc')
        }
        actions={(
          <div className="cfg-head-actions">
            <button
              className="btn btn-sm btn-primary"
              type="button"
              onClick={openCreate}
            >
              {t('cfg.new')}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => {
                setSearchOpen(true);
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              {t('cfg.search')}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={t('cfg.refreshTitle')}
              onClick={() => reloadAll()}
              disabled={loading}
            >
              {t('cfg.reload')}
            </button>
          </div>
        )}
      />

      {err && <div className="err">{err}</div>}
      {msg && <div className="banner">{msg}</div>}
      {meta?.warnings?.length > 0 && (
        <div className="banner warn">{meta.warnings.join(' · ')}</div>
      )}

      <Split aside={aside} asideWidth={240}>
        <form className="cfg-workspace" onSubmit={save}>
          <div className="cfg-toolbar">
            <div className="cfg-toolbar-file">
              <span className="cfg-file-badge">{activeFile || '—'}</span>
              {meta?.primary && <span className="cfg-pill">server.cfg</span>}
              {dirty && <span className="cfg-pill dirty">{t('cfg.dirty')}</span>}
            </div>
            {(searchOpen || search) && (
              <div className="cfg-find">
                <input
                  ref={searchRef}
                  className="cfg-find-input"
                  type="search"
                  placeholder={t('cfg.findPh')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      findNext(e.shiftKey ? -1 : 1);
                    }
                  }}
                  aria-label={t('cfg.findAria')}
                />
                <span className="cfg-find-count">
                  {search
                    ? (matches.length ? `${matchIdx + 1}/${matches.length}` : '0')
                    : ''}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => findNext(-1)} disabled={!matches.length} aria-label={t('cfg.findPrev')}>↑</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => findNext(1)} disabled={!matches.length} aria-label={t('cfg.findNext')}>↓</button>
                <label className="cfg-find-case" title={t('cfg.findCase')}>
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                  />
                  Aa
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSearch(''); setSearchOpen(false); }}
                  aria-label={t('cfg.findClose')}
                >
                  ✕
                </button>
              </div>
            )}
            <div className="cfg-toolbar-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving || !dirty}>
                {saving ? t('cfg.saving') : t('common.save')}
              </button>
            </div>
          </div>
          <textarea
            ref={taRef}
            className="mono cfg-area"
            value={content}
            onChange={onContentChange}
            spellCheck={false}
            disabled={loading && !content}
            aria-label={t('cfg.contentAria', { file: activeFile || 'CFG' })}
          />
          <div className="cfg-footer">
            <span className="muted">{t('cfg.footer')}</span>
          </div>
        </form>
      </Split>

      {createOpen && (
        <Modal title={t('cfg.newTitle')} onClose={closeCreate}>
          <form className="cfg-create-form" onSubmit={(e) => createCfg(e)}>
            <label className="field">
              <span>{t('cfg.newName')}</span>
              <input
                ref={newNameRef}
                type="text"
                className="mono"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('cfg.newNamePh')}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <p className="cfg-create-hint muted">{t('cfg.newNameHint')}</p>
            <fieldset className="cfg-create-template">
              <legend>{t('cfg.newTemplate')}</legend>
              <label className="cfg-create-opt">
                <input
                  type="radio"
                  name="cfg-template"
                  value="minimal"
                  checked={newTemplate === 'minimal'}
                  onChange={() => setNewTemplate('minimal')}
                />
                <span>{t('cfg.newTemplateMinimal')}</span>
              </label>
              <label className="cfg-create-opt">
                <input
                  type="radio"
                  name="cfg-template"
                  value="empty"
                  checked={newTemplate === 'empty'}
                  onChange={() => setNewTemplate('empty')}
                />
                <span>{t('cfg.newTemplateEmpty')}</span>
              </label>
            </fieldset>
            <div className="cfg-create-actions">
              <button type="button" className="btn btn-sm" onClick={closeCreate} disabled={creating}>
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={creating || !newName.trim()}
              >
                {creating ? t('cfg.newCreating') : t('cfg.newCreate')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
