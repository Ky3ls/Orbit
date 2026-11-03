import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Page, PageHeader } from '../components/Ui.jsx';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './ingame.css';

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
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(t('ingame.status'));
  }, [t]);

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

  const canDeploy = user?.role === 'owner' || user?.role === 'admin';
  const ICONS = { Main: 'bolt', Spieler: 'users', Fahrzeug: 'gamepad' };

  return (
    <Page className="ig-page">
      <PageHeader
        eyebrow="Ingame"
        title={t('page.ingame')}
        description={t('ingame.desc')}
        actions={canDeploy ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={hotDeploy}>
            <NavIcon name="refresh" />{busy ? 'Aktualisiert…' : t('ingame.refresh')}
          </button>
        ) : null}
      />
      {err && <div className="err">{err}</div>}

      <section className="ig-hero card">
        <div className="ig-steps">
          <div className="ig-step">
            <span className="ig-step-n">1</span>
            <div>
              <b>Im Spiel öffnen</b>
              <p>Chat-Befehl <kbd>/orbit</kbd> oder <kbd>/orbitmenu</kbd> — oder eine eigene Taste unter FiveM → Tastaturbelegung → „Orbit Admin-Menü“.</p>
            </div>
          </div>
          <div className="ig-step">
            <span className="ig-step-n">2</span>
            <div>
              <b>Automatisch verknüpft</b>
              <p>{t('ingame.autoLink')}</p>
            </div>
          </div>
          <div className="ig-step">
            <span className="ig-step-n">3</span>
            <div>
              <b>Änderungen sofort übernehmen</b>
              <p>„{t('ingame.refresh')}“ lädt das Menü neu — Spieler bleiben verbunden.</p>
            </div>
          </div>
        </div>
        {status ? <div className="ig-status"><span className="badge ok">Bereit</span><span>{status}</span></div> : null}
      </section>

      <div className="ig-grid">
        {FEATURES.map((block) => (
          <section key={block.title} className="ig-card card">
            <header>
              <span className="ig-ico"><NavIcon name={ICONS[block.title] || 'sparkle'} /></span>
              <h3>{block.title}</h3>
              <span className="ig-count">{block.items.length}</span>
            </header>
            <ul>
              {block.items.map((item) => (
                <li key={item}>
                  <NavIcon name="check" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}
