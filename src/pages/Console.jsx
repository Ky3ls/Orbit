import LiveConsole from '../components/LiveConsole.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';

export default function ConsolePage() {
  const { t } = useI18n();
  return (
    <Page className="ws-module-flush">
      <PageHeader eyebrow={t('console.eyebrow')} title={t('console.title')} description={t('console.desc')} />
      <div style={{ padding: 16, flex: 1, minHeight: 'calc(100dvh - 140px)' }}>
        <LiveConsole variant="page" />
      </div>
    </Page>
  );
}
