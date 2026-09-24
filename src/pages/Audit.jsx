import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import { Page, PageHeader, PanelCard } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';

export default function Audit() {
  const { t } = useI18n();
  const [entries, setEntries] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { api('/api/audit').then((d) => setEntries(d.entries)).catch(() => {}); }, []);
  const view = entries.filter((e) => `${e.user} ${e.action} ${e.detail}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page>
      <PageHeader
        eyebrow={t('audit.eyebrow')}
        title={t('page.audit')}
        description={t('audit.desc')}
        actions={<input className="search" placeholder={t('common.filter')} value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      <p className="page-hint muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 13 }}>
        {t('audit.hint')}
      </p>
      <PanelCard padded={false}>
        <div className="table-wrap">
          <table className="o-table">
            <thead>
              <tr>
                <th>{t('common.time')}</th>
                <th>{t('common.who')}</th>
                <th>{t('common.action')}</th>
                <th>{t('common.detail')}</th>
                <th>{t('common.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {view.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('common.time')}>{fmtFull(row.created)}</td>
                  <td className="name" data-label={t('common.who')}>{row.user}</td>
                  <td className="mono" data-label={t('common.action')}>{row.action}</td>
                  <td data-label={t('common.detail')}>{row.detail}</td>
                  <td className="mono" data-label={t('common.ip')}>{row.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </Page>
  );
}
