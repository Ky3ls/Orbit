import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Mark, Page, PageHeader } from '../components/Ui.jsx';
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
  const [menuTab, setMenuTab] = useState(0);

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

      <div className="ig-layout">
        <section className="ig-preview card" aria-label="Vorschau des Ingame-Menüs">
          <div className="ig-scene" aria-hidden="true" />
          <div className="ig-menu">
            <header className="ig-menu-head">
              <span className="ig-menu-logo"><Mark /></span>
              <div>
                <b>ORBIT</b>
                <small>Admin-Menü</small>
              </div>
              <kbd>/orbit</kbd>
            </header>
            <div className="ig-menu-tabs" role="tablist">
              {FEATURES.map((block, i) => (
                <button key={block.title} type="button" role="tab" aria-selected={menuTab === i} className={menuTab === i ? 'active' : ''} onClick={() => setMenuTab(i)}>
                  <NavIcon name={ICONS[block.title] || 'sparkle'} />{block.title}
                </button>
              ))}
            </div>
            <ul className="ig-menu-list">
              {FEATURES[menuTab].items.map((item, i) => (
                <li key={item} className={i === 0 ? 'sel' : ''}>
                  <span>{item}</span>
                  <NavIcon name="chevron" />
                </li>
              ))}
            </ul>
            <footer className="ig-menu-foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> Auswahl</span>
              <span><kbd>Enter</kbd> Ausführen</span>
              <span><kbd>{'Tab'}</kbd> Seite</span>
            </footer>
          </div>
        </section>

        <section className="ig-side">
          <div className="ig-steps card">
            <h3>So nutzt du das Menü</h3>
            <ol>
              <li>
                <span className="ig-step-n">1</span>
                <div>
                  <b>Im Spiel öffnen</b>
                  <p><kbd>/orbit</kbd> oder <kbd>/orbitmenu</kbd> im Chat — oder eine eigene Taste unter FiveM → Tastaturbelegung → „Orbit Admin-Menü“.</p>
                </div>
              </li>
              <li>
                <span className="ig-step-n">2</span>
                <div>
                  <b>Automatisch verknüpft</b>
                  <p>{t('ingame.autoLink')}</p>
                </div>
              </li>
              <li>
                <span className="ig-step-n">3</span>
                <div>
                  <b>Ohne Neustart aktualisieren</b>
                  <p>Änderungen am Menü mit „{t('ingame.refresh')}“ übernehmen — Spieler bleiben verbunden.</p>
                </div>
              </li>
            </ol>
          </div>
          <div className="ig-stat card">
            <span className="ig-stat-ico"><NavIcon name="check" /></span>
            <div>
              <b>System-Resource „orbit“</b>
              <span>{status || 'Bereit'}</span>
            </div>
          </div>
          <div className="ig-count card">
            {FEATURES.map((block) => (
              <div key={block.title}><b>{block.items.length}</b><span>{block.title}</span></div>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}
