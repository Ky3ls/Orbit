import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import GameMark from '../components/GameMark.jsx';
import { toast } from '../components/toast.jsx';
import { Brand } from '../components/Ui.jsx';
import { NavIcon } from '../layout/icons.jsx';
import { CopyField, JobLog, fmtBytes, useJob } from './host/hostShared.jsx';
import './host/host.css';
import './welcome.css';

const STEPS = [
  { id: 'start', label: 'Server' },
  { id: 'db', label: 'Datenbanken' },
  { id: 'web', label: 'Web & Domain' },
  { id: 'game', label: 'Erster Server' },
];
const ENGINE_ICON = { mysql: 'db', postgresql: 'layers', redis: 'bolt' };

/** Erst-Einrichtung von Orbit — für jeden Host, unabhängig von FiveM */
export default function Welcome({ user }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [d, setD] = useState(null);
  const [pick, setPick] = useState({ mysql: true, postgresql: false, redis: false });
  const [variant, setVariant] = useState('mariadb');
  const [queue, setQueue] = useState([]);
  const [ws, setWs] = useState('nginx');
  const [domain, setDomain] = useState('');
  const [ssl, setSsl] = useState('none');
  const [email, setEmail] = useState('');
  const [made, setMade] = useState([]);
  const [siteId, setSiteId] = useState(null);
  const [guide, setGuide] = useState(null);

  const load = useCallback(() => api('/api/host/setup').then((x) => { setD(x); setEmail((e) => e || x.email || ''); }).catch((e) => toast.err(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const [job, setJob] = useJob((j) => {
    if (j.error) toast.err(`${j.label} fehlgeschlagen`, { text: j.error.split('\n')[0] });
    else setMade((m) => [...m, j.label.replace(/ (installieren|einrichten)$/, '')]);
    if (j.kind === 'site' && !j.error) setSiteId(j.result?.id || null);
    load();
  });

  // Installations-Warteschlange abarbeiten
  useEffect(() => {
    if ((job && !job.done) || !queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    next().then((jb) => jb && setJob(jb)).catch((e) => toast.err(e.message));
  }, [job, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!siteId) return;
    api(`/api/host/web/sites/${siteId}/dns`).then(setGuide).catch(() => {});
  }, [siteId]);

  const busy = (job && !job.done) || queue.length > 0;
  const eng = (id) => d?.engines.find((e) => e.id === id);

  function installDbs() {
    const tasks = Object.entries(pick).filter(([id, on]) => on && !eng(id)?.installed)
      .map(([id]) => () => api(`/api/host/db/${id}/install`, { method: 'POST', body: { variant: id === 'mysql' ? variant : undefined } }).then((r) => r.job));
    if (!tasks.length) { setStep(2); return; }
    setQueue(tasks);
  }

  function setupWeb() {
    const tasks = [];
    if (!d.webserver) tasks.push(() => api('/api/host/web/install', { method: 'POST', body: { id: ws } }).then((r) => r.job));
    if (domain.trim()) {
      tasks.push(() => api('/api/host/web/sites', { method: 'POST', body: { type: 'proxy', domain: domain.trim().toLowerCase(), target: String(d.panelPort), websocket: true, ssl, email, note: 'Orbit-Panel' } }).then((r) => r.job));
    }
    if (!tasks.length) { setStep(3); return; }
    setQueue(tasks);
  }

  async function finish(to) {
    try { await api('/api/host/setup/done', { method: 'POST', body: {} }); } catch { /* */ }
    navigate(to, { replace: true });
  }

  if (!d) return <div className="wl"><div className="wl-card"><div className="mcx-loading">Prüfe den Server…</div></div></div>;
  const h = d.host;
  const running = d.services.filter((s) => s.installed);

  return (
    <div className="wl">
      <div className="wl-glow" aria-hidden="true" />
      <div className="wl-card">
        <header className="wl-head">
          <Brand size={38} sub="Ersteinrichtung" />
          <button type="button" className="mcx-reset" onClick={() => finish('/home')}>Später einrichten</button>
        </header>
        <ol className="wl-steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''}><span>{i < step ? <NavIcon name="check" /> : i + 1}</span>{s.label}</li>
          ))}
        </ol>

        {job && <JobLog job={job} onClose={busy ? undefined : () => setJob(null)} />}

        {step === 0 && (
          <section className="wl-body">
            <h1>Willkommen{user?.username ? `, ${user.username}` : ''}!</h1>
            <p className="wl-lead">Orbit verwaltet alles auf diesem Server an einem Ort: Gameserver, Datenbanken, Websites und Domains. In drei kurzen Schritten ist alles startklar — jeder Schritt lässt sich überspringen.</p>
            <div className="wl-facts">
              <div><span>System</span><b>{h.os}</b></div>
              <div><span>Prozessor</span><b>{h.cpus} Kerne</b></div>
              <div><span>Arbeitsspeicher</span><b>{fmtBytes(h.memTotal)}</b></div>
              <div><span>Freier Speicher</span><b>{h.disk ? fmtBytes(h.disk.free) : '—'}</b></div>
              <div><span>Öffentliche IP</span><b className="mono">{d.ip || '—'}</b></div>
              <div><span>Node.js</span><b>{h.node}</b></div>
            </div>
            {running.length > 0 && (
              <div className="wl-found">
                <span>Schon vorhanden:</span>
                {running.map((s) => <span key={s.id} className={`mcp-chip ${s.active ? 'ok' : ''}`}><i />{s.label}{s.version ? ` ${s.version}` : ''}</span>)}
              </div>
            )}
            <footer className="wl-foot"><span className="grow" /><button type="button" className="btn btn-primary" onClick={() => setStep(1)}>Los geht&apos;s<NavIcon name="arrowRight" /></button></footer>
          </section>
        )}

        {step === 1 && (
          <section className="wl-body">
            <h2>Welche Datenbanken brauchst du?</h2>
            <p className="wl-lead">Für Websites, FiveM-Frameworks, Minecraft-Plugins oder Bots. Orbit installiert sie, lässt sie nur lokal lauschen — Datenbanken und Benutzer legst du danach per Klick an.</p>
            <div className="wl-pick">
              {d.engines.map((e) => {
                const inst = e.installed;
                const on = inst || pick[e.id];
                return (
                  <button key={e.id} type="button" className={`wl-opt${on ? ' on' : ''}${inst ? ' locked' : ''}`} disabled={inst || busy} onClick={() => setPick((p) => ({ ...p, [e.id]: !p[e.id] }))}>
                    <span className="wl-opt-ico"><NavIcon name={ENGINE_ICON[e.id]} /></span>
                    <span className="wl-opt-text"><b>{inst ? (e.variant === 'mariadb' ? 'MariaDB' : e.id === 'mysql' ? 'MySQL' : e.label) : e.label}</b><small>{inst ? `Läuft bereits${e.service?.version ? ` · ${e.service.version}` : ''}` : e.uses}</small></span>
                    <span className="wl-check">{on ? <NavIcon name="check" /> : null}</span>
                  </button>
                );
              })}
            </div>
            {pick.mysql && !eng('mysql')?.installed && (
              <div className="wl-variant"><span>MySQL-Variante:</span><div className="seg"><button type="button" className={variant === 'mariadb' ? 'active' : ''} onClick={() => setVariant('mariadb')}>MariaDB (empfohlen)</button><button type="button" className={variant === 'mysql' ? 'active' : ''} onClick={() => setVariant('mysql')}>MySQL 8</button></div></div>
            )}
            <footer className="wl-foot">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep(0)}>Zurück</button>
              <span className="grow" />
              <button type="button" className="btn" disabled={busy} onClick={() => setStep(2)}>Überspringen</button>
              {job?.done && !queue.length && job.kind === 'install'
                ? <button type="button" className="btn btn-primary" onClick={() => { setJob(null); setStep(2); }}>Weiter<NavIcon name="arrowRight" /></button>
                : <button type="button" className="btn btn-primary" disabled={busy} onClick={installDbs}>{busy ? 'Installiert…' : Object.entries(pick).some(([id, on]) => on && !eng(id)?.installed) ? 'Installieren' : 'Weiter'}<NavIcon name="arrowRight" /></button>}
            </footer>
          </section>
        )}

        {step === 2 && (
          <section className="wl-body">
            <h2>Webserver &amp; Panel-Domain</h2>
            <p className="wl-lead">Ein Webserver bedient Websites und leitet Domains weiter. Optional erreichst du Orbit gleich unter einer eigenen Domain — z. B. <span className="mono">panel.deinserver.de</span>.</p>
            {d.webserver ? (
              <div className="wl-have"><NavIcon name="check" /><span><b>{d.webservers[d.webserver]?.label}</b> ist installiert und wird genutzt.</span></div>
            ) : (
              <div className="wl-pick three">
                {Object.values(d.webservers).map((w) => (
                  <button key={w.id} type="button" className={`wl-opt${ws === w.id ? ' on' : ''}`} disabled={busy} onClick={() => setWs(w.id)}>
                    <span className="wl-opt-ico"><NavIcon name="globe" /></span>
                    <span className="wl-opt-text"><b>{w.label}</b><small>{w.text}</small></span>
                    <span className="wl-check">{ws === w.id ? <NavIcon name="check" /> : null}</span>
                  </button>
                ))}
              </div>
            )}
            <label className="mcp-field wl-domain"><span>Domain für das Panel (optional)</span><input value={domain} disabled={busy} onChange={(e) => setDomain(e.target.value.replace(/\s/g, ''))} placeholder="panel.deinserver.de — leer lassen zum Überspringen" /></label>
            {domain && (
              <div className="hx-ssl">
                <span className="hx-ssl-label">HTTPS</span>
                <div className="seg">
                  <button type="button" className={ssl === 'none' ? 'active' : ''} onClick={() => setSsl('none')}>Über Cloudflare</button>
                  <button type="button" className={ssl === 'letsencrypt' ? 'active' : ''} onClick={() => setSsl('letsencrypt')}>Let&apos;s Encrypt</button>
                </div>
                {ssl === 'none'
                  ? <p className="hx-hint">Bei Cloudflare den A-Record mit orange Wolke anlegen und SSL auf „Flexible“ — fertig.</p>
                  : <label className="mcp-field"><span>E-Mail für Let&apos;s Encrypt</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@example.com" /></label>}
              </div>
            )}
            {guide && (
              <div className="wl-guide">
                <b>Jetzt bei Cloudflare eintragen:</b>
                {guide.guide.map((r) => <CopyField key={r.name} label={`${r.type} · ${r.proxy ? 'Proxy an' : 'Proxy aus'}`} value={`${r.name} → ${r.value}`} />)}
              </div>
            )}
            <footer className="wl-foot">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep(1)}>Zurück</button>
              <span className="grow" />
              <button type="button" className="btn" disabled={busy} onClick={() => setStep(3)}>Überspringen</button>
              {job?.done && !queue.length && (job.kind === 'site' || job.kind === 'install') && step === 2 && (d.webserver || !domain)
                ? <button type="button" className="btn btn-primary" onClick={() => { setJob(null); setStep(3); }}>Weiter<NavIcon name="arrowRight" /></button>
                : <button type="button" className="btn btn-primary" disabled={busy || (ssl === 'letsencrypt' && domain && !email)} onClick={setupWeb}>{busy ? 'Richtet ein…' : (!d.webserver || domain) ? 'Einrichten' : 'Weiter'}<NavIcon name="arrowRight" /></button>}
            </footer>
          </section>
        )}

        {step === 3 && (
          <section className="wl-body">
            <h2>Deinen ersten Server anlegen</h2>
            <p className="wl-lead">{made.length ? `Eingerichtet: ${made.join(', ')}. ` : ''}Jetzt fehlt nur noch ein Gameserver — oder du schaust dich erst um.</p>
            <div className="wl-pick">
              <button type="button" className="wl-opt big" onClick={() => finish('/instances/new/minecraft')}>
                <GameMark game="minecraft" size={44} />
                <span className="wl-opt-text"><b>Minecraft-Server</b><small>Paper, Fabric, Forge … mit RAM-Empfehlung und Mods</small></span>
                <NavIcon name="arrowRight" />
              </button>
              <button type="button" className="wl-opt big" onClick={() => finish('/setup')}>
                <GameMark game="fivem" size={44} />
                <span className="wl-opt-text"><b>FiveM-Server</b><small>Recipes (ESX, QBCore), Datenbank inklusive</small></span>
                <NavIcon name="arrowRight" />
              </button>
              <button type="button" className="wl-opt big" onClick={() => finish('/instances/import')}>
                <span className="wl-opt-ico"><NavIcon name="switch" /></span>
                <span className="wl-opt-text"><b>Bestehenden Server importieren</b><small>Orbit sucht auf dem Host nach Servern</small></span>
                <NavIcon name="arrowRight" />
              </button>
            </div>
            <footer className="wl-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>Zurück</button>
              <span className="grow" />
              <button type="button" className="btn btn-primary" onClick={() => finish('/home')}>Zum Panel<NavIcon name="arrowRight" /></button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
