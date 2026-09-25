import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, Page, PageHeader } from '../components/Ui.jsx';
import './schedule.css';
import { useI18n } from '../i18n/I18nProvider.jsx';

const TABS = [
  { id: 'restart', kind: 'restart', labelKey: 'sch.tab.restarts' },
  { id: 'server', kind: 'backup_server', type: 'server', labelKey: 'sch.tab.serverBackup' },
  { id: 'database', kind: 'backup_database', type: 'database', labelKey: 'sch.tab.dbBackup' },
];

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

function formatWhen(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function jobKind(job) {
  const k = String(job?.kind || 'restart').toLowerCase();
  if (k === 'backup_server' || k === 'backup_database') return k;
  return 'restart';
}

export default function Schedule() {
  const { t } = useI18n();
  const [tab, setTab] = useState('restart');
  const [jobs, setJobs] = useState([]);
  const [backups, setBackups] = useState([]);
  const [label, setLabel] = useState('');
  const [hhmm, setHhmm] = useState('06:00');
  const [retention, setRetention] = useState(5);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef(null);

  const activeTab = TABS.find((x) => x.id === tab) || TABS[0];
  const isBackup = activeTab.id !== 'restart';

  const defaultLabel = useCallback(() => {
    if (activeTab.kind === 'backup_server') return t('sch.defaultLabelServer');
    if (activeTab.kind === 'backup_database') return t('sch.defaultLabelDb');
    return t('sch.defaultLabel');
  }, [activeTab.kind, t]);

  useEffect(() => {
    setLabel(defaultLabel());
  }, [defaultLabel]);

  const loadJobs = useCallback(() => {
    api('/api/schedule')
      .then((d) => setJobs(d.jobs || []))
      .catch((e) => setErr(e.message));
  }, []);

  const loadBackups = useCallback(() => {
    if (!isBackup || !activeTab.type) {
      setBackups([]);
      return;
    }
    api(`/api/backups?type=${activeTab.type}`)
      .then((d) => setBackups(d.items || []))
      .catch((e) => setErr(e.message));
  }, [isBackup, activeTab.type]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { loadBackups(); }, [loadBackups]);

  const tabJobs = useMemo(
    () => jobs.filter((j) => jobKind(j) === activeTab.kind),
    [jobs, activeTab.kind],
  );
  const active = useMemo(() => tabJobs.filter((j) => j.enabled).length, [tabJobs]);
  const upcoming = useMemo(() => {
    const on = tabJobs.filter((j) => j.enabled).slice().sort((a, b) => String(a.hhmm).localeCompare(String(b.hhmm)));
    if (!on.length) return null;
    const now = new Date();
    const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return on.find((j) => j.hhmm >= cur) || on[0];
  }, [tabJobs]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const body = { label: label.trim(), hhmm, kind: activeTab.kind };
      if (isBackup) body.retention = Number(retention) === 10 ? 10 : 5;
      await api('/api/schedule', { method: 'POST', body });
      setLabel(defaultLabel());
      loadJobs();
      setMsg(t('sch.created'));
    } catch (error) {
      setErr(error.message);
    }
    setBusy(false);
  }

  async function toggle(job) {
    setErr('');
    try {
      await api(`/api/schedule/${job.id}`, { method: 'PATCH', body: { enabled: !job.enabled } });
      loadJobs();
    } catch (error) {
      setErr(error.message);
    }
  }

  async function remove(job) {
    setErr('');
    try {
      await api(`/api/schedule/${job.id}`, { method: 'DELETE' });
      loadJobs();
    } catch (error) {
      setErr(error.message);
    }
  }

  function applyPreset(p) {
    setLabel(isBackup ? defaultLabel() : t(p.labelKey));
    setHhmm(p.hhmm);
  }

  async function runNow() {
    if (!activeTab.type) return;
    setRunBusy(true);
    setErr('');
    setMsg('');
    try {
      const d = await api('/api/backups/run', {
        method: 'POST',
        body: { type: activeTab.type, retention: Number(retention) === 10 ? 10 : 5 },
      });
      setMsg(t('sch.backupDone', { name: d.backup?.name || '—' }));
      loadBackups();
    } catch (error) {
      setErr(error.message);
    }
    setRunBusy(false);
  }

  async function deleteBackupItem(item) {
    setErr('');
    try {
      await api(`/api/backups/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      loadBackups();
    } catch (error) {
      setErr(error.message);
    }
  }

  function downloadBackup(item) {
    window.location.href = `/api/backups/${encodeURIComponent(item.id)}/download`;
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeTab.type) return;
    setUploadBusy(true);
    setErr('');
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('type', activeTab.type);
      const q = new URLSearchParams({
        type: activeTab.type,
        retention: String(Number(retention) === 10 ? 10 : 5),
      });
      const res = await fetch(`/api/backups/upload?${q}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-TX2-Client': '1' },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('sch.uploadFail'));
      setMsg(t('sch.uploadOk', { name: data.backup?.name || file.name }));
      loadBackups();
    } catch (error) {
      setErr(error.message);
    }
    setUploadBusy(false);
  }

  return (
    <Page className="sch-page">
      <PageHeader
        eyebrow={t('sch.eyebrow')}
        title={t('page.schedule')}
        description={t(isBackup ? 'sch.descBackup' : 'sch.desc')}
      />

      <div className="sch-tabs" role="tablist" aria-label={t('page.schedule')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`sch-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => { setTab(item.id); setErr(''); setMsg(''); }}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {err ? <div className="err sch-err">{err}</div> : null}
      {msg ? <div className="sch-ok">{msg}</div> : null}

      <div className="sch-stats" aria-label={t('common.overview')}>
        <div className="sch-stat">
          <span>{t('sch.active')}</span>
          <strong>{active}</strong>
        </div>
        <div className="sch-stat">
          <span>{t('sch.total')}</span>
          <strong>{tabJobs.length}</strong>
        </div>
        {isBackup ? (
          <div className="sch-stat">
            <span>{t('sch.backupCount')}</span>
            <strong>{backups.length}</strong>
          </div>
        ) : null}
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

      <div className={`sch-layout${isBackup ? ' sch-layout-backup' : ''}`}>
        <section className="sch-card sch-create" aria-labelledby="sch-create-title">
          <header className="sch-card-head">
            <h2 id="sch-create-title">{t('sch.createTitle')}</h2>
            <p>{t(isBackup ? 'sch.createLeadBackup' : 'sch.createLead')}</p>
          </header>

          {!isBackup ? (
            <div className="sch-presets" role="group" aria-label={t('sch.presets')}>
              {PRESET_DEFS.map((p) => (
                <button
                  key={p.hhmm + p.labelKey}
                  type="button"
                  className={`sch-preset${hhmm === p.hhmm ? ' is-selected' : ''}`}
                  aria-pressed={hhmm === p.hhmm}
                  onClick={() => applyPreset(p)}
                >
                  <b>{p.hhmm}</b>
                  <span>{t(p.labelKey)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <form className={`sch-form${isBackup ? ' sch-form-backup' : ''}`} onSubmit={add}>
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
            {isBackup ? (
              <label className="sch-field sch-field-ret">
                <span>{t('sch.retention')}</span>
                <select value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
                  <option value={5}>{t('sch.retentionN', { n: 5 })}</option>
                  <option value={10}>{t('sch.retentionN', { n: 10 })}</option>
                </select>
              </label>
            ) : null}
            <button
              className="btn btn-primary sch-submit"
              type="submit"
              disabled={busy || label.trim().length < 2}
            >
              {busy ? '…' : t('sch.submit')}
            </button>
          </form>

          {isBackup ? (
            <div className="sch-quick">
              <button
                type="button"
                className="btn btn-sm"
                disabled={runBusy}
                onClick={runNow}
              >
                {runBusy ? '…' : t('sch.runNow')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={uploadBusy}
                onClick={() => fileRef.current?.click()}
              >
                {uploadBusy ? '…' : t('sch.upload')}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="sch-file"
                accept={activeTab.type === 'database' ? '.sql,.sql.gz,.gz' : '.tar.gz,.tgz,.tar,.zip'}
                onChange={onUpload}
              />
              <p className="sch-hint">{t(activeTab.type === 'database' ? 'sch.hintDb' : 'sch.hintServer')}</p>
            </div>
          ) : null}
        </section>

        <section className="sch-card sch-list" aria-labelledby="sch-list-title">
          <header className="sch-card-head">
            <h2 id="sch-list-title">{t('sch.listTitle')}</h2>
            <p>{tabJobs.length ? t('sch.listSummary', { active, total: tabJobs.length }) : t('sch.listEmpty')}</p>
          </header>

          {tabJobs.length === 0 ? (
            <Empty
              title={t('sch.emptyTitle')}
              text={t(isBackup ? 'sch.emptyTextBackup' : 'sch.emptyText')}
            />
          ) : (
            <ul className="sch-jobs">
              {tabJobs.map((job) => (
                <li key={job.id} className={`sch-job${job.enabled ? ' is-on' : ''}`}>
                  <div className="sch-job-time" aria-hidden="true">
                    <b>{job.hhmm}</b>
                    {job.enabled ? <small>{nextRunHint(job.hhmm, t)}</small> : <small>{t('common.paused')}</small>}
                  </div>
                  <div className="sch-job-body">
                    <strong>{job.label}</strong>
                    <Badge tone={job.enabled ? 'ok' : ''}>{job.enabled ? t('sch.badgeOn') : t('sch.badgeOff')}</Badge>
                    {isBackup ? (
                      <span className="sch-ret-chip">{t('sch.retentionN', { n: job.retention || 5 })}</span>
                    ) : null}
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

        {isBackup ? (
          <section className="sch-card sch-files" aria-labelledby="sch-files-title">
            <header className="sch-card-head">
              <h2 id="sch-files-title">{t('sch.filesTitle')}</h2>
              <p>{backups.length ? t('sch.filesSummary', { n: backups.length }) : t('sch.filesEmpty')}</p>
            </header>

            {backups.length === 0 ? (
              <Empty title={t('sch.filesEmptyTitle')} text={t('sch.filesEmptyText')} />
            ) : (
              <ul className="sch-files-list">
                {backups.map((item) => (
                  <li key={item.id} className="sch-file-row">
                    <div className="sch-file-meta">
                      <strong title={item.name}>{item.name}</strong>
                      <span>{formatWhen(item.created)} · {item.sizeLabel || item.size}</span>
                    </div>
                    <div className="sch-job-actions">
                      <button type="button" className="btn btn-sm" onClick={() => downloadBackup(item)}>
                        {t('sch.download')}
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteBackupItem(item)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </Page>
  );
}
