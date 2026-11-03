import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Page, PageHeader, useNow } from '../components/Ui.jsx';
import { toast } from '../components/toast.jsx';
import { NavIcon } from '../layout/icons.jsx';
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
  const [, setMsgState] = useState('');
  const setMsg = useCallback((m) => { setMsgState(m); if (m) toast.ok(m); }, []);
  const [createOpen, setCreateOpen] = useState(false);
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
      setBusy(false);
      return true;
    } catch (error) {
      setErr(error.message);
    }
    setBusy(false);
    throw new Error('create failed');
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

  const now = useNow(30_000);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const KIND_META = {
    restart: { icon: 'restart', label: 'Neustart', tone: 'accent' },
    backup_server: { icon: 'folder', label: 'Server-Backup', tone: 'info' },
    backup_database: { icon: 'db', label: 'DB-Backup', tone: 'ok' },
  };
  const toMin = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + m; };
  const allOn = jobs.filter((j) => j.enabled);
  const nextAny = allOn.length
    ? allOn.slice().sort((x, y) => ((toMin(x.hhmm) - nowMin + 1440) % 1440) - ((toMin(y.hhmm) - nowMin + 1440) % 1440))[0]
    : null;
  const countFor = (kind) => jobs.filter((j) => jobKind(j) === kind).length;

  return (
    <Page className="sch-page sch2">
      <PageHeader
        eyebrow={t('sch.eyebrow')}
        title={t('page.schedule')}
        description="Neustarts und Backups, die Orbit täglich automatisch ausführt."
        actions={(
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setCreateOpen(true); setErr(''); }}>
            <NavIcon name="plus" />Neue Automation
          </button>
        )}
      />

      {err && !createOpen ? <div className="err">{err}</div> : null}

      {/* ── Tagesplan ── */}
      <section className="sch2-day card">
        <div className="sch2-day-head">
          <div>
            <span className="sch2-label">Nächster Lauf</span>
            {nextAny ? (
              <div className="sch2-next">
                <strong className="mono">{nextAny.hhmm}</strong>
                <span>{nextAny.label}</span>
                <span className="badge accent">{nextRunHint(nextAny.hhmm, t)}</span>
              </div>
            ) : <div className="sch2-next"><strong>—</strong><span className="muted">Keine aktive Automation</span></div>}
          </div>
          <div className="sch2-legend">
            {Object.entries(KIND_META).map(([k, m]) => (
              <span key={k} className={`tone-${m.tone}`}><i />{m.label}</span>
            ))}
          </div>
        </div>
        <div className="sch2-track" aria-label="Tagesplan">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span key={h} className="sch2-tick" style={{ left: `${(h / 24) * 100}%` }}><em>{String(h).padStart(2, '0')}:00</em></span>
          ))}
          <span className="sch2-now" style={{ left: `${(nowMin / 1440) * 100}%` }}><em>Jetzt</em></span>
          {jobs.map((j) => {
            const m = KIND_META[jobKind(j)];
            return (
              <button
                key={j.id}
                type="button"
                className={`sch2-mark tone-${m.tone}${j.enabled ? '' : ' off'}`}
                style={{ left: `${(toMin(j.hhmm) / 1440) * 100}%` }}
                title={`${j.hhmm} · ${j.label}${j.enabled ? '' : ' (pausiert)'}`}
                onClick={() => setTab(TABS.find((x) => x.kind === jobKind(j))?.id || 'restart')}
              >
                <NavIcon name={m.icon} />
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Tabs ── */}
      <div className="seg sch2-tabs" role="tablist" aria-label={t('page.schedule')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => { setTab(item.id); setErr(''); setMsg(''); }}
          >
            <NavIcon name={KIND_META[item.kind].icon} />
            {t(item.labelKey)}
            <span className="res-seg-n">{countFor(item.kind)}</span>
          </button>
        ))}
      </div>

      <div className={`sch2-grid${isBackup ? ' with-files' : ''}`}>
        <section className="sch2-card card">
          <header className="sch2-card-head">
            <div>
              <h2>{t('sch.listTitle')}</h2>
              <p>{tabJobs.length ? `${active} von ${tabJobs.length} aktiv` : 'Noch nichts geplant'}</p>
            </div>
          </header>
          {tabJobs.length === 0 ? (
            <div className="sch2-empty">
              <NavIcon name={KIND_META[activeTab.kind].icon} />
              <b>{t('sch.emptyTitle')}</b>
              <span>{t(isBackup ? 'sch.emptyTextBackup' : 'sch.emptyText')}</span>
              <button type="button" className="btn btn-sm" onClick={() => setCreateOpen(true)}><NavIcon name="plus" />Automation anlegen</button>
            </div>
          ) : (
            <ul className="sch2-jobs">
              {tabJobs.slice().sort((x, y) => String(x.hhmm).localeCompare(String(y.hhmm))).map((job) => (
                <li key={job.id} className={job.enabled ? 'on' : ''}>
                  <span className="sch2-time mono">{job.hhmm}</span>
                  <div className="sch2-job-text">
                    <b>{job.label}</b>
                    <span>
                      {job.enabled ? `Täglich · nächster Lauf ${nextRunHint(job.hhmm, t)}` : 'Pausiert'}
                      {isBackup ? ` · behält ${job.retention || 5} Sicherungen` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!job.enabled}
                    aria-label={job.enabled ? t('sch.pause') : t('sch.enable')}
                    className={`switch${job.enabled ? ' on' : ''}`}
                    onClick={() => toggle(job)}
                  />
                  <button
                    type="button"
                    className="o-icon-btn"
                    title={t('common.delete')}
                    onClick={() => { if (window.confirm(`„${job.label}“ löschen?`)) remove(job); }}
                  >
                    <NavIcon name="x" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isBackup ? (
          <section className="sch2-card card">
            <header className="sch2-card-head">
              <div>
                <h2>{t('sch.filesTitle')}</h2>
                <p>{backups.length ? `${backups.length} Sicherungen` : 'Noch keine Sicherung'}</p>
              </div>
              <div className="sch2-card-actions">
                <button type="button" className="btn btn-sm" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
                  <NavIcon name="arrowRight" />{uploadBusy ? 'Lädt…' : t('sch.upload')}
                </button>
                <button type="button" className="btn btn-sm btn-primary" disabled={runBusy} onClick={runNow}>
                  <NavIcon name="db" />{runBusy ? 'Sichert…' : t('sch.runNow')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="sch-file"
                  accept={activeTab.type === 'database' ? '.sql,.sql.gz,.gz' : '.tar.gz,.tgz,.tar,.zip'}
                  onChange={onUpload}
                />
              </div>
            </header>
            {backups.length === 0 ? (
              <div className="sch2-empty">
                <NavIcon name="folder" />
                <span>{t(activeTab.type === 'database' ? 'sch.hintDb' : 'sch.hintServer')}</span>
              </div>
            ) : (
              <ul className="sch2-files">
                {backups.map((item) => (
                  <li key={item.id}>
                    <span className="sch2-file-ico"><NavIcon name={activeTab.type === 'database' ? 'db' : 'folder'} /></span>
                    <div className="sch2-job-text">
                      <b title={item.name}>{item.name}</b>
                      <span>{formatWhen(item.created)} · {item.sizeLabel || item.size}</span>
                    </div>
                    <button type="button" className="o-icon-btn" title={t('sch.download')} onClick={() => downloadBackup(item)}><NavIcon name="external" /></button>
                    <button type="button" className="o-icon-btn" title={t('common.delete')} onClick={() => { if (window.confirm(`${item.name} löschen?`)) deleteBackupItem(item); }}><NavIcon name="x" /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {createOpen && (
        <Modal title="Neue Automation" onClose={() => setCreateOpen(false)}>
          <form className="sch2-form" onSubmit={(e) => { add(e).then(() => setCreateOpen(false)).catch(() => {}); }}>
            {err ? <div className="err">{err}</div> : null}
            <div className="sch2-kinds" role="radiogroup" aria-label="Typ">
              {TABS.map((item) => {
                const m = KIND_META[item.kind];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={tab === item.id}
                    className={`sch2-kind tone-${m.tone}${tab === item.id ? ' active' : ''}`}
                    onClick={() => setTab(item.id)}
                  >
                    <NavIcon name={m.icon} />
                    <b>{t(item.labelKey)}</b>
                  </button>
                );
              })}
            </div>
            <label className="field">
              <span>{t('sch.label')}</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sch.labelPh')} required minLength={2} />
            </label>
            <div className="field">
              <span>{t('sch.time')}</span>
              <div className="sch2-timerow">
                <input type="time" value={hhmm} onChange={(e) => setHhmm(e.target.value)} required />
                {PRESET_DEFS.map((pr) => (
                  <button key={pr.hhmm} type="button" className={`pp-chip${hhmm === pr.hhmm ? ' active-acc' : ''}`} onClick={() => applyPreset(pr)}>{pr.hhmm}</button>
                ))}
              </div>
            </div>
            {isBackup ? (
              <label className="field">
                <span>{t('sch.retention')}</span>
                <select value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
                  <option value={5}>{t('sch.retentionN', { n: 5 })}</option>
                  <option value={10}>{t('sch.retentionN', { n: 10 })}</option>
                </select>
              </label>
            ) : null}
            <p className="muted sch2-formhint">Läuft täglich um {hhmm || '—'} Uhr{hhmm ? ` — erstmals ${nextRunHint(hhmm, t)}` : ''}.</p>
            <div className="sch2-formfoot">
              <button type="button" className="btn" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" type="submit" disabled={busy || label.trim().length < 2}>{busy ? '…' : t('sch.submit')}</button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
