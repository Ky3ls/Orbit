import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import { Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Audit() {
  const [entries, setEntries] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { api('/api/audit').then((d) => setEntries(d.entries)).catch(() => {}); }, []);
  const view = entries.filter((e) => `${e.user} ${e.action} ${e.detail}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Audit"
        description="Logins, Bans, Einstellungen, Ressourcen. Nichts davon lässt sich aus dem Panel löschen."
        actions={<input className="search" placeholder="Filtern" value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      <PanelCard padded={false}>
        <div className="table-wrap">
          <table className="o-table">
            <thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Detail</th><th>IP</th></tr></thead>
            <tbody>
              {view.map((row) => (
                <tr key={row.id}>
                  <td data-label="Zeit">{fmtFull(row.created)}</td>
                  <td className="name" data-label="Wer">{row.user}</td>
                  <td className="mono" data-label="Aktion">{row.action}</td>
                  <td data-label="Detail">{row.detail}</td>
                  <td className="mono" data-label="IP">{row.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </Page>
  );
}
