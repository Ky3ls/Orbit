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
  const [maxReached, setMaxReached] = useState(0);
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
  const [dbMode, setDbMode] = useState('create'); // create | reuse | skip
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [dbPassCopied, setDbPassCopied] = useState(false);
  const [mysqlConnection, setMysqlConnection] = useState('');
  const [mysqlRootPassword, setMysqlRootPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [result, setResult] = useState(null);
  const [redirectTo, setRedirectTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbProgress, setDbProgress] = useState(0);
  const [dbProgressLabel, setDbProgressLabel] = useState('');
  const [dbLogs, setDbLogs] = useState([]);
  const [preparedDsn, setPreparedDsn] = useState('');
  const [dbPreparing, setDbPreparing] = useState(false);

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

  // Datenordner immer prüfen, sobald ein Pfad gesetzt ist (unabhängig von Deploy/Domain)
  useEffect(() => {
    if (step !== 5) return undefined;
    const d = dataPath.trim();
    if (!d) {
      setPathStatus(null);
      return undefined;
    }
    const t = setTimeout(() => {
      api('/api/setup/validate-path', { method: 'POST', body: { dataPath: d } })
        .then(setPathStatus)
        .catch(() => setPathStatus({ ok: false, issues: ['Pfad konnte nicht geprüft werden.'] }));
    }, 400);
    return () => clearTimeout(t);
  }, [step, dataPath]);

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

  const probePort = useCallback((p, free = false) => {
    const n = Number(p);
    if (!n) return;
    api('/api/setup/check-port', {
      method: 'POST',
      body: {
        port: n,
        dataPath: dataPath.trim() || undefined,
        freePort: free === true,
      },
    })
      .then(setPortStatus)
      .catch(() => setPortStatus(null));
  }, [dataPath]);

  useEffect(() => {
    if (step !== 5) return undefined;
    const t = setTimeout(() => probePort(port), 400);
    return () => clearTimeout(t);
  }, [port, step, probePort]);

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

  function generateDbPassword() {
    // Nur URL-sichere Zeichen — oxmysql parsed sonst +/% falsch
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += chars[bytes[i] % chars.length];
    setDbPassword(out);
    setShowDbPassword(true);
    setDbPassCopied(false);
  }

  async function copyDbPassword() {
    if (!dbPassword) return;
    try {
      await navigator.clipboard.writeText(dbPassword);
      setDbPassCopied(true);
      window.setTimeout(() => setDbPassCopied(false), 2000);
    } catch {
      setErr('Kopieren fehlgeschlagen — Passwort manuell markieren.');
    }
  }

  useEffect(() => {
    if (dbMode === 'create' && !dbPassword) generateDbPassword();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode]);

  useEffect(() => {
    setDbReady(false);
    setPreparedDsn('');
    setDbProgress(0);
    setDbLogs([]);
  }, [dbMode, recipe, mysqlConnection]);

  async function prepareDatabase() {
    setErr('');
    setDbPreparing(true);
    setDbReady(false);
    setDbProgress(0);
    setDbProgressLabel('Starte…');
    setDbLogs([]);
    const recipeId = deploy === 'popular' ? recipe : (deploy === 'custom' ? 'blank' : recipe);
    try {
      const res = await fetch('/api/setup/database-prepare', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-TX2-Client': '1',
        },
        body: JSON.stringify({
          mode: dbMode,
          recipe: recipeId,
          serverName: name.trim(),
          dbName: dbMode === 'create' ? (dbName.trim() || undefined) : undefined,
          dbUser: dbMode === 'create' ? (dbUser.trim() || undefined) : undefined,
          dbPassword: dbMode === 'create' ? (dbPassword.trim() || undefined) : undefined,
          mysqlRootPassword: dbMode === 'create' && mysqlRootPassword.trim()
            ? mysqlRootPassword.trim()
            : undefined,
          mysqlConnection: dbMode === 'reuse' ? mysqlConnection.trim() : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Datenbank-Setup fehlgeschlagen.');
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let donePayload = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.type === 'progress') {
            setDbProgress(Number(msg.pct) || 0);
            if (msg.label) setDbProgressLabel(msg.label);
          } else if (msg.type === 'log') {
            setDbLogs((prev) => [...prev.slice(-80), String(msg.text || '')]);
          } else if (msg.type === 'error') {
            throw new Error(msg.error || 'Fehler beim DB-Setup.');
          } else if (msg.type === 'done') {
            donePayload = msg;
          }
        }
      }
      if (!donePayload?.ok) throw new Error('Datenbank-Setup unvollständig.');
      setDbProgress(100);
      setDbProgressLabel(donePayload.skipped ? 'Übersprungen' : 'Datenbank bereit');
      setPreparedDsn(String(donePayload.dsn || ''));
      setDbReady(true);
      return true;
    } catch (e) {
      setErr(e.message);
      setDbReady(false);
      return false;
    } finally {
      setDbPreparing(false);
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
          // DB wurde im DB-Schritt schon angelegt + SQL importiert
          createDatabase: false,
          skipSqlImport: dbMode !== 'skip' && dbReady,
          mysqlConnection: dbMode === 'skip'
            ? undefined
            : (preparedDsn || (dbMode === 'reuse' ? mysqlConnection.trim() : undefined)),
          startServer: autoStart,
          serversRoot: !dataPath.trim() && serversRoot.trim() ? serversRoot.trim() : undefined,
          dataPath: dataPath.trim() || undefined,
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
      setMaxReached((m) => Math.max(m, 8));

      const url = String(data.panelUrl || '').replace(/\/$/, '');
      if (panelMode === 'domain' && url && /^https?:\/\//i.test(url)) {
        const dest = `${url}/panel`;
        setRedirectTo(dest);
        window.setTimeout(() => {
          window.location.replace(dest);
        }, 400);
      } else {
        onDone();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    if (step === 6) {
      if (dbMode === 'skip') {
        setDbReady(true);
      } else if (!dbReady) {
        const ok = await prepareDatabase();
        if (!ok) return;
      }
    }
    if (step === 3 && deploy !== 'popular') {
      setStep(5);
      setMaxReached((m) => Math.max(m, 5));
      return;
    }
    setStep((s) => {
      const n = Math.min(STEPS.length - 1, s + 1);
      setMaxReached((m) => Math.max(m, n));
      return n;
    });
  }

  function goBack() {
    if (step === 5 && deploy !== 'popular') {
      setStep(3);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  }

  function jumpToStep(to) {
    if (to < 0 || to > maxReached) return;
    // Skip template-Schritt wenn nicht popular
    if (to === 4 && deploy !== 'popular') return;
    setStep(to);
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
      if (deploy === 'existing' && !dataPath.trim()) return false;
      if (dataPath.trim()) {
        if (!pathStatus || !pathStatus.ok) return false;
      }
      return true;
    }
    if (step === 6) {
      if (!preflight?.mysql?.running && dbMode !== 'skip') return false;
      if (dbMode === 'create') return dbPassword.trim().length >= 6;
      if (dbMode === 'reuse') return /^mysql:\/\//i.test(mysqlConnection.trim());
      return true;
    }
    if (step === 7) return licenseKey.trim().length > 8;
    return false;
  }, [
    step, name, deploy, recipe, recipeUrl, port, maxClients, portStatus, pathStatus,
    useCustomPath, serversRoot, dataPath, preflight, createDatabase, licenseKey,
    panelMode, panelPort, panelDomain, dbMode, mysqlConnection, dbPassword,
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
            maxReached={maxReached}
            onStepChange={jumpToStep}
            canNext={canNext}
            busy={busy || dbPreparing}
            showNav={step < 8}
            hideBack={step === 0 || dbPreparing}
            isLastAction={isLastAction}
            completeLabel="Server aufsetzen & starten"
            nextLabel={step === 6 && !dbReady && dbMode !== 'skip' ? 'Datenbank aufsetzen' : 'Weiter'}
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
                <h1>Netzwerk & Datenordner</h1>
                <p className="lede">Game-Port und Ordner für resources / server.cfg (unabhängig vom Panel-Domain).</p>
                <div className="row">
                  <label className="field grow"><span>Game-Port</span><input value={port} onChange={(e) => setPort(e.target.value)} /></label>
                  <label className="field grow"><span>Slots</span><input value={maxClients} onChange={(e) => setMaxClients(e.target.value)} /></label>
                </div>
                {portStatus && (
                  <p className={`setup-port-hint ${portStatus.available && !portStatus.orbitConflict ? 'ok' : 'bad'}`}>
                    {portStatus.inUse && 'Port ist belegt.'}
                    {!portStatus.inUse && portStatus.orbitConflict && `Aktiv belegt von „${portStatus.orbitConflict.name}“.`}
                    {portStatus.available && !portStatus.orbitConflict && 'Port ist frei.'}
                    {portStatus.inUse && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          style={{ width: 'auto', marginLeft: 8 }}
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await probePort(port, true);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          FX stoppen &amp; freigeben
                        </button>
                      </>
                    )}
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

                <div className="panel" style={{ padding: 12, marginTop: 12 }}>
                  <label className="row" style={{ marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={useCustomPath || deploy === 'existing'}
                      disabled={deploy === 'existing'}
                      onChange={(e) => {
                        setUseCustomPath(e.target.checked);
                        if (!e.target.checked) {
                          setDataPath('');
                          setPathStatus(null);
                        }
                      }}
                    />
                    Eigenen Datenordner festlegen
                  </label>
                  <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    Hier liegen <code className="mono">server.cfg</code>, <code className="mono">resources/</code> usw.
                    Standard ohne Haken: <code className="mono">{preflight?.defaultServersRoot || '/opt/orbit/servers'}/&lt;slug&gt;</code>
                  </p>
                  {(useCustomPath || deploy === 'existing' || dataPath) && (
                    <>
                      <label className="field">
                        <span>Datenordner</span>
                        <input
                          className="mono"
                          placeholder="/root/RoleplayServer oder /home/Roleplay"
                          value={dataPath}
                          onChange={(e) => setDataPath(e.target.value)}
                          autoFocus={deploy === 'existing'}
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
                    </>
                  )}
                </div>
              </>
            )}

            {step === 6 && (
              <>
                <div className="setup-step-num">7</div>
                <h1>Datenbank</h1>
                <p className="lede">
                  MySQL erkennen: läuft es schon, legt Orbit nur DB + User an.
                  Fehlt MySQL komplett, kann es hier installiert werden — bestehende Dienste werden nicht angefasst.
                </p>
                {preflight?.mysql?.running ? (
                  <p className="setup-port-hint ok" style={{ marginBottom: 12 }}>
                    MySQL/MariaDB läuft ({preflight.mysql.service || 'ok'}) — nur DB/User werden angelegt.
                  </p>
                ) : (
                  <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
                    <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                      Kein laufender MySQL/MariaDB-Dienst gefunden.
                    </p>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={installMysql}>
                      MySQL/MariaDB installieren oder starten
                    </button>
                  </div>
                )}
                <div className="deploy-list" style={{ marginBottom: 16 }}>
                  <button type="button" className={`deploy-card${dbMode === 'create' ? ' on' : ''}`} onClick={() => { setDbMode('create'); setCreateDatabase(true); }}>
                    <div className="deploy-card-top"><b>Neue Datenbank</b><span className="deploy-tag">STANDARD</span></div>
                    <span>Neue DB + User in der vorhandenen MySQL — deine anderen Datenbanken bleiben unberührt.</span>
                  </button>
                  <button type="button" className={`deploy-card${dbMode === 'reuse' ? ' on' : ''}`} onClick={() => { setDbMode('reuse'); setCreateDatabase(false); }}>
                    <div className="deploy-card-top"><b>Vorhandene Connection</b></div>
                    <span>Eigene mysql://…-URL verwenden (wird in die server.cfg geschrieben).</span>
                  </button>
                  <button type="button" className={`deploy-card${dbMode === 'skip' ? ' on' : ''}`} onClick={() => { setDbMode('skip'); setCreateDatabase(false); }}>
                    <div className="deploy-card-top"><b>Später</b></div>
                    <span>Keine DB jetzt — manuell in der server.cfg setzen.</span>
                  </button>
                </div>
                {dbMode === 'create' && (
                  <>
                    <label className="field"><span>Datenbankname</span>
                      <input
                        className="mono"
                        value={dbName}
                        onChange={(e) => setDbName(e.target.value)}
                        placeholder={`orbit_${name.toLowerCase().replace(/\W+/g, '_').slice(0, 24) || 'server'}`}
                      />
                    </label>
                    <label className="field"><span>DB-User (optional)</span>
                      <input className="mono" value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="orbit" />
                    </label>
                    <label className="field"><span>DB-Passwort</span>
                      <div className="db-pass-row">
                        <input
                          className="mono"
                          type={showDbPassword ? 'text' : 'password'}
                          value={dbPassword}
                          onChange={(e) => { setDbPassword(e.target.value); setDbPassCopied(false); }}
                          placeholder="mind. 6 Zeichen"
                          autoComplete="new-password"
                        />
                        <button type="button" className="btn btn-sm" onClick={() => setShowDbPassword((v) => !v)}>
                          {showDbPassword ? 'Verbergen' : 'Anzeigen'}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={copyDbPassword} disabled={!dbPassword}>
                          {dbPassCopied ? 'Kopiert' : 'Kopieren'}
                        </button>
                        <button type="button" className="btn btn-sm btn-primary" style={{ width: 'auto' }} onClick={generateDbPassword}>
                          Generieren
                        </button>
                      </div>
                    </label>
                    {dbPassword && showDbPassword && (
                      <p className="db-pass-preview mono">{dbPassword}</p>
                    )}
                    <label className="field">
                      <span>MySQL root-Passwort</span>
                      <input
                        type="password"
                        value={mysqlRootPassword}
                        onChange={(e) => setMysqlRootPassword(e.target.value)}
                        placeholder="Meist leer lassen"
                        autoComplete="new-password"
                      />
                      <span className="field-hint">
                        Leer lassen: Orbit legt DB/User per <code>sudo mysql</code> an (ohne root-Passwort).
                        Nur ausfüllen, wenn root ein TCP-Passwort braucht.
                      </span>
                    </label>
                  </>
                )}
                {dbMode === 'reuse' && (
                  <label className="field"><span>mysql_connection_string</span>
                    <input
                      className="mono"
                      value={mysqlConnection}
                      onChange={(e) => setMysqlConnection(e.target.value)}
                      placeholder="mysql://user:pass@127.0.0.1/dbname?charset=utf8mb4"
                    />
                  </label>
                )}

                {(dbPreparing || dbReady) && dbMode !== 'skip' && (
                  <div className={`db-setup-live${dbReady ? ' done' : ''}`} role="status" aria-live="polite">
                    <div className="db-setup-live-head">
                      <span className="db-setup-spinner" aria-hidden="true" />
                      <div>
                        <b>{dbReady ? 'Datenbank ist bereit' : 'Datenbank wird aufgesetzt…'}</b>
                        <span>{dbProgressLabel || 'Bitte warten'}</span>
                      </div>
                      <em className="mono">{Math.round(dbProgress)}%</em>
                    </div>
                    <div className="db-setup-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(4, dbProgress)}%` }} />
                    </div>
                    {dbLogs.length > 0 && (
                      <div className="db-setup-log mono">
                        {dbLogs.slice(-12).map((line, i) => (
                          <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!dbPreparing && !dbReady && dbMode !== 'skip' && (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                    Mit „Datenbank aufsetzen“ werden DB/User angelegt und die SQL-Dateien vom gewählten Template importiert.
                    Danach geht es weiter — der letzte Speichern-Schritt bleibt schnell.
                  </p>
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
                    <span>Datenbank</span>
                    <b>
                      {dbMode === 'skip'
                        ? 'später'
                        : dbReady
                          ? 'bereits aufgesetzt ✓'
                          : (dbMode === 'create' ? (dbName.trim() || 'auto neu') : 'vorhandene DSN')}
                    </b>
                  </div>
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
