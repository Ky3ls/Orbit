import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtFull } from '../format.js';
import SettingsHostPanel from '../components/SettingsHostPanel.jsx';
import { Page, PageHeader } from '../components/Ui.jsx';
import { toast } from '../components/toast.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './settings-v2.css';
import OrbitSelect from '../components/OrbitSelect.jsx';
import AllowlistPanel from '../components/allowlist/AllowlistPanel.jsx';
import {
  ALLOWLIST_MODE_KEYS,
  ALLOWLIST_MODE_VALUES,
} from '../components/allowlist/allowlistUtils.js';
import { useAppearance } from '../hooks/useAppearance.js';
import { ACCENT_PRESETS } from '../appearance.js';
import { useI18n } from '../i18n/I18nProvider.jsx';
import { LANGUAGE_OPTIONS } from '../i18n/catalog.js';
import { toBcp47, toSettingsValue } from '../i18n/core.js';
import { GAME_BUILD_OPTIONS, ONESYNC_OPTIONS } from './settingsOptions.js';
import { BAN_DURATION_PRESETS, banDurationLabel, customDurationToId } from './banPresets.js';

const HOST_TABS = new Set(['servers', 'artifacts', 'prod']);
const PERSONAL_SECTIONS = new Set(['appearance', 'account']);

/** Navigation in vier klaren Gruppen — jedes Feld existiert genau einmal. */
const SECTION_GROUPS = [
  { id: 'me', label: 'Persönlich' },
  { id: 'fivem', label: 'FiveM' },
  { id: 'system', label: 'Panel' },
];

const SECTION_DEFS = [
  { id: 'account', group: 'me', icon: 'audit', label: 'Konto & Sicherheit', hint: 'Passwort, 2FA, Cfx.re und aktive Sitzungen' },
  { id: 'appearance', group: 'me', icon: 'palette', label: 'Darstellung', hint: 'Farbschema, Akzentfarbe, Sidebar und Konsole' },
  { id: 'general', group: 'fivem', icon: 'globe', label: 'Server-Profil', hint: 'Name, Sprache und Eintrag in der Serverliste' },
  { id: 'fxserver', group: 'fivem', icon: 'cpu', label: 'Start & Netzwerk', hint: 'Prozess, Netzwerk, Pfade und RCON', owner: true },
  { id: 'host', group: 'fivem', icon: 'box', label: 'FXServer & Builds', hint: 'Weitere FiveM-Server und Artifacts', owner: true },
  { id: 'moderation', group: 'fivem', icon: 'ban', label: 'Zugang & Bans', hint: 'Allowlist, Ban-Prüfung und Ban-Vorlagen', admin: true },
  { id: 'game', group: 'fivem', icon: 'gamepad', label: 'Ingame-Menü', hint: '/orbit-Menü und Benachrichtigungen im Spiel', admin: true },
  { id: 'discord', group: 'fivem', icon: 'megaphone', label: 'Discord', hint: 'Webhook-Meldungen und Status-Bot', owner: true },
  { id: 'system', group: 'system', icon: 'db', label: 'Backup & Wartung', hint: 'Panel-Datenbank sichern und bereinigen', owner: true },
  { id: 'danger', group: 'system', icon: 'bolt', label: 'Gefahrenzone', hint: 'Zurücksetzen und Deinstallieren', owner: true },
];

/** Felder je Bereich — keine Überschneidungen mehr (vorher Port/Hostname doppelt). */
const SECTION_FIELDS = {
  general: ['serverName', 'language', 'locale', 'hostname', 'project', 'maxClients', 'tags'],
  fxserver: [
    'fxControlMode', 'fivemHost', 'fivemPort', 'gameBuild', 'onesync', 'resourceStartingTolerance',
    'fxDataPath', 'fxCfgPath', 'fxServerExtraArgs', 'fxServerRoot',
    'quietMode', 'fxAutostart', 'autoRestartEnabled', 'rconPort', 'rconPassword',
  ],
  moderation: [
    'allowlistMode', 'allowlistEnabled', 'allowlistInstructions', 'allowlistDiscordRoles', 'ipAllowlist',
    'banChecking', 'banRejectionMessage', 'requiredHwidMatches',
  ],
  discord: [
    'discordEnabled', 'discordNotifyDrops', 'discordWebhook', 'discordGuild',
    'discordWarningsChannel', 'discordStatusEmbedJson', 'discordStatusConfigJson',
    'discordBotEnabled', 'discordBotToken',
  ],
  game: [
    'gameMenuEnabled', 'gameMenuAlignRight', 'gameMenuPageKey', 'gameNotifyPos',
    'hideAdminInPunishments', 'hideAdminInMessages', 'hideAnnouncementNotif',
    'hideDmNotif', 'hideWarnNotif', 'hideRestartWarnNotif',
  ],
};

function pickSectionPayload(form, section) {
  const keys = SECTION_FIELDS[section];
  if (!keys) return { ...form };
  const out = {};
  for (const k of keys) {
    if (form[k] !== undefined) out[k] = form[k];
  }
  return out;
}

function Card({ title, lead, children, actions, tone }) {
  return (
    <section className={`sx-card${tone ? ` tone-${tone}` : ''}`}>
      {(title || lead || actions) && (
        <header className="sx-card-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {lead ? <p>{lead}</p> : null}
          </div>
          {actions ? <div className="sx-card-actions">{actions}</div> : null}
        </header>
      )}
      <div className="sx-card-body">{children}</div>
    </section>
  );
}

/** Einstellungs-Zeile: Beschriftung links, Steuerelement rechts */
function Row({ label, hint, children, stack }) {
  return (
    <div className={`sx-row${stack ? ' stack' : ''}`}>
      <div className="sx-row-text">
        <b>{label}</b>
        {hint ? <span>{hint}</span> : null}
      </div>
      <div className="sx-row-ctl">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

function Seg({ value, options, onChange, ariaLabel }) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Settings({ user, onUser, onSetupReset }) {
  const { t, setLanguage, syncFromSettings } = useI18n();
  const [form, setForm] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState(null);
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState([]);
  const [params, setParams] = useSearchParams();
  const [err, setErrState] = useState('');
  const setMsg = useCallback((m) => { if (m) toast.ok(m); }, []);
  const setErr = useCallback((m) => { setErrState(m || ''); if (m) toast.err(m); }, []);
  const [saved, setSaved] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplTitle, setTplTitle] = useState('');
  const [tplReason, setTplReason] = useState('');
  const [tplDuration, setTplDuration] = useState('2d');
  const [tplDays, setTplDays] = useState('');
  const [tplHhmm, setTplHhmm] = useState('');
  const [tplBusy, setTplBusy] = useState(false);
  const [cleanOpts, setCleanOpts] = useState(null);
  const [cleanForm, setCleanForm] = useState({ players: '60d', bans: 'revoked', warns: '30d', hwids: 'none' });
  const [sysBusy, setSysBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const hostTab = HOST_TABS.has(params.get('tab')) ? params.get('tab') : 'servers';
  const [prefs, setAppearance] = useAppearance();

  useEffect(() => {
    const cfx = params.get('cfx');
    if (cfx === 'ok') setMsg(t('settings.cfxOk'));
    else if (cfx === 'taken') setMsg(t('settings.cfxTaken'));
  }, [params, t]);

  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const perms = user?.permissions || [];
  const canViewSettings = isOwner
    || perms.includes('*')
    || perms.includes('all_permissions')
    || perms.includes('settings')
    || perms.includes('settings.write');
  const nav = useMemo(
    () => SECTION_DEFS.filter((s) => {
      if (PERSONAL_SECTIONS.has(s.id)) return true;
      if (!canViewSettings) return false;
      if (s.owner && !isOwner) return false;
      if (s.admin && !isAdmin) return false;
      return true;
    }),
    [isOwner, isAdmin, canViewSettings],
  );

  const sectionParam = params.get('section');
  const legacyMap = { server: 'general', bans: 'moderation', allowlist: 'moderation', fx: 'fxserver' };
  const mapped = legacyMap[sectionParam] || sectionParam;
  const fallbackSection = 'account';
  const section = nav.some((s) => s.id === mapped)
    ? mapped
    : (canViewSettings && HOST_TABS.has(params.get('tab')) ? 'host' : fallbackSection);

  function setSection(id) {
    const next = new URLSearchParams(params);
    next.set('section', id);
    if (id !== 'host') next.delete('tab');
    setParams(next, { replace: true });
  }

  function load() {
    if (!canViewSettings) {
      setForm({});
      setSaved({});
      return;
    }
    api('/api/settings').then((d) => {
      setForm(d.settings);
      setSaved(d.settings);
      if (d.settings) syncFromSettings(d.settings);
    }).catch((e) => setErr(e.message));
    api('/api/sessions').then((d) => setSessions(d.sessions)).catch(() => {});
  }

  function loadTemplates() {
    api('/api/ban-templates')
      .then((d) => setTemplates(d.templates || []))
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { load(); }, [canViewSettings]);
  useEffect(() => {
    if (PERSONAL_SECTIONS.has(section) || !canViewSettings) {
      api('/api/sessions').then((d) => setSessions(d.sessions || [])).catch(() => {});
    }
  }, [section, canViewSettings]);
  useEffect(() => {
    if (section === 'moderation' && isAdmin) loadTemplates();
  }, [section, isAdmin]);
  useEffect(() => {
    if (section === 'system' && isOwner) {
      api('/api/system/options').then((d) => {
        setCleanOpts(d.clean);
        if (d.clean?.players?.[4]) setCleanForm((f) => ({ ...f, players: d.clean.players[4].value }));
      }).catch(() => {});
    }
  }, [section, isOwner]);

  async function addTemplate(e) {
    e.preventDefault();
    let durationId = tplDuration;
    if (tplDuration === 'custom') {
      const mapped = customDurationToId(tplDays, tplHhmm);
      if (!mapped.ok) {
        setErr(t(mapped.error === 'hhmm' ? 'players.errBanHhmm' : 'players.errBanDuration'));
        return;
      }
      durationId = mapped.id;
    }
    setTplBusy(true);
    setErr('');
    try {
      await api('/api/ban-templates', {
        method: 'POST',
        body: { title: tplTitle, reason: tplReason, durationId },
      });
      setTplTitle('');
      setTplReason('');
      setTplDuration('2d');
      setTplDays('');
      setTplHhmm('');
      setMsg(t('settings.tplSaved'));
      loadTemplates();
    } catch (error) {
      setErr(error.message);
    }
    setTplBusy(false);
  }

  async function removeTemplate(id) {
    setTplBusy(true);
    setErr('');
    try {
      await api(`/api/ban-templates/${id}`, { method: 'DELETE' });
      loadTemplates();
    } catch (error) {
      setErr(error.message);
    }
    setTplBusy(false);
  }

  const canSaveSection = Boolean(SECTION_FIELDS[section]);

  const saveSettings = useCallback(async () => {
    if (!form || !SECTION_FIELDS[section] || saveBusy) return;
    setErr('');
    setMsg('');
    setSaveBusy(true);
    try {
      const base = pickSectionPayload(form, section);
      const payload = section === 'general'
        ? {
          ...base,
          language: form.language || form.locale,
          locale: toBcp47(form.language || form.locale || 'de'),
        }
        : base;
      await api('/api/settings', { method: 'PUT', body: payload });
      if (payload.language) setLanguage(payload.language);
      setMsg(t('common.saved'));
      load();
    } catch (error) {
      setErr(error.message);
    } finally {
      setSaveBusy(false);
    }
  }, [form, section, saveBusy, setLanguage, t]);

  function save(e) {
    e?.preventDefault?.();
    saveSettings();
  }

  useEffect(() => {
    if (!canSaveSection) return undefined;
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      saveSettings();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSaveSection, saveSettings]);

  async function password(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/auth/password', { method: 'POST', body: pw });
      setMsg(t('settings.pwChanged'));
      onUser({ ...user, mustChange: false });
      setPw({ current: '', next: '' });
    } catch (error) {
      setErr(error.message);
    }
  }

  if (!form) {
    return <Page>{err ? <div className="err">{err}</div> : <p className="muted">{t('common.loading')}</p>}</Page>;
  }

  const set = (patch) => setForm({ ...form, ...patch });
  const activeMeta = nav.find((s) => s.id === section);
  const modes = (form.allowlistModes?.length
    ? form.allowlistModes.map((m) => ({ ...m, label: t(ALLOWLIST_MODE_KEYS[m.value] || m.label) }))
    : ALLOWLIST_MODE_VALUES.map((value) => ({ value, label: t(ALLOWLIST_MODE_KEYS[value]) })));

  const dirtyKeys = canSaveSection && saved
    ? SECTION_FIELDS[section].filter((k) => JSON.stringify(form[k] ?? '') !== JSON.stringify(saved[k] ?? ''))
    : [];
  const dirty = dirtyKeys.length > 0;

  function discard() {
    const back = { ...form };
    for (const k of SECTION_FIELDS[section] || []) back[k] = saved?.[k];
    setForm(back);
  }

  const saveBar = canSaveSection && dirty && (
    <div className="sx-savebar" role="status">
      <span className="sx-savebar-dot" />
      <span className="sx-savebar-text">
        {`${dirtyKeys.length} ungespeicherte Änderung${dirtyKeys.length === 1 ? '' : 'en'}`}
      </span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={discard} disabled={saveBusy}>Verwerfen</button>
      <button type="submit" className="btn btn-sm btn-primary" disabled={saveBusy}>
        {saveBusy ? 'Speichert…' : t('common.save')}
        <kbd>Ctrl S</kbd>
      </button>
    </div>
  );

  const navEl = (
    <nav className="sx-nav" aria-label={t('settings.navAria')}>
      {SECTION_GROUPS.map((g) => {
        const items = nav.filter((s) => s.group === g.id);
        if (!items.length) return null;
        return (
          <div key={g.id} className="sx-nav-group">
            <span className="sx-nav-label">{g.label}</span>
            {items.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sx-nav-item${section === s.id ? ' active' : ''}${s.id === 'danger' ? ' danger' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <NavIcon name={s.icon} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );

  const confirmAction = async (question, fn) => {
    if (!window.confirm(question)) return;
    setSysBusy(true);
    try { await fn(); } catch (e) { setErr(e.message); }
    setSysBusy(false);
  };

  return (
    <Page className="settings-page sx-page">
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description="Dein Konto, die Darstellung, FiveM-spezifische Optionen und das Panel selbst."
      />

      <div className="sx-shell">
        {navEl}
        <div className="sx-main">
          <header className="sx-head">
            <span className="sx-head-ico"><NavIcon name={activeMeta?.icon || 'gear'} /></span>
            <div>
              <h2>{activeMeta?.label}</h2>
              <p>{activeMeta?.hint}</p>
            </div>
          </header>

          {/* ── Konto & Sicherheit ── */}
          {section === 'account' && (
            <div className="sx-stack">
              <Card title="Anmeldung" lead="Wie du dich bei Orbit anmeldest.">
                <Row label="Cfx.re-Konto" hint={t('settings.account.cfxLead')}>
                  {user.cfxName ? (
                    <div className="sx-inline">
                      <span className="badge ok">{user.cfxName}</span>
                      <button className="btn btn-sm" type="button" onClick={() => api('/api/auth/cfx/unlink', { method: 'POST', body: {} }).then(() => { onUser({ ...user, cfxName: '' }); setMsg('Cfx.re getrennt.'); }).catch((e) => setErr(e.message))}>Trennen</button>
                    </div>
                  ) : (
                    <a className="btn btn-sm" href="/api/auth/cfx/start?mode=link">Mit Cfx.re verbinden</a>
                  )}
                </Row>
                <Row label="Zwei-Faktor (2FA)" hint="Zusätzlicher Code aus einer Authenticator-App beim Login.">
                  {user.totp ? (
                    <span className="badge ok">Aktiv</span>
                  ) : !totp ? (
                    <button className="btn btn-sm" type="button" onClick={() => api('/api/auth/totp/setup', { method: 'POST', body: {} }).then(setTotp).catch((e) => setErr(e.message))}>Einrichten</button>
                  ) : (
                    <div className="sx-totp">
                      <code className="sx-secret">{totp.secret}</code>
                      <div className="sx-inline">
                        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" maxLength={8} />
                        <button className="btn btn-sm btn-primary" type="button" onClick={() => api('/api/auth/totp/enable', { method: 'POST', body: { code } }).then(() => { setMsg('2FA aktiv.'); onUser({ ...user, totp: true }); setTotp(null); }).catch((e) => setErr(e.message))}>Aktivieren</button>
                      </div>
                    </div>
                  )}
                </Row>
              </Card>
              <Card title={t('settings.account.password')}>
                <form className="sx-pw" onSubmit={password}>
                  <label className="field"><span>Aktuelles Passwort</span><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
                  <label className="field"><span>Neues Passwort</span><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
                  <button className="btn btn-primary" type="submit" disabled={!pw.current || !pw.next}>{t('settings.account.changePw')}</button>
                </form>
              </Card>
              <Card title={t('settings.account.sessions')} lead="Geräte, auf denen du gerade angemeldet bist.">
                <ul className="sx-list">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <span className="sx-list-ico"><NavIcon name="globe" /></span>
                      <div className="sx-list-text">
                        <b className="mono">{s.ip}</b>
                        <span>Zuletzt aktiv {fmtFull(s.last_seen)}</span>
                      </div>
                      {s.current ? <span className="badge accent">Dieses Gerät</span> : (
                        <button className="btn btn-sm" type="button" onClick={() => api(`/api/sessions/${s.id}`, { method: 'DELETE' }).then(() => { setMsg('Sitzung beendet.'); load(); }).catch((e) => setErr(e.message))}>Abmelden</button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          {/* ── Darstellung ── */}
          {section === 'appearance' && (
            <div className="sx-stack">
              <Card title="Oberfläche" lead="Gilt für deinen Account auf allen Geräten.">
                <Row label="Farbschema">
                  <Seg value={prefs.theme} onChange={(v) => setAppearance({ theme: v })} options={[{ value: 'dark', label: 'Dunkel' }, { value: 'light', label: 'Hell' }]} />
                </Row>
                <Row label="Sidebar" hint="Kompakt zeigt nur Icons. Tastenkürzel: [">
                  <Seg value={prefs.sidebarCollapsed ? 'compact' : 'full'} onChange={(v) => setAppearance({ sidebarCollapsed: v === 'compact' })} options={[{ value: 'full', label: 'Ausgeklappt' }, { value: 'compact', label: 'Kompakt' }]} />
                </Row>
                <Row label="Akzentfarbe" hint="Buttons, Markierungen und Diagramme." stack>
                  <div className="st-accents" role="group" aria-label="Akzentfarbe">
                    {Object.values(ACCENT_PRESETS).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`st-accent${prefs.accent === c.id ? ' active' : ''}`}
                        style={{ ['--swatch']: c.hex, ['--swatch-b']: c.hex2 }}
                        aria-pressed={prefs.accent === c.id}
                        onClick={() => setAppearance({ accent: c.id })}
                      >
                        <i />
                        <span>{c.label}</span>
                      </button>
                    ))}
                  </div>
                </Row>
              </Card>
              <Card title="Live-Konsole" lead="Welche Zeilen in der Konsole angezeigt werden.">
                {[
                  { key: 'showInfo', label: 'Infos', hint: 'Normale Server-Ausgabe' },
                  { key: 'showWarn', label: 'Warnungen' },
                  { key: 'showBad', label: 'Fehler' },
                  { key: 'showOk', label: 'Erfolgsmeldungen' },
                  { key: 'hideAssetSpam', label: 'Asset-Spam ausblenden', hint: 'Oversized-Asset- und Streaming-Hinweise' },
                ].map((o) => (
                  <Row key={o.key} label={o.label} hint={o.hint}>
                    <Switch label={o.label} checked={prefs.console?.[o.key] !== false} onChange={(v) => setAppearance({ console: { [o.key]: v } })} />
                  </Row>
                ))}
              </Card>
            </div>
          )}

          {/* ── Server-Profil ── */}
          {section === 'general' && (
            <form className="sx-stack" onSubmit={save}>
              <Card title="Panel" lead="Wie Orbit deinen Server nennt.">
                <Row label="Kurzname" hint="Für Panel, Discord und Ingame-Menü (max. 18 Zeichen).">
                  <input value={form.serverName || ''} maxLength={18} required onChange={(e) => set({ serverName: e.target.value })} placeholder={t('settings.serverNamePh')} />
                </Row>
                <Row label="Sprache" hint="Panel, Discord-Meldungen und Ingame-Texte.">
                  <select
                    value={toSettingsValue(form.language || form.locale || 'de-DE')}
                    onChange={(e) => {
                      const language = e.target.value;
                      set({ language, locale: toBcp47(language) });
                      setLanguage(language);
                    }}
                  >
                    {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                  </select>
                </Row>
              </Card>
              <Card title="Serverliste" lead="Erscheint in der FiveM-Serverliste — wird in die aktive server.cfg geschrieben.">
                <Row label="Anzeigename" hint="sv_hostname">
                  <input value={form.hostname || ''} onChange={(e) => set({ hostname: e.target.value })} />
                </Row>
                <Row label="Projektname" hint="sv_projectName">
                  <input value={form.project || ''} onChange={(e) => set({ project: e.target.value })} />
                </Row>
                <Row label="Tags" hint="Kommagetrennt, z. B. roleplay, german">
                  <input value={form.tags || ''} onChange={(e) => set({ tags: e.target.value })} placeholder={t('settings.tagsPh')} />
                </Row>
                <Row label="Slots" hint="Maximale Spielerzahl (sv_maxclients)">
                  <input type="number" min={1} max={2048} value={form.maxClients ?? ''} onChange={(e) => set({ maxClients: e.target.value })} className="sx-num" />
                </Row>
              </Card>
              {saveBar}
            </form>
          )}

          {/* ── FXServer & Start ── */}
          {section === 'fxserver' && isOwner && (
            <form className="sx-stack" onSubmit={save}>
              <Card title="Prozess" lead="Wie der FXServer gestartet und überwacht wird.">
                <Row label="Steuerung" hint="Orbit startet FX selbst oder nutzt einen bestehenden systemd-Dienst.">
                  <select value={form.fxControlMode || 'systemd'} onChange={(e) => set({ fxControlMode: e.target.value })}>
                    <option value="orbit">Orbit startet FXServer</option>
                    <option value="systemd">systemd-Dienst</option>
                  </select>
                </Row>
                <Row label="Autostart" hint="FX beim Start von Orbit automatisch hochfahren.">
                  <Switch label="Autostart" checked={form.fxAutostart !== false} onChange={(v) => set({ fxAutostart: v })} />
                </Row>
                <Row label="Crash-Neustart" hint="Nach einem Absturz automatisch neu starten.">
                  <Switch label="Crash-Neustart" checked={form.autoRestartEnabled !== false} onChange={(v) => set({ autoRestartEnabled: v })} />
                </Row>
                <Row label="Ausgabe im Journal" hint="FX-Ausgabe zusätzlich ins Host-Terminal/Journal schreiben.">
                  <Switch label="Ausgabe im Journal" checked={!form.quietMode} onChange={(v) => set({ quietMode: !v })} />
                </Row>
                <Row label="Start-Toleranz" hint="So lange darf das Hochfahren dauern, bevor neu gestartet wird.">
                  <select value={form.resourceStartingTolerance || '90'} onChange={(e) => set({ resourceStartingTolerance: e.target.value })}>
                    <option value="60">1 Minute</option>
                    <option value="90">1,5 Minuten</option>
                    <option value="120">2 Minuten</option>
                    <option value="180">3 Minuten</option>
                    <option value="300">5 Minuten</option>
                  </select>
                </Row>
              </Card>
              <Card title="Netzwerk & Spiel">
                <Row label="Port" hint="Game-Port (TCP + UDP)">
                  <input value={form.fivemPort || ''} onChange={(e) => set({ fivemPort: e.target.value })} className="sx-num" />
                </Row>
                <Row label="Game-Build" hint="sv_enforceGameBuild">
                  <select value={form.gameBuild || ''} onChange={(e) => set({ gameBuild: e.target.value })}>
                    {GAME_BUILD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                  </select>
                </Row>
                <Row label="OneSync">
                  <select value={form.onesync || 'on'} onChange={(e) => set({ onesync: e.target.value })}>
                    {ONESYNC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Row>
              </Card>
              <Card title="Pfade" lead="Wo Server-Daten und FXServer liegen. Weitere Instanzen unter „Instanzen & Builds“.">
                <Row label="Server-Datenordner" stack>
                  <input className="mono" value={form.fxDataPath || ''} onChange={(e) => set({ fxDataPath: e.target.value })} placeholder="/opt/orbit/servers/…" />
                </Row>
                <Row label="FXServer-Ordner" stack>
                  <input className="mono" value={form.fxServerRoot || ''} onChange={(e) => set({ fxServerRoot: e.target.value })} />
                </Row>
                <Row label="CFG-Datei" hint="Relativ zum Datenordner">
                  <input className="mono" value={form.fxCfgPath || 'server.cfg'} onChange={(e) => set({ fxCfgPath: e.target.value })} />
                </Row>
                <Row label="Zusätzliche Start-Argumente" hint="Optional">
                  <input className="mono" value={form.fxServerExtraArgs || ''} onChange={(e) => set({ fxServerExtraArgs: e.target.value })} />
                </Row>
              </Card>
              <Card
                title="RCON"
                lead="Fallback-Konsole, wenn Orbit den FX nicht selbst steuert."
                actions={<button className="btn btn-sm" type="button" onClick={() => api('/api/settings/rcon-test', { method: 'POST', body: {} }).then((d) => setMsg(d.message || t('settings.rconOk'))).catch((e) => setErr(e.message))}>{t('settings.fx.rconTest')}</button>}
              >
                <Row label="Port">
                  <input value={form.rconPort || ''} onChange={(e) => set({ rconPort: e.target.value })} placeholder={form.fivemPort || '30120'} className="sx-num" />
                </Row>
                <Row label="Passwort" hint={form.rconConfigured ? 'Gesetzt — leer lassen, um es zu behalten.' : 'Noch nicht gesetzt.'}>
                  <input type="password" value={form.rconPassword || ''} onChange={(e) => set({ rconPassword: e.target.value })} autoComplete="new-password" />
                </Row>
              </Card>
              {saveBar}
            </form>
          )}

          {/* ── Instanzen & Builds ── */}
          {section === 'host' && isOwner && (
            <div className="sx-stack">
              <Card
                title="Instanzen & FX-Builds"
                lead={form.orbitServerName ? `Aktiv: ${form.orbitServerName}` : 'Weitere Server anlegen und FXServer-Builds verwalten.'}
              >
                <SettingsHostPanel initialTab={hostTab} onMessage={setMsg} onError={setErr} />
              </Card>
            </div>
          )}

          {/* ── Zugang & Bans ── */}
          {section === 'moderation' && isAdmin && (
            <div className="sx-stack">
              <form className="sx-stack" onSubmit={save}>
                <Card title={t('settings.allowlist.title')} lead={t('settings.allowlist.lead')}>
                  <AllowlistPanel
                    mode={form.allowlistMode}
                    modes={modes}
                    instructions={form.allowlistInstructions}
                    discordRoles={form.allowlistDiscordRoles}
                    ipAllowlist={form.ipAllowlist}
                    showIp={isOwner}
                    onChange={set}
                  />
                </Card>
                <Card title="Ban-Prüfung" lead={t('settings.bans.lead')}>
                  <Row label="Bans beim Verbinden prüfen" hint="Gebannte Spieler werden abgewiesen.">
                    <Switch label="Bans prüfen" checked={form.banChecking !== false} onChange={(v) => set({ banChecking: v })} />
                  </Row>
                  <Row label={t('settings.bans.hwid')} hint="Wie viele Hardware-IDs übereinstimmen müssen.">
                    <select value={String(form.requiredHwidMatches ?? '1')} onChange={(e) => set({ requiredHwidMatches: e.target.value })}>
                      <option value="0">{t('settings.bans.hwidOff')}</option>
                      <option value="1">{t('settings.bans.hwidRec')}</option>
                      {[2, 3, 4, 5, 6].map((n) => <option key={n} value={String(n)}>{n}</option>)}
                    </select>
                  </Row>
                  <Row label={t('settings.bans.reject')} hint="Nachricht, die gebannte Spieler sehen." stack>
                    <textarea rows={3} value={form.banRejectionMessage || ''} onChange={(e) => set({ banRejectionMessage: e.target.value })} />
                  </Row>
                </Card>
                {saveBar}
              </form>

              <Card title={t('settings.bans.templates')} lead={t('settings.bans.templatesLead')}>
                {templates.length === 0 ? (
                  <p className="muted sx-empty">{t('settings.bans.noTpl')}</p>
                ) : (
                  <ul className="sx-list">
                    {templates.map((tpl) => (
                      <li key={tpl.id}>
                        <span className="sx-list-ico"><NavIcon name="ban" /></span>
                        <div className="sx-list-text">
                          <b>{tpl.title || tpl.reason}</b>
                          <span>{tpl.reason}</span>
                        </div>
                        <span className="badge">{banDurationLabel(tpl.duration_id, t)}</span>
                        <button type="button" className="o-icon-btn" disabled={tplBusy} title={t('common.delete')} onClick={() => removeTemplate(tpl.id)}><NavIcon name="x" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <form className="sx-tpl-form" onSubmit={addTemplate}>
                  <input value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} placeholder={t('settings.bans.tplTitlePh')} required maxLength={48} aria-label={t('settings.bans.tplTitle')} />
                  <input value={tplReason} onChange={(e) => setTplReason(e.target.value)} placeholder={t('settings.bans.reasonPh')} required minLength={3} maxLength={280} aria-label={t('settings.bans.reason')} />
                  <OrbitSelect
                    value={tplDuration}
                    onChange={setTplDuration}
                    options={[
                      ...BAN_DURATION_PRESETS.map((p) => ({ value: p.id, label: banDurationLabel(p.id, t) })),
                      { value: 'custom', label: t('ban.custom') },
                    ]}
                  />
                  {tplDuration === 'custom' && (
                    <div className="st-custom-dur">
                      <input type="number" min={0} max={9999} inputMode="numeric" placeholder={t('ban.daysPh')} value={tplDays} onChange={(e) => setTplDays(e.target.value)} aria-label={t('common.days')} />
                      <input type="text" inputMode="numeric" placeholder={t('ban.hhmmPh')} value={tplHhmm} onChange={(e) => setTplHhmm(e.target.value)} maxLength={5} autoComplete="off" aria-label={t('ban.hhmm')} />
                    </div>
                  )}
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={tplBusy || !tplTitle.trim() || tplReason.trim().length < 3 || (tplDuration === 'custom' && !customDurationToId(tplDays, tplHhmm).ok)}
                  >
                    <NavIcon name="plus" />{t('settings.tplAdd')}
                  </button>
                </form>
              </Card>

              {isOwner && (
                <Card title={t('settings.allowlist.revoke')} lead={t('settings.allowlist.revokeLead')} tone="warn">
                  <Row label="Alle Allowlist-Einträge entfernen" hint="Spieler müssen danach neu freigeschaltet werden.">
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={sysBusy}
                      onClick={() => confirmAction(t('settings.allowlist.revokeConfirm'), async () => {
                        const d = await api('/api/system/revoke-allowlists', { method: 'POST', body: { confirm: true, olderThanDays: 'all' } });
                        setMsg(t('settings.allowlist.revoked', { n: d.removed }));
                      })}
                    >
                      Widerrufen
                    </button>
                  </Row>
                </Card>
              )}
            </div>
          )}

          {/* ── Ingame-Menü ── */}
          {section === 'game' && isAdmin && (
            <form className="sx-stack" onSubmit={save}>
              <Card title="Menü" lead={t('settings.game.menuLead')}>
                <Row label="Ingame-Menü aktiv" hint="/orbit bzw. /orbitmenu im Spiel">
                  <Switch label="Ingame-Menü" checked={form.gameMenuEnabled !== false} onChange={(v) => set({ gameMenuEnabled: v })} />
                </Row>
                <Row label="Position">
                  <Seg value={form.gameMenuAlignRight ? 'right' : 'left'} onChange={(v) => set({ gameMenuAlignRight: v === 'right' })} options={[{ value: 'left', label: 'Links' }, { value: 'right', label: 'Rechts' }]} />
                </Row>
                <Row label="Seitenwechsel-Taste" hint="Feld anklicken und Taste drücken.">
                  <input
                    className="sx-key"
                    value={form.gameMenuPageKey || 'Tab'}
                    onChange={(e) => set({ gameMenuPageKey: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.ctrlKey || e.metaKey || e.altKey) return;
                      if (e.key === 'Escape' || e.key === 'Backspace') return;
                      if (e.key.length === 1 || ['Tab', 'Enter', 'Shift', 'Control', 'Alt'].includes(e.key)) {
                        e.preventDefault();
                        set({ gameMenuPageKey: e.key === ' ' ? 'Space' : e.key });
                      }
                    }}
                    placeholder={t('settings.game.keyPh')}
                  />
                </Row>
              </Card>
              <Card title="Benachrichtigungen" lead="Was Spieler im Spiel angezeigt bekommen.">
                <Row label={t('settings.game.notifyPos')}>
                  <select value={form.gameNotifyPos || 'top-left'} onChange={(e) => set({ gameNotifyPos: e.target.value })}>
                    <option value="top-left">{t('settings.game.notifyTopLeft')}</option>
                    <option value="top-right">{t('settings.game.notifyTopRight')}</option>
                    <option value="bottom-left">{t('settings.game.notifyBottomLeft')}</option>
                    <option value="bottom-right">{t('settings.game.notifyBottomRight')}</option>
                  </select>
                </Row>
                {[
                  ['hideAnnouncementNotif', 'Ankündigungen anzeigen'],
                  ['hideDmNotif', 'Direktnachrichten anzeigen'],
                  ['hideWarnNotif', 'Verwarnungen anzeigen'],
                  ['hideRestartWarnNotif', 'Restart-Warnungen anzeigen'],
                ].map(([key, label]) => (
                  <Row key={key} label={label}>
                    <Switch label={label} checked={!form[key]} onChange={(v) => set({ [key]: !v })} />
                  </Row>
                ))}
              </Card>
              <Card title="Admin-Namen" lead="Ob Spieler sehen, welcher Admin gehandelt hat.">
                <Row label="Bei Strafen anzeigen" hint="Kick, Warn, Ban">
                  <Switch label="Bei Strafen anzeigen" checked={form.hideAdminInPunishments === false} onChange={(v) => set({ hideAdminInPunishments: !v })} />
                </Row>
                <Row label="Bei Nachrichten anzeigen" hint="Ankündigungen und DMs">
                  <Switch label="Bei Nachrichten anzeigen" checked={!form.hideAdminInMessages} onChange={(v) => set({ hideAdminInMessages: !v })} />
                </Row>
              </Card>
              {saveBar}
            </form>
          )}

          {/* ── Discord ── */}
          {section === 'discord' && isOwner && (
            <form className="sx-stack" onSubmit={save}>
              <Card
                title="Webhook"
                lead="Meldungen bei Start, Stop und Restart."
                actions={<button type="button" className="btn btn-sm" onClick={() => api('/api/platform/discord-test', { method: 'POST', body: {} }).then(() => setMsg('Discord-Test gesendet.')).catch((e) => setErr(e.message))}>Testnachricht</button>}
              >
                <Row label="Webhook aktiv">
                  <Switch label="Webhook" checked={!!form.discordEnabled} onChange={(v) => set({ discordEnabled: v })} />
                </Row>
                <Row label="Verbindungsabbrüche melden" hint="Player-Drops (Crashes, Timeouts) posten.">
                  <Switch label="Drops melden" checked={!!form.discordNotifyDrops} onChange={(v) => set({ discordNotifyDrops: v })} />
                </Row>
                <Row label="Webhook-URL" stack>
                  <input value={form.discordWebhook || ''} onChange={(e) => set({ discordWebhook: e.target.value })} placeholder="https://discord.com/api/webhooks/…" />
                </Row>
              </Card>
              <Card title="Status-Bot" lead={t('settings.discord.statusEmbed')}>
                <Row label="Bot aktiv" hint={t('settings.discord.intent')}>
                  <Switch label="Bot" checked={!!form.discordBotEnabled} onChange={(v) => set({ discordBotEnabled: v })} />
                </Row>
                <Row label="Bot-Token" hint={form.discordBotConfigured ? 'Gesetzt — leer lassen, um ihn zu behalten.' : 'Aus dem Discord Developer Portal.'}>
                  <input type="password" value={form.discordBotToken || ''} onChange={(e) => set({ discordBotToken: e.target.value })} autoComplete="new-password" />
                </Row>
                <Row label="Server-ID (Guild)">
                  <input className="mono" value={form.discordGuild || ''} onChange={(e) => set({ discordGuild: e.target.value })} />
                </Row>
                <Row label="Warnungs-Kanal" hint="Kanal-ID für Restart-Warnungen — leer = aus">
                  <input className="mono" value={form.discordWarningsChannel || ''} onChange={(e) => set({ discordWarningsChannel: e.target.value })} />
                </Row>
                {form.discordStatusMessageId ? (
                  <Row label="Status-Embed"><span className="badge ok">Aktiv</span></Row>
                ) : null}
              </Card>
              <details className="sx-adv">
                <summary><NavIcon name="chevron" />Erweitert: Status-Embed anpassen (JSON)</summary>
                <Card title="Embed-Struktur" lead="Platzhalter wie {{uptime}} sind erlaubt.">
                  <textarea className="st-code" rows={10} value={form.discordStatusEmbedJson || ''} onChange={(e) => set({ discordStatusEmbedJson: e.target.value })} spellCheck={false} />
                </Card>
                <Card title="Farben & Buttons">
                  <textarea className="st-code" rows={10} value={form.discordStatusConfigJson || ''} onChange={(e) => set({ discordStatusConfigJson: e.target.value })} spellCheck={false} />
                </Card>
              </details>
              {saveBar}
            </form>
          )}

          {/* ── Backup & Wartung ── */}
          {section === 'system' && isOwner && (
            <div className="sx-stack">
              <Card title="Backup" lead="Orbit-Panel-Datenbank: Spieler, Bans, Warns, Allowlist.">
                <Row label="Backup erstellen" hint="Speichert eine Kopie auf dem Server und lädt sie als JSON herunter.">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={sysBusy}
                    onClick={async () => {
                      setSysBusy(true);
                      try {
                        const d = await api('/api/system/backup-database');
                        const blob = new Blob([JSON.stringify(d.export, null, 2)], { type: 'application/json' });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `orbit-players-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                        setMsg(`Backup gespeichert: ${d.file}`);
                      } catch (e) {
                        setErr(e.message);
                      }
                      setSysBusy(false);
                    }}
                  >
                    Backup herunterladen
                  </button>
                </Row>
              </Card>
              <Card title="Datenbank bereinigen" lead="Alte Einträge entfernen. Nicht umkehrbar — vorher Backup erstellen." tone="warn">
                {['players', 'bans', 'warns', 'hwids'].map((key) => (
                  <Row key={key} label={t(`settings.clean.${key}`)}>
                    <select value={cleanForm[key]} onChange={(e) => setCleanForm({ ...cleanForm, [key]: e.target.value })}>
                      {(cleanOpts?.[key] || [{ value: cleanForm[key], label: cleanForm[key] }]).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Row>
                ))}
                <div className="sx-card-foot">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={sysBusy}
                    onClick={() => confirmAction('Datenbank wirklich bereinigen? Das kann nicht rückgängig gemacht werden.', async () => {
                      const d = await api('/api/system/clean-database', { method: 'POST', body: { confirm: true, ...cleanForm } });
                      setMsg(`Bereinigt: ${Object.entries(d.cleaned || {}).map(([k, v]) => `${k} ${v}`).join(', ')}`);
                    })}
                  >
                    Jetzt bereinigen
                  </button>
                </div>
              </Card>
            </div>
          )}

          {/* ── Gefahrenzone ── */}
          {section === 'danger' && isOwner && (
            <div className="sx-stack">
              <Card title="Gefahrenzone" lead="Diese Aktionen lassen sich nicht rückgängig machen." tone="bad">
                <Row label={t('settings.danger.reset')} hint={t('settings.danger.resetLead')}>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={resetBusy}
                    onClick={async () => {
                      if (!window.confirm(t('settings.danger.resetConfirm1'))) return;
                      if (!window.confirm(t('settings.danger.resetConfirm2'))) return;
                      setResetBusy(true);
                      try {
                        const res = await api('/api/settings/reset-setup', { method: 'POST', body: { confirm: true, wipe: true } });
                        setMsg(t('settings.danger.resetMsg', { n: (res.deleted || []).length }));
                        onSetupReset?.({ redirect: '/setup', wipe: true });
                      } catch (e) {
                        setErr(e.message || t('settings.danger.resetFail'));
                      } finally {
                        setResetBusy(false);
                      }
                    }}
                  >
                    {resetBusy ? t('settings.danger.resetBusy') : 'Zurücksetzen'}
                  </button>
                </Row>
                <Row label="Orbit deinstallieren" hint="Entfernt Panel, Dienst und Installation vollständig.">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={resetBusy}
                    onClick={async () => {
                      const phrase = window.prompt(t('settings.danger.uninstallPrompt'));
                      if (phrase == null) return;
                      if (String(phrase).trim().toUpperCase() !== t('settings.danger.uninstallPhrase')) {
                        setErr('Abgebrochen — Phrase falsch.');
                        return;
                      }
                      if (!window.confirm('Orbit jetzt unwiderruflich deinstallieren?')) return;
                      setResetBusy(true);
                      try {
                        const res = await api('/api/settings/uninstall', { method: 'POST', body: { confirmPhrase: t('settings.danger.uninstallPhrase') } });
                        setMsg(res.message || t('settings.danger.uninstallMsg'));
                        window.setTimeout(() => { window.location.href = 'about:blank'; }, 2500);
                      } catch (e) {
                        setErr(e.message || 'Deinstallation fehlgeschlagen');
                        setResetBusy(false);
                      }
                    }}
                  >
                    {resetBusy ? '…' : 'Deinstallieren'}
                  </button>
                </Row>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
