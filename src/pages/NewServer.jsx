import { Link, useOutletContext } from 'react-router-dom';
import GameMark from '../components/GameMark.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import { GAMES, GAME_ORDER } from '../games.js';
import { NavIcon } from '../layout/icons.jsx';
import './home.css';

/** Neuer Server: erst das Spiel wählen, dann der passende Assistent */
export default function NewServer() {
  const { servers = [] } = useOutletContext();
  const hasFx = servers.some((s) => s.game === 'fivem');
  const target = {
    minecraft: '/instances/new/minecraft',
    fivem: hasFx ? '/settings?section=host&tab=servers' : '/setup',
  };
  const note = {
    minecraft: 'Version, Loader, RAM-Empfehlung und Mods/Plugins direkt beim Anlegen.',
    fivem: hasFx ? 'Weiteren FXServer hinzufügen — Verwaltung in den Host-Einstellungen.' : 'Assistent mit Recipes, Datenbank und txAdmin-Import.',
  };

  return (
    <Page className="home-page">
      <PageHeader
        eyebrow="Neuer Server"
        title="Welches Spiel?"
        description="Orbit verwaltet alle Server auf diesem Host gleich — Konsole, Spieler, Dateien, Backups."
        actions={<Link to="/home" className="btn btn-sm btn-ghost">Abbrechen</Link>}
      />
      <div className="ns-grid">
        {GAME_ORDER.map((id) => {
          const g = GAMES[id];
          const inner = (
            <>
              <GameMark game={id} size={56} />
              <span className="ns-text">
                <b>{g.label}{!g.ready && <span className="ns-soon">Bald</span>}</b>
                <small>{g.blurb}</small>
                {note[id] && <em>{note[id]}</em>}
              </span>
              {g.ready && <span className="ns-go"><NavIcon name="arrowRight" /></span>}
            </>
          );
          return g.ready
            ? <Link key={id} to={target[id]} className="ns-card card" style={{ '--game': g.color }}>{inner}</Link>
            : <div key={id} className="ns-card card off" style={{ '--game': g.color }} aria-disabled="true">{inner}</div>;
        })}
      </div>
      <Link to="/instances/import" className="ns-import card">
        <span className="ns-import-ico"><NavIcon name="switch" /></span>
        <span className="ns-text"><b>Bestehenden Server importieren</b><small>Orbit sucht auf dem Host nach Servern und übernimmt Welten, Plugins/Mods und Einstellungen.</small></span>
        <span className="ns-go"><NavIcon name="arrowRight" /></span>
      </Link>
    </Page>
  );
}
