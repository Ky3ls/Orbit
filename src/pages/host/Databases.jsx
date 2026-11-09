import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import Drawer from '../../components/Drawer.jsx';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty, Modal, Page, PageHeader } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { CopyField, JobLog, SVC_LABEL, SVC_TONE, ServiceButtons, fmtBytes, useJob } from './hostShared.jsx';
import './host.css';

const ENGINE_ICON = { mysql: 'db', postgresql: 'layers', redis: 'bolt' };
const ENGINE_COLOR = { mysql: '#00a3e0', postgresql: '#6b8cce', redis: '#e5483f' };

export default function Databases() {
  const { user, servers = [] } = useOutletContext();
  const isOwner = user.role === 'owner';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [engines, setEngines] = useState(null);
  const [sel, setSel] = useState(params.get('engine') || 'mysql');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [creds, setCreds] = useState(null);
  const [variant, setVariant] = useState('mariadb');
  const [job, setJob] = useJob((j) => {
    if (j.error) toast.err('Installation fehlgeschlagen', { text: j.error.split('\n')[0] });
    else {
      toast.ok(`${j.label.replace(' installieren', '')} ist bereit`);
      if (j.result?.password) setCreds({ title: 'Redis ist bereit', engine: 'redis', password: j.result.password, connection: [{ label: 'URL', value: `redis://:${j.result.password}@127.0.0.1:6379` }] });
    }
    loadEngines();
    load();
  });

  const loadEngines = useCallback(() => {
    api('/api/host/db').then((d) => setEngines(d.engines)).catch((e) => setErr(e.message));
  }, []);
  const load = useCallback(() => {
    setErr('');
    api(`/api/host/db/${sel}`).then(setData).catch((e) => setErr(e.message));
  }, [sel]);

  useEffect(() => { loadEngines(); }, [loadEngines]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { if (params.get('engine') !== sel) setParams({ engine: sel }, { replace: true }); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const eng = engines?.find((e) => e.id === sel);

  async function install() {
    try {
      const d = await api(`/api/host/db/${sel}/install`, { method: 'POST', body: { variant: sel === 'mysql' ? variant : undefined } });
      setJob(d.job);
    } catch (e) { toast.err(e.message); }
  }

  async function drop(d) {
    const typed = window.prompt(`Datenbank „${d.name}“ endgültig löschen — inklusive aller Tabellen und des Benutzers ${d.meta?.user}?\n\nZum Bestätigen den Namen eingeben:`);
    if (typed !== d.name) { if (typed !== null) toast.err('Name stimmt nicht — nichts gelöscht.'); return; }
    try {
      await api(`/api/host/db/${sel}/${encodeURIComponent(d.name)}`, { method: 'DELETE' });
      toast.ok(`${d.name} gelöscht`);
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function newPassword(d) {
    if (!window.confirm(`Neues Passwort für ${d.meta?.user || 'Redis'} erzeugen? Apps mit dem alten Passwort verlieren die Verbindung, bis du es dort einträgst.`)) return;
    try {
      const out = await api(`/api/host/db/${sel}/${encodeURIComponent(d?.name || 'default')}/password`, { method: 'POST', body: {} });
      setCreds({ title: 'Neues Passwort', engine: sel, name: d?.name, user: d?.meta?.user, password: out.password, connection: out.connection });
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function toggleRemote(d) {
    const on = !d.meta?.remote;
    if (on && !window.confirm('Externen Zugriff für diese Datenbank erlauben? Dafür wird ein neues Passwort erzeugt. Zusätzlich muss „Von außen erreichbar“ für MySQL an sein.')) return;
    try {
      const out = await api(`/api/host/db/mysql/${encodeURIComponent(d.name)}/remote`, { method: 'POST', body: { on } });
      if (out.password) setCreds({ title: 'Externer Zugriff aktiv', engine: 'mysql', name: d.name, user: d.meta.user, password: out.password, connection: out.connection });
      else toast.ok('Externer Zugriff entfernt');
      load();
    } catch (e) { toast.err(e.message); }
  }

  async function toggleExternal() {
    const on = !data?.external;
    if (!window.confirm(on
      ? 'MySQL von außen erreichbar machen (Port 3306 auf allen Adressen)? MySQL wird dafür neu gestartet. Nur Benutzer mit „Extern“ dürfen sich von außen anmelden — sichere den Port zusätzlich per Firewall ab.'
      : 'MySQL wieder nur lokal erreichbar machen? MySQL wird neu gestartet.')) return;
    try {
      await api('/api/host/db/mysql/external', { method: 'PUT', body: { on } });
      toast.ok(on ? 'MySQL lauscht jetzt auf allen Adressen' : 'MySQL lauscht wieder nur lokal');
      load();
    } catch (e) { toast.err(e.message); }
  }

  return (
    <Page className="hx-page">
      <PageHeader
        eyebrow="Host"
        title="Datenbanken"
        description="Datenbank-Server installieren, Datenbanken mit eigenem Benutzer anlegen und Zugangsdaten für Websites, Gameserver und Bots holen."
        actions={isOwner && eng?.installed && sel !== 'redis' ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><NavIcon name="plus" />Neue Datenbank</button> : null}
      />

      <div className="hx-engines">
        {(engines || []).map((e) => (
          <button key={e.id} type="button" className={`hx-engine card${sel === e.id ? ' active' : ''} tone-${e.installed ? SVC_TONE(e.service) : 'idle'}`} style={{ '--eng': ENGINE_COLOR[e.id] }} onClick={() => setSel(e.id)}>
            <span className="hx-engine-ico"><NavIcon name={ENGINE_ICON[e.id]} /></span>
            <span className="hx-engine-text">
              <b>{e.installed ? (e.variant === 'mariadb' ? 'MariaDB' : e.id === 'mysql' ? 'MySQL' : e.label) : e.label}</b>
              <small>{e.installed ? `${SVC_LABEL(e.service)}${e.service?.version ? ` · ${e.service.version}` : ''}` : 'Nicht installiert'}</small>
            </span>
            <i className="hx-dot" />
          </button>
        ))}
        {!engines && <div className="mcx-loading">Lade…</div>}
      </div>

      {job && <JobLog job={job} onClose={() => setJob(null)} />}

      {eng && !eng.installed && (
        <section className="card hx-install">
          <span className="hx-install-ico" style={{ '--eng': ENGINE_COLOR[sel] }}><NavIcon name={ENGINE_ICON[sel]} /></span>
          <div className="hx-install-text">
            <h3>{eng.label} installieren</h3>
            <p>Gut für: {eng.uses}. Orbit installiert das Paket, startet den Dienst und lässt ihn nur lokal lauschen{sel === 'redis' ? ' — mit Passwort' : ''}.</p>
            {sel === 'mysql' && (
              <div className="seg hx-variant">
                {eng.variants.map((v) => <button key={v.id} type="button" className={variant === v.id ? 'active' : ''} onClick={() => setVariant(v.id)}>{v.label}</button>)}
              </div>
            )}
          </div>
          {isOwner ? <button type="button" className="btn btn-primary" disabled={!!job && !job.done} onClick={install}><NavIcon name="download" />Installieren</button> : <span className="muted">Nur der Inhaber kann installieren.</span>}
        </section>
      )}

      {eng?.installed && (
        <section className="card hx-svcbar">
          <span className={`mcx-state tone-${SVC_TONE(eng.service)}`}><i />{SVC_LABEL(eng.service)}</span>
          <span className="hx-svcbar-facts">
            <span>Port <b className="mono">{eng.port}</b></span>
            {data?.bind && <span>Erreichbar <b>{data.bind === '127.0.0.1' || data.bind === 'localhost' ? 'nur lokal' : `auf ${data.bind}`}</b></span>}
            {data?.redis && <span>Speicher <b>{fmtBytes(data.redis.memory)}</b></span>}
            {data?.redis && <span>Verbindungen <b>{data.redis.clients}</b></span>}
            {data?.redis && <span>Passwort <b>{data.redis.auth ? 'aktiv' : 'keins'}</b></span>}
          </span>
          {isOwner && sel === 'mysql' && <button type="button" className={`btn btn-sm${data?.external ? ' hx-warnbtn' : ''}`} onClick={toggleExternal}><NavIcon name="globe" />{data?.external ? 'Von außen erreichbar' : 'Nur lokal'}</button>}
          {isOwner && sel === 'redis' && <button type="button" className="btn btn-sm" onClick={() => newPassword(null)}><NavIcon name="lock" />Neues Passwort</button>}
          {isOwner && <ServiceButtons svc={{ ...eng.service, id: eng.variant === 'mariadb' ? 'mariadb' : eng.id === 'mysql' ? 'mysql' : eng.id, label: eng.label }} onDone={() => { loadEngines(); load(); }} />}
        </section>
      )}

      {err && <div className="err">{err}</div>}

      {eng?.installed && data && !data.stopped && (
        data.databases.length === 0 ? (
          <div className="card mm-empty"><Empty title={sel === 'redis' ? 'Noch keine Schlüssel' : 'Noch keine Datenbanken'} text={sel === 'redis' ? 'Redis ist bereit — Apps legen ihre Daten selbst an.' : 'Lege die erste Datenbank mit eigenem Benutzer an.'} /></div>
        ) : (
          <div className="card hx-list">
            <div className="hx-row hx-th"><span>Datenbank</span><span>Größe</span><span>Benutzer</span><span>Verknüpft</span><span /></div>
            {data.databases.map((d) => {
              const linked = servers.find((s) => s.key === d.meta?.server_key);
              return (
                <div key={d.name} className={`hx-row${d.managed ? '' : ' foreign'}${sel === 'mysql' && isOwner ? ' clickable' : ''}`} onClick={(e) => { if (sel === 'mysql' && isOwner && !e.target.closest('button, a')) navigate(`/host/databases/mysql/${encodeURIComponent(d.name)}`); }}>
                  <span className="hx-name">
                    <span className="hx-name-ico" style={{ '--eng': ENGINE_COLOR[sel] }}><NavIcon name={ENGINE_ICON[sel]} /></span>
                    <span><b className="mono">{d.name}</b><small>{d.managed ? (d.meta?.note || 'Von Orbit angelegt') : 'Bestehend — nur lesend'}{d.meta?.remote ? ' · extern erreichbar' : ''}</small></span>
                  </span>
                  <span className="hx-num">{d.keys != null ? `${d.keys} Schlüssel` : fmtBytes(d.size)}{d.tables != null ? <small> · {d.tables} Tabellen</small> : null}</span>
                  <span className="hx-users">{d.users?.length ? d.users.slice(0, 2).map((u) => <span key={u} className="mono">{u}</span>) : <span className="muted">—</span>}{d.users?.length > 2 ? <span className="muted">+{d.users.length - 2}</span> : null}</span>
                  <span>{linked ? <span className="hx-linked"><GameMark game={linked.game} size={18} />{linked.name}</span> : <span className="muted">—</span>}</span>
                  <span className="hx-acts">
                    {sel === 'mysql' && isOwner && <Link className="btn btn-sm btn-primary" to={`/host/databases/mysql/${encodeURIComponent(d.name)}`}><NavIcon name="term" />Öffnen</Link>}
                    {sel !== 'redis' && isOwner && <a className="o-icon-btn" title="Als SQL exportieren" href={`/api/host/db/${sel}/${encodeURIComponent(d.name)}/dump`}><NavIcon name="download" /></a>}
                    {d.managed && isOwner && (
                      <>
                        {sel === 'mysql' && <button type="button" className={`o-icon-btn${d.meta?.remote ? ' on' : ''}`} title={d.meta?.remote ? 'Externen Zugriff entfernen' : 'Externen Zugriff erlauben'} onClick={() => toggleRemote(d)}><NavIcon name="globe" /></button>}
                        <button type="button" className="btn btn-sm" onClick={() => newPassword(d)}><NavIcon name="lock" />Zugang</button>
                        <button type="button" className="o-icon-btn danger" title="Löschen" onClick={() => drop(d)}><NavIcon name="trash" /></button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}
      {data?.stopped && <div className="card mm-empty"><Empty title="Dienst ist gestoppt" text="Starte ihn, um die Datenbanken zu sehen." /></div>}

      {creating && <CreateDb engine={sel} servers={servers} onClose={() => setCreating(false)} onCreated={(out) => { setCreating(false); setCreds({ title: 'Datenbank angelegt', engine: sel, ...out }); load(); }} />}
      {creds && <CredsModal creds={creds} onClose={() => setCreds(null)} />}
    </Page>
  );
}

function CreateDb({ engine, servers, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [userName, setUserName] = useState('');
  const [custom, setCustom] = useState(false);
  const [password, setPassword] = useState('');
  const [remote, setRemote] = useState(false);
  const [serverKey, setServerKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = (s) => s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z]+/, '').slice(0, 48);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api(`/api/host/db/${engine}`, { method: 'POST', body: { name, user: userName || name, password: custom ? password : undefined, remote, serverKey: serverKey || null, note } });
      toast.ok(`${out.name} angelegt`);
      onCreated(out);
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  }

  return (
    <Drawer onClose={onClose} label="Neue Datenbank" width={480}>
      <form className="mcp-form" onSubmit={submit}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Neue Datenbank</h2><div className="pp-sub"><span className="muted">{engine === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'} · eigener Benutzer mit vollen Rechten nur auf diese Datenbank</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          <label className="mcp-field"><span>Name</span><input autoFocus value={name} onChange={(e) => setName(clean(e.target.value))} placeholder="z. B. website, luckperms, fivem_rp" required /></label>
          <label className="mcp-field"><span>Benutzer</span><input value={userName} onChange={(e) => setUserName(clean(e.target.value))} placeholder={name || 'wie der Name'} /></label>
          <div className="mcp-toggle-row"><div><b>Eigenes Passwort</b><small>Sonst erzeugt Orbit ein sicheres (24 Zeichen)</small></div><button type="button" role="switch" aria-checked={custom} className={`switch${custom ? ' on' : ''}`} onClick={() => setCustom(!custom)} /></div>
          {custom && <label className="mcp-field"><span>Passwort</span><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} placeholder="mind. 10 Zeichen, keine Anführungszeichen" /></label>}
          {engine === 'mysql' && <div className="mcp-toggle-row"><div><b>Externer Zugriff</b><small>Benutzer darf sich auch von anderen Rechnern anmelden (z. B. HeidiSQL)</small></div><button type="button" role="switch" aria-checked={remote} className={`switch${remote ? ' on' : ''}`} onClick={() => setRemote(!remote)} /></div>}
          <label className="mcp-field"><span>Gehört zu (optional)</span>
            <select value={serverKey} onChange={(e) => setServerKey(e.target.value)}>
              <option value="">— kein Server —</option>
              {servers.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.game})</option>)}
            </select>
          </label>
          <label className="mcp-field"><span>Notiz (optional)</span><input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="z. B. WordPress Shop" /></label>
          <button type="submit" className="btn btn-primary" disabled={busy || !name}>{busy ? 'Wird angelegt…' : 'Datenbank anlegen'}</button>
        </div>
      </form>
    </Drawer>
  );
}

function CredsModal({ creds, onClose }) {
  return (
    <Modal title={creds.title} onClose={onClose} wide>
      <div className="hx-creds">
        <div className="mcp-note warn"><NavIcon name="lock" /><span>Das Passwort wird <b>nur jetzt</b> angezeigt — kopiere es in deine App. Vergessen? Einfach ein neues erzeugen.</span></div>
        <div className="hx-creds-grid">
          {creds.name && <CopyField label="Datenbank" value={creds.name} />}
          {creds.user && <CopyField label="Benutzer" value={creds.user} />}
          <CopyField label="Passwort" value={creds.password} secret />
          <CopyField label="Host" value="127.0.0.1" />
        </div>
        {(creds.connection || []).map((c) => <CopyField key={c.label} label={c.label} value={c.value} multiline={c.value.includes('\n')} />)}
        <div className="hx-creds-foot"><button type="button" className="btn btn-primary" onClick={onClose}>Erledigt</button></div>
      </div>
    </Modal>
  );
}
