import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import { Badge, Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

const HOURS = [
  { v: 2, l: '2 Stunden' },
  { v: 24, l: '1 Tag' },
  { v: 168, l: '7 Tage' },
  { v: 720, l: '30 Tage' },
  { v: 0, l: 'Permanent' },
];

export default function Bans() {
  const [bans, setBans] = useState([]);
  const [form, setForm] = useState({ identifier: '', name: '', reason: '', hours: 24 });
  const [err, setErr] = useState('');

  function load() { api('/api/bans').then((d) => setBans(d.bans)).catch((e) => setErr(e.message)); }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/bans', { method: 'POST', body: { ...form, hours: Number(form.hours) } });
      setForm({ identifier: '', name: '', reason: '', hours: 24 });
      load();
    } catch (error) { setErr(error.message); }
  }

  async function revoke(id) {
    await api(`/api/bans/${id}/revoke`, { method: 'POST', body: {} });
    load();
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Moderation"
        title="Bans"
        description="Panel-Bans sofort aktiv. Ingame-Sperre über die Konsole (Queue), wenn Orbit oder RCON verbunden ist."
      />
      {err && <div className="err">{err}</div>}
      <PanelCard>
        <form className="grid-2" onSubmit={create} style={{ display: 'grid' }}>
          <label className="field"><span>Identifier</span><input required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="license:…" /></label>
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Grund</span><input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <label className="field"><span>Dauer</span>
            <select value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}>
              {HOURS.map((h) => <option key={h.v} value={h.v}>{h.l}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">Ban setzen</button>
        </form>
      </PanelCard>
      <PanelCard padded={false}>
        <div className="table-wrap">
          {bans.length === 0 ? <Empty title="Keine Bans" text="Die Liste ist sauber." /> : (
            <table className="o-table">
              <thead><tr><th>Name</th><th>Identifier</th><th>Grund</th><th>Bis</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {bans.map((ban) => {
                  const active = !ban.revoked && (!ban.expires || ban.expires > Date.now());
                  return (
                    <tr key={ban.id}>
                      <td data-label="Name">{ban.name || '–'}</td>
                      <td className="mono" data-label="Identifier">{ban.identifier}</td>
                      <td data-label="Grund">{ban.reason}</td>
                      <td data-label="Bis">{ban.expires ? fmtFull(ban.expires) : 'Permanent'}</td>
                      <td data-label="Status"><Badge tone={active ? 'bad' : ''}>{active ? 'aktiv' : ban.revoked ? 'aufgehoben' : 'abgelaufen'}</Badge></td>
                      <td className="td-actions" data-label="">{active && <button className="btn btn-sm" type="button" onClick={() => revoke(ban.id)}>Aufheben</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </PanelCard>
    </Page>
  );
}
