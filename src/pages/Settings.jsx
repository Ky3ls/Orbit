import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import SettingsHostPanel from '../components/SettingsHostPanel.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import { useAppearance } from '../hooks/useAppearance.js';
import { ACCENT_PRESETS } from '../appearance.js';
import { GAME_BUILD_OPTIONS, ONESYNC_OPTIONS } from './settingsOptions.js';

const HOST_TABS = new Set(['servers', 'artifacts', 'prod']);

function SettingsGroup({ id, title, lead, children }) {
  return (
    <section className="st-group" id={id || undefined}>
      <header className="st-group-head">
        <h2>{title}</h2>
        {lead ? <p>{lead}</p> : null}
      </header>
      <div className="st-group-body">{children}</div>
    </section>
  );
}

export default function Settings({ user, onUser, onSetupReset }) {
  const [form, setForm] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState(null);
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState([]);
  const [params] = useSearchParams();
  const [msg, setMsg] = useState(params.get('cfx') === 'ok' ? 'Cfx.re ist verbunden.' : params.get('cfx') === 'taken' ? 'Dieses Cfx.re-Konto ist schon vergeben.' : '');
  const [err, setErr] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const hostTab = HOST_TABS.has(params.get('tab')) ? params.get('tab') : 'servers';
  const [prefs, setAppearance] = useAppearance();

  function load() {
    api('/api/settings').then((d) => setForm(d.settings)).catch((e) => setErr(e.message));
    api('/api/sessions').then((d) => setSessions(d.sessions)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('/api/settings', { method: 'PUT', body: form });
      setMsg('Gespeichert — OneSync / Game Build in server.cfg übernommen (Neustart ggf. nötig).');
    } catch (error) { setErr(error.message); }
  }

  async function password(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/auth/password', { method: 'POST', body: pw });
      setMsg('Passwort geändert. Andere Sitzungen sind ungültig.');
      onUser({ ...user, mustChange: false });
      setPw({ current: '', next: '' });
    } catch (error) { setErr(error.message); }
  }

  if (!form) {
    return <Page>{err ? <div className="err">{err}</div> : <p className="muted">Lade…</p>}</Page>;
  }

  const set = (patch) => setForm({ ...form, ...patch });

  return (
    <Page className="settings-page">
      <PageHeader
        eyebrow="System"
        title="Einstellungen"
        description="FiveM-Server und Orbit/Account getrennt. CFG-Werte werden beim Speichern in server.cfg geschrieben."
      />
      {err && <div className="err">{err}</div>}
      {msg && <div className="banner">{msg}</div>}

      <SettingsGroup
        title="Aussehen"
        lead="Pro Account gespeichert — auf jedem Gerät nach Login gleich."
      >
        <div className="appear-block">
          <span className="appear-label">Navigation</span>
          <div className="appear-seg" role="group" aria-label="Navigation">
            <button
              type="button"
              className={`appear-opt${prefs.navLayout === 'sidebar' ? ' active' : ''}`}
              onClick={() => setAppearance({ navLayout: 'sidebar' })}
            >
              <b>Sidebar</b>
              <small>Links, einklappbar</small>
            </button>
            <button
              type="button"
              className={`appear-opt${prefs.navLayout === 'dock' ? ' active' : ''}`}
              onClick={() => setAppearance({ navLayout: 'dock' })}
            >
              <b>Toolbar</b>
              <small>Unten, wie iPhone</small>
            </button>
          </div>
        </div>
        <div className="appear-block">
          <span className="appear-label">Farbschema</span>
          <div className="appear-seg" role="group" aria-label="Farbschema">
            <button
              type="button"
              className={`appear-opt${prefs.theme === 'dark' ? ' active' : ''}`}
              onClick={() => setAppearance({ theme: 'dark' })}
            >
              <b>Dunkel</b>
              <small>Standard</small>
            </button>
            <button
              type="button"
              className={`appear-opt${prefs.theme === 'light' ? ' active' : ''}`}
              onClick={() => setAppearance({ theme: 'light' })}
            >
              <b>Hell</b>
              <small>Tageslicht</small>
            </button>
          </div>
        </div>
        <div className="appear-block">
          <span className="appear-label">Akzentfarbe</span>
          <div className="appear-swatches" role="group" aria-label="Akzentfarbe">
            {Object.values(ACCENT_PRESETS).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`appear-swatch${prefs.accent === c.id ? ' active' : ''}`}
                style={{ ['--swatch']: c.hex }}
                title={c.label}
                aria-label={c.label}
                aria-pressed={prefs.accent === c.id}
                onClick={() => setAppearance({ accent: c.id })}
              >
                <i />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="appear-block">
          <span className="appear-label">Konsole — anzeigen</span>
          <div className="appear-toggles" role="group" aria-label="Konsolen-Filter">
            {[
              { key: 'showInfo', label: 'Infos', hint: 'Normale Log-Zeilen' },
              { key: 'showWarn', label: 'Warnings', hint: 'Warnungen' },
              { key: 'showBad', label: 'Errors', hint: 'Fehler / bad' },
              { key: 'showOk', label: 'OK', hint: 'Erfolgsmeldungen' },
            ].map((t) => (
              <label key={t.key} className={`appear-toggle${prefs.console?.[t.key] !== false ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={prefs.console?.[t.key] !== false}
                  onChange={(e) => setAppearance({ console: { [t.key]: e.target.checked } })}
                />
                <span>
                  <b>{t.label}</b>
                  <small>{t.hint}</small>
                </span>
              </label>
            ))}
            <label className={`appear-toggle${prefs.console?.hideAssetSpam !== false ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={prefs.console?.hideAssetSpam !== false}
                onChange={(e) => setAppearance({ console: { hideAssetSpam: e.target.checked } })}
              />
              <span>
                <b>Asset-Spam ausblenden</b>
                <small>Oversized YTD / MiB / Streaming-Warnungen</small>
              </span>
            </label>
          </div>
        </div>
      </SettingsGroup>

      <form className="st-layout" onSubmit={save}>
        <SettingsGroup
          title="Game Server (server.cfg)"
          lead="Anzeigename, Slots, OneSync und Game Build — landen in der aktiven server.cfg."
        >
          <div className="st-grid">
            <label className="field"><span>Anzeigename (sv_hostname)</span><input value={form.hostname} onChange={(e) => set({ hostname: e.target.value })} /></label>
            <label className="field"><span>Projekt (sv_projectName)</span><input value={form.project} onChange={(e) => set({ project: e.target.value })} /></label>
            <label className="field"><span>Slots (sv_maxclients)</span><input type="number" min={1} max={2048} value={form.maxClients} onChange={(e) => set({ maxClients: e.target.value })} /></label>
            <label className="field">
              <span>OneSync</span>
              <select value={form.onesync || 'on'} onChange={(e) => set({ onesync: e.target.value })}>
                {ONESYNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Game Build (sv_enforceGameBuild)</span>
              <select value={form.gameBuild || ''} onChange={(e) => set({ gameBuild: e.target.value })}>
                {GAME_BUILD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Locale</span><input value={form.locale || 'de-DE'} onChange={(e) => set({ locale: e.target.value })} /></label>
            <label className="field st-span-2"><span>Tags</span><input value={form.tags || ''} onChange={(e) => set({ tags: e.target.value })} placeholder="roleplay, german, …" /></label>
          </div>
          <div className="st-sub">
            <h3>Verbindung (Panel)</h3>
            <div className="st-grid">
              <label className="field"><span>Host</span><input value={form.fivemHost} onChange={(e) => set({ fivemHost: e.target.value })} readOnly /></label>
              <label className="field"><span>Port</span><input value={form.fivemPort} onChange={(e) => set({ fivemPort: e.target.value })} /></label>
            </div>
            <p className="muted">FiveM läuft lokal — Host bleibt 127.0.0.1.</p>
          </div>
          {user.role === 'owner' && (
            <label className="field st-span-2"><span>IP-Allowlist (Panel)</span><textarea placeholder="Leer = alle. Eine IP pro Zeile." value={form.ipAllowlist} onChange={(e) => set({ ipAllowlist: e.target.value })} /></label>
          )}
          <label className="row"><input type="checkbox" checked={!!form.allowlistEnabled} onChange={(e) => set({ allowlistEnabled: e.target.checked })} /> Allowlist-Modus (Spieler-Whitelist)</label>
          <div className="actions">
            <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">FiveM speichern</button>
            {user.role === 'owner' && (
              <button className="btn" type="button" onClick={() => api('/api/settings/rescan', { method: 'POST', body: {} }).then((d) => { load(); setMsg(`CFG gelesen · ${d.count} Ressourcen.`); }).catch((e) => setErr(e.message))}>
                Aus server.cfg laden
              </button>
            )}
          </div>
        </SettingsGroup>

        {user.role === 'owner' && (
          <SettingsGroup
            id="settings-host"
            title="Host & Instanzen"
            lead="FX-Builds, weitere Server und Prod — FX läuft über Orbit."
          >
            {form.orbitServerName ? (
              <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Aktiv: <b>{form.orbitServerName}</b> · <span className="mono">{form.fxDataPath}</span>
                {' · '}Basis: <span className="mono">{form.orbitServersRoot || '/opt/orbit/servers'}</span>
              </p>
            ) : null}
            <SettingsHostPanel
              initialTab={hostTab}
              onMessage={setMsg}
              onError={setErr}
            />
          </SettingsGroup>
        )}

        {user.role === 'owner' && (
          <SettingsGroup
            title="FX & Orbit"
            lead="Prozess-Steuerung, Pfade und Konsole — nicht in der server.cfg."
          >
            <label className="field">
              <span>Steuerungsmodus</span>
              <select value={form.fxControlMode || 'systemd'} onChange={(e) => set({ fxControlMode: e.target.value })}>
                <option value="systemd">systemd (bestehender Dienst)</option>
                <option value="orbit">Orbit startet FXServer selbst</option>
              </select>
            </label>
            {form.fxControlMode === 'orbit' && (
              <>
                <label className="field"><span>FXServer-Root</span><input value={form.fxServerRoot || ''} onChange={(e) => set({ fxServerRoot: e.target.value })} placeholder="/root/RoleplayServer" /></label>
                <label className="field"><span>Datenpfad (server.cfg)</span><input value={form.fxDataPath || ''} onChange={(e) => set({ fxDataPath: e.target.value })} /></label>
                <label className="field"><span>Zusatz-Argumente</span><input value={form.fxServerExtraArgs || ''} onChange={(e) => set({ fxServerExtraArgs: e.target.value })} placeholder="optional" /></label>
              </>
            )}
            <p className="muted">
              Konsole: {form.fxCommandReady ? <b style={{ color: 'var(--ok)' }}>bereit</b> : <b style={{ color: 'var(--bad)' }}>offline</b>}
              {' · '}
              MySQL: {form.mysqlReady ? <b style={{ color: 'var(--ok)' }}>CFG</b> : <b style={{ color: 'var(--bad)' }}>fehlt</b>}
            </p>
            <div className="st-grid">
              <label className="field"><span>RCON-Port</span><input value={form.rconPort || ''} onChange={(e) => set({ rconPort: e.target.value })} placeholder={form.fivemPort || '30120'} /></label>
              <label className="field"><span>RCON-Passwort (Panel)</span><input type="password" value={form.rconPassword || ''} onChange={(e) => set({ rconPassword: e.target.value })} placeholder={form.rconConfigured ? 'leer lassen' : 'eintragen'} autoComplete="new-password" /></label>
            </div>
            <label className="row">
              <input type="checkbox" checked={form.autoRestartEnabled !== false} onChange={(e) => set({ autoRestartEnabled: e.target.checked })} />
              Bei Crash immer neu starten (Backoff, unbegrenzt)
            </label>
            <div className="actions">
              <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">FX speichern</button>
              <button className="btn" type="button" onClick={() => api('/api/settings/rcon-test', { method: 'POST', body: {} }).then((d) => setMsg(d.message || 'RCON OK')).catch((e) => setErr(e.message))}>RCON testen</button>
            </div>
          </SettingsGroup>
        )}

        {user.role === 'owner' && (
          <SettingsGroup title="Discord" lead="Webhook für Start/Stop und optional Player-Drops (kein Bot nötig).">
            <label className="row"><input type="checkbox" checked={!!form.discordEnabled} onChange={(e) => set({ discordEnabled: e.target.checked })} /> Discord aktiv</label>
            <label className="row"><input type="checkbox" checked={form.discordNotifyDrops === '1' || form.discordNotifyDrops === true} onChange={(e) => set({ discordNotifyDrops: e.target.checked ? '1' : '0' })} /> Disconnects an Webhook</label>
            <label className="field"><span>Webhook-URL</span><input value={form.discordWebhook || ''} onChange={(e) => set({ discordWebhook: e.target.value })} /></label>
            <label className="field"><span>Guild-ID</span><input value={form.discordGuild || ''} onChange={(e) => set({ discordGuild: e.target.value })} /></label>
            <label className="row"><input type="checkbox" checked={!!form.discordBotEnabled} onChange={(e) => set({ discordBotEnabled: e.target.checked })} /> Discord-Bot (Slash-Commands)</label>
            <label className="field"><span>Bot-Token</span><input type="password" value={form.discordBotToken || ''} onChange={(e) => set({ discordBotToken: e.target.value })} placeholder={form.discordBotConfigured ? 'leer = behalten' : 'Bot-Token'} autoComplete="new-password" /></label>
            <div className="actions">
              <button className="btn btn-primary" style={{ width: 'auto' }} type="submit">Discord speichern</button>
              <button type="button" className="btn btn-sm" onClick={() => api('/api/platform/discord-test', { method: 'POST', body: {} }).then(() => setMsg('Discord-Test gesendet.')).catch((e) => setErr(e.message))}>Webhook testen</button>
            </div>
          </SettingsGroup>
        )}
      </form>

      {user.role === 'owner' && (
        <SettingsGroup
          title="Zurücksetzen & Deinstallieren"
          lead="Zwei getrennte Aktionen — nicht verwechseln."
        >
          <div className="st-sub">
            <h3>Alles löschen &amp; neu einrichten</h3>
            <p className="muted">Stoppt FX, löscht Server-Ordner, öffnet danach direkt den Setup-Wizard.</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              disabled={resetBusy}
              onClick={async () => {
                if (!window.confirm('FX stoppen und ALLE Server-Ordner löschen, dann Setup starten?')) return;
                if (!window.confirm('Wirklich alles löschen und neu einrichten?')) return;
                setResetBusy(true);
                setErr('');
                try {
                  const res = await api('/api/settings/reset-setup', {
                    method: 'POST',
                    body: { confirm: true, wipe: true },
                  });
                  setMsg(`Gelöscht: ${(res.deleted || []).length} Ordner — Setup startet…`);
                  onSetupReset?.({ redirect: '/setup', wipe: true });
                } catch (e) {
                  setErr(e.message || 'Löschen fehlgeschlagen');
                } finally {
                  setResetBusy(false);
                }
              }}
            >
              {resetBusy ? 'Lösche…' : 'Alles löschen & Setup starten'}
            </button>
          </div>
          <div className="st-sub" style={{ marginTop: 20 }}>
            <h3>Orbit komplett deinstallieren</h3>
            <p className="muted">
              Entfernt Panel, Dienst und Installation. <b>Kein Setup danach</b> — Orbit ist weg.
              Neu nur über das GitHub-Install-Skript.
            </p>
            <button
              type="button"
              className="btn btn-danger"
              style={{ width: 'auto' }}
              disabled={resetBusy}
              onClick={async () => {
                const phrase = window.prompt('Zum Bestätigen exakt eingeben: ORBIT LÖSCHEN');
                if (phrase == null) return;
                if (String(phrase).trim().toUpperCase() !== 'ORBIT LÖSCHEN') {
                  setErr('Abgebrochen — Phrase falsch.');
                  return;
                }
                if (!window.confirm('Orbit jetzt unwiderruflich deinstallieren? Das Panel geht offline.')) return;
                setResetBusy(true);
                setErr('');
                try {
                  const res = await api('/api/settings/uninstall', {
                    method: 'POST',
                    body: { confirmPhrase: 'ORBIT LÖSCHEN' },
                  });
                  setMsg(res.message || 'Deinstallation läuft…');
                  window.setTimeout(() => { window.location.href = 'about:blank'; }, 2500);
                } catch (e) {
                  setErr(e.message || 'Deinstallation fehlgeschlagen');
                  setResetBusy(false);
                }
              }}
            >
              {resetBusy ? '…' : 'Orbit komplett deinstallieren'}
            </button>
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup title="Account & Sicherheit" lead="Passwort, Cfx.re, 2FA und aktive Sitzungen.">
        <form onSubmit={password} className="st-sub">
          <h3>Passwort</h3>
          <div className="st-grid">
            <label className="field"><span>Aktuell</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
            <label className="field"><span>Neu</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
          </div>
          <button className="btn" type="submit">Passwort ändern</button>
        </form>

        <div className="st-sub">
          <h3>Cfx.re</h3>
          <p className="muted">Verknüpfung für Login — erstellt keine neuen Admins.</p>
          {user.cfxName ? (
            <div className="spread">
              <b>{user.cfxName}</b>
              <button className="btn btn-sm" type="button" onClick={() => api('/api/auth/cfx/unlink', { method: 'POST', body: {} }).then(() => { onUser({ ...user, cfxName: '' }); setMsg('Cfx.re getrennt.'); }).catch((e) => setErr(e.message))}>Trennen</button>
            </div>
          ) : (
            <a className="btn cfx" href="/api/auth/cfx/start?mode=link">Mit Cfx.re verbinden</a>
          )}
        </div>

        <div className="st-sub">
          <h3>Zwei-Faktor</h3>
          {!totp ? (
            <button className="btn" type="button" onClick={() => api('/api/auth/totp/setup', { method: 'POST', body: {} }).then(setTotp)}>Einrichten</button>
          ) : (
            <>
              <p className="mono">{totp.secret}</p>
              <div className="row">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                <button className="btn btn-primary" style={{ width: 'auto' }} type="button" onClick={() => api('/api/auth/totp/enable', { method: 'POST', body: { code } }).then(() => { setMsg('2FA aktiv.'); onUser({ ...user, totp: true }); }).catch((e) => setErr(e.message))}>Aktivieren</button>
              </div>
            </>
          )}
        </div>

        <div className="st-sub">
          <h3>Sitzungen</h3>
          {sessions.map((s) => (
            <div className="res-line" key={s.id}>
              <span>{s.ip} · {fmtFull(s.last_seen)} {s.current ? '· diese' : ''}</span>
              {!s.current && <button className="btn btn-sm" type="button" onClick={() => api(`/api/sessions/${s.id}`, { method: 'DELETE' }).then(load)}>Beenden</button>}
            </div>
          ))}
        </div>
      </SettingsGroup>
    </Page>
  );
}
