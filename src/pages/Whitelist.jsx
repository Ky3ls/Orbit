import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import { Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Whitelist({ user }) {
  const [entries, setEntries] = useState([]);
  const [identifier, setIdentifier] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const canWrite = user.role !== 'moderator';

  function load() { api('/api/whitelist').then((d) => setEntries(d.entries)).catch((e) => setErr(e.message)); }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    try {
      await api('/api/whitelist', { method: 'POST', body: { identifier, note } });
      setIdentifier(''); setNote(''); load();
    } catch (error) { setErr(error.message); }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Moderation"
        title="Allowlist"
        description="License, Discord oder Steam. Doppelte Einträge werden abgelehnt. Status-Schalter unter Einstellungen."
      />
      {err && <div className="err">{err}</div>}
      {canWrite && (
        <PanelCard>
          <form className="row" onSubmit={add}>
            <input className="grow" placeholder="license:…" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <input className="grow" placeholder="Notiz" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">Hinzufügen</button>
          </form>
        </PanelCard>
      )}
      <PanelCard padded={false}>
        <div className="table-wrap">
          {entries.length === 0 ? <Empty title="Whitelist leer" text="Noch keine Freigaben." /> : (
            <table className="o-table">
              <thead><tr><th>Identifier</th><th>Notiz</th><th>Von</th><th>Seit</th><th></th></tr></thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id}>
                    <td className="mono" data-label="Identifier">{row.identifier}</td>
                    <td data-label="Notiz">{row.note || '–'}</td>
                    <td data-label="Von">{row.author}</td>
                    <td data-label="Seit">{fmtFull(row.created)}</td>
                    <td className="td-actions" data-label="">{canWrite && <button className="btn btn-sm btn-danger" type="button" onClick={() => api(`/api/whitelist/${row.id}`, { method: 'DELETE' }).then(load)}>Entfernen</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </PanelCard>
    </Page>
  );
}
