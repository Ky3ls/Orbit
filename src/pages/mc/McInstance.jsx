import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import '../../cockpit/cockpit.css';
import { api } from '../../api.js';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Page } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META, fmtDur, fmtMb, phaseOf } from './mcShared.js';
import McBackups from './McBackups.jsx';
import McFiles from './McFiles.jsx';
import McMods from './McMods.jsx';
import McPlayers, { McPlayerPanel } from './McPlayers.jsx';
import McWidgets from './McWidgets.jsx';
import McRestartCard from './McRestartCard.jsx';
import { CrashCard, HistoryCard, ModUpdateBanner, PlayerHistoryCard, lagTile, useMonitor } from './McMonitor.jsx';
import McSettings from './McSettings.jsx';
import './mc.css';

const TABS = [
  { id: 'console', label: 'Übersicht & Konsole', icon: 'term' },
  { id: 'players', label: 'Spieler', icon: 'users' },
  { id: 'mods', label: 'Mods', icon: 'box' },
  { id: 'settings', label: 'Einstellungen', icon: 'cfg' },
  { id: 'files', label: 'Dateien', icon: 'folder' },
  { id: 'backups', label: 'Backups', icon: 'archive' },
  { id: 'instance', label: 'Instanz', icon: 'gear' },
];
const QUICK = ['list', 'save-all', 'time set day', 'weather clear', 'tps'];
const COMMANDS = ['advancement', 'ban', 'ban-ip', 'banlist', 'clear', 'difficulty', 'effect', 'enchant', 'execute', 'experience', 'fill', 'forceload', 'gamemode', 'gamerule', 'give', 'help', 'item', 'kick', 'kill', 'list', 'locate', 'loot', 'me', 'msg', 'op', 'deop', 'pardon', 'pardon-ip', 'particle', 'playsound', 'reload', 'save-all', 'save-off', 'save-on', 'say', 'scoreboard', 'seed', 'setblock', 'setworldspawn', 'spawnpoint', 'spreadplayers', 'stop', 'summon', 'tag', 'team', 'teleport', 'tell', 'tellraw', 'tick', 'time', 'title', 'tp', 'weather', 'whitelist', 'worldborder', 'xp', 'forge', 'tps', 'mspt', 'plugins', 'version'];
const SELECTORS = ['@a', '@p', '@r', '@s', '@e'];
const FILTERS = [{ id: 'all', label: 'Alle' }, { id: 'warn', label: 'Warnungen' }, { id: 'bad', label: 'Fehler' }];

function Highlight({ text, q }) {
  if (!q) return text;
  const low = text.toLowerCase();
  const out = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const j = low.indexOf(q, i);
    if (j < 0) break;
    out.push(text.slice(i, j), <mark key={k += 1}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  out.push(text.slice(i));
  return out;
}

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

/** Kachel wie in der FiveM-Übersicht */
function Kpi({ icon, label, value, unit, sub, pct, to, tone }) {
  return (
    <Link to={to} className="kpi card" style={tone ? { '--kpi': `var(--${tone === 'accent' ? 'accent' : tone})` } : undefined}>
      <div className="kpi-top">
        <span className="kpi-ico"><NavIcon name={icon} /></span>
        <span className="kpi-label">{label}</span>
        <span className="kpi-go"><NavIcon name="arrowRight" /></span>
      </div>
      <div className="kpi-value"><strong>{value}</strong>{unit ? <span>{unit}</span> : null}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
      {pct != null && <div className="kpi-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>}
    </Link>
  );
}

/* ── Konsole ── */
function Console({ inst, onPlayers }) {
  const [lines, setLines] = useState([]);
  const [cmd, setCmd] = useState('');
  const [hist, setHist] = useState([]);
  const [hi, setHi] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [live, setLive] = useState(false);
  const [q, setQ] = useState('');
  const [lvl, setLvl] = useState('all');
  const [names, setNames] = useState([]);
  const [tab, setTab] = useState(null); // { base, list, i }
  const box = useRef(null);
  const playersCb = useRef(onPlayers);
  playersCb.current = onPlayers;
  const running = !!inst.status.pid;

  // Live-Stream: Orbit schickt sofort die letzten Zeilen, danach jede neue Zeile in dem Moment, in dem der Server sie schreibt
  useEffect(() => {
    const es = new EventSource(`/api/mc/instances/${inst.id}/console/stream`);
    const parse = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
    es.addEventListener('init', (e) => {
      const d = parse(e);
      if (!d) return;
      setLive(true);
      setLines(d.lines || []);
      playersCb.current?.(d.players || []);
      setNames((d.players || []).map((p) => p.name));
    });
    es.addEventListener('lines', (e) => {
      const d = parse(e);
      if (d?.lines?.length) setLines((prev) => (prev.length + d.lines.length > 1500 ? [...prev, ...d.lines].slice(-1500) : [...prev, ...d.lines]));
    });
    es.addEventListener('reset', () => setLines([]));
    es.addEventListener('players', (e) => { const d = parse(e); if (d) { playersCb.current?.(d.players || []); setNames((d.players || []).map((p) => p.name)); } });
    es.onerror = () => setLive(false);
    return () => { es.close(); playersCb.current?.(null); };
  }, [inst.id]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  async function send(text) {
    const c = String(text ?? cmd).trim().replace(/^\//, '');
    if (!c) return;
    try {
      await api(`/api/mc/instances/${inst.id}/command`, { method: 'POST', body: { command: c } });
      setHist((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50));
      setHi(-1);
      if (text == null) setCmd('');
    } catch (e) {
      toast.err(e.message);
    }
  }

  const ql = q.trim().toLowerCase();
  const shown = (ql || lvl !== 'all')
    ? lines.filter((l) => (lvl === 'all' || (lvl === 'warn' ? l.level === 'warn' || l.level === 'bad' : l.level === 'bad')) && (!ql || l.t.toLowerCase().includes(ql)))
    : lines;

  /** Tab: Befehl bzw. Spielername vervollständigen, nochmal Tab = nächster Treffer */
  function complete(e) {
    e.preventDefault();
    if (tab && tab.list.length > 1) {
      const i = (tab.i + 1) % tab.list.length;
      setTab({ ...tab, i });
      setCmd(tab.base + tab.list[i]);
      return;
    }
    const parts = cmd.split(' ');
    const word = parts.pop();
    const base = parts.length ? `${parts.join(' ')} ` : '';
    const pool = parts.length ? [...names, ...SELECTORS] : COMMANDS;
    const list = pool.filter((x) => x.toLowerCase().startsWith(word.toLowerCase())).sort();
    if (!list.length) return;
    setTab({ base, list, i: 0 });
    setCmd(base + list[0] + (list.length === 1 ? ' ' : ''));
  }

  return (
    <section className="mci-console dash-console card">
      <header>
        <span className={`lg-live${running ? '' : ' paused'}`}><i />{running ? 'Live' : 'Offline'}</span>
        <div className="mci-quick">
          {QUICK.map((q) => <button key={q} type="button" className="lc-chip" disabled={!running} onClick={() => send(q)}>{q}</button>)}
        </div>
        <div className="mci-search">
          <NavIcon name="search" />
          <input value={q} placeholder="Suchen…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />
          {q ? <button type="button" title="Leeren" onClick={() => setQ('')}><NavIcon name="x" /></button> : null}
        </div>
        <div className="mci-seg" role="group" aria-label="Filter">
          {FILTERS.map((f) => <button key={f.id} type="button" className={lvl === f.id ? 'on' : ''} onClick={() => setLvl(f.id)}>{f.label}</button>)}
        </div>
        <button type="button" className={`btn btn-sm${follow ? ' mci-on' : ''}`} onClick={() => setFollow((v) => !v)}>Auto-Scroll</button>
      </header>
      <div
        className="mci-term"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {lines.length === 0 ? <div className="lc-empty">{!live ? 'Verbinde…' : running ? 'Warte auf Ausgabe…' : 'Server ist offline. Starte ihn, um die Konsole zu sehen.'}</div> : null}
        {lines.length > 0 && shown.length === 0 ? <div className="lc-empty">Keine Zeile passt zu {ql ? `„${q}“` : 'dem Filter'}.</div> : null}
        {shown.map((l, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={l.id ?? i} className={`mci-line lvl-${l.level}`}><Highlight text={l.t} q={ql} /></div>
        ))}
      </div>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="mono"
          value={cmd}
          disabled={!running}
          placeholder={running ? 'Befehl eingeben (ohne /) — Tab ergänzt, ↑ für Verlauf' : 'Server ist offline'}
          onChange={(e) => { setCmd(e.target.value); setTab(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') { complete(e); return; }
            if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); const n = Math.min(hi + 1, hist.length - 1); setHi(n); setCmd(hist[n]); }
            if (e.key === 'ArrowDown' && hi >= 0) { e.preventDefault(); const n = hi - 1; setHi(n); setCmd(n < 0 ? '' : hist[n]); }
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </form>
      {tab && tab.list.length > 1 ? (
        <div className="mci-tabs">{tab.list.slice(0, 12).map((x, i) => <span key={x} className={i === tab.i ? 'on' : ''}>{x}</span>)}{tab.list.length > 12 ? <span>+{tab.list.length - 12}</span> : null}</div>
      ) : null}
    </section>
  );
}

/* ── Adresse & Erreichbarkeit ── */
function Reach({ inst }) {
  const [host, setHost] = useState('');
  const [saved, setSaved] = useState('');
  const [check, setCheck] = useState(null);
  const [ext, setExt] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/api/mc/address').then((d) => { setHost(d.host || ''); setSaved(d.host || ''); setCheck(d.check); }).catch(() => {});
  }, []);

  async function save() {
    setBusy('save');
    try {
      const d = await api('/api/mc/address', { method: 'PUT', body: { host } });
      setSaved(d.host);
      setHost(d.host);
      setCheck(d.check);
      toast.ok('Adresse gespeichert', { text: `${d.host}:${inst.port}` });
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }
  async function testOutside() {
    setBusy('ext');
    setExt(null);
    try { setExt(await api(`/api/mc/instances/${inst.id}/reach`)); } catch (e) { toast.err(e.message); }
    setBusy('');
  }

  const full = `${saved || host}:${inst.port}`;
  return (
    <section className="sx-card">
      <header className="sx-card-head">
        <div><h3>Adresse & Erreichbarkeit</h3><p>Diese Adresse tragen Spieler in Minecraft ein. Gilt für alle Minecraft-Instanzen.</p></div>
      </header>
      <div className="sx-card-body">
        <div className="sx-row">
          <div className="sx-row-text"><b>Öffentliche Adresse</b><span>Domain (z. B. play.deinserver.de) oder IP — ohne Port</span></div>
          <div className="sx-row-ctl mci-inline">
            <input value={host} placeholder="play.deinserver.de" onChange={(e) => setHost(e.target.value.trim())} />
            <button type="button" className="btn btn-sm" disabled={busy === 'save' || host === saved} onClick={save}>Speichern</button>
          </div>
        </div>
        {check && (
          <div className={`mci-dns ${check.cloudflare ? 'bad' : !check.resolves && !check.isIp ? 'bad' : check.pointsHere ? 'ok' : 'warn'}`}>
            <NavIcon name={check.cloudflare || (!check.resolves && !check.isIp) ? 'x' : check.pointsHere ? 'check' : 'bolt'} />
            <div>
              {check.cloudflare ? (
                <><b>Läuft über den Cloudflare-Proxy — Minecraft kann so nicht verbinden.</b><span>Bei Cloudflare den DNS-Eintrag auf „Nur DNS“ (graue Wolke) stellen. Minecraft nutzt reines TCP, das der Proxy nicht weiterleitet.</span></>
              ) : !check.resolves && !check.isIp ? (
                <><b>Domain ist nicht auflösbar.</b><span>DNS-Eintrag (A-Record) auf {check.local?.[0] || 'die Server-IP'} anlegen.</span></>
              ) : check.pointsHere ? (
                <><b>DNS ist korrekt.</b><span>{check.host} → {check.ips.join(', ')} (dieser Server)</span></>
              ) : (
                <><b>Zeigt nicht auf diesen Server.</b><span>{check.host} → {check.ips.join(', ')} · dieser Server: {check.local?.join(', ')}</span></>
              )}
            </div>
          </div>
        )}
        <div className="sx-row">
          <div className="sx-row-text"><b>Verbinden mit</b><span>{inst.port === 25565 ? 'Standard-Port — in Minecraft reicht auch die Adresse ohne :25565' : 'Nicht-Standard-Port — muss in Minecraft mit angegeben werden'}</span></div>
          <div className="sx-row-ctl mci-inline">
            <code className="mci-full mono">{full}</code>
            <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(full).then(() => toast.ok('Adresse kopiert', { text: full }))}><NavIcon name="copy" />Kopieren</button>
          </div>
        </div>
        <div className="sx-row">
          <div className="sx-row-text"><b>Von außen prüfen</b><span>Fragt den öffentlichen Dienst mcsrvstat.us, ob der Server aus dem Internet erreichbar ist.</span></div>
          <div className="sx-row-ctl mci-inline">
            {ext ? (
              <span className={`badge ${ext.external.online ? 'ok' : 'bad'}`}>{ext.external.online ? `Erreichbar · ${ext.external.version || ''} · ${ext.external.players || ''}` : 'Nicht erreichbar'}</span>
            ) : null}
            <button type="button" className="btn btn-sm" disabled={busy === 'ext' || !inst.status.pid} onClick={testOutside}><NavIcon name="globe" />{busy === 'ext' ? 'Prüft…' : inst.status.pid ? 'Jetzt prüfen' : 'Server starten'}</button>
          </div>
        </div>
        {ext && !ext.external.online && (
          <div className="mci-dns bad">
            <NavIcon name="x" />
            <div><b>Von außen nicht erreichbar.</b><span>Port {inst.port} (TCP) in der Firewall deines Hosters freigeben (z. B. IONOS Cloud-Firewall) und prüfen, ob die Adresse auf diesen Server zeigt.</span></div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Instanz-Einstellungen ── */
/** Discord-Benachrichtigungen (gelten für alle Minecraft-Server) */
function AlertSettings() {
  const [cfg, setCfg] = useState(null);
  const [hook, setHook] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    api('/api/mc/alerts').then((d) => { setCfg(d); setHook(d.webhook || ''); }).catch(() => {});
  }, []);
  if (!cfg) return null;
  async function save(body, msg) {
    setBusy('save');
    try {
      const d = await api('/api/mc/alerts', { method: 'PUT', body });
      setCfg((c) => ({ ...c, ...d }));
      setHook(d.webhook || '');
      if (msg) toast.ok(msg);
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }
  async function test() {
    setBusy('test');
    try { await api('/api/mc/alerts/test', { method: 'POST' }); toast.ok('Testnachricht gesendet', { text: 'Schau in deinen Discord-Kanal.' }); } catch (e) { toast.err(e.message); }
    setBusy('');
  }
  return (
    <section className="sx-card">
      <header className="sx-card-head"><div><h3>Discord-Benachrichtigungen</h3><p>Orbit meldet Probleme sofort in einen Discord-Kanal — für alle Minecraft-Server. Webhook anlegen: Kanal → Einstellungen → Integrationen → Webhooks.</p></div></header>
      <div className="sx-card-body mci-alerts">
        <div className="mci-alerts-row">
          <input className="input mono" value={hook} placeholder="https://discord.com/api/webhooks/…" onChange={(e) => setHook(e.target.value)} />
          <button type="button" className="btn btn-sm btn-primary" disabled={!!busy || hook === (cfg.webhook || '')} onClick={() => save({ webhook: hook }, hook ? 'Webhook gespeichert' : 'Webhook entfernt')}>Speichern</button>
          <button type="button" className="btn btn-sm" disabled={!!busy || !cfg.webhook} onClick={test}>Test senden</button>
        </div>
        <div className="mci-alerts-kinds">
          {Object.entries(cfg.labels || {}).map(([k, label]) => (
            <label key={k} className="mci-alerts-kind">
              <input type="checkbox" checked={cfg.kinds?.[k] !== false} disabled={!!busy} onChange={(e) => save({ kinds: { [k]: e.target.checked } })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {cfg.recent?.length ? (
          <ul className="mci-alerts-recent">
            {cfg.recent.slice(0, 5).map((a) => (
              <li key={`${a.at}-${a.kind}`}><b>{a.server ? `${a.server} · ` : ''}{a.title}</b><time>{new Date(a.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></li>
            ))}
          </ul>
        ) : <p className="muted mci-alerts-none">Noch keine Meldungen — alles ruhig.</p>}
      </div>
    </section>
  );
}

function InstanceSettings({ inst, onChange }) {
  const navigate = useNavigate();
  const [ram, setRam] = useState(null);
  const [ramMb, setRamMb] = useState(inst.ramMb);
  const [name, setName] = useState(inst.name);
  const [port, setPort] = useState(inst.port);
  const [java, setJava] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/mc/ram-suggest?id=${inst.id}`).then(setRam).catch(() => {});
    api(`/api/mc/java?mc=${encodeURIComponent(inst.mcVersion)}`).then(setJava).catch(() => {});
  }, [inst.id, inst.mcVersion]);

  async function patch(body, msg) {
    setBusy(true);
    try {
      const d = await api(`/api/mc/instances/${inst.id}`, { method: 'PATCH', body });
      onChange(d.instance);
      toast.ok(msg, { text: inst.status.pid ? 'Greift nach einem Neustart.' : undefined });
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }

  async function del() {
    const files = window.confirm(`„${inst.name}“ löschen?\n\nOK = inklusive aller Dateien (Welt, Mods, Configs)\nAbbrechen = nichts tun`);
    if (!files) return;
    const typed = window.prompt(`Zum Bestätigen den Namen eingeben: ${inst.name}`);
    if (typed !== inst.name) { toast.err('Abgebrochen — Name stimmt nicht.'); return; }
    const backups = window.confirm('Auch alle Backups dieser Instanz löschen?\n\nOK = Backups löschen\nAbbrechen = Backups behalten (bleiben im Orbit-Datenordner)');
    try {
      await api(`/api/mc/instances/${inst.id}`, { method: 'DELETE', body: { deleteFiles: true, deleteBackups: backups } });
      toast.ok(`${inst.name} gelöscht`);
      navigate('/home');
    } catch (e) { toast.err(e.message); }
  }

  const max = Math.max(ram?.max || 16384, ramMb);
  return (
    <div className="sx-stack">
      <AlertSettings />
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Arbeitsspeicher</h3><p>Orbit empfiehlt anhand von Typ, installierten {inst.modKind || 'Erweiterungen'}, Slots und Sichtweite.</p></div></header>
        <div className="sx-card-body mci-ram">
          <div className="mci-ram-row">
            <b>{fmtMb(ramMb)}</b>
            {ram ? (ramMb === ram.recommended
              ? <span className="badge ok">Empfehlung</span>
              : <button type="button" className="mcx-reset" onClick={() => setRamMb(ram.recommended)}>Empfehlung: {fmtMb(ram.recommended)}</button>) : null}
            <span className="grow" />
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || ramMb === inst.ramMb} onClick={() => patch({ ramMb }, 'RAM gespeichert')}>Übernehmen</button>
          </div>
          <input
            type="range"
            className="mcx-ram-slider"
            min={1024}
            max={max}
            step={512}
            value={ramMb}
            onChange={(e) => setRamMb(Number(e.target.value))}
            style={{ '--pct': `${((ramMb - 1024) / (max - 1024)) * 100}%`, '--rec': `${(((ram?.recommended || 1024) - 1024) / (max - 1024)) * 100}%` }}
          />
          {ram ? <ul className="mci-reasons">{ram.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
        </div>
      </section>
      <Reach inst={inst} />
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Allgemein</h3></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>Name</b></div>
            <div className="sx-row-ctl mci-inline"><input value={name} onChange={(e) => setName(e.target.value)} /><button type="button" className="btn btn-sm" disabled={busy || name === inst.name} onClick={() => patch({ name }, 'Name gespeichert')}>Speichern</button></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Port</b><span>Nur bei gestopptem Server änderbar.</span></div>
            <div className="sx-row-ctl mci-inline"><input type="number" value={port} className="sx-num" disabled={!!inst.status.pid} onChange={(e) => setPort(Number(e.target.value))} /><button type="button" className="btn btn-sm" disabled={busy || port === inst.port || !!inst.status.pid} onClick={() => patch({ port }, 'Port gespeichert')}>Speichern</button></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Java</b><span>{java?.required ? `Minecraft ${inst.mcVersion} braucht Java ${java.required}` : ''}</span></div>
            <div className="sx-row-ctl">
              <select value={inst.javaMajor || ''} disabled={busy} onChange={(e) => patch({ javaMajor: Number(e.target.value) }, `Java ${e.target.value} gesetzt`)}>
                {[...new Set([...(java?.installed || []).map((j) => j.major), java?.required].filter(Boolean))].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>Java {m}{m === java?.required ? ' (empfohlen)' : ''}{(java?.installed || []).some((j) => j.major === m) ? '' : ' — wird geladen'}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Autostart</b><span>Startet automatisch, wenn Orbit startet.</span></div>
            <div className="sx-row-ctl"><button type="button" role="switch" aria-checked={inst.autostart} className={`switch${inst.autostart ? ' on' : ''}`} onClick={() => patch({ autostart: !inst.autostart }, 'Autostart gespeichert')} /></div>
          </div>
          <div className="sx-row">
            <div className="sx-row-text"><b>Crash-Neustart</b><span>Nach einem Absturz automatisch neu starten (max. 3× in 10 Min.).</span></div>
            <div className="sx-row-ctl"><button type="button" role="switch" aria-checked={inst.autoRestart} className={`switch${inst.autoRestart ? ' on' : ''}`} onClick={() => patch({ autoRestart: !inst.autoRestart }, 'Gespeichert')} /></div>
          </div>
          <div className="sx-row stack">
            <div className="sx-row-text"><b>Ordner auf dem Server</b><span>Hier liegen Welt, Configs und {inst.modKind || 'Daten'} dieser Instanz.</span></div>
            <div className="sx-row-ctl mci-pathrow">
              <code className="mci-path mono">{inst.path}</code>
              <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(inst.path).then(() => toast.ok('Pfad kopiert', { text: inst.path }))}><NavIcon name="copy" />Kopieren</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/mc/${inst.id}/files`)}><NavIcon name="folder" />Im Dateimanager</button>
            </div>
          </div>
        </div>
      </section>
      <section className="sx-card tone-bad">
        <header className="sx-card-head"><div><h3>Gefahrenzone</h3><p>Löscht die Instanz samt Welt, Mods und Configs. Nicht umkehrbar.</p></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>Instanz löschen</b><span>{inst.status.pid ? 'Zuerst den Server stoppen.' : ''}</span></div>
            <div className="sx-row-ctl"><button type="button" className="btn btn-sm btn-danger" disabled={!!inst.status.pid} onClick={del}>Löschen</button></div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function McInstance() {
  const { id, tab = 'console' } = useParams();
  const { user } = useOutletContext() || {};
  const navigate = useNavigate();
  const [inst, setInst] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [livePlayers, setLivePlayers] = useState(null);
  const [panel, setPanel] = useState(null);
  const [mon, reloadMon] = useMonitor({ id });

  // Klick auf einen Online-Spieler: Profil direkt hier an der Seite öffnen
  async function openPlayer(name) {
    const known = (livePlayers || []).find((p) => p.name === name && p.uuid);
    if (known) { setPanel(known.uuid); return; }
    try {
      const d = await api(`/api/mc/instances/${id}/players`);
      const hit = d.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (hit) setPanel(hit.uuid);
      else toast.err(`${name} ist Orbit noch nicht bekannt.`);
    } catch (e) { toast.err(e.message); }
  }

  const load = useCallback(() => {
    api(`/api/mc/instances/${id}`).then((d) => { setInst(d.instance); setErr(''); }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    setInst(null);
    setLivePlayers(null);
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  async function control(action) {
    setBusy(action);
    try {
      await api(`/api/mc/instances/${id}/control`, { method: 'POST', body: { action } });
      toast.ok({ start: 'Server startet', stop: 'Server gestoppt', restart: 'Server neu gestartet', kill: 'Prozess beendet' }[action]);
      load();
    } catch (e) { toast.err(e.message); }
    setBusy('');
  }

  if (err && !inst) return <Page><div className="err">{err}</div><Link to="/home" className="btn">Zur Übersicht</Link></Page>;
  if (!inst) return <Page><div className="mcx-loading">Lädt…</div></Page>;

  const tm = TYPE_META[inst.type] || {};
  const ph = phaseOf(inst);
  const st = inst.status;
  const addr = inst.address || `${window.location.hostname}:${inst.port}`;

  return (
    <Page className="mcx-page mci-page">
      {tab === 'console' && (
        <div className="dash mci-dash">
          {/* ── Kopf: gleich aufgebaut wie bei FiveM ── */}
          <section className={`dash-hero card tone-${ph.tone}`}>
            <span className="dash-hero-game" aria-hidden="true"><GameMark game="minecraft" color={tm.color} size={120} /></span>
            <div className="dash-hero-main">
              <p className="dash-greet">{greeting()}, <b>{user?.username}</b></p>
              <h1 className="dash-title">{inst.name}</h1>
              <p className="dash-host">
                {tm.label} · Minecraft {inst.mcVersion}
                {inst.loaderVersion ? ` · ${inst.type === 'paper' || inst.type === 'purpur' ? `Build ${inst.loaderVersion}` : `${tm.label} ${inst.loaderVersion}`}` : ''}
              </p>
              <div className="dash-facts">
                <span className="dash-status"><i />{ph.label}</span>
                {st.startedAt ? <span className="dash-fact"><NavIcon name="clock" />Uptime <b>{fmtDur(Date.now() - st.startedAt)}</b></span> : null}
                <button type="button" className="dash-addr" title="Adresse kopieren" onClick={() => navigator.clipboard?.writeText(addr).then(() => toast.ok('Adresse kopiert', { text: addr }))}>
                  <NavIcon name="globe" /><span className="mono">{addr}</span><NavIcon name="copy" />
                </button>
                {!inst.domain && <Link to={`/host/web?add=game&server=minecraft:${inst.id}`} className="dash-cfx-add"><NavIcon name="plus" />Domain verbinden</Link>}
              </div>
            </div>
            <div className="dash-hero-ctl mci-hero-ctl">
              {inst.state !== 'ready' ? null : st.pid ? (
                <>
                  <button type="button" className="btn" disabled={!!busy} onClick={() => control('restart')}><NavIcon name="restart" />Neustart</button>
                  <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => control('stop')}><NavIcon name="stop" />{busy === 'stop' ? 'Stoppt…' : 'Stoppen'}</button>
                  {st.phase === 'stopping' || busy === 'stop' ? <button type="button" className="btn btn-ghost" onClick={() => control('kill')}>Erzwingen</button> : null}
                </>
              ) : (
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => control('start')}><NavIcon name="play" />{busy === 'start' ? 'Startet…' : 'Starten'}</button>
              )}
            </div>
          </section>
          <McRestartCard key={inst.id} inst={inst} onSaved={setInst} />

          {mon?.crash ? <CrashCard inst={inst} crash={mon.crash} onDismiss={reloadMon} /> : null}
          <ModUpdateBanner inst={inst} />
          {inst.state === 'failed' && <div className="err mci-span">Die Installation ist fehlgeschlagen. Lösche die Instanz unter „Instanz“ und lege sie neu an.</div>}

          <div className="dash-kpis">
            <Kpi icon="users" label="Spieler" value={st.pid ? (livePlayers ? livePlayers.length : st.players ?? 0) : '–'} unit={`/ ${st.maxPlayers ?? '–'}`} sub={st.version ? `Version ${st.version}` : null} pct={st.pid && st.maxPlayers ? ((livePlayers ? livePlayers.length : st.players || 0) / st.maxPlayers) * 100 : null} to={`/mc/${inst.id}/players`} />
            <Kpi icon="cpu" label="CPU" value={st.pid ? st.cpu : '–'} unit={st.pid ? '%' : ''} sub={st.pid ? `PID ${st.pid}` : null} pct={st.pid ? Math.min(100, st.cpu / 4) : null} to="/" />
            <Kpi icon="memory" label="RAM" value={st.pid ? fmtMb(st.rssMb) : '–'} sub={`Heap-Limit ${fmtMb(inst.ramMb)}`} pct={st.pid ? Math.min(100, (st.rssMb / (inst.ramMb * 1.35)) * 100) : null} to={`/mc/${inst.id}/instance`} />
            {(() => {
              const l = lagTile(mon?.lag, !!st.online);
              return <Kpi icon="activity" label="Lag" value={l.value} unit={l.unit} sub={l.sub} pct={l.pct} tone={l.tone} to={`/mc/${inst.id}`} />;
            })()}
          </div>

          <Console inst={inst} onPlayers={setLivePlayers} />
          <section className="dash-players card">
            {(() => {
              const list = st.pid ? (livePlayers || (st.sample || []).map((n) => ({ name: n }))) : [];
              return (<>
                <header className="dash-card-head">
                  <div className="dash-card-title"><h2>Gerade online</h2><span className="dash-count">{list.length}</span></div>
                  <Link to={`/mc/${inst.id}/players`} className="btn btn-sm btn-ghost">Alle<NavIcon name="arrowRight" /></Link>
                </header>
                {!st.pid ? (
                  <div className="dash-empty"><NavIcon name="power" /><b>Server ist offline</b><span>Starte ihn, um Spieler zu sehen.</span></div>
                ) : list.length === 0 ? (
                  <div className="dash-empty"><NavIcon name="users" /><span>{st.online ? 'Niemand online.' : 'Server startet…'}</span></div>
                ) : (
                  <ul className="dash-plist">
                    {list.map((p) => (
                      <li key={p.name}>
                        <button type="button" onClick={() => openPlayer(p.name)} title={`${p.name} öffnen`}>
                          <span className="dash-pavatar">{p.name.slice(0, 1).toUpperCase()}</span>
                          <span className="dash-pname">{p.name}</span>
                          {p.since ? <span className="dash-pid">{fmtDur(Date.now() - p.since)}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>);
            })()}
          </section>

          <McWidgets inst={inst} onPlayer={setPanel} />
          <HistoryCard history={mon?.history} />
          <PlayerHistoryCard inst={inst} onPlayer={setPanel} />
        </div>
      )}
      {tab !== 'console' && inst.state === 'failed' && <div className="err">Die Installation ist fehlgeschlagen. Lösche die Instanz unter „Instanz“ und lege sie neu an.</div>}
      {tab === 'console' && panel && <McPlayerPanel inst={inst} uuid={panel} online={(livePlayers || []).filter((p) => p.uuid)} onClose={() => setPanel(null)} />}
      {tab === 'players' && <McPlayers inst={inst} />}
      {tab === 'mods' && inst.modKind && <McMods inst={inst} noun={inst.modKind} onRestart={() => control('restart')} />}
      {(tab === 'settings' || tab === 'properties') && <McSettings inst={inst} />}
      {tab === 'files' && <McFiles inst={inst} />}
      {tab === 'backups' && <McBackups inst={inst} />}
      {tab === 'instance' && <InstanceSettings inst={inst} onChange={setInst} />}
    </Page>
  );
}
