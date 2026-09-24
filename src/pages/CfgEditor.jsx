import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Page, PageHeader, Split } from '../components/Ui.jsx';

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

export default function CfgEditor() {
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

  const taRef = useRef(null);
  const searchRef = useRef(null);

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
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
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
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
    await loadFile(rel);
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
      setMsg(`Gespeichert · ${d.file}${d.resources ? ` · ${d.resources} Ressourcen` : ''}`);
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
    // Scroll roughly into view
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
        <span className="cfg-side-title">CFG-Dateien</span>
      </div>
      <input
        className="cfg-side-filter"
        type="search"
        placeholder="Dateien filtern…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="CFG-Dateien filtern"
      />
      <div className="cfg-side-list" role="listbox" aria-label="CFG-Dateien">
        {filteredFiles.length === 0 && (
          <p className="cfg-side-empty">{loading ? 'Lädt…' : 'Keine .cfg gefunden'}</p>
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
              {f.primary ? 'aktiv' : formatBytes(f.size)}
            </span>
          </button>
        ))}
      </div>
      {root && (
        <div className="cfg-side-foot" title={root}>
          <span className="muted">{files.length} Datei{files.length === 1 ? '' : 'en'}</span>
        </div>
      )}
    </div>
  );

  return (
    <Page className="cfg-page">
      <PageHeader
        eyebrow="Server"
        title="CFG"
        description={
          activeFile
            ? `${activeFile}${meta && !meta.writable ? ' · schreibgeschützt' : ''}${meta?.primary ? ` · ${meta.resources} ensures` : ''}${dirty ? ' · ungespeichert' : ''}`
            : 'Server-Konfiguration'
        }
        actions={(
          <div className="cfg-head-actions">
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => {
                setSearchOpen(true);
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              Suche
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title="Dateiliste neu scannen und aktuelle Datei neu laden"
              onClick={() => reloadAll()}
              disabled={loading}
            >
              Neu laden
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
              {dirty && <span className="cfg-pill dirty">geändert</span>}
            </div>
            {(searchOpen || search) && (
              <div className="cfg-find">
                <input
                  ref={searchRef}
                  className="cfg-find-input"
                  type="search"
                  placeholder="In Datei suchen…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      findNext(e.shiftKey ? -1 : 1);
                    }
                  }}
                  aria-label="In CFG suchen"
                />
                <span className="cfg-find-count">
                  {search
                    ? (matches.length ? `${matchIdx + 1}/${matches.length}` : '0')
                    : ''}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => findNext(-1)} disabled={!matches.length} aria-label="Vorheriger Treffer">↑</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => findNext(1)} disabled={!matches.length} aria-label="Nächster Treffer">↓</button>
                <label className="cfg-find-case" title="Groß-/Kleinschreibung">
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
                  aria-label="Suche schließen"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="cfg-toolbar-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving || !dirty}>
                {saving ? 'Speichert…' : 'Speichern'}
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
            aria-label={`Inhalt von ${activeFile || 'CFG'}`}
          />
          <div className="cfg-footer">
            <span className="muted">Ctrl+F Suche · Ctrl+S Speichern · Secrets bleiben redacted</span>
          </div>
        </form>
      </Split>
    </Page>
  );
}
