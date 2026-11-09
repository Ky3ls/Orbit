import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import Drawer from '../../components/Drawer.jsx';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty, Modal, Page, PageHeader } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { CopyField, JobLog, copy, useJob } from './hostShared.jsx';
import './host.css';

const TYPE_ICON = { proxy: 'switch', static: 'folder', php: 'cfg', redirect: 'arrowRight', game: 'gamepad' };
const DNS_LABEL = { direct: 'Zeigt auf diesen Server', cloudflare: 'Über Cloudflare', missing: 'Kein DNS-Eintrag', other: 'Zeigt woanders hin' };
const DNS_TONE = { direct: 'ok', cloudflare: 'ok', missing: 'warn', other: 'bad' };

export default function Web() {
  const { user, servers = [] } = useOutletContext();
  const isOwner = user.role === 'owner';
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [guide, setGuide] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [dnsState, setDnsState] = useState({});
  const [job, setJob] = useJob((j) => {
    if (j.error) toast.err(`${j.label} fehlgeschlagen`, { text: j.error.split('\n')[0] });
    else toast.ok(j.label.replace(/ (einrichten|aktualisieren|installieren)$/, '') + ' ist bereit');
    load();
    if (!j.error && j.result?.id) setGuide(j.result.id);
  });

  const load = useCallback(() => {
    api('/api/host/web').then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Direkt-Link: /host/web?add=game&server=minecraft:1
  useEffect(() => {
    const add = params.get('add');
    if (add && data) {
      setEdit({ type: add, target: params.get('server') || '' });
      setParams({}, { replace: true });
    }
  }, [params, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // DNS-Status je Seite nachladen
  useEffect(() => {
    if (!data) return;
    for (const s of data.sites) {
      if (dnsState[s.domain]) continue;
      api(`/api/host/web/check?domain=${encodeURIComponent(s.domain)}`).then((r) => setDnsState((m) => ({ ...m, [s.domain]: r }))).catch(() => {});
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function installWs(id) {
    try {
      const d = await api('/api/host/web/install', { method: 'POST', body: { id } });
      setJob(d.job);
    } catch (e) { toast.err(e.message); }
  }

  async function toggle(s) {
    try {
      await api(`/api/host/web/sites/${s.id}/${s.enabled ? 'disable' : 'enable'}`, { method: 'POST', body: {} });
      toast.ok(`${s.domain} ${s.enabled ? 'deaktiviert' : 'aktiviert'}`);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function remove(s) {
    const files = (s.type === 'static' || s.type === 'php') && !s.root;
    if (!window.confirm(`${s.domain} entfernen? Die Webserver-Konfiguration wird gelöscht.`)) return;
    const delFiles = files && window.confirm(`Auch den Website-Ordner /var/www/${s.domain} löschen?\n\nOK = Dateien löschen\nAbbrechen = Dateien behalten`);
    try {
      await api(`/api/host/web/sites/${s.id}${delFiles ? '?files=1' : ''}`, { method: 'DELETE' });
      toast.ok(`${s.domain} entfernt`);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function showConfig(s) {
    try { const d = await api(`/api/host/web/sites/${s.id}/config`); setCfg({ site: s, text: d.config || '(keine Datei)' }); } catch (e) { toast.err(e.message); }
  }

  const wsLabel = data?.webserver ? data.webservers[data.webserver]?.label : null;
  const sites = data?.sites || [];
  const web = sites.filter((s) => s.type !== 'game');
  const games = sites.filter((s) => s.type === 'game');

  return (
    <Page className="hx-page">
      <PageHeader
        eyebrow="Host"
        title="Domains & Web"
        description="Domains per Klick einrichten — für Websites, Apps, das Panel und deine Gameserver. Danach nur noch den DNS-Eintrag bei Cloudflare anlegen."
        actions={isOwner && data ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdit({})}><NavIcon name="plus" />Domain hinzufügen</button> : null}
      />
      {err && <div className="err">{err}</div>}
      {job && <JobLog job={job} onClose={() => setJob(null)} />}

      {data && !data.webserver && (
        <section className="card hx-wspick">
          <header><h3>Webserver wählen</h3><p>Für Websites und Reverse-Proxys braucht der Host einen Webserver. Gameserver-Domains funktionieren auch ohne.</p></header>
          <div className="hx-wspick-grid">
            {Object.values(data.webservers).map((w) => (
              <button key={w.id} type="button" className="hx-wsopt" disabled={!isOwner || (job && !job.done)} onClick={() => installWs(w.id)}>
                <b>{w.label}</b><small>{w.text}</small><span className="btn btn-sm"><NavIcon name="download" />Installieren</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {data && (
        <div className="hx-webfacts">
          <div className="card"><span><NavIcon name="globe" />Server-IP</span><b className="mono">{data.ip || '—'}</b>{data.ip && <button type="button" className="o-icon-btn" onClick={() => copy(data.ip, 'IP kopiert')}><NavIcon name="copy" /></button>}</div>
          <div className="card"><span><NavIcon name="layers" />Webserver</span><b>{wsLabel || 'Keiner'}</b></div>
          <div className="card"><span><NavIcon name="lock" />Zertifikate</span><b>{data.certificates.length}</b></div>
          <div className="card"><span><NavIcon name="switch" />Von Orbit verwaltet</span><b>{sites.length}</b></div>
        </div>
      )}

      {data && sites.length === 0 && (
        <div className="card mm-empty"><Empty title="Noch keine Domains" text="Füge eine Domain hinzu — Orbit schreibt die Webserver-Konfiguration, holt auf Wunsch ein Zertifikat und zeigt dir, was du bei Cloudflare eintragen musst." /></div>
      )}

      {[['Websites & Apps', web], ['Gameserver-Adressen', games]].map(([title, list]) => list.length > 0 && (
        <section key={title} className="hx-sec">
          <h3 className="hx-sec-title">{title}</h3>
          <div className="card hx-list">
            {list.map((s) => {
              const d = dnsState[s.domain];
              const srv = s.type === 'game' ? servers.find((x) => x.key === s.target) : null;
              return (
                <div key={s.id} className={`hx-site${s.enabled ? '' : ' off'}`}>
                  <span className={`hx-site-ico t-${s.type}`}>{srv ? <GameMark game={srv.game} size={34} /> : <NavIcon name={TYPE_ICON[s.type]} />}</span>
                  <span className="hx-site-main">
                    <a href={s.type === 'game' ? undefined : `${s.ssl === 'none' ? 'http' : 'https'}://${s.domain}`} target="_blank" rel="noreferrer"><b>{s.domain}</b></a>
                    <small>
                      {data.types[s.type]?.label}
                      {s.type === 'proxy' && <> → <span className="mono">{/^\d+$/.test(s.target) ? `Port ${s.target}` : s.target}</span></>}
                      {s.type === 'redirect' && <> → {s.target}</>}
                      {s.type === 'game' && <> → {srv?.name || s.target}</>}
                      {(s.type === 'static' || s.type === 'php') && <> · <span className="mono">{s.root || `/var/www/${s.domain}/public`}</span></>}
                      {s.aliases.length ? ` · +${s.aliases.join(', ')}` : ''}
                    </small>
                  </span>
                  <span className="hx-site-chips">
                    {s.type !== 'game' && <span className={`mcp-chip ${s.ssl === 'none' ? '' : 'ok'}`}><NavIcon name="lock" />{s.ssl === 'none' ? 'HTTP' : s.ssl === 'letsencrypt' ? "Let's Encrypt" : s.ssl === 'auto' ? 'Auto-HTTPS' : 'Zertifikat'}</span>}
                    {d ? <span className={`mcp-chip ${DNS_TONE[d.status]}`} title={d.records.join(', ')}><i />{DNS_LABEL[d.status]}</span> : <span className="mcp-chip">DNS …</span>}
                  </span>
                  <span className="hx-acts">
                    <button type="button" className="btn btn-sm" onClick={() => setGuide(s.id)}><NavIcon name="globe" />DNS</button>
                    {isOwner && <button type="button" className="o-icon-btn" title="Bearbeiten" onClick={() => setEdit(s)}><NavIcon name="cfg" /></button>}
                    {s.type !== 'game' && <button type="button" className="o-icon-btn" title="Konfiguration ansehen" onClick={() => showConfig(s)}><NavIcon name="log" /></button>}
                    {isOwner && s.type !== 'game' && <button type="button" role="switch" aria-checked={s.enabled} title={s.enabled ? 'Deaktivieren' : 'Aktivieren'} className={`switch${s.enabled ? ' on' : ''}`} onClick={() => toggle(s)} />}
                    {isOwner && <button type="button" className="o-icon-btn danger" title="Entfernen" onClick={() => remove(s)}><NavIcon name="trash" /></button>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {data?.foreign?.length > 0 && (
        <section className="hx-sec">
          <h3 className="hx-sec-title">Bestehende Seiten <small>nicht von Orbit verwaltet — nur zur Übersicht</small></h3>
          <div className="card hx-list">
            {data.foreign.filter((f) => f.domains.length).map((f) => (
              <div key={f.file} className="hx-site foreign">
                <span className="hx-site-ico"><NavIcon name="globe" /></span>
                <span className="hx-site-main"><b>{f.domains.join(', ')}</b><small className="mono">{f.webserver} · {f.file}{f.proxies.length ? ` → ${f.proxies.join(', ')}` : ''}</small></span>
                <span className="hx-site-chips">{f.ssl && <span className="mcp-chip ok"><NavIcon name="lock" />HTTPS</span>}</span>
                <span />
              </div>
            ))}
          </div>
        </section>
      )}

      {edit && data && (
        <SiteEditor
          initial={edit}
          data={data}
          servers={servers}
          onClose={() => setEdit(null)}
          onStarted={(j) => { setEdit(null); setJob(j); }}
        />
      )}
      {guide && <DnsGuide id={guide} site={sites.find((s) => s.id === guide)} onClose={() => setGuide(null)} />}
      {cfg && (
        <Modal title={`Konfiguration · ${cfg.site.domain}`} onClose={() => setCfg(null)} wide>
          <pre className="hx-cfg">{cfg.text}</pre>
        </Modal>
      )}
    </Page>
  );
}

function SiteEditor({ initial, data, servers, onClose, onStarted }) {
  const editing = !!initial.id;
  const [type, setType] = useState(initial.type || '');
  const [f, setF] = useState({
    domain: initial.domain || '',
    aliases: (initial.aliases || []).join(', '),
    target: initial.target || '',
    root: initial.root || '',
    ssl: initial.ssl || (data.webserver === 'caddy' ? 'auto' : data.certificates.length ? 'existing' : 'none'),
    cert: initial.cert || '',
    forceHttps: initial.force_https ?? true,
    websocket: initial.websocket ?? true,
    email: data.email || '',
    note: initial.note || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const domain = f.domain.trim().toLowerCase();

  const certOpts = useMemo(() => {
    const match = (c) => c.names.some((n) => n === domain || (n.startsWith('*.') && domain.endsWith(n.slice(1)) && domain.split('.').length === n.split('.').length));
    return [...data.certificates].sort((a, b) => Number(match(b)) - Number(match(a))).map((c) => ({ ...c, match: match(c) }));
  }, [data.certificates, domain]);

  useEffect(() => {
    if (f.ssl === 'existing' && !f.cert && certOpts[0]?.match) set('cert', certOpts[0].id);
  }, [certOpts]); // eslint-disable-line react-hooks/exhaustive-deps

  const panelPort = String(data.panelPort || 40220);
  const gameServers = servers.filter((s) => s.game === 'minecraft' || (s.game === 'fivem' && s.active));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        type, domain, aliases: f.aliases, target: type === 'game' ? f.target : f.target.trim(), root: f.root || null,
        ssl: type === 'game' ? 'none' : f.ssl, cert: f.cert, forceHttps: f.forceHttps, websocket: f.websocket, email: f.email, note: f.note,
        serverKey: type === 'game' ? f.target : null,
      };
      const d = await api(editing ? `/api/host/web/sites/${initial.id}` : '/api/host/web/sites', { method: editing ? 'PUT' : 'POST', body });
      onStarted(d.job);
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  }

  return (
    <Drawer onClose={onClose} label="Domain" width={560}>
      <form className="mcp-form" onSubmit={submit}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>{editing ? domain : 'Domain hinzufügen'}</h2><div className="pp-sub"><span className="muted">{type ? data.types[type].text : 'Was soll unter der Domain laufen?'}</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          {!type ? (
            <div className="hx-types">
              {Object.entries(data.types).map(([id, t]) => {
                const needsWs = id !== 'game' && !data.webserver;
                return (
                  <button key={id} type="button" className="hx-type" disabled={needsWs} onClick={() => setType(id)}>
                    <span className={`hx-site-ico t-${id}`}><NavIcon name={TYPE_ICON[id]} /></span>
                    <span><b>{t.label}</b><small>{needsWs ? 'Zuerst einen Webserver installieren' : t.text}</small></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {!editing && <button type="button" className="mcx-reset hx-back" onClick={() => setType('')}><NavIcon name="collapse" />Anderer Typ</button>}
              <label className="mcp-field"><span>Domain</span><input autoFocus value={f.domain} onChange={(e) => set('domain', e.target.value.replace(/\s/g, ''))} placeholder={type === 'game' ? 'z. B. play.deinserver.de' : 'z. B. shop.deinserver.de'} required /></label>

              {type === 'game' && (
                <label className="mcp-field"><span>Gameserver</span>
                  <select value={f.target} onChange={(e) => set('target', e.target.value)} required>
                    <option value="">— auswählen —</option>
                    {gameServers.map((s) => <option key={s.key} value={s.game === 'fivem' ? 'fivem:active' : s.key}>{s.name} · {s.game === 'minecraft' ? 'Minecraft' : 'FiveM'}</option>)}
                  </select>
                </label>
              )}

              {type === 'proxy' && (
                <>
                  <label className="mcp-field"><span>Ziel</span><input value={f.target} onChange={(e) => set('target', e.target.value.trim())} placeholder="Port (z. B. 3000) oder http://127.0.0.1:8080" required /></label>
                  <div className="hx-quick">
                    <span>Schnellwahl:</span>
                    <button type="button" className="mcp-chip" onClick={() => set('target', panelPort)}>Orbit-Panel ({panelPort})</button>
                    <button type="button" className="mcp-chip" onClick={() => set('target', '3000')}>Node-App (3000)</button>
                    <button type="button" className="mcp-chip" onClick={() => set('target', '8080')}>8080</button>
                  </div>
                  <div className="mcp-toggle-row"><div><b>WebSockets</b><small>Für Live-Apps, Panels und Chats</small></div><button type="button" role="switch" aria-checked={f.websocket} className={`switch${f.websocket ? ' on' : ''}`} onClick={() => set('websocket', !f.websocket)} /></div>
                </>
              )}
              {type === 'redirect' && <label className="mcp-field"><span>Weiterleiten nach</span><input value={f.target} onChange={(e) => set('target', e.target.value.trim())} placeholder="https://www.deinserver.de" required /></label>}
              {(type === 'static' || type === 'php') && (
                <label className="mcp-field"><span>Ordner (optional)</span><input value={f.root} onChange={(e) => set('root', e.target.value.trim())} placeholder={`/var/www/${domain || 'domain'}/public`} /><small className="muted">Leer lassen — Orbit legt den Ordner mit einer Startseite an.</small></label>
              )}
              {type !== 'game' && <label className="mcp-field"><span>Weitere Domains (optional)</span><input value={f.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="z. B. www.deinserver.de" /></label>}

              {type !== 'game' && (
                <div className="hx-ssl">
                  <span className="hx-ssl-label">HTTPS</span>
                  {data.webserver === 'caddy' ? (
                    <div className="seg"><button type="button" className={f.ssl === 'auto' ? 'active' : ''} onClick={() => set('ssl', 'auto')}>Automatisch (Caddy)</button><button type="button" className={f.ssl === 'none' ? 'active' : ''} onClick={() => set('ssl', 'none')}>Nur HTTP</button></div>
                  ) : (
                    <div className="seg">
                      <button type="button" className={f.ssl === 'letsencrypt' ? 'active' : ''} onClick={() => set('ssl', 'letsencrypt')}>Let&apos;s Encrypt</button>
                      <button type="button" className={f.ssl === 'existing' ? 'active' : ''} disabled={!data.certificates.length} onClick={() => set('ssl', 'existing')}>Vorhandenes Zertifikat</button>
                      <button type="button" className={f.ssl === 'none' ? 'active' : ''} onClick={() => set('ssl', 'none')}>Nur HTTP</button>
                    </div>
                  )}
                  {f.ssl === 'letsencrypt' && (
                    <>
                      <label className="mcp-field"><span>E-Mail für Let&apos;s Encrypt</span><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="du@example.com" required /></label>
                      <p className="hx-hint">Die Domain muss vorher auf diesen Server zeigen. Mit Cloudflare: Eintrag anlegen, SSL-Modus „Full“ — Orbit holt das Zertifikat über Port 80.</p>
                    </>
                  )}
                  {f.ssl === 'existing' && (
                    <div className="hx-certs">
                      {certOpts.map((c) => (
                        <label key={c.id} className={`hx-cert${f.cert === c.id ? ' on' : ''}${c.match ? '' : ' nomatch'}`}>
                          <input type="radio" name="cert" checked={f.cert === c.id} onChange={() => set('cert', c.id)} />
                          <span><b>{c.names.slice(0, 3).join(', ')}</b><small>{c.source}{c.expires ? ` · gültig bis ${new Date(c.expires).toLocaleDateString('de-DE')}` : ''}{c.match ? '' : ' · passt nicht zur Domain'}</small></span>
                        </label>
                      ))}
                    </div>
                  )}
                  {f.ssl === 'none' && <p className="hx-hint">Mit Cloudflare-Proxy (orange Wolke) und SSL-Modus „Flexible“ ist die Seite für Besucher trotzdem per HTTPS erreichbar.</p>}
                  {f.ssl !== 'none' && data.webserver !== 'caddy' && <div className="mcp-toggle-row"><div><b>HTTP auf HTTPS umleiten</b></div><button type="button" role="switch" aria-checked={f.forceHttps} className={`switch${f.forceHttps ? ' on' : ''}`} onClick={() => set('forceHttps', !f.forceHttps)} /></div>}
                </div>
              )}
              {type === 'game' && <p className="hx-hint">Für Gameserver ändert Orbit keinen Webserver — du bekommst die passenden DNS-Einträge (inkl. SRV, damit niemand den Port eintippen muss), und die Adresse im Panel nutzt die Domain.</p>}

              <button type="submit" className="btn btn-primary" disabled={busy || !domain}>{busy ? 'Startet…' : editing ? 'Speichern' : 'Einrichten'}</button>
            </>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function DnsGuide({ id, site, onClose }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    api(`/api/host/web/sites/${id}/dns`).then(setD).catch((e) => toast.err(e.message)).finally(() => setBusy(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const st = d?.check?.status;
  return (
    <Modal title={`DNS · ${site?.domain || ''}`} onClose={onClose} wide>
      <div className="hx-dns">
        {d && (
          <div className={`hx-dns-status tone-${DNS_TONE[st]}`}>
            <i />
            <span>
              <b>{DNS_LABEL[st]}</b>
              <small>{d.check.records.length ? `Aktuell: ${d.check.records.join(', ')}` : 'Noch kein A-Record gefunden.'} · Server-IP {d.check.serverIp}{d.check.srv ? ` · SRV → ${d.check.srv.name}:${d.check.srv.port}` : ''}</small>
            </span>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={load}><NavIcon name="refresh" />Erneut prüfen</button>
          </div>
        )}
        {site?.type === 'game' && st === 'cloudflare' && <div className="mcp-note warn"><NavIcon name="bolt" /><span>Die Domain läuft über den Cloudflare-Proxy — damit können Spieler <b>nicht</b> verbinden. Stell die Wolke auf <b>grau (nur DNS)</b>.</span></div>}
        <h4>Bei Cloudflare eintragen <small>DNS → Records → Add record</small></h4>
        <div className="hx-dns-table">
          <div className="hx-dns-row th"><span>Typ</span><span>Name</span><span>Inhalt</span><span>Proxy</span></div>
          {(d?.guide || []).map((r) => (
            <div key={`${r.type}${r.name}`} className="hx-dns-row">
              <span className="mono"><b>{r.type}</b></span>
              <span className="mono hx-dns-cell"><span>{r.name}</span><button type="button" className="o-icon-btn" onClick={() => copy(r.name, 'Name kopiert')}><NavIcon name="copy" /></button></span>
              <span className="mono hx-dns-cell"><span>{r.value}</span><button type="button" className="o-icon-btn" onClick={() => copy(r.value, 'Inhalt kopiert')}><NavIcon name="copy" /></button></span>
              <span><span className={`hx-cloud${r.proxy ? ' on' : ''}`} title={r.proxy ? 'Proxied' : 'DNS only'} />{r.proxy ? 'An' : 'Aus'}</span>
              <small className="hx-dns-note">{r.note}</small>
            </div>
          ))}
        </div>
        {site?.type === 'game' && d?.game?.port && (
          <div className="hx-dns-connect">
            <span>So verbinden Spieler:</span>
            <CopyField value={d.game.game === 'minecraft' ? (d.game.port === 25565 || d.check.srv ? site.domain : `${site.domain}:${d.game.port}`) : `connect ${site.domain}:${d.game.port}`} />
          </div>
        )}
        <p className="hx-hint">Bei SRV-Records fragt Cloudflare nach Service (<span className="mono">_minecraft</span>), Protokoll (<span className="mono">TCP</span>), Name, Priorität (0), Gewicht (5), Port und Ziel. DNS-Änderungen sind meist nach wenigen Minuten aktiv.</p>
      </div>
    </Modal>
  );
}
