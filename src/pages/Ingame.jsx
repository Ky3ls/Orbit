import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Ingame({ user }) {
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus('System-Resource orbit — Kick, Announce, Heal, Spielerliste.');
  }, []);

  async function hotDeploy() {
    setErr('');
    setBusy(true);
    try {
      const d = await api('/api/ingame/hot-deploy', { method: 'POST', body: {} });
      setStatus(d.note || 'orbit aktualisiert — im Spiel /orbit oder /tx');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Ingame"
        title="Orbit Menü"
        description="Schlankes Admin-Menü als System-Resource — ohne ACE/Token-Setup."
      />
      {err && <div className="err">{err}</div>}
      <PanelCard>
        <p className="muted" style={{ marginTop: 0 }}>
          Befehle: <b>/orbit</b> · <b>/tx</b> · <b>/orbitmenu</b>
        </p>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          <li>Heal</li>
          <li>Announce</li>
          <li>Spielerliste + Kick</li>
        </ul>
        {status && <p className="banner" style={{ marginTop: 12 }}>{status}</p>}
        {(user?.role === 'owner' || user?.role === 'admin') && (
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={busy} onClick={hotDeploy}>
            {busy ? '…' : 'Menü jetzt aktualisieren (ohne FX-Neustart)'}
          </button>
        )}
      </PanelCard>
    </Page>
  );
}
