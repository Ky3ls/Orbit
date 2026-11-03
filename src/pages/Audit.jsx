import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, Page, PageHeader } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './audit.css';

/** Kategorie einer Audit-Aktion (für Filter + Icon) */
function category(action = '') {
  const a = String(action);
  if (a.startsWith('server.') || a.startsWith('fx.') || a.startsWith('resource')) return 'server';
  if (/ban|kick|warn|player|whitelist|allowlist|note/.test(a)) return 'players';
  if (/^login|auth|logout|totp|password|session/.test(a)) return 'auth';
  return 'system';
}

const CAT = {
  server: { icon: 'power', tone: 'accent' },
  players: { icon: 'users', tone: 'warn' },
  auth: { icon: 'logout', tone: 'info' },
  system: { icon: 'gear', tone: 'muted' },
};

function toneFor(action) {
  if (/stop|ban|delete|revoke|fail/.test(action)) return 'bad';
  if (/start|unban|add|create|enable/.test(action)) return 'ok';
  return CAT[category(action)].tone;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Audit() {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [who, setWho] = useState('');

  useEffect(() => {
    api('/api/audit').then((d) => setEntries(d.entries || [])).catch(() => setEntries([]));
  }, []);

  const users = useMemo(() => [...new Set((entries || []).map((e) => e.user))].sort(), [entries]);
  const counts = useMemo(() => {
    const c = { all: 0, server: 0, players: 0, auth: 0, system: 0 };
    for (const e of entries || []) { c.all += 1; c[category(e.action)] += 1; }
    return c;
  }, [entries]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries || []).filter((e) => {
      if (cat !== 'all' && category(e.action) !== cat) return false;
      if (who && e.user !== who) return false;
      return !needle || `${e.user} ${e.action} ${e.detail} ${e.ip}`.toLowerCase().includes(needle);
    });
  }, [entries, q, cat, who]);

  const days = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const out = [];
    let cur = null;
    for (const e of view) {
      const key = new Date(e.created).toDateString();
      if (!cur || cur.key !== key) {
        cur = { key, label: fmtDay.format(e.created), items: [] };
        out.push(cur);
      }
      cur.items.push(e);
    }
    return out;
  }, [view, locale]);

  const fmtClock = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), [locale]);

  function exportCsv() {
    const rows = [['time', 'user', 'action', 'detail', 'ip'], ...view.map((e) => [new Date(e.created).toISOString(), e.user, e.action, e.detail, e.ip])];
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orbit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <Page className="audit-page">
      <PageHeader
        eyebrow={t('audit.eyebrow')}
        title={t('page.audit')}
        description={t('audit.desc')}
        actions={(
          <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!view.length}>
            <NavIcon name="external" />{t('audit2.export')}
          </button>
        )}
      />

      <div className="audit-toolbar">
        <div className="seg" role="tablist">
          {['all', 'server', 'players', 'auth', 'system'].map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cat === c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
              {t(`audit2.cat.${c}`)}<span className="res-seg-n">{counts[c]}</span>
            </button>
          ))}
        </div>
        <select className="audit-who" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('common.who')}>
          <option value="">{t('audit2.allUsers')}</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <input className="search audit-search" placeholder={t('common.filter')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {entries === null ? (
        <div className="card audit-skel">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}</div>
      ) : days.length === 0 ? (
        <div className="card"><Empty title={t('audit2.empty')} text={t('audit.hint')} /></div>
      ) : (
        <div className="audit-days">
          {days.map((d) => (
            <section key={d.key} className="audit-day">
              <h3 className="audit-day-label"><span>{d.label}</span><em>{d.items.length}</em></h3>
              <ol className="audit-list card">
                {d.items.map((e) => {
                  const c = CAT[category(e.action)];
                  return (
                    <li key={e.id} className={`audit-row tone-${toneFor(e.action)}`}>
                      <time className="mono">{fmtClock.format(e.created)}</time>
                      <span className="audit-ico"><NavIcon name={c.icon} /></span>
                      <span className="audit-user">{e.user}</span>
                      <code className="audit-action">{e.action}</code>
                      <span className="audit-detail" title={e.detail}>{e.detail}</span>
                      <span className="audit-ip mono">{e.ip}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
