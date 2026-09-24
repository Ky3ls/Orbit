import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, Page, PageHeader } from '../components/Ui.jsx';
import './schedule.css';
import { useI18n } from '../i18n/I18nProvider.jsx';

const PRESET_DEFS = [
  { labelKey: 'sch.preset.morning', hhmm: '06:00' },
  { labelKey: 'sch.preset.noon', hhmm: '12:00' },
  { labelKey: 'sch.preset.night', hhmm: '04:00' },
];

function nextRunHint(hhmm, t) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const diff = next - now;
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hrs >= 24) return t('sch.tomorrow');
  if (hrs > 0) return t('sch.inHm', { h: hrs, m: mins });
  return t('sch.inM', { m: mins });
}

export default function Schedule() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState([]);
  const [label, setLabel] = useState('');
  const [hhmm, setHhmm] = useState('06:00');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLabel(t('sch.defaultLabel'));
  }, [t]);

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
      setLabel(t('sch.defaultLabel'));
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
    setLabel(t(p.labelKey));
    setHhmm(p.hhmm);
  }

  return (
    <Page className="sch-page">
      <PageHeader
        eyebrow={t('sch.eyebrow')}
        title={t('page.schedule')}
        description={t('sch.desc')}
      />

      {err ? <div className="err sch-err">{err}</div> : null}

      <div className="sch-stats" aria-label={t('common.overview')}>
        <div className="sch-stat">
          <span>{t('sch.active')}</span>
          <strong>{active}</strong>
        </div>
        <div className="sch-stat">
          <span>{t('sch.total')}</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className="sch-stat sch-stat-wide">
          <span>{t('sch.next')}</span>
          <strong>
            {upcoming
              ? `${upcoming.hhmm} · ${upcoming.label}`
              : '—'}
          </strong>
          {upcoming ? <small>{nextRunHint(upcoming.hhmm, t)}</small> : null}
        </div>
      </div>

      <div className="sch-layout">
        <section className="sch-card sch-create" aria-labelledby="sch-create-title">
          <header className="sch-card-head">
            <h2 id="sch-create-title">{t('sch.createTitle')}</h2>
            <p>{t('sch.createLead')}</p>
          </header>

          <div className="sch-presets" role="group" aria-label={t('sch.presets')}>
            {PRESET_DEFS.map((p) => (
              <button
                key={p.hhmm + p.labelKey}
                type="button"
                className="sch-preset"
                onClick={() => applyPreset(p)}
              >
                <b>{p.hhmm}</b>
                <span>{t(p.labelKey)}</span>
              </button>
            ))}
          </div>

          <form className="sch-form" onSubmit={add}>
            <label className="sch-field">
              <span>{t('sch.label')}</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('sch.labelPh')}
                required
                minLength={2}
              />
            </label>
            <label className="sch-field sch-field-time">
              <span>{t('sch.time')}</span>
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
              {busy ? '…' : t('sch.submit')}
            </button>
          </form>
        </section>

        <section className="sch-card sch-list" aria-labelledby="sch-list-title">
          <header className="sch-card-head">
            <h2 id="sch-list-title">{t('sch.listTitle')}</h2>
            <p>{jobs.length ? t('sch.listSummary', { active, total: jobs.length }) : t('sch.listEmpty')}</p>
          </header>

          {jobs.length === 0 ? (
            <Empty
              title={t('sch.emptyTitle')}
              text={t('sch.emptyText')}
            />
          ) : (
            <ul className="sch-jobs">
              {jobs.map((job) => (
                <li key={job.id} className={`sch-job${job.enabled ? ' is-on' : ''}`}>
                  <div className="sch-job-time" aria-hidden="true">
                    <b>{job.hhmm}</b>
                    {job.enabled ? <small>{nextRunHint(job.hhmm, t)}</small> : <small>{t('common.paused')}</small>}
                  </div>
                  <div className="sch-job-body">
                    <strong>{job.label}</strong>
                    <Badge tone={job.enabled ? 'ok' : ''}>{job.enabled ? t('sch.badgeOn') : t('sch.badgeOff')}</Badge>
                  </div>
                  <div className="sch-job-actions">
                    <button type="button" className="btn btn-sm" onClick={() => toggle(job)}>
                      {job.enabled ? t('sch.pause') : t('sch.enable')}
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(job)}>
                      {t('common.delete')}
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
