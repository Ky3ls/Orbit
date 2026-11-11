import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../components/toast.jsx';
import { Empty, Page, PageHeader } from '../components/Ui.jsx';
import { NavIcon } from '../layout/icons.jsx';
import './audit.css';

/* Kategorien — gleiche Präfix-Logik wie server/auditQuery.js */
export function category(action = '', user = '') {
  const a = String(action);
  if (a.startsWith('orbit.') || user === 'system') return 'system';
  if (a.startsWith('mc.')) return 'minecraft';
  if (a.startsWith('host.')) return 'host';
  if (/^(login|logout|lockout|master\.create|cfx\.)|^totp|^password|^session/.test(a)) return 'auth';
  if (/^(ban|unban|kick|warn|unwarn|note)$|^player\.|^whitelist|^allowlist|^ban\./.test(a)) return 'players';
  if (/^user\.|^admin\.|^role|^team\.|^template/.test(a)) return 'team';
  return 'fivem';
}

const CATS = {
  fivem: { label: 'FiveM', icon: 'power', tone: 'accent' },
  minecraft: { label: 'Minecraft', icon: 'cube', tone: 'ok' },
  players: { label: 'Spieler', icon: 'users', tone: 'warn' },
  host: { label: 'Host', icon: 'db', tone: 'info' },
  auth: { label: 'Anmeldung', icon: 'lock', tone: 'violet' },
  team: { label: 'Team', icon: 'team', tone: 'pink' },
  system: { label: 'System', icon: 'gear', tone: 'muted' },
};

/* Verständliche Sätze statt Codes */
const LABELS = {
  login: 'hat sich angemeldet', logout: 'hat sich abgemeldet', lockout: 'wurde nach Fehlversuchen gesperrt', 'master.create': 'hat das Inhaberkonto angelegt', 'cfx.claim': 'hat sein Cfx.re-Konto verknüpft',
  'server.start': 'hat den FiveM-Server gestartet', 'server.stop': 'hat den FiveM-Server gestoppt', 'server.restart': 'hat den FiveM-Server neu gestartet',
  'resource.start': 'hat eine Ressource gestartet', 'resource.stop': 'hat eine Ressource gestoppt', 'resource.restart': 'hat eine Ressource neu gestartet',
  console: 'hat einen Konsolenbefehl ausgeführt', 'cfg.save': 'hat die server.cfg gespeichert', message: 'hat eine Nachricht gesendet', settings: 'hat Einstellungen geändert', setup: 'hat die FiveM-Einrichtung abgeschlossen',
  ban: 'hat einen Spieler gebannt', unban: 'hat einen Spieler entbannt', kick: 'hat einen Spieler gekickt', warn: 'hat einen Spieler verwarnt',
  'mc.start': 'hat einen Minecraft-Server gestartet', 'mc.stop': 'hat einen Minecraft-Server gestoppt', 'mc.restart': 'hat einen Minecraft-Server neu gestartet', 'mc.kill': 'hat einen Minecraft-Server hart beendet',
  'mc.create': 'hat einen Minecraft-Server erstellt', 'mc.delete': 'hat einen Minecraft-Server gelöscht', 'mc.import': 'hat einen Minecraft-Server importiert', 'mc.command': 'hat einen Minecraft-Befehl ausgeführt',
  'mc.update': 'hat Instanz-Einstellungen geändert', 'mc.properties': 'hat server.properties geändert', 'mc.address': 'hat die öffentliche Adresse geändert',
  'mc.player.inventory': 'hat ein Inventar bearbeitet', 'mc.player.op': 'hat OP vergeben', 'mc.player.deop': 'hat OP entzogen', 'mc.player.give': 'hat ein Item gegeben', 'mc.player.kick': 'hat einen Spieler gekickt', 'mc.player.ban': 'hat einen Spieler gebannt', 'mc.player.pardon': 'hat einen Spieler entbannt',
  'mc.player.whitelist-add': 'hat jemanden auf die Whitelist gesetzt', 'mc.player.whitelist-remove': 'hat jemanden von der Whitelist entfernt', 'mc.player.gamemode': 'hat den Spielmodus geändert', 'mc.player.tp': 'hat einen Spieler teleportiert', 'mc.player.heal': 'hat einen Spieler geheilt',
  'mc.backup.create': 'hat ein Backup erstellt', 'mc.backup.restore': 'hat ein Backup wiederhergestellt', 'mc.backup.delete': 'hat ein Backup gelöscht', 'mc.backup.settings': 'hat den Backup-Zeitplan geändert', 'mc.backup.download': 'hat ein Backup heruntergeladen', 'mc.backup.upload': 'hat ein Backup hochgeladen',
  'mc.mod.install': 'hat einen Mod / ein Plugin installiert', 'mc.mod.remove': 'hat einen Mod / ein Plugin entfernt', 'mc.mod.update': 'hat einen Mod / ein Plugin aktualisiert', 'mc.mod.upload': 'hat einen Mod / ein Plugin hochgeladen',
  'host.db.create': 'hat eine Datenbank angelegt', 'host.db.drop': 'hat eine Datenbank gelöscht', 'host.db.password': 'hat ein Datenbank-Passwort erneuert', 'host.db.install': 'hat einen Datenbank-Server installiert', 'host.db.sql': 'hat SQL ausgeführt', 'host.db.update': 'hat Datensätze geändert', 'host.db.insert': 'hat einen Datensatz eingefügt', 'host.db.delete': 'hat Datensätze gelöscht', 'host.db.import': 'hat SQL importiert', 'host.db.export': 'hat Daten exportiert', 'host.db.dump': 'hat einen Dump heruntergeladen', 'host.db.create-table': 'hat eine Tabelle angelegt',
  'host.web.add': 'hat eine Domain eingerichtet', 'host.web.update': 'hat eine Domain geändert', 'host.web.delete': 'hat eine Domain entfernt', 'host.web.install': 'hat einen Webserver installiert', 'host.web.enable': 'hat eine Domain aktiviert', 'host.web.disable': 'hat eine Domain deaktiviert',
  'host.process.term': 'hat einen Prozess beendet', 'host.process.kill': 'hat einen Prozess hart beendet', 'host.service.restart': 'hat einen Dienst neu gestartet', 'host.service.stop': 'hat einen Dienst gestoppt', 'host.service.start': 'hat einen Dienst gestartet', 'host.service.reload': 'hat einen Dienst neu geladen', 'host.setup.done': 'hat die Orbit-Einrichtung abgeschlossen',
  'orbit.sync': 'Ingame-Ressource synchronisiert', 'orbit.ready': 'Ingame-Menü bereit', 'orbit.deploy': 'Ingame-Ressource bereitgestellt', 'fx.adopt': 'FiveM-Prozess nach Panel-Neustart übernommen', 'fx.autostart.fail': 'FiveM-Autostart fehlgeschlagen',
};

function sentence(e) {
  if (LABELS[e.action]) return LABELS[e.action];
  if (e.action.startsWith('host.db.alter.')) return `hat eine Tabelle geändert (${e.action.slice(14)})`;
  if (e.action.startsWith('mc.player.')) return `Spieler-Aktion: ${e.action.slice(10)}`;
  return e.action;
}

function tone(e) {
  if (/stop|ban|delete|drop|kill|fail|lockout|restore|remove/.test(e.action)) return 'bad';
  if (/start|create|unban|add|install|enable|done/.test(e.action)) return 'ok';
  return '';
}

const PALETTE = ['#f97316', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#fb7185'];
export function userColor(u) {
  if (u === 'system') return 'var(--muted)';
  let h = 0;
  for (const ch of String(u)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const RANGES = [['all', 'Alles', 0], ['today', 'Heute', 'today'], ['7', '7 Tage', 7], ['30', '30 Tage', 30]];

function csvCell(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Audit() {
  const [entries, setEntries] = useState(null);
  const [stats, setStats] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [cat, setCat] = useState('');
  const [who, setWho] = useState('');
  const [range, setRange] = useState('all');
  const [system, setSystem] = useState(false);
  const [critical, setCritical] = useState(false);
  const [open, setOpen] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const qt = useRef(null);

  const params = useCallback((before) => {
    const p = new URLSearchParams({ limit: '150' });
    if (qLive) p.set('q', qLive);
    if (cat) p.set('cat', cat);
    if (who) p.set('user', who);
    if (system || cat === 'system') p.set('system', '1');
    if (critical) p.set('critical', '1');
    const r = RANGES.find((x) => x[0] === range)?.[2];
    if (r === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); p.set('from', String(d.getTime())); } else if (r) p.set('from', String(Date.now() - r * 86400_000));
    if (before) p.set('before', String(before));
    return p;
  }, [qLive, cat, who, system, critical, range]);

  useEffect(() => {
    let alive = true;
    api(`/api/audit?${params()}`).then((d) => {
      if (!alive) return;
      setEntries(d.entries || []);
      setHasMore(!!d.hasMore);
      if (d.stats) setStats(d.stats);
    }).catch(() => alive && setEntries([]));
    return () => { alive = false; };
  }, [params]);

  async function more() {
    if (!entries?.length) return;
    setLoadingMore(true);
    try {
      const d = await api(`/api/audit?${params(entries[entries.length - 1].id)}`);
      setEntries((e) => [...e, ...(d.entries || [])]);
      setHasMore(!!d.hasMore);
    } catch (e) { toast.err(e.message); }
    setLoadingMore(false);
  }

  // Gleiche Ereignisse direkt hintereinander zusammenfassen (z. B. 12× Inventar bearbeitet)
  const days = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
    const today = new Date().toDateString();
    const yest = new Date(Date.now() - 86400_000).toDateString();
    const out = [];
    let cur = null;
    for (const e of entries || []) {
      const ds = new Date(e.created).toDateString();
      if (!cur || cur.key !== ds) {
        cur = { key: ds, label: ds === today ? 'Heute' : ds === yest ? 'Gestern' : fmtDay.format(e.created), items: [], count: 0 };
        out.push(cur);
      }
      cur.count += 1;
      const last = cur.items[cur.items.length - 1];
      if (last && last.action === e.action && last.user === e.user && Math.abs(last.created - e.created) < 30 * 60_000) {
        last.group.push(e);
      } else cur.items.push({ ...e, group: [e] });
    }
    return out;
  }, [entries]);

  function exportCsv() {
    const rows = [['Zeit', 'Benutzer', 'Aktion', 'Beschreibung', 'Details', 'IP'], ...(entries || []).map((e) => [new Date(e.created).toISOString(), e.user, e.action, sentence(e), e.detail, e.ip])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿', rows.map((r) => r.map(csvCell).join(';')).join('\n')], { type: 'text/csv' }));
    a.download = `orbit-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const maxDay = Math.max(1, ...(stats?.byDay || []).map((d) => d.n));
  const activeUsers = (stats?.users || []).filter((u) => u.user !== 'system');

  return (
    <Page className="au-page">
      <PageHeader
        eyebrow="Verwaltung"
        title="Audit-Log"
        description="Wer hat wann was gemacht — auf allen Servern, im Host und im Team."
        actions={<button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!entries?.length}><NavIcon name="download" />CSV-Export</button>}
      />

      {stats && (
        <div className="au-top">
          <div className="au-kpis">
            <div className="card au-kpi"><span className="au-kpi-ico tone-accent"><NavIcon name="activity" /></span><span><b>{stats.today}</b><em>Heute</em></span></div>
            <div className="card au-kpi"><span className="au-kpi-ico tone-info"><NavIcon name="calendar" /></span><span><b>{stats.week}</b><em>Letzte 7 Tage</em></span></div>
            <button type="button" className={`card au-kpi${critical ? ' on' : ''}`} onClick={() => setCritical(!critical)} title="Nur kritische Aktionen zeigen"><span className="au-kpi-ico tone-bad"><NavIcon name="bolt" /></span><span><b>{stats.critical}</b><em>Kritisch (7 Tage)</em></span></button>
            <div className="card au-kpi"><span className="au-kpi-ico tone-ok"><NavIcon name="users" /></span><span><b>{activeUsers.length}</b><em>Aktive Personen</em></span></div>
          </div>
          <div className="card au-chart">
            <header><b>Aktivität</b><small>letzte 30 Tage</small></header>
            <div className="au-bars">
              {stats.byDay.map((d) => (
                <span key={d.day} className="au-bar" title={`${new Date(d.day).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}: ${d.n} Aktionen`}>
                  <i style={{ height: `${Math.max(d.n ? 6 : 2, (d.n / maxDay) * 100)}%` }} className={d.n ? '' : 'zero'} />
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="au-filters">
        <div className="lg-search au-search"><NavIcon name="search" /><input placeholder="Suchen: Name, Aktion, Details, IP…" value={q} onChange={(e) => { setQ(e.target.value); clearTimeout(qt.current); const v = e.target.value; qt.current = setTimeout(() => setQLive(v.trim()), 300); }} /></div>
        <div className="seg au-range">{RANGES.map(([k, l]) => <button key={k} type="button" className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
        <label className="au-sys"><button type="button" role="switch" aria-checked={system} className={`switch${system ? ' on' : ''}`} onClick={() => setSystem(!system)} />Systemereignisse</label>
      </div>

      <div className="au-cats">
        <button type="button" className={`au-cat${!cat ? ' on' : ''}`} onClick={() => setCat('')}><NavIcon name="list" />Alle</button>
        {Object.entries(CATS).filter(([k]) => k !== 'system' || system).map(([k, c]) => (
          <button key={k} type="button" className={`au-cat tone-${c.tone}${cat === k ? ' on' : ''}`} onClick={() => setCat(cat === k ? '' : k)}>
            <NavIcon name={c.icon} />{c.label}{stats?.byCat?.[k] ? <span className="seg-n">{stats.byCat[k]}</span> : null}
          </button>
        ))}
        {activeUsers.length > 1 && (
          <div className="au-people">
            {activeUsers.map((u) => (
              <button key={u.user} type="button" className={`au-person${who === u.user ? ' on' : ''}`} title={`${u.user}: ${u.n} Aktionen`} style={{ '--uc': userColor(u.user) }} onClick={() => setWho(who === u.user ? '' : u.user)}>
                {u.user.slice(0, 2).toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {!entries ? <div className="mcx-loading">Lädt…</div> : entries.length === 0 ? (
        <div className="card mm-empty"><Empty title="Keine Einträge" text={qLive || cat || who || critical ? 'Für diese Filter gibt es nichts.' : 'Noch keine Aktionen protokolliert.'} /></div>
      ) : (
        <div className="au-timeline">
          {days.map((d) => (
            <section key={d.key} className="au-day">
              <header className="au-day-head"><b>{d.label}</b><span>{d.count} Aktion{d.count === 1 ? '' : 'en'}</span></header>
              <div className="card au-list">
                {d.items.map((e) => {
                  const c = CATS[category(e.action, e.user)];
                  const isOpen = open === e.id;
                  const n = e.group.length;
                  const details = [...new Set(e.group.map((x) => x.detail).filter(Boolean))];
                  return (
                    <div key={e.id} className={`au-row tone-${tone(e) || c.tone}${isOpen ? ' open' : ''}`}>
                      <button type="button" className="au-main" onClick={() => setOpen(isOpen ? null : e.id)}>
                        <span className="au-time mono">{new Date(e.created).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="au-dot"><NavIcon name={c.icon} /></span>
                        <span className="au-avatar" style={{ '--uc': userColor(e.user) }}>{e.user === 'system' ? <NavIcon name="gear" /> : e.user.slice(0, 2).toUpperCase()}</span>
                        <span className="au-text">
                          <span><b>{e.user === 'system' ? 'Orbit' : e.user}</b> {sentence(e)}{n > 1 && <span className="au-times">{n}×</span>}</span>
                          {details[0] && <small>{details[0].length > 120 ? `${details[0].slice(0, 120)}…` : details[0]}{details.length > 1 ? ` · +${details.length - 1} weitere` : ''}</small>}
                        </span>
                        <span className="au-badge">{c.label}</span>
                        <NavIcon name="chevronDown" />
                      </button>
                      {isOpen && (
                        <div className="au-detail">
                          {e.group.slice(0, 30).map((x) => (
                            <div key={x.id} className="au-detail-row">
                              <span className="mono">{new Date(x.created).toLocaleString('de-DE')}</span>
                              <code>{x.action}</code>
                              <span className="au-detail-text">{x.detail || <em className="muted">keine Details</em>}</span>
                              <span className="mono muted">{x.ip || '—'}</span>
                            </div>
                          ))}
                          {n > 30 && <div className="muted au-detail-more">… und {n - 30} weitere</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {hasMore && <button type="button" className="btn au-more" disabled={loadingMore} onClick={more}>{loadingMore ? 'Lädt…' : 'Ältere Einträge laden'}</button>}
        </div>
      )}
    </Page>
  );
}
