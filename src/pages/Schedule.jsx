import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, Page, PageHeader } from '../components/Ui.jsx';
import './schedule.css';
import { useI18n } from '../i18n/I18nProvider.jsx';

const PRESETS = [
  { label: 'Morgen-Neustart', hhmm: '06:00' },
  { label: 'Mittag-Neustart', hhmm: '12:00' },
  { label: 'Nacht-Neustart', hhmm: '04:00' },
];

function nextRunHint(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const diff = next - now;
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hrs >= 24) return 'morgen';
  if (hrs > 0) return `in ${hrs}h ${mins}m`;
  return `in ${mins}m`;
}

export default function Schedule() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState([]);
  const [label, setLabel] = useState('Server-Neustart');
  const [hhmm, setHhmm] = useState('06:00');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api('/api/schedule')
      .then((d) => setJobs(d.jobs || []))
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { load(); }, []);

  const active = useMemo(() => jobs.filter((j) => j.enabled).length, [jobs]);
  const upcoming = useMemo(() => {
    const on = jobs.filter((j) => j.enabled).slice().sort((a, b) => String(a.hhmm).localeCompare(String(b.hhmm)));
    if (!on.length) return null;
    const now = new Date();
    const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return on.find((j) => j.hhmm >= cur) || on[0];
  }, [jobs]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/schedule', { method: 'POST', body: { label: label.trim(), hhmm } });
      setLabel('Server-Neustart');
      load();
    } catch (error) {
      setErr(error.message);
    }
    setBusy(false);
  }

  async function toggle(job) {
    setErr('');
    try {
      await api(`/api/schedule/${job.id}`, { method: 'PATCH', body: { enabled: !job.enabled } });
      load();
    } catch (error) {
      setErr(error.message);
    }
  }

  async function remove(job) {
    setErr('');
    try {
      await api(`/api/schedule/${job.id}`, { method: 'DELETE' });
      load();
    } catch (error) {
      setErr(error.message);
    }
  }

  function applyPreset(p) {
    setLabel(p.label);
    setHhmm(p.hhmm);
  }

  return (
    <Page className="sch-page">
      <PageHeader
        eyebrow="Betrieb"
        title={t('page.schedule')}
        description="Geplante Server-Neustarts zur gewählten Uhrzeit — wenn die Server-Steuerung aktiv ist."
      />

      {err ? <div className="err sch-err">{err}</div> : null}

      <div className="sch-stats" aria-label="Übersicht">
        <div className="sch-stat">
          <span>Aktiv</span>
          <strong>{active}</strong>
        </div>
        <div className="sch-stat">
          <span>Gesamt</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className="sch-stat sch-stat-wide">
          <span>Als Nächstes</span>
          <strong>
            {upcoming
              ? `${upcoming.hhmm} · ${upcoming.label}`
              : '—'}
          </strong>
          {upcoming ? <small>{nextRunHint(upcoming.hhmm)}</small> : null}
        </div>
      </div>

      <div className="sch-layout">
        <section className="sch-card sch-create" aria-labelledby="sch-create-title">
          <header className="sch-card-head">
            <h2 id="sch-create-title">Neue Automation</h2>
            <p>Täglich zur Minute — Orbit startet den Server neu.</p>
          </header>

          <div className="sch-presets" role="group" aria-label="Vorlagen">
            {PRESETS.map((p) => (
              <button
                key={p.hhmm + p.label}
                type="button"
                className="sch-preset"
                onClick={() => applyPreset(p)}
              >
                <b>{p.hhmm}</b>
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <form className="sch-form" onSubmit={add}>
            <label className="sch-field">
              <span>Bezeichnung</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. Nacht-Neustart"
                required
                minLength={2}
              />
            </label>
            <label className="sch-field sch-field-time">
              <span>Uhrzeit</span>
              <input
                type="time"
                value={hhmm}
                onChange={(e) => setHhmm(e.target.value)}
                required
              />
            </label>
            <button
              className="btn btn-primary sch-submit"
              type="submit"
              disabled={busy || label.trim().length < 2}
            >
              {busy ? '…' : 'Automation anlegen'}
            </button>
          </form>
        </section>

        <section className="sch-card sch-list" aria-labelledby="sch-list-title">
          <header className="sch-card-head">
            <h2 id="sch-list-title">Geplante Jobs</h2>
            <p>{jobs.length ? `${active} aktiv von ${jobs.length}` : 'Noch keine Einträge'}</p>
          </header>

          {jobs.length === 0 ? (
            <Empty
              title="Keine Automationen"
              text="Lege links eine Uhrzeit fest — z. B. 06:00 für den Morgen-Neustart."
            />
          ) : (
            <ul className="sch-jobs">
              {jobs.map((job) => (
                <li key={job.id} className={`sch-job${job.enabled ? ' is-on' : ''}`}>
                  <div className="sch-job-time" aria-hidden="true">
                    <b>{job.hhmm}</b>
                    {job.enabled ? <small>{nextRunHint(job.hhmm)}</small> : <small>pausiert</small>}
                  </div>
                  <div className="sch-job-body">
                    <strong>{job.label}</strong>
                    <Badge tone={job.enabled ? 'ok' : ''}>{job.enabled ? 'aktiv' : 'aus'}</Badge>
                  </div>
                  <div className="sch-job-actions">
                    <button type="button" className="btn btn-sm" onClick={() => toggle(job)}>
                      {job.enabled ? 'Pausieren' : 'Aktivieren'}
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(job)}>
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}
