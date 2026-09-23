import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function PlayerDrops() {
  const [data, setData] = useState({ rows: [], stats: [], hours: 24 });
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/drops?hours=72')
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="Moderation"
        title="Player Drops"
        description="Disconnect-Gründe aus FX-Konsole / Logs (letzte 72h)."
      />
      {err && <div className="err">{err}</div>}
      <PanelCard>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {(data.stats || []).map((s) => (
            <span key={s.reason} className="badge">{s.reason}: {s.c}</span>
          ))}
        </div>
      </PanelCard>
      <PanelCard padded={false}>
        <div className="table-wrap">
          <table className="o-table">
            <thead><tr><th>Spieler</th><th>Grund</th><th>Zeit</th></tr></thead>
            <tbody>
              {(data.rows || []).length === 0 ? (
                <tr><td colSpan={3} className="muted">Noch keine Drops erkannt — Server-Konsole beobachten.</td></tr>
              ) : (data.rows || []).map((r) => (
                <tr key={r.id}>
                  <td>{r.player_name}</td>
                  <td>{r.reason}</td>
                  <td>{new Date(r.created).toLocaleString('de-DE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </Page>
  );
}
