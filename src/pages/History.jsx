import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import { Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function History() {
  const [q, setQ] = useState('');
  const [players, setPlayers] = useState([]);
  const [note, setNote] = useState('');
  const [pick, setPick] = useState('');
  const [err, setErr] = useState('');

  function load(query = q) {
    api(`/api/history?q=${encodeURIComponent(query)}`).then((d) => setPlayers(d.players)).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(''); }, []);

  async function save(e) {
    e.preventDefault();
    try {
      await api('/api/history/note', { method: 'POST', body: { identifier: pick, note } });
      setPick('');
      load();
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Moderation"
        title="Spielerverlauf"
        description="Wer schon einmal auf dem Server war, bleibt hier mit Notiz."
        actions={(
          <form onSubmit={(e) => { e.preventDefault(); load(); }}>
            <input className="search" placeholder="Name oder License" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
        )}
      />
      {err && <div className="err">{err}</div>}
      <PanelCard padded={false}>
        <div className="table-wrap">
          {players.length === 0 ? <Empty title="Noch niemand gesehen" text="Der Verlauf füllt sich, sobald FiveM Spieler meldet." /> : (
            <table className="o-table">
              <thead><tr><th>Name</th><th>Identifier</th><th>Zuletzt</th><th>Notiz</th><th></th></tr></thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.identifier}>
                    <td className="name" data-label="Name">{p.name}</td>
                    <td className="mono" data-label="Identifier">{p.identifier}</td>
                    <td data-label="Zuletzt">{fmtFull(p.last_seen)}</td>
                    <td data-label="Notiz">{p.note || '–'}</td>
                    <td className="td-actions" data-label=""><button className="btn btn-sm" type="button" onClick={() => { setPick(p.identifier); setNote(p.note || ''); }}>Notiz</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </PanelCard>
      {pick && (
        <PanelCard>
          <form onSubmit={save}>
            <h3 className="mono">{pick}</h3>
            <label className="field"><span>Notiz</span><textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">Speichern</button>
          </form>
        </PanelCard>
      )}
    </Page>
  );
}
