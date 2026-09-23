import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Schedule() {
  const [jobs, setJobs] = useState([]);
  const [label, setLabel] = useState('Neustart');
  const [hhmm, setHhmm] = useState('06:00');
  const [err, setErr] = useState('');

  function load() { api('/api/schedule').then((d) => setJobs(d.jobs)).catch((e) => setErr(e.message)); }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    try {
      await api('/api/schedule', { method: 'POST', body: { label, hhmm } });
      load();
    } catch (error) { setErr(error.message); }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Betrieb"
        title="Zeitpläne"
        description="Zur Minute startet Orbit einen echten systemctl-Restart, wenn Server-Steuerung aktiv ist."
      />
      {err && <div className="err">{err}</div>}
      <PanelCard>
        <form className="row" onSubmit={add}>
          <input className="grow" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input type="time" value={hhmm} onChange={(e) => setHhmm(e.target.value)} />
          <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">Planen</button>
        </form>
      </PanelCard>
      {jobs.length === 0 ? (
        <Empty title="Nichts geplant" text="Lege eine Uhrzeit fest, zum Beispiel 06:00." />
      ) : jobs.map((job) => (
        <PanelCard className="spread" key={job.id}>
          <div><b>{job.label}</b><div className="mono">{job.hhmm}</div></div>
          <div className="actions">
            <Badge tone={job.enabled ? 'ok' : ''}>{job.enabled ? 'aktiv' : 'aus'}</Badge>
            <button className="btn btn-sm" type="button" onClick={() => api(`/api/schedule/${job.id}`, { method: 'PATCH', body: { enabled: !job.enabled } }).then(load)}>{job.enabled ? 'Pause' : 'An'}</button>
            <button className="btn btn-sm btn-danger" type="button" onClick={() => api(`/api/schedule/${job.id}`, { method: 'DELETE' }).then(load)}>Löschen</button>
          </div>
        </PanelCard>
      ))}
    </Page>
  );
}
