import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import { Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function ServerLog() {
  const [entries, setEntries] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    api('/api/audit').then((d) => setEntries(d.entries || [])).catch(() => {});
  }, []);

  const view = entries.filter((e) => `${e.user} ${e.action} ${e.detail}`.toLowerCase().includes(q.toLowerCase()));
  const connectish = view.filter((e) => /player|kick|warn|ban|whitelist|note|join|leave/i.test(`${e.action} ${e.detail}`));

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Server Log"
        description="Activity aus Audit und Warteschlange. Verbindungen erscheinen, sobald Events ankommen."
        actions={<input className="search" placeholder="Filtern" value={q} onChange={(e) => setQ(e.target.value)} />}
      />

      <PanelCard>
        <h3>Connections / Moderation</h3>
        {connectish.length === 0 ? (
          <Empty title="Keine Connection-Events" text="Sobald Kick/Warn/Ban oder Spieleraktionen laufen, landen sie hier." />
        ) : (
          <div className="feed">
            {connectish.slice(0, 40).map((row) => (
              <article key={row.id}>
                <time>{fmtFull(row.created)}</time>
                <div><b>{row.user}</b><span>{row.action}</span><em>{row.detail}</em></div>
              </article>
            ))}
          </div>
        )}
      </PanelCard>

      <PanelCard padded={false}>
        <div className="table-wrap">
          <table className="o-table">
            <thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Detail</th></tr></thead>
            <tbody>
              {view.slice(0, 200).map((row) => (
                <tr key={row.id}>
                  <td data-label="Zeit">{fmtFull(row.created)}</td>
                  <td className="name" data-label="Wer">{row.user}</td>
                  <td className="mono" data-label="Aktion">{row.action}</td>
                  <td data-label="Detail">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </Page>
  );
}
