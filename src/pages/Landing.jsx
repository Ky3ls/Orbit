import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LineWaves from '../components/LineWaves.jsx';
import { Mark } from '../components/Ui.jsx';

function FlyWord({ text, className = '', delay = 0 }) {
  return (
    <span className={`fly-word ${className}`} aria-label={text}>
      {text.split('').map((char, index) => (
        <span
          key={`${char}-${index}`}
          className="fly-letter"
          style={{ animationDelay: `${delay + index * 0.055}s` }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  );
}

function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setOn(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal ${on ? 'on' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const STACK = [
  ['01', 'Unified control', 'Spieler, Konsole, Bans, Whitelist und Ressourcen in einer Oberfläche.'],
  ['02', 'Setup-Wizard', 'Master zuerst, danach Deployment wie bei txAdmin: Recipes oder vorhandene Daten.'],
  ['03', 'Live monitoring', 'CPU, RAM und Slots als Kurve — ohne Extra-Last auf dem FXServer.'],
  ['04', 'Cfx.re login', 'Optional verknüpfen. Neue Admins entstehen dadurch nicht von allein.'],
  ['05', 'Access control', 'Rollen, Audit, Rate-Limits und Sitzungen, die nur lokal bleiben.'],
];

const FAQ = [
  {
    q: 'Für wen ist Orbit?',
    a: 'Für Server-Inhaber und Team-Admins. Zuerst der Master-Account, danach das Serverprofil.',
  },
  {
    q: 'Was passiert beim Setup?',
    a: 'Du wählst Deployment-Typ und Vorlage. Orbit speichert das Profil und erzeugt eine server.cfg-Vorschau — ohne den laufenden FXServer zu überschreiben.',
  },
  {
    q: 'Kann ich Cfx.re nutzen?',
    a: 'Ja. Unter Einstellungen verknüpfen. Danach reicht der Cfx-Login — aber nur für bereits angelegte Team-Accounts.',
  },
  {
    q: 'Steuert Orbit den FXServer direkt?',
    a: 'Ja — optional startet Orbit den FXServer selbst (wie ein Launcher). Alternativ bleibt systemd. Konsole und Ressourcen laufen über die Orbit-Pipe oder RCON.',
  },
  {
    q: 'Kommt Minecraft?',
    a: 'Der Adapter ist vorbereitet. FiveM ist aktiv, Minecraft folgt als nächste Plattform.',
  },
];

export default function Landing({ user }) {
  const panel = user ? (user.setup ? '/panel' : '/setup') : '/login';
  const [openFaq, setOpenFaq] = useState(0);
  const [active, setActive] = useState('top');

  useEffect(() => {
    const ids = ['top', 'pulse', 'lens', 'stack', 'access', 'notes'];
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (!nodes.length) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActive(visible.target.id);
      },
      { threshold: [0.25, 0.45], rootMargin: '-20% 0px -45% 0px' },
    );
    nodes.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, []);

  return (
    <div className="land land-heroic">
      <LineWaves />
      <div className="land-veil" aria-hidden="true" />

      <nav className="float-nav" aria-label="Primary">
        <Link to="/" className="float-brand"><Mark /> orbit</Link>
        <div className="float-links" aria-hidden="false">
          {[
            ['pulse', 'Pulse'],
            ['lens', 'Lens'],
            ['stack', 'Stack'],
            ['access', 'Access'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? 'on' : ''}>{label}</a>
          ))}
        </div>
        <Link className="float-cta" to={panel}>
          Enter <span aria-hidden="true">↗</span>
        </Link>
      </nav>

      <nav className="float-nav-mobile" aria-label="Abschnitte">
        {[
          ['top', 'Start'],
          ['pulse', 'Pulse'],
          ['lens', 'Lens'],
          ['stack', 'Stack'],
          ['access', 'Access'],
          ['notes', 'FAQ'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={id === 'top' ? '#' : `#${id}`}
            className={active === id ? 'on' : ''}
            onClick={id === 'top' ? (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); } : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      <header id="top" className="hero-god">
        <div className="live-pill fly-block" style={{ animationDelay: '0.05s' }}>
          <i /> FiveM Control
        </div>
        <h1 className="hero-title">
          <FlyWord text="orbit" />
        </h1>
        <p className="hero-sub fly-block" style={{ animationDelay: '0.45s' }}>
          One panel. <em>Every server move.</em>
        </p>
        <p className="hero-copy fly-block" style={{ animationDelay: '0.58s' }}>
          Master anlegen, Recipes wählen, danach mit der Home-Bar steuern —
          Konsole, Spieler, Bans und Monitoring lokal und gehärtet.
        </p>
        <div className="hero-actions fly-block" style={{ animationDelay: '0.72s' }}>
          <Link className="btn-solid" to={panel}>
            Get started <span aria-hidden="true">↗</span>
          </Link>
          <a className="btn-ghost" href="#stack">See the stack</a>
        </div>
      </header>

      <section id="pulse" className="land-section">
        <Reveal>
          <p className="sec-kicker">01 — Pulse</p>
          <div className="sec-head">
            <h2>Built for operators, not one box.</h2>
            <span>product scope</span>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="pulse-board">
            {[
              ['Slots', '48'],
              ['Resources', '16+'],
              ['Modules', '12'],
              ['Games', '2'],
              ['Audit', 'Full'],
              ['Bridge', 'Local'],
            ].map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </Reveal>
      </section>

      <section id="lens" className="land-section lens">
        <Reveal className="lens-copy">
          <p className="sec-kicker">02 — Lens</p>
          <h2>Drop one server.<br /><em>Watch the panel tighten.</em></h2>
          <p>
            Orbit liest den lokalen Endpunkt, zeigt Spieler und Host-Last,
            und hält Befehle in einer Warteschlange — bereit für Notes, Audit und Follow-ups.
          </p>
          <Link className="text-link" to={panel}>Open the panel →</Link>
        </Reveal>
        <Reveal delay={120} className="lens-panel">
          <div className="query-card">
            <div className="spread">
              <span className="mono">profile</span>
              <span className="tag game-fivem">FIVEM</span>
            </div>
            <b className="mono">Dev | by Ky3ls</b>
            {[
              ['Live console', 'queued commands', 'READY'],
              ['Player graph', 'ping · identifiers', 'LIVE'],
              ['Ban ledger', 'expiry · audit', 'SOFT'],
              ['Resource map', 'start · stop · restart', 'CORE'],
            ].map(([title, text, badge]) => (
              <div className="query-row" key={title}>
                <div>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </div>
                <span className={`tag ${badge === 'LIVE' || badge === 'READY' ? 'hot' : ''}`}>{badge}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section id="stack" className="land-section">
        <Reveal>
          <p className="sec-kicker">03 — Stack</p>
          <h2>Built as a system, not a dump.</h2>
        </Reveal>
        <div className="stack-grid">
          {STACK.map(([num, title, text], index) => (
            <Reveal key={title} delay={index * 60} className="stack-card">
              <span>{num}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="between">
        <Reveal>
          <div className="between-line" />
          <p className="sec-kicker">Between systems</p>
          <h2>Signal in. Structure out.</h2>
          <p>Der Stack speist Access — Module, Corpora und Controls in einer Operator-Fläche.</p>
          <div className="chip-marquee">
            {['Role-gated access', 'Case-ready queue', 'Local FX bridge', 'Cfx.re link', 'Home-Bar nav', 'Recipe wizard'].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Reveal>
      </section>

      <section id="access" className="land-section">
        <Reveal>
          <p className="sec-kicker">04 — Access</p>
          <h2>Pick a lane. Start shipping.</h2>
        </Reveal>
        <div className="access-grid">
          {[
            ['Install', 'Master anlegen', 'Erster Inhaber-Account. Danach der Wizard.', '/install'],
            ['Setup', 'Server anbinden', 'Recipes, vorhandene Daten oder Custom-Template.', user ? '/setup' : '/login'],
            ['Panel', 'Home-Bar', 'Spieler, Konsole, Server und Mehr unten greifbar.', panel],
            ['Cfx.re', 'Optional', 'Forum-Login nur für verknüpfte Team-Accounts.', user ? '/settings' : '/api/auth/cfx/start?mode=login'],
          ].map(([eyebrow, title, text, href], index) => (
            <Reveal key={title} delay={index * 70} className="access-card">
              <span>{eyebrow}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              {href.startsWith('/api') ? <a className="btn-ghost" href={href}>Open</a> : <Link className="btn-ghost" to={href}>Open</Link>}
            </Reveal>
          ))}
        </div>
      </section>

      <section id="notes" className="land-section">
        <Reveal>
          <p className="sec-kicker">05 — Notes</p>
          <h2>Short answers. No brochure fog.</h2>
        </Reveal>
        <div className="faq">
          {FAQ.map((item, index) => (
            <Reveal key={item.q} delay={index * 40}>
              <button type="button" className={`faq-item${openFaq === index ? ' open' : ''}`} onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>
                <span>{item.q}</span>
                <i>{openFaq === index ? '−' : '+'}</i>
              </button>
              {openFaq === index && <p className="faq-a">{item.a}</p>}
            </Reveal>
          ))}
        </div>
      </section>

      <section className="land-final">
        <Reveal>
          <h2>Ready when you are.</h2>
          <Link className="btn-solid" to={panel}>Enter orbit <span aria-hidden="true">↗</span></Link>
          <p>© 2026 Orbit · by Ky3ls</p>
        </Reveal>
      </section>
    </div>
  );
}
