import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Page } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META, fmtDur, fmtMb, phaseOf } from './mcShared.js';
import McFiles from './McFiles.jsx';
import McMods from './McMods.jsx';
import McPlayers from './McPlayers.jsx';
import McSettings from './McSettings.jsx';
import './mc.css';

const TABS = [
  { id: 'console', label: 'Übersicht & Konsole', icon: 'term' },
  { id: 'players', label: 'Spieler', icon: 'users' },
  { id: 'mods', label: 'Mods', icon: 'box' },
  { id: 'settings', label: 'Einstellungen', icon: 'cfg' },
  { id: 'files', label: 'Dateien', icon: 'folder' },
  { id: 'instance', label: 'Instanz', icon: 'gear' },
];
const QUICK = ['list', 'save-all', 'time set day', 'weather clear', 'tps'];

/* ── Konsole ── */
function Console({ inst }) {
  const [lines, setLines] = useState([]);
  const [cmd, setCmd] = useState('');
  const [hist, setHist] = useState([]);
  const [hi, setHi] = useState(-1);
  const [follow, setFollow] = useState(true);
  const offset = useRef(null);
  const box = useRef(null);
  const running = !!inst.status.pid;

  useEffect(() => {
    let alive = true;
    offset.current = null;
    setLines([]);
    const tick = () => {
      const q = offset.current == null ? '' : `?offset=${offset.current}`;
      api(`/api/mc/instances/${inst.id}/console${q}`).then((d) => {
        if (!alive) return;
        offset.current = d.offset;
        if (d.reset) setLines(d.lines);
        else if (d.lines.length) setLines((prev) => [...prev, ...d.lines].slice(-1500));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
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

  return (
    <section className="mci-console card">
      <header>
        <span className={`lg-live${running ? '' : ' paused'}`}><i />{running ? 'Live' : 'Offline'}</span>
        <div className="mci-quick">
          {QUICK.map((q) => <button key={q} type="button" className="lc-chip" disabled={!running} onClick={() => send(q)}>{q}</button>)}
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
        {lines.length === 0 ? <div className="lc-empty">{running ? 'Warte auf Ausgabe…' : 'Server ist offline. Starte ihn, um die Konsole zu sehen.'}</div> : null}
        {lines.map((l, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className={`mci-line lvl-${l.level}`}>{l.t}</div>
        ))}
      </div>
      <form className="lc-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="mono"
          value={cmd}
          disabled={!running}
          placeholder={running ? 'Befehl eingeben (ohne /) — ↑ für Verlauf' : 'Server ist offline'}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); const n = Math.min(hi + 1, hist.length - 1); setHi(n); setCmd(hist[n]); }
            if (e.key === 'ArrowDown' && hi >= 0) { e.preventDefault(); const n = hi - 1; setHi(n); setCmd(n < 0 ? '' : hist[n]); }
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </form>
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
    try {
      await api(`/api/mc/instances/${inst.id}`, { method: 'DELETE', body: { deleteFiles: true } });
      toast.ok(`${inst.name} gelöscht`);
      navigate('/instances');
    } catch (e) { toast.err(e.message); }
  }

  const max = Math.max(ram?.max || 16384, ramMb);
  return (
    <div className="sx-stack">
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
  const navigate = useNavigate();
  const [inst, setInst] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api(`/api/mc/instances/${id}`).then((d) => { setInst(d.instance); setErr(''); }).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    setInst(null);
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

  if (err && !inst) return <Page><div className="err">{err}</div><Link to="/instances" className="btn">Zur Übersicht</Link></Page>;
  if (!inst) return <Page><div className="mcx-loading">Lädt…</div></Page>;

  const tm = TYPE_META[inst.type] || {};
  const ph = phaseOf(inst);
  const st = inst.status;
  const tabs = TABS.filter((t) => t.id !== 'mods' || inst.modKind).map((t) => (t.id === 'mods' ? { ...t, label: inst.modKind } : t));
  const addr = inst.address || `${window.location.hostname}:${inst.port}`;

  return (
    <Page className="mcx-page mci-page">
      <section className={`mci-hero card tone-${ph.tone}`}>
        <GameMark game="minecraft" color={tm.color} size={60} />
        <div className="mci-hero-main">
          <div className="mci-hero-top">
            <h1>{inst.name}</h1>
            <span className={`mcx-state tone-${ph.tone}`}><i />{ph.label}</span>
          </div>
          <div className="mci-hero-facts">
            <span className="tag" style={{ color: tm.color, borderColor: `${tm.color}66` }}>{tm.label}</span>
            <span>Minecraft {inst.mcVersion}</span>
            {inst.loaderVersion ? <span className="mono">{inst.type === 'paper' || inst.type === 'purpur' ? `Build ${inst.loaderVersion}` : `${TYPE_META[inst.type]?.label} ${inst.loaderVersion}`}</span> : null}
            <button type="button" className="mci-addr" title="Adresse kopieren" onClick={() => navigator.clipboard?.writeText(addr).then(() => toast.ok('Adresse kopiert', { text: addr }))}>
              <NavIcon name="globe" /><span className="mono">{addr}</span><NavIcon name="copy" />
            </button>
          </div>
        </div>
        <div className="mci-hero-ctl">
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

      {inst.state === 'failed' && <div className="err">Die Installation ist fehlgeschlagen. Lösche die Instanz unter „Instanz“ und lege sie neu an.</div>}

      <div className="mci-kpis">
        <div><span><NavIcon name="users" />Spieler</span><b>{st.online ? st.players : '–'}<small> / {st.maxPlayers ?? '–'}</small></b></div>
        <div><span><NavIcon name="cpu" />CPU</span><b>{st.pid ? `${st.cpu}%` : '–'}</b></div>
        <div>
          <span><NavIcon name="memory" />RAM</span>
          <b>{st.pid ? fmtMb(st.rssMb) : '–'}<small> · Heap-Limit {fmtMb(inst.ramMb)}</small></b>
          <i className="mci-meter"><em style={{ width: `${st.pid ? Math.min(100, (st.rssMb / (inst.ramMb * 1.35)) * 100) : 0}%` }} /></i>
        </div>
        <div><span><NavIcon name="clock" />Uptime</span><b>{st.startedAt ? fmtDur(Date.now() - st.startedAt) : '–'}</b></div>
      </div>

      <div className="pp-tabs mci-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => navigate(`/mc/${inst.id}${t.id === 'console' ? '' : `/${t.id}`}`)}>
            <NavIcon name={t.icon} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'console' && (
        <div className="mci-overview">
          <Console inst={inst} />
          <aside className="mci-players card">
            <header><h3>Spieler online</h3><span className="dash-count">{st.online ? st.players : 0}</span></header>
            {!st.online ? (
              <div className="dash-empty"><NavIcon name="power" /><span>{st.pid ? 'Server startet…' : 'Server ist offline.'}</span></div>
            ) : st.sample.length === 0 ? (
              <div className="dash-empty"><NavIcon name="users" /><span>{st.players ? `${st.players} Spieler online` : 'Niemand online.'}</span></div>
            ) : (
              <ul>
                {st.sample.map((n) => (
                  <li key={n}>
                    <img src={`https://mc-heads.net/avatar/${encodeURIComponent(n)}/28`} alt="" loading="lazy" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
            {st.version ? <footer><span>Version</span><b>{st.version}</b></footer> : null}
          </aside>
        </div>
      )}
      {tab === 'players' && <McPlayers inst={inst} />}
      {tab === 'mods' && inst.modKind && <McMods inst={inst} noun={inst.modKind} onRestart={() => control('restart')} />}
      {(tab === 'settings' || tab === 'properties') && <McSettings inst={inst} />}
      {tab === 'files' && <McFiles inst={inst} />}
      {tab === 'instance' && <InstanceSettings inst={inst} onChange={setInst} />}
    </Page>
  );
}
