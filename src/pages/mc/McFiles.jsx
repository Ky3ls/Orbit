import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import CfgCode, { langFor } from '../../components/CfgCode.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fileIcon(e) {
  if (e.dir) return 'folder';
  if (/\.jar$/i.test(e.name)) return 'box';
  if (/\.(ya?ml|json|toml|properties|cfg|conf)$/i.test(e.name)) return 'cfg';
  if (/\.(log|txt|md)$/i.test(e.name)) return 'log';
  if (/\.(gz|zip|tar|mca|dat)$/i.test(e.name)) return 'db';
  return 'cfg';
}

export default function McFiles({ inst }) {
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') || '';
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const dirty = edit && content !== edit.content;

  const go = useCallback((p) => {
    const next = new URLSearchParams(params);
    if (p) next.set('dir', p); else next.delete('dir');
    setParams(next, { replace: false });
  }, [params, setParams]);

  const load = useCallback(() => {
    setList(null);
    api(`/api/mc/instances/${inst.id}/files?path=${encodeURIComponent(dir)}`)
      .then(setList)
      .catch((e) => { toast.err(e.message); setList({ path: dir, entries: [], abs: inst.path }); });
  }, [inst.id, inst.path, dir]);
  useEffect(() => { load(); setFilter(''); }, [load]);

  async function open(e) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.dir) { go(p); return; }
    if (!e.editable) { download(p); return; }
    try {
      const d = await api(`/api/mc/instances/${inst.id}/files?read=1&path=${encodeURIComponent(p)}`);
      setEdit(d);
      setContent(d.content);
    } catch (err) { toast.err(err.message); }
  }

  function download(p) {
    window.location.href = `/api/mc/instances/${inst.id}/files/download?path=${encodeURIComponent(p)}`;
  }

  async function save() {
    setBusy(true);
    try {
      const d = await api(`/api/mc/instances/${inst.id}/files`, { method: 'PUT', body: { path: edit.path, content } });
      setEdit({ ...edit, content });
      toast.ok(`${edit.path.split('/').pop()} gespeichert`, { text: d.restartNeeded ? 'Viele Änderungen greifen erst nach einem Neustart.' : undefined });
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  useEffect(() => {
    if (!edit) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function remove(e) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (!window.confirm(`${e.dir ? 'Ordner' : 'Datei'} „${e.name}“ wirklich löschen?${e.dir ? '\nDer gesamte Inhalt wird entfernt.' : ''}`)) return;
    try {
      await api(`/api/mc/instances/${inst.id}/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
      toast.ok(`${e.name} gelöscht`);
      load();
    } catch (err) { toast.err(err.message); }
  }

  async function rename(e) {
    const name = window.prompt('Neuer Name', e.name);
    if (!name || name === e.name) return;
    const base = dir ? `${dir}/` : '';
    try {
      await api(`/api/mc/instances/${inst.id}/files/rename`, { method: 'POST', body: { from: base + e.name, to: base + name } });
      load();
    } catch (err) { toast.err(err.message); }
  }

  async function mkdir() {
    const name = window.prompt('Name des neuen Ordners');
    if (!name) return;
    try {
      await api(`/api/mc/instances/${inst.id}/files/mkdir`, { method: 'POST', body: { path: dir ? `${dir}/${name}` : name } });
      load();
    } catch (err) { toast.err(err.message); }
  }

  async function newFile() {
    const name = window.prompt('Name der neuen Datei (z. B. config.yml)');
    if (!name) return;
    const p = dir ? `${dir}/${name}` : name;
    try {
      await api(`/api/mc/instances/${inst.id}/files`, { method: 'PUT', body: { path: p, content: '' } });
      setEdit({ path: p, content: '', size: 0 });
      setContent('');
      load();
    } catch (err) { toast.err(err.message); }
  }

  async function upload(ev) {
    const files = [...(ev.target.files || [])];
    ev.target.value = '';
    for (const file of files) {
      try {
        const res = await fetch(`/api/mc/instances/${inst.id}/files/upload?path=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'X-TX2-Client': '1' },
          body: file,
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Upload fehlgeschlagen');
        toast.ok(`${file.name} hochgeladen`);
      } catch (err) { toast.err(`${file.name}: ${err.message}`); }
    }
    load();
  }

  const crumbs = dir ? dir.split('/') : [];
  const absPath = list?.abs || (dir ? `${inst.path}/${dir}` : inst.path);
  const entries = (list?.entries || []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));

  if (edit) {
    return (
      <section className="mcf card">
        <header className="mcf-edit-head">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (!dirty || window.confirm('Ungespeicherte Änderungen verwerfen?')) setEdit(null); }}>
            <NavIcon name="collapse" />Zurück
          </button>
          <span className="mcf-edit-path mono" title={`${inst.path}/${edit.path}`}>{edit.path}</span>
          <span className="grow" />
          <button type="button" className="btn btn-sm" onClick={() => download(edit.path)}><NavIcon name="external" />Download</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Speichert…' : 'Speichern'}<kbd className="cfg-kbd">Ctrl S</kbd></button>
        </header>
        <div className="mcf-editor">
          <CfgCode value={content} onChange={(e) => setContent(e.target.value)} dirty={dirty} lang={langFor(edit.path)} ariaLabel={edit.path} readOnly={edit.path.startsWith('.orbit/')} />
        </div>
      </section>
    );
  }

  return (
    <section className="mcf card">
      <header className="mcf-head">
        <nav className="mcf-crumbs" aria-label="Pfad">
          <button type="button" onClick={() => go('')} className={crumbs.length ? '' : 'cur'}><NavIcon name="home" />{inst.slug}</button>
          {crumbs.map((c, i) => (
            <span key={`${c}-${i}`}>
              <NavIcon name="chevron" />
              <button type="button" className={i === crumbs.length - 1 ? 'cur' : ''} onClick={() => go(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            </span>
          ))}
        </nav>
        <div className="mcf-actions">
          <div className="lg-search"><NavIcon name="search" /><input placeholder="Filtern…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <button type="button" className="btn btn-sm" onClick={newFile}><NavIcon name="plus" />Datei</button>
          <button type="button" className="btn btn-sm" onClick={mkdir}><NavIcon name="folder" />Ordner</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()}><NavIcon name="external" />Hochladen</button>
          <input ref={fileRef} type="file" multiple hidden onChange={upload} />
        </div>
      </header>
      <div className="mcf-abs">
        <NavIcon name="folder" />
        <code className="mono">{absPath}</code>
        <button type="button" className="o-icon-btn" title="Pfad kopieren" onClick={() => navigator.clipboard?.writeText(absPath).then(() => toast.ok('Pfad kopiert', { text: absPath }))}><NavIcon name="copy" /></button>
      </div>
      {!list ? <div className="mcx-loading">Lädt…</div> : entries.length === 0 ? (
        <Empty title={filter ? 'Keine Treffer' : 'Ordner ist leer'} text={filter ? '' : 'Dateien hierher hochladen oder einen neuen Ordner anlegen.'} />
      ) : (
        <div className="mcf-table">
          <div className="mcf-row mcf-th"><span>Name</span><span>Größe</span><span>Geändert</span><span /></div>
          {dir && (
            <button type="button" className="mcf-row mcf-up" onClick={() => go(crumbs.slice(0, -1).join('/'))}>
              <span className="mcf-name"><span className="mcf-ico"><NavIcon name="collapse" /></span>..</span><span /><span /><span />
            </button>
          )}
          {entries.map((e) => (
            <div key={e.name} className={`mcf-row${e.dir ? ' dir' : ''}`}>
              <button type="button" className="mcf-name" onClick={() => open(e)} title={e.dir ? 'Öffnen' : e.editable ? 'Bearbeiten' : 'Herunterladen'}>
                <span className="mcf-ico"><NavIcon name={fileIcon(e)} /></span>
                <span className="mcf-n">{e.name}</span>
                {e.editable ? <em>bearbeitbar</em> : null}
              </button>
              <span className="mcf-size">{e.dir ? '—' : fmtSize(e.size)}</span>
              <span className="mcf-date">{e.mtime ? new Date(e.mtime).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <span className="mcf-acts">
                {!e.dir && <button type="button" className="o-icon-btn" title="Herunterladen" onClick={() => download(dir ? `${dir}/${e.name}` : e.name)}><NavIcon name="external" /></button>}
                {e.name !== '.orbit' && <button type="button" className="o-icon-btn" title="Umbenennen" onClick={() => rename(e)}><NavIcon name="cfg" /></button>}
                {e.name !== '.orbit' && <button type="button" className="o-icon-btn" title="Löschen" onClick={() => remove(e)}><NavIcon name="x" /></button>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
