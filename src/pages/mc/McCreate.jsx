import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import GameMark from '../../components/GameMark.jsx';
import { Page, PageHeader } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META, fmtMb } from './mcShared.js';
import './mc.css';

const STEPS = ['Spiel', 'Server-Typ', 'Version', 'Einstellungen', 'Arbeitsspeicher', 'Bestätigen'];
const TYPE_ORDER = ['paper', 'purpur', 'vanilla', 'fabric', 'neoforge', 'forge'];
const GROUPS = [
  { id: 'plugins', label: 'Plugin-Server', hint: 'Bukkit/Spigot/Paper-Plugins, Vanilla-Clients können joinen' },
  { id: 'mods', label: 'Mod-Server', hint: 'Mods auf Server und Client nötig' },
  { id: 'vanilla', label: 'Vanilla', hint: 'Unverändertes Minecraft' },
];

export default function McCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({
    game: '', type: 'paper', mcVersion: '', loaderVersion: '', name: '', port: '',
    maxPlayers: 20, gamemode: 'survival', difficulty: 'normal', onlineMode: true, seed: '',
    viewDistance: 10, plannedMods: 0, ramMb: 4096, autostart: true, startAfter: true, eula: false,
  });
  const [versions, setVersions] = useState(null);
  const [vq, setVq] = useState('');
  const [java, setJava] = useState(null);
  const [portCheck, setPortCheck] = useState(null);
  const [ram, setRam] = useState(null);
  const [err, setErr] = useState('');
  const [job, setJob] = useState(null);
  const [instId, setInstId] = useState(null);
  const jobAfter = useRef(0);
  const logRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const tm = TYPE_META[form.type] || {};
  const kind = types.find((x) => x.id === form.type)?.kind;

  useEffect(() => { api('/api/mc/types').then((d) => setTypes(d.types || [])).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { api('/api/mc/port-suggest').then((d) => set({ port: d.port })).catch(() => {}); }, []);

  /* Versionen je Typ */
  useEffect(() => {
    if (!form.type) return;
    setVersions(null);
    api(`/api/mc/versions?type=${form.type}`)
      .then((d) => {
        setVersions(d.versions || []);
        const first = d.versions?.[0];
        if (first) set({ mcVersion: first.mc, loaderVersion: first.loader || '' });
      })
      .catch((e) => { setVersions([]); setErr(e.message); });
  }, [form.type]);

  /* Java-Bedarf */
  useEffect(() => {
    if (!form.mcVersion) return;
    api(`/api/mc/java?mc=${encodeURIComponent(form.mcVersion)}`).then(setJava).catch(() => setJava(null));
  }, [form.mcVersion]);

  /* Port prüfen */
  useEffect(() => {
    if (!form.port) return undefined;
    const id = setTimeout(() => {
      api(`/api/mc/port-check?port=${form.port}`).then(setPortCheck).catch(() => setPortCheck(null));
    }, 300);
    return () => clearTimeout(id);
  }, [form.port]);

  /* RAM-Empfehlung */
  useEffect(() => {
    const q = new URLSearchParams({ type: form.type, mods: String(form.plannedMods || 0), players: String(form.maxPlayers), viewDistance: String(form.viewDistance) });
    api(`/api/mc/ram-suggest?${q}`).then((d) => {
      setRam(d);
      set({ ramMb: d.recommended });
    }).catch(() => {});
  }, [form.type, form.plannedMods, form.maxPlayers, form.viewDistance]);

  /* Name vorschlagen */
  useEffect(() => {
    if (!form.name || /^(Paper|Purpur|Vanilla|Fabric|Forge|NeoForge) /.test(form.name)) {
      if (form.mcVersion) set({ name: `${tm.label} ${form.mcVersion}` });
    }
  }, [form.type, form.mcVersion]);

  const selectedVersion = (versions || []).find((v) => v.mc === form.mcVersion);
  const filteredVersions = useMemo(
    () => (versions || []).filter((v) => !vq || v.mc.includes(vq.trim())),
    [versions, vq],
  );

  const canNext = [
    !!form.game,
    !!form.type,
    !!form.mcVersion,
    form.name.trim().length >= 2 && portCheck?.ok !== false && !!form.port,
    form.ramMb >= 1024,
    form.eula,
  ][step];

  async function create() {
    setErr('');
    try {
      const d = await api('/api/mc/instances', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          type: form.type,
          mcVersion: form.mcVersion,
          loaderVersion: form.loaderVersion || undefined,
          port: Number(form.port),
          ramMb: form.ramMb,
          eula: form.eula,
          autostart: form.autostart,
          startAfter: form.startAfter,
          properties: {
            'max-players': form.maxPlayers,
            gamemode: form.gamemode,
            difficulty: form.difficulty,
            'online-mode': form.onlineMode ? 'true' : 'false',
            'level-seed': form.seed,
            'view-distance': form.viewDistance,
          },
        },
      });
      setInstId(d.instance.id);
      setJob({ id: d.jobId, log: [], progress: 0, step: 'Startet…', done: false });
    } catch (e) {
      setErr(e.message);
    }
  }

  /* Job-Fortschritt pollen */
  useEffect(() => {
    if (!job?.id || job.done) return undefined;
    const id = setInterval(() => {
      api(`/api/mc/jobs/${job.id}?after=${jobAfter.current}`).then((d) => {
        if (d.log?.length) jobAfter.current = d.log[d.log.length - 1].t;
        setJob((j) => ({ ...d, log: [...(j?.log || []), ...(d.log || [])].slice(-300) }));
      }).catch(() => {});
    }, 800);
    return () => clearInterval(id);
  }, [job?.id, job?.done]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job?.log?.length]);

  if (job) {
    return (
      <Page className="mcx-page">
        <PageHeader eyebrow="Neue Instanz" title={form.name} description={`${tm.label} ${form.mcVersion} wird eingerichtet.`} />
        <section className="mcx-install card">
          <div className="mcx-install-head">
            <GameMark game="minecraft" color={tm.color} size={48} />
            <div>
              <b>{job.done ? (job.error ? 'Installation fehlgeschlagen' : 'Fertig eingerichtet') : job.step}</b>
              <span>{job.done ? (job.error || (form.startAfter ? 'Der Server startet jetzt.' : 'Bereit zum Starten.')) : 'Das kann je nach Typ ein paar Minuten dauern.'}</span>
            </div>
            <span className="mcx-install-pct">{job.progress || 0}%</span>
          </div>
          <div className={`mcx-progress${job.error ? ' bad' : job.done ? ' ok' : ''}`}><i style={{ width: `${job.progress || 0}%` }} /></div>
          <div className="mcx-install-log" ref={logRef}>
            {job.log.map((l, i) => (
              <div key={`${l.t}-${i}`} className={`lvl-${l.level}`}>
                {l.level === 'step' ? <NavIcon name="chevron" /> : null}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
          {job.done && (
            <div className="mcx-install-foot">
              {job.error
                ? <button type="button" className="btn" onClick={() => { setJob(null); setStep(5); }}>Zurück</button>
                : <button type="button" className="btn btn-primary" onClick={() => navigate(`/mc/${instId}`)}>Zur Instanz<NavIcon name="arrowRight" /></button>}
            </div>
          )}
        </section>
      </Page>
    );
  }

  return (
    <Page className="mcx-page">
      <PageHeader eyebrow="Multi-Game" title="Neue Instanz" description="Server einrichten — Orbit lädt alles automatisch, inklusive passender Java-Version." />

      <ol className="mcx-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step} onClick={() => setStep(i)}>
              <span>{i < step ? <NavIcon name="check" /> : i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      {err && <div className="err">{err}</div>}

      <section className="mcx-panel card">
        {step === 0 && (
          <div className="mcx-games">
            <button type="button" className={`mcx-game${form.game === 'minecraft' ? ' active' : ''}`} onClick={() => set({ game: 'minecraft' })}>
              <GameMark game="minecraft" size={56} />
              <b>Minecraft</b>
              <span>Java Edition — Vanilla, Plugins oder Mods</span>
            </button>
            <Link className="mcx-game" to="/settings?section=host&tab=servers">
              <GameMark game="fivem" size={56} />
              <b>FiveM</b>
              <span>Weitere FXServer-Instanz unter Einstellungen → Instanzen & Builds</span>
            </Link>
          </div>
        )}

        {step === 1 && (
          <div className="mcx-typegroups">
            {GROUPS.map((g) => (
              <div key={g.id} className="mcx-typegroup">
                <div className="mcx-typegroup-head"><b>{g.label}</b><span>{g.hint}</span></div>
                <div className="mcx-types">
                  {TYPE_ORDER.filter((id) => types.find((x) => x.id === id)?.kind === g.id).map((id) => {
                    const t = types.find((x) => x.id === id);
                    const meta = TYPE_META[id];
                    return (
                      <button key={id} type="button" className={`mcx-type${form.type === id ? ' active' : ''}`} style={{ '--tc': meta.color }} onClick={() => set({ type: id, mcVersion: '' })}>
                        <span className="mcx-type-badge">{meta.short}</span>
                        <b>{t.label}{id === 'paper' ? <em>Empfohlen</em> : null}</b>
                        <span>{t.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="mcx-version">
            <div className="mcx-version-list">
              <div className="mcx-search">
                <NavIcon name="search" />
                <input placeholder="Version suchen, z. B. 1.21" value={vq} onChange={(e) => setVq(e.target.value)} />
              </div>
              {versions === null ? (
                <div className="mcx-loading">Versionen werden geladen…</div>
              ) : (
                <div className="mcx-vgrid">
                  {filteredVersions.slice(0, 80).map((v, i) => (
                    <button
                      key={v.mc}
                      type="button"
                      className={`mcx-v${form.mcVersion === v.mc ? ' active' : ''}`}
                      onClick={() => set({ mcVersion: v.mc, loaderVersion: v.loader || '' })}
                    >
                      {v.mc}
                      {i === 0 && !vq ? <em>Neueste</em> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <aside className="mcx-version-side">
              <div className="mcx-kv"><span>Typ</span><b>{tm.label}</b></div>
              <div className="mcx-kv"><span>Minecraft</span><b>{form.mcVersion || '–'}</b></div>
              {selectedVersion?.loaders?.length ? (
                <label className="field">
                  <span>{form.type === 'fabric' ? 'Fabric-Loader' : form.type === 'forge' ? 'Forge-Version' : 'NeoForge-Version'}</span>
                  <select value={form.loaderVersion} onChange={(e) => set({ loaderVersion: e.target.value })}>
                    {selectedVersion.loaders.map((l, i) => <option key={l} value={l}>{l}{i === 0 ? ' (empfohlen)' : ''}</option>)}
                  </select>
                </label>
              ) : null}
              {java?.required ? (
                <div className={`mcx-java${java.installed.some((j) => j.major >= java.required) ? ' ok' : ''}`}>
                  <NavIcon name="cpu" />
                  <div>
                    <b>Java {java.required}</b>
                    <span>{java.installed.some((j) => j.major === java.required)
                      ? 'Bereits installiert'
                      : java.installed.some((j) => j.major > java.required && java.required > 8)
                        ? `Java ${java.installed.find((j) => j.major > java.required).major} wird verwendet`
                        : 'Wird automatisch geladen (Eclipse Temurin)'}</span>
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        )}

        {step === 3 && (
          <div className="mcx-form">
            <label className="field mcx-span2">
              <span>Name der Instanz</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
            </label>
            <label className="field">
              <span>Port</span>
              <input type="number" min={1024} max={65535} value={form.port} onChange={(e) => set({ port: e.target.value })} />
              <small className={`mcx-hint${portCheck?.ok === false ? ' bad' : ' ok'}`}>{portCheck?.ok === false ? portCheck.reason : 'Port ist frei'}</small>
            </label>
            <label className="field">
              <span>Spieler-Slots</span>
              <input type="number" min={1} max={500} value={form.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) || 1 })} />
            </label>
            <div className="field">
              <span>Spielmodus</span>
              <div className="seg">
                {[['survival', 'Überleben'], ['creative', 'Kreativ'], ['adventure', 'Abenteuer']].map(([v, l]) => (
                  <button key={v} type="button" className={form.gamemode === v ? 'active' : ''} onClick={() => set({ gamemode: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Schwierigkeit</span>
              <div className="seg">
                {[['peaceful', 'Friedlich'], ['easy', 'Leicht'], ['normal', 'Normal'], ['hard', 'Schwer']].map(([v, l]) => (
                  <button key={v} type="button" className={form.difficulty === v ? 'active' : ''} onClick={() => set({ difficulty: v })}>{l}</button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Sichtweite (Chunks)</span>
              <input type="range" min={4} max={24} value={form.viewDistance} onChange={(e) => set({ viewDistance: Number(e.target.value) })} />
              <small className="mcx-hint">{form.viewDistance} Chunks{form.viewDistance > 12 ? ' — braucht mehr RAM und CPU' : ''}</small>
            </label>
            <label className="field">
              <span>Seed (optional)</span>
              <input value={form.seed} onChange={(e) => set({ seed: e.target.value })} placeholder="zufällig" />
            </label>
            <div className="mcx-toggles mcx-span2">
              <label><input type="checkbox" checked={form.onlineMode} onChange={(e) => set({ onlineMode: e.target.checked })} /><span><b>Online-Modus</b><small>Nur Spieler mit gekauftem Minecraft (empfohlen)</small></span></label>
              <label><input type="checkbox" checked={form.autostart} onChange={(e) => set({ autostart: e.target.checked })} /><span><b>Autostart</b><small>Startet automatisch mit Orbit</small></span></label>
            </div>
          </div>
        )}

        {step === 4 && ram && (
          <div className="mcx-ram">
            <div className="mcx-ram-main">
              <div className="mcx-ram-value">
                <span>Zugewiesener Arbeitsspeicher</span>
                <b>{fmtMb(form.ramMb)}</b>
                {form.ramMb === ram.recommended
                  ? <em className="ok"><NavIcon name="sparkle" />Empfehlung</em>
                  : <button type="button" className="mcx-reset" onClick={() => set({ ramMb: ram.recommended })}>Empfehlung übernehmen ({fmtMb(ram.recommended)})</button>}
              </div>
              <input
                type="range"
                className="mcx-ram-slider"
                min={1024}
                max={Math.max(ram.max, ram.recommended)}
                step={512}
                value={form.ramMb}
                onChange={(e) => set({ ramMb: Number(e.target.value) })}
                style={{ '--pct': `${((form.ramMb - 1024) / (Math.max(ram.max, ram.recommended) - 1024)) * 100}%`, '--rec': `${((ram.recommended - 1024) / (Math.max(ram.max, ram.recommended) - 1024)) * 100}%` }}
              />
              <div className="mcx-ram-scale"><span>1 GB</span><span>{fmtMb(Math.max(ram.max, ram.recommended))}</span></div>
              {kind === 'mods' || kind === 'plugins' ? (
                <label className="field mcx-plan">
                  <span>Geplante Anzahl {kind === 'mods' ? 'Mods' : 'Plugins'}</span>
                  <input type="number" min={0} max={500} value={form.plannedMods} onChange={(e) => set({ plannedMods: Number(e.target.value) || 0 })} />
                  <small className="mcx-hint">Große Modpacks (100+ Mods) brauchen deutlich mehr Speicher — die Empfehlung passt sich an.</small>
                </label>
              ) : null}
              {form.ramMb < ram.recommended - 1024 && <div className="banner warn">Weniger als empfohlen — der Server kann laggen oder abstürzen.</div>}
              {form.ramMb > ram.budget && <div className="err">Mehr als aktuell frei ist ({fmtMb(ram.budget)}). Andere Server könnten ausgebremst werden.</div>}
            </div>
            <aside className="mcx-ram-why">
              <b>So setzt sich die Empfehlung zusammen</b>
              <ul>{ram.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <div className="mcx-kv"><span>Host gesamt</span><b>{fmtMb(ram.host.totalMb)}</b></div>
              <div className="mcx-kv"><span>Aktuell frei</span><b>{fmtMb(ram.host.availableMb)}</b></div>
              <p>Orbit startet den Server mit optimierten G1GC-Flags (Aikar) — Xms und Xmx gleich groß, damit Java keinen Speicher nachfordern muss.</p>
            </aside>
          </div>
        )}

        {step === 5 && (
          <div className="mcx-summary">
            <div className="mcx-sum-card">
              <GameMark game="minecraft" color={tm.color} size={52} />
              <div>
                <b>{form.name}</b>
                <span>{tm.label} {form.mcVersion}{form.loaderVersion ? ` · ${form.loaderVersion}` : ''}</span>
              </div>
            </div>
            <dl className="mcx-sum-grid">
              <div><dt>Port</dt><dd>{form.port}</dd></div>
              <div><dt>Slots</dt><dd>{form.maxPlayers}</dd></div>
              <div><dt>RAM</dt><dd>{fmtMb(form.ramMb)}</dd></div>
              <div><dt>Java</dt><dd>{java?.required ?? '–'}</dd></div>
              <div><dt>Spielmodus</dt><dd>{form.gamemode}</dd></div>
              <div><dt>Schwierigkeit</dt><dd>{form.difficulty}</dd></div>
            </dl>
            <label className="mcx-eula">
              <input type="checkbox" checked={form.eula} onChange={(e) => set({ eula: e.target.checked })} />
              <span>Ich akzeptiere die <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft-EULA</a> (Pflicht für jeden Minecraft-Server).</span>
            </label>
            <label className="mcx-eula">
              <input type="checkbox" checked={form.startAfter} onChange={(e) => set({ startAfter: e.target.checked })} />
              <span>Server nach der Installation direkt starten</span>
            </label>
          </div>
        )}
      </section>

      <div className="mcx-nav">
        {step > 0 ? <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}><NavIcon name="collapse" />Zurück</button> : <Link className="btn btn-ghost" to="/instances">Abbrechen</Link>}
        <span className="grow" />
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" disabled={!canNext || (step === 0 && form.game !== 'minecraft')} onClick={() => setStep((s) => s + 1)}>Weiter<NavIcon name="arrowRight" /></button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!canNext} onClick={create}><NavIcon name="sparkle" />Instanz erstellen</button>
        )}
      </div>
    </Page>
  );
}
