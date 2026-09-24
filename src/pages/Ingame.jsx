import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Page, PageHeader, PanelCard } from '../components/Ui.jsx';

const FEATURES = [
  {
    title: 'Main',
    items: [
      'NoClip · Godmode · Superjump',
      'Spieler-IDs in der Welt',
      'Teleport: Wegpunkt, Zurück, Koordinaten',
      'Heal Self / Heal Alle · Area clear',
      'Server-Ankündigung',
    ],
  },
  {
    title: 'Spieler',
    items: [
      'Online-Liste mit Suche',
      'Goto · Bring · Freeze · Spectate',
      'Heal · Kick · Warn · DM · Ban',
      'Troll: Drunk · Fire',
    ],
  },
  {
    title: 'Fahrzeug',
    items: ['Reparieren · Boost · Aufrichten · Löschen'],
  },
];

export default function Ingame({ user }) {
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus('System-Resource orbit — Admin-Menü.');
  }, []);

  async function hotDeploy() {
    setErr('');
    setBusy(true);
    try {
      const d = await api('/api/ingame/hot-deploy', { method: 'POST', body: {} });
      setStatus(d.note || 'orbit aktualisiert — im Spiel /orbit');
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
        description="Eigenes Admin-Menü als System-Resource — Orbit-Design, Orbit-Befehle."
      />
      {err && <div className="err">{err}</div>}

      <PanelCard>
        <p className="muted" style={{ marginTop: 0 }}>
          Öffnen: <b>/orbit</b> · <b>/orbitmenu</b>
          {' '}(Keybind unter FiveM → Tastaturbelegung → Orbit Admin-Menü)
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Zugang nur für Panel-Admins mit verknüpfter License/Cfx. Rechte kommen aus der Team-Rolle.
        </p>
        {(user?.role === 'owner' || user?.role === 'admin') && (
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={hotDeploy}>
            {busy ? '…' : 'Menü jetzt aktualisieren (ohne FX-Neustart)'}
          </button>
        )}
        {status && <p className="banner" style={{ marginTop: 12 }}>{status}</p>}
      </PanelCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
        {FEATURES.map((block) => (
          <PanelCard key={block.title}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--accent)' }}>{block.title}</h3>
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {block.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </PanelCard>
        ))}
      </div>
    </Page>
  );
}
