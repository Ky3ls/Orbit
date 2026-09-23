import LiveConsole from '../components/LiveConsole.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';

export default function ConsolePage() {
  return (
    <Page className="ws-module-flush">
      <PageHeader eyebrow="Live" title="Konsole" description="Vollbild · SSE · Befehlshistorie" />
      <div style={{ padding: 16, flex: 1, minHeight: 'calc(100dvh - 140px)' }}>
        <LiveConsole variant="page" />
      </div>
    </Page>
  );
}
