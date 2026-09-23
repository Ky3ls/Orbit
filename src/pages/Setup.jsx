import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Stepper from '../components/Stepper.jsx';
import { Badge, Mark } from '../components/Ui.jsx';
import './setup-wizard.css';

const DEPLOYS = [
  {
    id: 'popular',
    title: 'Beliebte Recipes',
    tag: 'EMPFOHLEN',
    text: 'Vorlage aus der Liste: ESX, QBCore oder Minimal — wie bei txAdmin.',
  },
  {
    id: 'existing',
    title: 'Vorhandene Server-Daten',
    text: 'Bereits server.cfg + resources auf dem Host — Orbit übernimmt den Ordner.',
  },
  {
    id: 'remote',
    title: 'Remote-URL Template',
    text: 'YAML-Recipe von einer HTTPS-URL laden und ausführen.',
  },
  {
    id: 'custom',
    title: 'Custom Template',
    text: 'Leeres Profil — Ressourcen und CFG selbst pflegen.',
  },
];

const TEMPLATES = [
  { id: 'blank', title: 'CFX Default FiveM', tags: ['FIVEM'], text: 'Nur Basis-Ressourcen für einen FiveM-Server.' },
  { id: 'esx', title: 'ESX Legacy', tags: ['ROLEPLAY', 'FIVEM'], text: 'Jobs, Housing, Fahrzeuge — populäres RP-Framework.' },
  { id: 'qb', title: 'QBCore Framework', tags: ['ROLEPLAY', 'FIVEM'], text: 'Fortgeschrittenes RP-Framework.' },
  { id: 'redm', title: 'CFX Default RedM', tags: ['REDM'], text: 'Basis-Ressourcen für RedM.' },
  { id: 'vorp', title: 'VORP Core', tags: ['ROLEPLAY', 'REDM'], text: 'Führendes RP-Framework für RedM.' },
];

const STEPS = [
  { id: 'welcome', label: 'Start' },
  { id: 'name', label: 'Name' },
  { id: 'panel', label: 'Panel' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'template', label: 'Template' },
  { id: 'network', label: 'Netzwerk' },
  { id: 'database', label: 'Datenbank' },
  { id: 'keys', label: 'Keys' },
  { id: 'done', label: 'Fertig' },
];

const DEFAULT_PANEL_PORT = 40220;

function CheckRow({ ok, warn, title, detail }) {
  const cls = ok ? 'ok' : warn ? 'warn' : 'bad';
  return (
    <div className={`setup-check ${cls}`}>
      <i className="dot" aria-hidden="true" />
      <div>
        <b>{title}</b>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export default function Setup({ onDone, userName = '' }) {
  const [step, setStep] = useState(0);
  const [preflight, setPreflight] = useState(null);
  const [name, setName] = useState('Mein Roleplay');
  const [deploy, setDeploy] = useState('popular');
  const [recipe, setRecipe] = useState('esx');
  const [recipeUrl, setRecipeUrl] = useState('');
  const [port, setPort] = useState(30120);
  const [maxClients, setMaxClients] = useState(48);
  const [onesync, setOnesync] = useState('on');
  const [locale, setLocale] = useState('de-DE');
  const [tags, setTags] = useState('roleplay, german');
  const [portStatus, setPortStatus] = useState(null);
  const [useCustomPath, setUseCustomPath] = useState(false);
  const [serversRoot, setServersRoot] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [pathStatus, setPathStatus] = useState(null);
  const [panelAccess, setPanelAccess] = useState(null);
  const [panelMode, setPanelMode] = useState('port');
  const [panelPort, setPanelPort] = useState(DEFAULT_PANEL_PORT);
  const [panelDomain, setPanelDomain] = useState('');
  const [panelPublicHost, setPanelPublicHost] = useState('');
  const [panelStack, setPanelStack] = useState('auto');
  const [panelPreview, setPanelPreview] = useState(null);
  const [createDatabase, setCreateDatabase] = useState(true);
  const [dbName, setDbName] = useState('');
  const [mysqlRootPassword, setMysqlRootPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [result, setResult] = useState(null);
  const [redirectTo, setRedirectTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const loadPreflight = useCallback(() => {
    api('/api/setup/preflight').then(setPreflight).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => { loadPreflight(); }, [loadPreflight]);
  useEffect(() => {
    api('/api/setup/panel-access').then(setPanelAccess).catch(() => {});
  }, []);

  useEffect(() => {
    if (deploy === 'existing' || deploy === 'custom') setUseCustomPath(true);
  }, [deploy]);

  const refreshPanelPreview = useCallback(() => {
    api('/api/setup/panel-access/preview', {
      method: 'POST',
      body: {
        mode: panelMode,
        panelPort: Number(panelPort),
        publicHost: panelPublicHost.trim() || undefined,
        domain: panelDomain.trim() || undefined,
        https: panelMode === 'domain',
      },
    })
      .then(setPanelPreview)
      .catch(() => setPanelPreview(null));
  }, [panelMode, panelPort, panelPublicHost, panelDomain]);

  useEffect(() => {
    if (step !== 2) return undefined;
    const t = setTimeout(refreshPanelPreview, 350);
    return () => clearTimeout(t);
  }, [step, refreshPanelPreview]);

  const probePort = useCallback((p) => {
    const n = Number(p);
    if (!n) return;
    api('/api/setup/check-port', { method: 'POST', body: { port: n } })
      .then(setPortStatus)
      .catch(() => setPortStatus(null));
  }, []);

  useEffect(() => {
    if (step !== 5) return undefined;
    const t = setTimeout(() => probePort(port), 400);
    return () => clearTimeout(t);
  }, [port, step, probePort]);

  const probePath = useCallback((root, exact) => {
    if (!useCustomPath) {
      setPathStatus(null);
      return;
    }
    const r = String(root || '').trim();
    const d = String(exact || '').trim();
    if (!r && !d) {
      setPathStatus(null);
      return;
    }
    api('/api/setup/validate-path', { method: 'POST', body: { serversRoot: r, dataPath: d } })
      .then(setPathStatus)
      .catch(() => setPathStatus({ ok: false, issues: ['Pfad konnte nicht geprüft werden.'] }));
  }, [useCustomPath]);

  useEffect(() => {
    if (step !== 5 || !useCustomPath) return undefined;
    const t = setTimeout(() => probePath(serversRoot, dataPath), 400);
    return () => clearTimeout(t);
  }, [step, useCustomPath, serversRoot, dataPath, probePath]);

  async function installMysql() {
    setBusy(true);
    setErr('');
    try {
      await api('/api/setup/mysql-install', { method: 'POST', body: {} });
      loadPreflight();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setErr('');
    try {
      const data = await api('/api/setup', {
        method: 'POST',
        body: {
          deploy,
          name: name.trim(),
          project: name.trim(),
          recipe: deploy === 'popular' ? recipe : (deploy === 'custom' ? 'blank' : recipe),
          recipeUrl: deploy === 'remote' ? recipeUrl.trim() : undefined,
          port: Number(port),
          maxClients: Number(maxClients),
          onesync,
          locale,
          tags,
          licenseKey: licenseKey.trim(),
          createDatabase: deploy === 'existing' ? false : createDatabase,
          dbName: dbName.trim() || undefined,
          mysqlRootPassword,
          startServer: autoStart,
          serversRoot: useCustomPath && !dataPath.trim() ? serversRoot.trim() : undefined,
          dataPath: useCustomPath && dataPath.trim() ? dataPath.trim() : undefined,
          panelAccess: {
            mode: panelMode,
            panelPort: Number(panelPort) || DEFAULT_PANEL_PORT,
            publicHost: panelMode === 'port' ? (panelPublicHost.trim() || panelAccess?.publicIp) : undefined,
            domain: panelMode === 'domain' ? panelDomain.trim() : undefined,
            stack: panelStack,
            https: panelMode === 'domain',
          },
        },
      });
      setResult(data);
      setStep(8);
      onDone();

      const url = String(data.panelUrl || '').replace(/\/$/, '');
      if (panelMode === 'domain' && url && /^https?:\/\//i.test(url)) {
        const dest = `${url}/panel`;
        setRedirectTo(dest);
        window.setTimeout(() => {
          window.location.assign(dest);
        }, 2800);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    if (step === 3 && deploy !== 'popular') {
      setStep(5);
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function goBack() {
    if (step === 5 && deploy !== 'popular') {
      setStep(3);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  }

  const canNext = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return name.trim().length >= 2;
    if (step === 2) {
      const pp = Number(panelPort);
      if (!Number.isFinite(pp) || pp < 1024 || pp > 65535) return false;
      if (panelMode === 'domain') return panelDomain.trim().includes('.');
      return true;
    }
    if (step === 3) return Boolean(deploy);
    if (step === 4) {
      if (deploy === 'remote') return /^https:\/\//i.test(recipeUrl.trim());
      return Boolean(recipe);
    }
    if (step === 5) {
      const p = Number(port);
      const m = Number(maxClients);
      if (!Number.isFinite(p) || p < 1) return false;
      if (!Number.isFinite(m) || m < 1) return false;
      if (portStatus?.inUse || portStatus?.orbitConflict) return false;
      if (deploy === 'existing' || useCustomPath) {
        const r = serversRoot.trim();
        const d = dataPath.trim();
        if (!r && !d) return false;
        if (!pathStatus || !pathStatus.ok) return false;
      }
      return true;
    }
    if (step === 6) {
      if (deploy === 'existing') return true;
      if (createDatabase) return Boolean(preflight?.mysql?.running);
      return true;
    }
    if (step === 7) return licenseKey.trim().length > 8;
    return false;
  }, [
    step, name, deploy, recipe, recipeUrl, port, maxClients, portStatus, pathStatus,
    useCustomPath, serversRoot, dataPath, preflight, createDatabase, licenseKey,
    panelMode, panelPort, panelDomain,
  ]);

  const isLastAction = step === 7;
  const greet = userName || 'Admin';

  return (
    <div className="wizard setup-wizard">
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="wizard-shell setup-shell">
        <header className="setup-head">
          <div className="brand-link"><Mark /> Orbit</div>
          <p className="eyebrow">Server-Einrichtung</p>
        </header>

        <section className="wizard-body setup-body">
          {err && <div className="err">{err}</div>}

          <Stepper
            steps={STEPS}
            step={step}
            onStepChange={setStep}
            canNext={canNext}
            busy={busy}
            showNav={step < 8}
            hideBack={step === 0}
            isLastAction={isLastAction}
            completeLabel="Server aufsetzen & starten"
            onComplete={finish}
            onBack={goBack}
            onNext={goNext}
          >
            {step === 0 && (
              <>
                <div className="setup-step-num">1</div>
                <h1>Willkommen, {greet}!</h1>
                <p className="lede">
                  Profil <code className="mono">default</code> ist noch nicht konfiguriert.
                  Richten wir den Server jetzt ein.
                </p>
                <div className="setup-checks">
                  <CheckRow
                    ok={preflight?.paths?.issues?.length === 0}
                    warn={preflight?.paths?.issues?.length > 0}
                    title="Orbit-Pfade"
                    detail={(preflight?.paths?.ok || []).join(' · ') || 'Lade…'}
                  />
                  <CheckRow
                    ok={preflight?.artifact}
                    warn={!preflight?.artifact}
                    title="FXServer"
                    detail={preflight?.artifact ? 'Artifact vorhanden' : 'Wird beim Abschluss geladen'}
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="setup-step-num">2</div>
                <h1>Servername</h1>
                <p className="lede">Name, der in der Serverliste und im Panel erscheint.</p>
                <label className="field">
                  <span>Name</span>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Mein Roleplay" />
                </label>
              </>
            )}

            {step === 2 && (
              <>
                <div className="setup-step-num">3</div>
                <h1>Panel-Zugang</h1>
                <p className="lede">
                  Panel per <code className="mono">IP:{DEFAULT_PANEL_PORT}</code> oder eigene Domain mit HTTPS.
                </p>
                <div className="deploy-list" style={{ marginBottom: 16 }}>
                  <button type="button" className={`deploy-card${panelMode === 'port' ? ' on' : ''}`} onClick={() => setPanelMode('port')}>
                    <div className="deploy-card-top"><b>IP & Port</b></div>
                    <span>Direkt erreichbar — z. B. {panelAccess?.directPortUrl || `http://…:${DEFAULT_PANEL_PORT}`}</span>
                  </button>
                  <button type="button" className={`deploy-card${panelMode === 'domain' ? ' on' : ''}`} onClick={() => setPanelMode('domain')}>
                    <div className="deploy-card-top"><b>Domain / HTTPS</b></div>
                    <span>Eigene Domain — Reverse-Proxy wird eingerichtet. Nach dem Setup wirst du dorthin weitergeleitet.</span>
                  </button>
                </div>
                <label className="field">
                  <span>Panel-Port (intern / bei IP-Zugang)</span>
                  <input className="mono" type="number" min={1024} max={65535} value={panelPort} onChange={(e) => setPanelPort(e.target.value)} />
                </label>
                {panelMode === 'port' && (
                  <label className="field">
                    <span>Öffentliche IP (optional)</span>
                    <input className="mono" placeholder={panelAccess?.publicIp || 'automatisch'} value={panelPublicHost} onChange={(e) => setPanelPublicHost(e.target.value)} />
                  </label>
                )}
                {panelMode === 'domain' && (
                  <>
                    <label className="field">
                      <span>Domain fürs Panel</span>
                      <input className="mono" autoFocus placeholder="panel.deine-domain.de" value={panelDomain} onChange={(e) => setPanelDomain(e.target.value)} />
                    </label>
                    <label className="field">
                      <span>Webserver (Reverse-Proxy)</span>
                      <select value={panelStack} onChange={(e) => setPanelStack(e.target.value)}>
                        <option value="auto">Automatisch ({panelAccess?.suggestedStack || 'nginx'})</option>
                        {(panelAccess?.stacks || []).map((s) => (
                          <option key={s.id} value={s.id} disabled={!s.installed}>
                            {s.label}{s.active ? ' · aktiv' : s.installed ? ' · installiert' : ' · fehlt'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted" style={{ fontSize: 13 }}>
                      DNS muss auf diesen Server zeigen. Beim Abschluss: VHost + Dienst-URL.
                      {panelAccess?.stacks?.every((s) => !s.installed) ? ' Kein Webserver erkannt — nginx empfohlen oder IP:Port wählen.' : ''}
                    </p>
                  </>
                )}
                {panelPreview?.previewUrl && (
                  <p className="setup-port-hint ok" style={{ marginTop: 12 }}>
                    Vorschau: <span className="mono">{panelPreview.previewUrl}</span>
                  </p>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <div className="setup-step-num">4</div>
                <h1>Deployment Type</h1>
                <p className="lede">Wie soll der Server aufgesetzt werden?</p>
                <div className="deploy-list">
                  {DEPLOYS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`deploy-card${deploy === d.id ? ' on' : ''}`}
                      onClick={() => setDeploy(d.id)}
                    >
                      <div className="deploy-card-top">
                        <b>{d.title}</b>
                        {d.tag && <span className="deploy-tag">{d.tag}</span>}
                      </div>
                      <span>{d.text}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div className="setup-step-num">5</div>
                <h1>{deploy === 'remote' ? 'Recipe-URL' : 'Template wählen'}</h1>
                {deploy === 'remote' ? (
                  <label className="field">
                    <span>HTTPS Recipe-URL (YAML)</span>
                    <input className="mono" value={recipeUrl} onChange={(e) => setRecipeUrl(e.target.value)} placeholder="https://…/recipe.yaml" />
                  </label>
                ) : (
                  <div className="deploy-list">
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`deploy-card${recipe === t.id ? ' on' : ''}`}
                        onClick={() => setRecipe(t.id)}
                      >
                        <div className="deploy-card-top">
                          <b>{t.title}</b>
                          <span className="deploy-tags">
                            {t.tags.map((tag) => (
                              <i key={tag} className={`tag-pill ${tag === 'REDM' ? 'redm' : tag === 'FIVEM' ? 'fivem' : ''}`}>{tag}</i>
                            ))}
                          </span>
                        </div>
                        <span>{t.text}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {step === 5 && (
              <>
                <div className="setup-step-num">6</div>
                <h1>Netzwerk</h1>
                <p className="lede">Game-Port und optional eigener Datenordner.</p>
                <div className="row">
                  <label className="field grow"><span>Game-Port</span><input value={port} onChange={(e) => setPort(e.target.value)} /></label>
                  <label className="field grow"><span>Slots</span><input value={maxClients} onChange={(e) => setMaxClients(e.target.value)} /></label>
                </div>
                {portStatus && (
                  <p className={`setup-port-hint ${portStatus.available && !portStatus.orbitConflict ? 'ok' : 'bad'}`}>
                    {portStatus.inUse && 'Port ist belegt.'}
                    {!portStatus.inUse && portStatus.orbitConflict && `Reserviert für „${portStatus.orbitConflict.name}“.`}
                    {portStatus.available && !portStatus.orbitConflict && 'Port ist frei.'}
                  </p>
                )}
                <label className="field"><span>OneSync</span>
                  <select value={onesync} onChange={(e) => setOnesync(e.target.value)}>
                    <option value="on">Infinity</option>
                    <option value="legacy">Legacy</option>
                    <option value="off">Aus</option>
                  </select>
                </label>
                <label className="field"><span>Locale</span><input value={locale} onChange={(e) => setLocale(e.target.value)} /></label>
                <label className="field"><span>Tags</span><input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
                {(deploy === 'existing' || deploy === 'custom' || useCustomPath) && (
                  <div className="panel" style={{ padding: 12, marginTop: 8 }}>
                    <label className="field">
                      <span>{deploy === 'existing' ? 'Pfad zu server.cfg / resources' : 'Datenordner'}</span>
                      <input
                        className="mono"
                        placeholder="/opt/orbit/servers/mein-server"
                        value={dataPath}
                        onChange={(e) => setDataPath(e.target.value)}
                      />
                    </label>
                    {pathStatus && (
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        {(pathStatus.issues || []).map((i) => (
                          <p key={i} className="setup-port-hint bad">{i}</p>
                        ))}
                        {(pathStatus.warnings || []).map((w) => (
                          <p key={w} className="setup-port-hint ok">{w}</p>
                        ))}
                        {pathStatus.ok && !(pathStatus.warnings || []).length && (
                          <p className="setup-port-hint ok">Pfad ist nutzbar.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {step === 6 && (
              <>
                <div className="setup-step-num">7</div>
                <h1>Datenbank</h1>
                {deploy === 'existing' ? (
                  <p className="lede">Vorhandener Server — DB belassen wir unverändert.</p>
                ) : (
                  <>
                    <p className="lede">MariaDB für ESX/QB — Orbit kann die DB anlegen.</p>
                    {!preflight?.mysql?.running && (
                      <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={installMysql}>
                          MariaDB installieren
                        </button>
                      </div>
                    )}
                    <label className="row">
                      <input type="checkbox" checked={createDatabase} onChange={(e) => setCreateDatabase(e.target.checked)} />
                      Datenbank automatisch anlegen
                    </label>
                    {createDatabase && (
                      <>
                        <label className="field"><span>Datenbankname</span>
                          <input className="mono" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="orbit_rp" />
                        </label>
                        <label className="field"><span>MySQL root-Passwort (optional)</span>
                          <input type="password" value={mysqlRootPassword} onChange={(e) => setMysqlRootPassword(e.target.value)} autoComplete="new-password" />
                        </label>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {step === 7 && (
              <>
                <div className="setup-step-num">8</div>
                <h1>Keys & Start</h1>
                <label className="field"><span>sv_licenseKey</span>
                  <input type="password" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="cfxk_…" autoComplete="off" />
                </label>
                <label className="row">
                  <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                  FXServer nach Einrichtung starten
                </label>
                <article className="panel setup-summary" style={{ marginTop: 16, padding: 12 }}>
                  <div className="res-line"><span>Server</span><b>{name}</b></div>
                  <div className="res-line"><span>Deploy</span><b>{deploy}</b></div>
                  <div className="res-line"><span>Template</span><b>{deploy === 'popular' ? recipe : '—'}</b></div>
                  <div className="res-line"><span>Game-Port</span><b>{port}</b></div>
                  <div className="res-line">
                    <span>Panel</span>
                    <b className="mono" style={{ fontSize: 12 }}>{panelPreview?.previewUrl || (panelMode === 'port' ? `:${panelPort}` : panelDomain)}</b>
                  </div>
                </article>
              </>
            )}

            {step === 8 && result && (
              <>
                <h1>Fertig</h1>
                <p className="lede">
                  {result.serverStarted ? 'Server wurde aufgesetzt und gestartet.' : 'Server wurde aufgesetzt.'}
                </p>
                {result.serverStarted && <Badge tone="ok">FX läuft</Badge>}
                {result.panelUrl && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    Panel: <a className="mono" href={result.panelUrl}>{result.panelUrl}</a>
                    {result.panelRestart ? ' · Dienst wird neu gestartet…' : ''}
                  </p>
                )}
                {redirectTo ? (
                  <p className="setup-port-hint ok" style={{ marginTop: 16 }}>
                    Weiterleitung zu <span className="mono">{redirectTo}</span> …
                  </p>
                ) : (
                  <div className="row" style={{ gap: 8, marginTop: 20 }}>
                    <a className="btn btn-primary" style={{ width: 'auto', display: 'inline-flex' }} href={result.panelUrl ? `${String(result.panelUrl).replace(/\/$/, '')}/panel` : '/panel'}>
                      Zum Cockpit
                    </a>
                  </div>
                )}
              </>
            )}
          </Stepper>
        </section>
      </div>
    </div>
  );
}
