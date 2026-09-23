import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function CfgEditor() {
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    api('/api/cfg')
      .then((d) => {
        setContent(d.content);
        setMeta(d);
      })
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setErr('');
    setMsg('');
    setSaving(true);
    try {
      const d = await api('/api/cfg', { method: 'PUT', body: { content } });
      setMsg(`Gespeichert · ${d.resources} Ressourcen erkannt.`);
      load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Config"
        title="CFG Editor"
        description={`${meta?.path || 'server.cfg'}${meta && !meta.writable ? ' · schreibgeschützt (Draft möglich)' : ''}${meta ? ` · ${meta.resources} ensures` : ''}`}
        actions={<button className="btn btn-sm" type="button" onClick={load}>Neu laden</button>}
      />
      {err && <div className="err">{err}</div>}
      {msg && <div className="banner">{msg}</div>}
      {meta?.warnings?.length > 0 && (
        <div className="banner warn">{meta.warnings.join(' · ')}</div>
      )}
      <PanelCard padded={false}>
        <form onSubmit={save} className="cfg-editor">
          <textarea
            className="mono cfg-area"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
          <div className="actions" style={{ padding: '12px 16px' }}>
            <button className="btn btn-primary" type="submit" disabled={saving} style={{ width: 'auto' }}>Speichern</button>
            <span className="muted">Secrets bleiben redacted und werden beim Speichern beibehalten.</span>
          </div>
        </form>
      </PanelCard>
    </Page>
  );
}
