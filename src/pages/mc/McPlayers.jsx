import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import Drawer from '../../components/Drawer.jsx';
import { toast } from '../../components/toast.jsx';
import { Empty } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import {
  DIM, GM, ItemIcon, McBody, McHead, advTitle, fmtAgo, fmtDate, fmtNum, fmtTicks, itemName, langName, roman, useCatalog,
} from './mcItems.jsx';
import './mcplayers.css';

const FILTERS = [
  { id: 'all', label: 'Alle' },
  { id: 'online', label: 'Online' },
  { id: 'op', label: 'OPs' },
  { id: 'wl', label: 'Whitelist' },
  { id: 'banned', label: 'Gebannt' },
];

async function act(inst, body, okText) {
  const d = await api(`/api/mc/instances/${inst.id}/players/action`, { method: 'POST', body });
  if (okText) toast.ok(okText, { text: d.output ? d.output.slice(0, 140) : d.viaFile ? 'Direkt in die Datei geschrieben — Server ist aus.' : undefined });
  return d;
}

/* ═══ Spieler-Tab ═══ */
export default function McPlayers({ inst }) {
  const cat = useCatalog(inst.mcVersion);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [bc, setBc] = useState(false);
  const [loadErr, setLoadErr] = useState(null);

  const load = useCallback(() => {
    api(`/api/mc/instances/${inst.id}/players`).then((d) => { setData(d); setLoadErr(null); }).catch((e) => setLoadErr(e.message || 'Anfrage fehlgeschlagen'));
  }, [inst.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const players = data?.players || [];
  const counts = useMemo(() => ({
    all: players.length,
    online: players.filter((p) => p.online).length,
    op: players.filter((p) => p.op).length,
    wl: players.filter((p) => p.whitelisted).length,
    banned: players.filter((p) => p.banned).length,
  }), [players]);
  const shown = players.filter((p) => {
    if (filter === 'online' && !p.online) return false;
    if (filter === 'op' && !p.op) return false;
    if (filter === 'wl' && !p.whitelisted) return false;
    if (filter === 'banned' && !p.banned) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase()) && !p.uuid.startsWith(q.toLowerCase())) return false;
    return true;
  });

  if (!data && loadErr) {
    return (
      <div className="card mm-empty">
        <Empty title="Spieler konnten nicht geladen werden" text={loadErr} />
        <div className="mcp-retry"><button type="button" className="btn btn-sm" onClick={load}><NavIcon name="refresh" />Erneut versuchen</button></div>
      </div>
    );
  }
  if (!data) return <div className="mcx-loading">Lädt Spieler…</div>;

  const toggleWl = async () => {
    try { await act(inst, { action: data.whitelist ? 'whitelist-off' : 'whitelist-on' }, data.whitelist ? 'Whitelist ausgeschaltet' : 'Whitelist eingeschaltet'); load(); } catch (e) { toast.err(e.message); }
  };

  return (
    <div className="mcp">
      {data.running && !data.live && (
        <div className="mcp-note">
          <NavIcon name="bolt" />
          <span><b>Live-Daten nach einem Neustart.</b> Orbit hat RCON eingerichtet, das greift ab dem nächsten Start. Danach siehst du alle Online-Spieler und Inventare in Echtzeit und kannst sie live bearbeiten. Kick, Bann, OP und Whitelist gehen schon jetzt.</span>
        </div>
      )}

      <div className="mcp-tiles">
        <button type="button" className={`mcp-tile tone-ok${filter === 'online' ? ' active' : ''}`} onClick={() => setFilter(filter === 'online' ? 'all' : 'online')}>
          <span className="mcp-tile-ico"><NavIcon name="signal" /></span>
          <span><b>{data.online}<small> / {data.max}</small></b><em>{data.running ? 'Online' : 'Server aus'}</em></span>
        </button>
        <button type="button" className={`mcp-tile tone-accent${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          <span className="mcp-tile-ico"><NavIcon name="users" /></span>
          <span><b>{counts.all}</b><em>Spieler bekannt</em></span>
        </button>
        <div className={`mcp-tile tone-info${filter === 'wl' ? ' active' : ''}`}>
          <button type="button" className="mcp-tile-main" onClick={() => setFilter(filter === 'wl' ? 'all' : 'wl')}>
            <span className="mcp-tile-ico"><NavIcon name="wl" /></span>
            <span><b>{counts.wl}</b><em>Whitelist {data.whitelist ? 'aktiv' : 'aus'}</em></span>
          </button>
          <button type="button" role="switch" aria-checked={data.whitelist} aria-label="Whitelist" className={`switch${data.whitelist ? ' on' : ''}`} onClick={toggleWl} />
        </div>
        <button type="button" className={`mcp-tile tone-warn${filter === 'op' ? ' active' : ''}`} onClick={() => setFilter(filter === 'op' ? 'all' : 'op')}>
          <span className="mcp-tile-ico"><NavIcon name="crown" /></span>
          <span><b>{counts.op}</b><em>Operatoren</em></span>
        </button>
        <button type="button" className={`mcp-tile tone-bad${filter === 'banned' ? ' active' : ''}`} onClick={() => setFilter(filter === 'banned' ? 'all' : 'banned')}>
          <span className="mcp-tile-ico"><NavIcon name="ban" /></span>
          <span><b>{counts.banned + data.ipBans.length}</b><em>Gebannt{data.ipBans.length ? ` · ${data.ipBans.length} IP` : ''}</em></span>
        </button>
      </div>

      <div className="mm-bar">
        <div className="lg-search"><NavIcon name="search" /><input placeholder="Name oder UUID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
              {f.label}{counts[f.id] ? <span className="seg-n">{counts[f.id]}</span> : null}
            </button>
          ))}
        </div>
        <span className="grow" />
        {data.running && <button type="button" className="btn btn-sm" onClick={() => setBc(true)}><NavIcon name="megaphone" />Nachricht an alle</button>}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><NavIcon name="plus" />Spieler hinzufügen</button>
      </div>

      {shown.length === 0 ? (
        <div className="card mm-empty">
          <Empty
            title={players.length ? 'Keine Treffer' : 'Noch keine Spieler'}
            text={players.length ? 'Filter oder Suche anpassen.' : `Sobald jemand joint, erscheint er hier. Adresse: ${inst.address || ''}`}
          />
        </div>
      ) : (
        <div className="mcp-list card">
          <div className="mcp-row mcp-th"><span>Spieler</span><span>Status</span><span>Spielzeit</span><span>K / T</span><span>Zuletzt</span><span /></div>
          {shown.map((p) => (
            <div key={p.uuid} className={`mcp-row${p.online ? ' on' : ''}${p.banned ? ' banned' : ''}`} role="button" tabIndex={0} onClick={() => setSel(p.uuid)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(p.uuid); }}>
              <span className="mcp-who">
                <McHead uuid={p.uuid} name={p.name} ver={inst.mcVersion} size={36} className={p.online ? 'on' : ''} />
                <span><b>{p.name}</b><small className="mono">{p.uuid.slice(0, 8)}…</small></span>
              </span>
              <span className="mcp-chips">
                {p.online ? <span className="mcp-chip ok"><i />Online</span> : null}
                {p.op ? <span className="mcp-chip warn"><NavIcon name="crown" />OP {p.op}</span> : null}
                {p.whitelisted ? <span className="mcp-chip info"><NavIcon name="wl" />Whitelist</span> : null}
                {p.banned ? <span className="mcp-chip bad"><NavIcon name="ban" />Gebannt</span> : null}
                {!p.online && !p.op && !p.whitelisted && !p.banned ? <span className="muted">—</span> : null}
              </span>
              <span className="mcp-num">{p.playTicks ? fmtTicks(p.playTicks) : '—'}</span>
              <span className="mcp-num">{fmtNum(p.mobKills + p.playerKills)} <span className="muted">/ {fmtNum(p.deaths)}</span></span>
              <span className="mcp-num muted">{p.online ? 'jetzt' : fmtAgo(p.lastSeen)}</span>
              <span className="mcp-quick" onClick={(e) => e.stopPropagation()} role="presentation">
                {p.online && (
                  <button type="button" className="o-icon-btn" title="Kicken" onClick={async () => {
                    const reason = window.prompt(`${p.name} kicken — Grund (optional):`, '');
                    if (reason === null) return;
                    try { await act(inst, { action: 'kick', name: p.name, reason }, `${p.name} gekickt`); load(); } catch (err) { toast.err(err.message); }
                  }}><NavIcon name="door" /></button>
                )}
                <button type="button" className="o-icon-btn" title="Details"><NavIcon name="chevron" /></button>
              </span>
            </div>
          ))}
        </div>
      )}

      {data.ipBans.length > 0 && (
        <section className="sx-card">
          <header className="sx-card-head"><div><h3>Gebannte IPs</h3><p>Diese Adressen können nicht joinen, egal mit welchem Account.</p></div></header>
          <div className="sx-card-body">
            {data.ipBans.map((b) => (
              <div key={b.ip} className="sx-row">
                <div className="sx-row-text"><b className="mono">{b.ip}</b><span>{b.reason || 'Kein Grund'} · {b.source} · {fmtDate(b.created)}</span></div>
                <div className="sx-row-ctl"><button type="button" className="btn btn-sm" onClick={async () => { try { await act(inst, { action: 'pardon-ip', ip: b.ip }, `${b.ip} entbannt`); load(); } catch (e) { toast.err(e.message); } }}>Entbannen</button></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {adding && <AddPlayer inst={inst} onClose={() => setAdding(false)} onDone={load} />}
      {bc && <Broadcast inst={inst} onClose={() => setBc(false)} />}
      {sel && <PlayerDrawer inst={inst} cat={cat} uuid={sel} online={data.players.filter((p) => p.online)} onClose={() => setSel(null)} onChange={load} />}
    </div>
  );
}

/* ── Spieler hinzufügen ── */
function AddPlayer({ inst, onClose, onDone }) {
  const [name, setName] = useState('');
  const [wl, setWl] = useState(true);
  const [op, setOp] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (wl) await act(inst, { action: 'whitelist-add', name: name.trim() });
      if (op) await act(inst, { action: 'op', name: name.trim() });
      toast.ok(`${name} hinzugefügt`, { text: [wl && 'Whitelist', op && 'Operator'].filter(Boolean).join(' + ') });
      setTimeout(onDone, 600);
      onClose();
    } catch (err) { toast.err(err.message); }
    setBusy(false);
  }
  return (
    <Drawer onClose={onClose} label="Spieler hinzufügen" width={460}>
      <form className="mcp-form" onSubmit={submit}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Spieler hinzufügen</h2><div className="pp-sub"><span className="muted">Minecraft-Name, die UUID holt Orbit bei Mojang</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          <label className="mcp-field"><span>Spielername</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Ky3ls" maxLength={16} pattern="[A-Za-z0-9_]{1,16}" required /></label>
          <div className="mcp-toggle-row"><div><b>Auf die Whitelist</b><small>Darf joinen, wenn die Whitelist aktiv ist</small></div><button type="button" role="switch" aria-checked={wl} className={`switch${wl ? ' on' : ''}`} onClick={() => setWl(!wl)} /></div>
          <div className="mcp-toggle-row"><div><b>Operator (OP)</b><small>Volle Admin-Rechte im Spiel, alle Befehle</small></div><button type="button" role="switch" aria-checked={op} className={`switch${op ? ' on' : ''}`} onClick={() => setOp(!op)} /></div>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || (!wl && !op)}>{busy ? 'Wird hinzugefügt…' : 'Hinzufügen'}</button>
        </div>
      </form>
    </Drawer>
  );
}

function Broadcast({ inst, onClose }) {
  const [msg, setMsg] = useState('');
  return (
    <Drawer onClose={onClose} label="Nachricht an alle" width={460}>
      <form className="mcp-form" onSubmit={async (e) => { e.preventDefault(); try { await act(inst, { action: 'broadcast', message: msg }, 'Nachricht gesendet'); onClose(); } catch (err) { toast.err(err.message); } }}>
        <header className="pp-head"><div className="pp-top"><div className="pp-title"><h2>Nachricht an alle</h2><div className="pp-sub"><span className="muted">Erscheint im Chat als [Server]</span></div></div><button type="button" className="pp-close" onClick={onClose}><NavIcon name="x" /></button></div></header>
        <div className="pp-scroll">
          <label className="mcp-field"><span>Nachricht</span><textarea rows={3} autoFocus value={msg} maxLength={240} onChange={(e) => setMsg(e.target.value)} placeholder="Server-Neustart in 5 Minuten!" /></label>
          <button type="submit" className="btn btn-primary" disabled={!msg.trim()}><NavIcon name="megaphone" />Senden</button>
        </div>
      </form>
    </Drawer>
  );
}

/* ═══ Spieler-Detail ═══ */
const DTABS = [
  { id: 'overview', label: 'Übersicht', icon: 'dashboard' },
  { id: 'inventory', label: 'Inventar', icon: 'box' },
  { id: 'stats', label: 'Statistiken', icon: 'chart' },
  { id: 'adv', label: 'Erfolge', icon: 'trophy' },
  { id: 'actions', label: 'Aktionen', icon: 'bolt' },
];

function PlayerDrawer({ inst, cat, uuid, online, onClose, onChange }) {
  const [p, setP] = useState(null);
  const [tab, setTab] = useState('overview');
  const [err, setErr] = useState(null);
  const load = useCallback(() => {
    api(`/api/mc/instances/${inst.id}/players/${uuid}`).then((d) => { setP(d.player); setErr(null); }).catch((e) => setErr(e.message));
  }, [inst.id, uuid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!p?.online) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [p?.online, load]);

  const run = async (body, okText) => {
    try {
      await act(inst, { name: p.name, uuid: p.uuid, ...body }, okText);
      setTimeout(() => { load(); onChange(); }, 500);
    } catch (e) { toast.err(e.message); }
  };

  return (
    <Drawer onClose={onClose} label="Spieler" width={760}>
      {!p ? <div className="mcx-loading">{err || 'Lädt…'}</div> : (
        <>
          <header className="pp-head mcp-dhead">
            <div className="pp-top">
              <McHead uuid={p.uuid} name={p.name} ver={inst.mcVersion} size={56} className={p.online ? 'on' : ''} />
              <div className="pp-title">
                <h2>{p.name}</h2>
                <div className="pp-sub">
                  <span className={`pp-state${p.online ? ' on' : ''}`}><i />{p.online ? 'Online' : `Zuletzt ${fmtAgo(p.lastSeen)}`}</span>
                  {p.op ? <span className="mcp-chip warn"><NavIcon name="crown" />OP {p.op}</span> : null}
                  {p.whitelisted ? <span className="mcp-chip info"><NavIcon name="wl" />Whitelist</span> : null}
                  {p.banned ? <span className="mcp-chip bad"><NavIcon name="ban" />Gebannt</span> : null}
                  {p.data ? <span className="mcp-chip"><NavIcon name="gamepad" />{GM[p.data.gamemode]}</span> : null}
                </div>
              </div>
              <button type="button" className="pp-close" onClick={onClose} aria-label="Schließen"><NavIcon name="x" /></button>
            </div>
            <div className="pp-actions">
              {p.online && <button type="button" className="btn btn-sm" onClick={() => { const r = window.prompt('Grund (optional):', ''); if (r !== null) run({ action: 'kick', reason: r }, `${p.name} gekickt`); }}><NavIcon name="door" />Kicken</button>}
              {p.banned
                ? <button type="button" className="btn btn-sm pp-on" onClick={() => run({ action: 'pardon' }, `${p.name} entbannt`)}><NavIcon name="ban" />Entbannen</button>
                : <button type="button" className="btn btn-sm btn-danger" onClick={() => { const r = window.prompt(`${p.name} bannen — Grund:`, ''); if (r !== null) run({ action: 'ban', reason: r }, `${p.name} gebannt`); }}><NavIcon name="ban" />Bannen</button>}
              <button type="button" className={`btn btn-sm${p.op ? ' pp-on' : ''}`} onClick={() => run({ action: p.op ? 'deop' : 'op' }, p.op ? 'OP entzogen' : `${p.name} ist jetzt OP`)}><NavIcon name="crown" />{p.op ? 'OP entziehen' : 'OP geben'}</button>
              <button type="button" className={`btn btn-sm${p.whitelisted ? ' pp-on' : ''}`} onClick={() => run({ action: p.whitelisted ? 'whitelist-remove' : 'whitelist-add' }, p.whitelisted ? 'Von der Whitelist entfernt' : 'Auf die Whitelist gesetzt')}><NavIcon name="wl" />{p.whitelisted ? 'Whitelist ✓' : 'Whitelist'}</button>
            </div>
            {p.banned && (
              <div className="pp-ban">
                <span className="pp-ban-ico"><NavIcon name="ban" /></span>
                <div className="pp-ban-text"><b>Gebannt</b><p>{p.banned.reason || 'Kein Grund angegeben'}</p><small>von {p.banned.source || '—'} · {fmtDate(p.banned.created)}{p.banned.expires ? ` · bis ${fmtDate(p.banned.expires)}` : ' · dauerhaft'}</small></div>
              </div>
            )}
          </header>
          <div className="pp-tabs mcp-dtabs" role="tablist">
            {DTABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                <NavIcon name={t.icon} />{t.label}
                {t.id === 'adv' && p.advancements ? <span className="pp-tab-n">{p.advancements}</span> : null}
              </button>
            ))}
          </div>
          <div className="pp-scroll">
            {tab === 'overview' && <Overview inst={inst} cat={cat} p={p} />}
            {tab === 'inventory' && <Inventory inst={inst} cat={cat} p={p} reload={load} />}
            {tab === 'stats' && <Stats cat={cat} p={p} />}
            {tab === 'adv' && <Advancements cat={cat} p={p} />}
            {tab === 'actions' && <Actions inst={inst} cat={cat} p={p} online={online} run={run} />}
          </div>
        </>
      )}
    </Drawer>
  );
}

function Bar({ value, max, tone, icon, label, text }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={`mcp-bar tone-${tone}`}>
      <div className="mcp-bar-top"><span><NavIcon name={icon} />{label}</span><b>{text ?? `${value} / ${max}`}</b></div>
      <div className="mcp-bar-track"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function copy(text, label) {
  navigator.clipboard?.writeText(text).then(() => toast.ok(`${label} kopiert`, { text }));
}

function Overview({ inst, cat, p }) {
  const d = p.data;
  const s = p.stats?.summary;
  const kd = s ? (s.deaths ? (s.mobKills + s.playerKills) / s.deaths : s.mobKills + s.playerKills) : 0;
  return (
    <>
      <div className="mcp-ov">
        <div className="mcp-ov-body">
          <McBody uuid={p.uuid} ver={inst.mcVersion} scale={7} />
          {p.source === 'live' && <span className="mcp-live"><i />Live</span>}
        </div>
        <div className="mcp-ov-main">
          {d ? (
            <>
              <Bar icon="heart" label="Leben" tone="bad" value={d.health} max={d.maxHealth} text={`${d.health} / ${d.maxHealth}${d.absorption ? ` +${Math.round(d.absorption)}` : ''}`} />
              <Bar icon="drop" label="Hunger" tone="warn" value={d.food} max={20} text={`${d.food} / 20 · Sättigung ${d.saturation}`} />
              <Bar icon="sparkle" label="Erfahrung" tone="ok" value={d.xpP * 100} max={100} text={`Level ${d.xpLevel} · ${Math.round(d.xpP * 100)} %`} />
              <dl className="mcp-kv">
                <div><dt>Spielmodus</dt><dd>{GM[d.gamemode]}{d.flying ? ' · fliegt' : ''}</dd></div>
                <div><dt>Dimension</dt><dd>{DIM[d.dimension] || d.dimension}</dd></div>
                <div className="wide">
                  <dt>Position</dt>
                  <dd className="mono">
                    {d.pos.map((n) => Math.round(n)).join(' · ')}
                    <button type="button" className="o-icon-btn" title="Teleport-Befehl kopieren" onClick={() => copy(`/execute in ${d.dimension} run tp @s ${d.pos.join(' ')}`, 'Teleport-Befehl')}><NavIcon name="copy" /></button>
                  </dd>
                </div>
                {d.respawn && <div className="wide"><dt>Spawnpunkt</dt><dd className="mono">{(d.respawn.pos || []).join(' · ')} <span className="muted">{DIM[d.respawn.dimension] || ''}</span></dd></div>}
                {d.lastDeath && <div className="wide"><dt>Letzter Tod</dt><dd className="mono">{(d.lastDeath.pos || []).join(' · ')} <span className="muted">{DIM[d.lastDeath.dimension] || ''}</span></dd></div>}
              </dl>
              {d.effects.length > 0 && (
                <div className="mcp-effects">
                  {d.effects.map((e) => (
                    <span key={e.id} className="mcp-effect">
                      <img src={`/api/mc/assets/${encodeURIComponent(inst.mcVersion)}/tex?p=${encodeURIComponent(`mob_effect/${e.id.replace(/^minecraft:/, '')}`)}`} alt="" onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />
                      {langName(cat, 'effect', e.id)} {roman(e.amp + 1)}
                      <small>{e.dur < 0 ? '∞' : `${Math.floor(e.dur / 20 / 60)}:${String(Math.floor(e.dur / 20) % 60).padStart(2, '0')}`}</small>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : <Empty title="Keine Spielerdaten" text="Der Spieler war noch nie auf dieser Welt." />}
        </div>
      </div>
      <dl className="pp-stats mcp-stats4">
        <div><dt>Spielzeit</dt><dd>{s ? fmtTicks(s.playTicks) : '—'}</dd></div>
        <div><dt>Kills / Tode</dt><dd>{s ? `${fmtNum(s.mobKills + s.playerKills)} / ${fmtNum(s.deaths)}` : '—'}</dd></div>
        <div><dt>K/D</dt><dd>{s ? kd.toFixed(1) : '—'}</dd></div>
        <div><dt>Erfolge</dt><dd>{p.advancements}</dd></div>
      </dl>
      <section className="sx-card">
        <div className="sx-card-body">
          <div className="sx-row"><div className="sx-row-text"><b>UUID</b><span className="mono">{p.uuid}</span></div><div className="sx-row-ctl"><button type="button" className="o-icon-btn" onClick={() => copy(p.uuid, 'UUID')}><NavIcon name="copy" /></button></div></div>
          <div className="sx-row"><div className="sx-row-text"><b>Letzte IP</b><span className="mono">{p.ip || 'unbekannt (seit dem letzten Log-Wechsel nicht gejoint)'}</span></div><div className="sx-row-ctl">{p.ip && <button type="button" className="o-icon-btn" onClick={() => copy(p.ip, 'IP')}><NavIcon name="copy" /></button>}</div></div>
          <div className="sx-row"><div className="sx-row-text"><b>Erstmals gesehen</b><span>{fmtDate(p.firstSeen)}</span></div></div>
          <div className="sx-row"><div className="sx-row-text"><b>Zuletzt gespeichert</b><span>{fmtDate(p.lastSeen)}{p.source === 'file-stale' ? ' · Live-Daten erst nach Neustart (RCON)' : ''}</span></div></div>
        </div>
      </section>
    </>
  );
}

/* ── Inventar ── */
const ARMOR = [['head', 'Helm'], ['chest', 'Brust'], ['legs', 'Hose'], ['feet', 'Schuhe']];

function Slot({ item, cat, active, selected, onClick, label }) {
  const enchanted = item?.ench?.length;
  const pct = item?.max ? Math.max(0, 1 - (item.dmg || 0) / item.max) : null;
  return (
    <button type="button" className={`mcp-slot${active ? ' active' : ''}${selected ? ' sel' : ''}${enchanted ? ' glint' : ''}${item ? '' : ' empty'}`} onClick={onClick} title={item ? undefined : label}>
      {item ? <ItemIcon id={item.id} cat={cat} size={34} /> : label ? <span className="mcp-slot-lbl">{label}</span> : null}
      {item && item.count > 1 && <span className="mcp-slot-n">{item.count}</span>}
      {pct !== null && pct < 1 && <span className="mcp-slot-dur"><i style={{ width: `${pct * 100}%`, background: `hsl(${pct * 120}, 80%, 48%)` }} /></span>}
      {item && <Tooltip item={item} cat={cat} />}
    </button>
  );
}

function Tooltip({ item, cat }) {
  return (
    <span className="mcp-tip" role="tooltip">
      <b className={item.ench?.length ? 'ench' : ''}>{item.name || itemName(cat, item.id)}</b>
      {item.name && <small className="muted">{itemName(cat, item.id)}</small>}
      {item.ench?.map((e) => <span key={e.id} className="mcp-tip-ench">{langName(cat, 'enchantment', e.id)} {roman(e.lvl)}</span>)}
      {item.potion && <span className="mcp-tip-ench">{prettyEffect(item.potion)}</span>}
      {item.lore?.map((l, i) => <i key={i}>{l}</i>)}
      {item.max ? <span className="mcp-tip-dur">Haltbarkeit {item.max - (item.dmg || 0)} / {item.max}</span> : null}
      {item.unbreakable && <span className="mcp-tip-dur">Unzerbrechlich</span>}
      {item.contents?.length ? (
        <span className="mcp-tip-box">
          {item.contents.slice(0, 27).map((c) => (
            <span key={c.slot} className="mcp-tip-cell"><ItemIcon id={c.id} cat={cat} size={18} />{c.count > 1 && <em>{c.count}</em>}</span>
          ))}
        </span>
      ) : null}
      <small className="mono muted">{item.id}</small>
    </span>
  );
}
const POPULAR = ['diamond', 'netherite_ingot', 'emerald', 'gold_ingot', 'iron_ingot', 'elytra', 'totem_of_undying', 'golden_apple', 'enchanted_golden_apple', 'ender_pearl',
  'firework_rocket', 'cooked_beef', 'golden_carrot', 'diamond_sword', 'netherite_sword', 'diamond_pickaxe', 'netherite_pickaxe', 'bow', 'arrow', 'shield', 'trident', 'mace',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots', 'experience_bottle', 'enchanted_book', 'shulker_box', 'beacon', 'torch', 'oak_log', 'stone', 'cobblestone',
  'obsidian', 'tnt', 'water_bucket', 'lava_bucket', 'name_tag', 'saddle', 'chest', 'crafting_table', 'furnace', 'anvil', 'enchanting_table', 'bookshelf', 'redstone', 'glowstone'];
const prettyEffect = (p) => String(p).replace(/^minecraft:/, '').replace(/_/g, ' ');

function ItemPicker({ cat, onPick, initial = '' }) {
  const [q, setQ] = useState(initial);
  const items = useMemo(() => {
    if (!cat) return [];
    const s = q.trim().toLowerCase();
    const all = Object.entries(cat.items).filter(([id]) => id !== 'minecraft:air');
    if (!s) {
      const fav = POPULAR.map((id) => [`minecraft:${id}`, cat.items[`minecraft:${id}`]]).filter(([, v]) => v);
      return [...fav, ...all.filter(([id]) => !POPULAR.includes(id.slice(10)))].slice(0, 60);
    }
    const hits = all.filter(([id, v]) => v.n.toLowerCase().includes(s) || id.includes(s));
    hits.sort((a, b) => (a[1].n.toLowerCase().startsWith(s) ? 0 : 1) - (b[1].n.toLowerCase().startsWith(s) ? 0 : 1) || a[1].n.length - b[1].n.length);
    return hits.slice(0, 60);
  }, [cat, q]);
  if (!cat) return <div className="mcx-loading">Item-Grafiken werden einmalig von Mojang geladen…</div>;
  return (
    <div className="mcp-picker">
      <div className="lg-search"><NavIcon name="search" /><input autoFocus placeholder="Item suchen, z. B. Diamant, Elytren…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="mcp-picker-grid">
        {items.map(([id, v]) => (
          <button key={id} type="button" className="mcp-pick" title={`${v.n} · ${id}`} onClick={() => onPick(id)}>
            <ItemIcon id={id} cat={cat} size={30} />
            <span>{v.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Inventory({ inst, cat, p, reload }) {
  const [sel, setSel] = useState(null);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);
  const d = p.data;
  if (!d) return <Empty title="Kein Inventar" text="Der Spieler war noch nie auf dieser Welt." />;
  const itemAt = (slot) => {
    const [k, n] = slot.split(':');
    if (k === 'inv') return d.inv[n];
    if (k === 'ender') return d.ender[n];
    if (k === 'armor') return d.equip[n];
    if (k === 'offhand') return d.equip.offhand;
    return null;
  };
  const selItem = sel ? itemAt(sel) : null;
  const pick = (slot) => {
    setSel(slot === sel ? null : slot);
    const it = itemAt(slot);
    setCount(it?.count || 1);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  };
  async function edit(body, okText) {
    setBusy(true);
    try {
      const r = await api(`/api/mc/instances/${inst.id}/players/${p.uuid}/inventory`, { method: 'POST', body });
      toast.ok(okText, { text: r.viaFile ? 'In die Spielerdatei geschrieben (Backup: .orbit-bak).' : 'Live an den Spieler gesendet.' });
      setTimeout(reload, p.online ? 400 : 50);
      if (body.op === 'remove' || body.op === 'clear' || body.op === 'clear-ender') setSel(null);
    } catch (e) { toast.err(e.message); }
    setBusy(false);
  }
  const slotLabel = (slot) => {
    const [k, n] = slot.split(':');
    if (k === 'inv') return Number(n) < 9 ? `Hotbar ${Number(n) + 1}` : `Inventar ${Number(n) - 8}`;
    if (k === 'ender') return `Enderkiste ${Number(n) + 1}`;
    if (k === 'armor') return ARMOR.find((a) => a[0] === n)?.[1];
    return 'Zweithand';
  };

  return (
    <div className="mcp-inv-wrap">
      <div className={`mcp-mode ${p.online ? 'live' : 'file'}`}>
        <NavIcon name={p.online ? 'bolt' : 'db'} />
        {p.online ? 'Spieler ist online: Änderungen gehen sofort per Befehl ins Spiel.' : 'Spieler ist offline: Änderungen werden direkt in seine Spielerdatei geschrieben, mit Backup.'}
      </div>
      <div className="mcp-inv">
        <div className="mcp-inv-side">
          {ARMOR.map(([k, l]) => <Slot key={k} cat={cat} item={d.equip[k]} label={l} active={sel === `armor:${k}`} onClick={() => pick(`armor:${k}`)} />)}
          <div className="mcp-inv-sep" />
          <Slot cat={cat} item={d.equip.offhand} label="Hand" active={sel === 'offhand'} onClick={() => pick('offhand')} />
        </div>
        <div className="mcp-inv-main">
          <div className="mcp-inv-title">Inventar</div>
          <div className="mcp-grid9">
            {Array.from({ length: 27 }, (_, i) => i + 9).map((n) => <Slot key={n} cat={cat} item={d.inv[n]} active={sel === `inv:${n}`} onClick={() => pick(`inv:${n}`)} />)}
          </div>
          <div className="mcp-grid9 hotbar">
            {Array.from({ length: 9 }, (_, n) => <Slot key={n} cat={cat} item={d.inv[n]} selected={d.selected === n} active={sel === `inv:${n}`} onClick={() => pick(`inv:${n}`)} />)}
          </div>
          <div className="mcp-inv-title ender">Enderkiste</div>
          <div className="mcp-grid9 ender">
            {Array.from({ length: 27 }, (_, n) => <Slot key={n} cat={cat} item={d.ender[n]} active={sel === `ender:${n}`} onClick={() => pick(`ender:${n}`)} />)}
          </div>
        </div>
      </div>

      {sel && (
        <section ref={panelRef} className="mcp-edit card">
          <header>
            <span className="mcp-edit-slot">{slotLabel(sel)}</span>
            <button type="button" className="o-icon-btn" onClick={() => setSel(null)}><NavIcon name="x" /></button>
          </header>
          {selItem ? (
            <div className="mcp-edit-item">
              <div className="mcp-edit-big"><ItemIcon id={selItem.id} cat={cat} size={56} /></div>
              <div className="mcp-edit-info">
                <b>{selItem.name || itemName(cat, selItem.id)}</b>
                <small className="mono muted">{selItem.id}</small>
                {selItem.ench?.length ? <span className="mcp-edit-ench">{selItem.ench.map((e) => `${langName(cat, 'enchantment', e.id)} ${roman(e.lvl)}`).join(' · ')}</span> : null}
                {selItem.max ? <span className="muted">Haltbarkeit {selItem.max - (selItem.dmg || 0)} / {selItem.max}</span> : null}
              </div>
              <div className="mcp-edit-acts">
                <div className="mcp-count">
                  <button type="button" onClick={() => setCount(Math.max(1, count - 1))}>−</button>
                  <input type="number" min={1} max={99} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                  <button type="button" onClick={() => setCount(Math.min(99, count + 1))}>+</button>
                </div>
                <button type="button" className="btn btn-sm" disabled={busy || count === selItem.count} onClick={() => edit({ op: 'count', slot: sel, count }, 'Anzahl geändert')}>Anzahl setzen</button>
                {selItem.max && selItem.dmg ? <button type="button" className="btn btn-sm" disabled={busy} onClick={() => edit({ op: 'repair', slot: sel }, 'Repariert')}><NavIcon name="wrench" />Reparieren</button> : null}
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => edit({ op: 'remove', slot: sel }, 'Item entfernt')}><NavIcon name="x" />Entfernen</button>
              </div>
            </div>
          ) : (
            <>
              <div className="mcp-edit-new">
                <span>Item für diesen Slot wählen, Anzahl:</span>
                <div className="mcp-count">
                  <button type="button" onClick={() => setCount(Math.max(1, count - 1))}>−</button>
                  <input type="number" min={1} max={99} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                  <button type="button" onClick={() => setCount(Math.min(99, count + 1))}>+</button>
                  <button type="button" onClick={() => setCount(64)}>64</button>
                </div>
              </div>
              <ItemPicker cat={cat} onPick={(id) => edit({ op: 'set', slot: sel, id, count }, `${itemName(cat, id)} gesetzt`)} />
            </>
          )}
        </section>
      )}

      <div className="mcp-inv-foot">
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { if (window.confirm(`Komplettes Inventar von ${p.name} leeren (inkl. Rüstung)?`)) edit({ op: 'clear' }, 'Inventar geleert'); }}>Inventar leeren</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { if (window.confirm(`Enderkiste von ${p.name} leeren?`)) edit({ op: 'clear-ender' }, 'Enderkiste geleert'); }}>Enderkiste leeren</button>
      </div>
    </div>
  );
}

/* ── Statistiken ── */
function statValue(id, v) {
  if (/play_time|play_one_minute|time_since|sneak_time|total_world_time/.test(id)) return fmtTicks(v);
  if (/_one_cm$/.test(id)) return v >= 100000 ? `${(v / 100000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km` : `${Math.round(v / 100)} m`;
  if (/damage_/.test(id)) return `${fmtNum(Math.round(v / 20))} ♥`;
  return fmtNum(v);
}

function TopList({ title, icon, rows, cat, entity }) {
  if (!rows?.length) return null;
  const max = rows[0].v || 1;
  return (
    <section className="mcp-top card">
      <header><NavIcon name={icon} />{title}</header>
      {rows.map((r) => (
        <div key={r.id} className="mcp-top-row">
          {entity
            ? (cat?.items?.[`${r.id}_spawn_egg`] ? <ItemIcon id={`${r.id}_spawn_egg`} cat={cat} size={24} /> : <span className="mcp-top-ent">{langName(cat, 'entity', r.id).slice(0, 1)}</span>)
            : <ItemIcon id={r.id} cat={cat} size={24} />}
          <span className="mcp-top-name">{entity ? langName(cat, 'entity', r.id) : itemName(cat, r.id)}</span>
          <span className="mcp-top-bar"><i style={{ width: `${(r.v / max) * 100}%` }} /></span>
          <b>{fmtNum(r.v)}</b>
        </div>
      ))}
    </section>
  );
}

function Stats({ cat, p }) {
  const [all, setAll] = useState(false);
  const st = p.stats;
  if (!st) return <Empty title="Keine Statistiken" text="Statistiken entstehen, sobald der Spieler auf dem Server spielt." />;
  const s = st.summary;
  const cards = [
    ['clock', 'Spielzeit', fmtTicks(s.playTicks)],
    ['pin', 'Strecke', statValue('x_one_cm', s.distanceCm)],
    ['cube', 'Abgebaut', fmtNum(s.mined)],
    ['layers', 'Benutzt / platziert', fmtNum(s.placed)],
    ['wrench', 'Hergestellt', fmtNum(s.crafted)],
    ['sword', 'Mob-Kills', fmtNum(s.mobKills)],
    ['users', 'Spieler-Kills', fmtNum(s.playerKills)],
    ['heart', 'Tode', fmtNum(s.deaths)],
    ['activity', 'Sprünge', fmtNum(s.jumps)],
    ['bolt', 'Schaden verursacht', statValue('damage_dealt', s.damageDealt)],
    ['globe', 'Handel mit Dorfbewohnern', fmtNum(s.trades)],
    ['moon', 'Geschlafen', fmtNum(s.sleeps)],
  ];
  return (
    <>
      <div className="mcp-cards">
        {cards.map(([icon, label, v]) => (
          <div key={label} className="mcp-card"><NavIcon name={icon} /><span>{label}</span><b>{v}</b></div>
        ))}
      </div>
      {s.sinceDeath != null && <p className="muted mcp-since">Seit dem letzten Tod: <b>{fmtTicks(s.sinceDeath)}</b></p>}
      <div className="mcp-tops">
        <TopList title="Am meisten abgebaut" icon="cube" rows={st.mined} cat={cat} />
        <TopList title="Am meisten benutzt" icon="layers" rows={st.used} cat={cat} />
        <TopList title="Am meisten getötet" icon="sword" rows={st.killed} cat={cat} entity />
        <TopList title="Getötet von" icon="heart" rows={st.killedBy} cat={cat} entity />
        <TopList title="Hergestellt" icon="wrench" rows={st.crafted} cat={cat} />
        <TopList title="Kaputt gegangen" icon="x" rows={st.broken} cat={cat} />
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAll(!all)}>{all ? 'Weniger anzeigen' : `Alle ${st.custom.length} Statistiken`}</button>
      {all && (
        <div className="mcp-allstats card">
          {st.custom.map((r) => (
            <div key={r.id}><span>{langName(cat, 'stat', r.id)}</span><b>{statValue(r.id, r.v)}</b></div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Erfolge ── */
const ADV_CATS = { story: 'Minecraft', nether: 'Nether', end: 'Das Ende', adventure: 'Abenteuer', husbandry: 'Landwirtschaft' };
function Advancements({ cat, p }) {
  const [c, setC] = useState('all');
  const list = (p.advancementsList || []).map((a) => ({ ...a, ...advTitle(cat, a.id) }));
  const cats = [...new Set(list.map((a) => a.cat))];
  const shown = list.filter((a) => c === 'all' || a.cat === c);
  if (!list.length) return <Empty title="Noch keine Erfolge" text="Erfolge erscheinen hier, sobald der Spieler sie freischaltet." />;
  return (
    <>
      <div className="seg mcp-advseg">
        <button type="button" className={c === 'all' ? 'active' : ''} onClick={() => setC('all')}>Alle <span className="seg-n">{list.length}</span></button>
        {cats.map((k) => <button key={k} type="button" className={c === k ? 'active' : ''} onClick={() => setC(k)}>{ADV_CATS[k] || k}</button>)}
      </div>
      <div className="mcp-adv">
        {shown.map((a) => (
          <div key={a.id} className="mcp-adv-item">
            <span className="mcp-adv-ico"><NavIcon name="trophy" /></span>
            <span className="mcp-adv-text"><b>{a.title}</b><small>{a.desc}</small></span>
            <span className="mcp-adv-at">{a.at ? new Date(a.at).toLocaleDateString('de-DE') : ''}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Aktionen ── */
function Actions({ inst, cat, p, online, run }) {
  const [msg, setMsg] = useState('');
  const [xp, setXp] = useState(5);
  const [give, setGive] = useState(null);
  const [giveN, setGiveN] = useState(1);
  const [tpTo, setTpTo] = useState('');
  const others = online.filter((o) => o.uuid !== p.uuid);
  const needOnline = !p.online;
  return (
    <div className="mcp-actions">
      {needOnline && <div className="mcp-mode file"><NavIcon name="signal" />Die meisten Aktionen brauchen den Spieler online. Kick, Bann, OP und Whitelist gehen immer.</div>}
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Spielmodus</h3></div></header>
        <div className="sx-card-body">
          <div className="mcp-gm">
            {Object.entries(GM).map(([k, l]) => (
              <button key={k} type="button" disabled={needOnline} className={p.data?.gamemode === k ? 'active' : ''} onClick={() => run({ action: 'gamemode', value: k }, `Spielmodus: ${l}`)}>{l}</button>
            ))}
          </div>
        </div>
      </section>
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Zustand</h3></div></header>
        <div className="sx-card-body mcp-btngrid">
          <button type="button" className="btn btn-sm" disabled={needOnline} onClick={() => run({ action: 'heal' }, 'Geheilt')}><NavIcon name="heart" />Heilen</button>
          <button type="button" className="btn btn-sm" disabled={needOnline} onClick={() => run({ action: 'feed' }, 'Gesättigt')}><NavIcon name="drop" />Sättigen</button>
          <button type="button" className="btn btn-sm" disabled={needOnline} onClick={() => run({ action: 'effects-clear' }, 'Effekte entfernt')}><NavIcon name="sparkle" />Effekte entfernen</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={needOnline} onClick={() => { if (window.confirm(`${p.name} töten?`)) run({ action: 'kill' }, `${p.name} getötet`); }}><NavIcon name="sword" />Töten</button>
        </div>
      </section>
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Erfahrung &amp; Items</h3></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>Level geben</b><span>Negativ zieht Level ab</span></div>
            <div className="sx-row-ctl mcp-inline">
              <input type="number" className="sx-num" value={xp} onChange={(e) => setXp(e.target.value)} />
              <button type="button" className="btn btn-sm" disabled={needOnline} onClick={() => run({ action: 'xp', value: xp }, `${xp} Level gegeben`)}>Geben</button>
            </div>
          </div>
          <div className="sx-row mcp-give">
            <div className="sx-row-text"><b>Item geben</b><span>{give ? itemName(cat, give) : 'Item auswählen'}</span></div>
            <div className="sx-row-ctl mcp-inline">
              {give && <ItemIcon id={give} cat={cat} size={28} />}
              <input type="number" className="sx-num" min={1} max={6400} value={giveN} onChange={(e) => setGiveN(e.target.value)} />
              <button type="button" className="btn btn-sm" disabled={needOnline || !give} onClick={() => run({ action: 'give', id: give, count: giveN }, `${giveN}× ${itemName(cat, give)} gegeben`)}>Geben</button>
            </div>
          </div>
          {!needOnline && <ItemPicker cat={cat} onPick={setGive} />}
        </div>
      </section>
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Teleport &amp; Nachricht</h3></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>Zu Spieler teleportieren</b><span>{others.length ? 'Teleportiert diesen Spieler zum gewählten Spieler' : 'Kein anderer Spieler online'}</span></div>
            <div className="sx-row-ctl mcp-inline">
              <select value={tpTo} onChange={(e) => setTpTo(e.target.value)} disabled={needOnline || !others.length}>
                <option value="">Spieler wählen…</option>
                {others.map((o) => <option key={o.uuid} value={o.name}>{o.name}</option>)}
              </select>
              <button type="button" className="btn btn-sm" disabled={!tpTo || needOnline} onClick={() => run({ action: 'tp', target: tpTo }, `Zu ${tpTo} teleportiert`)}>Teleport</button>
            </div>
          </div>
          {p.data?.respawn?.pos && (
            <div className="sx-row">
              <div className="sx-row-text"><b>Zum Spawnpunkt (Bett)</b><span className="mono">{p.data.respawn.pos.join(' · ')}</span></div>
              <div className="sx-row-ctl"><button type="button" className="btn btn-sm" disabled={needOnline} onClick={() => run({ action: 'tp', pos: p.data.respawn.pos, dimension: p.data.respawn.dimension }, 'Zum Spawnpunkt teleportiert')}>Teleport</button></div>
            </div>
          )}
          {p.data?.lastDeath?.pos && (
            <div className="sx-row">
              <div className="sx-row-text"><b>Zum letzten Todespunkt</b><span className="mono">{p.data.lastDeath.pos.join(' · ')}</span></div>
              <div className="sx-row-ctl"><button type="button" className="btn btn-sm" disabled={needOnline} onClick={() => run({ action: 'tp', pos: p.data.lastDeath.pos, dimension: p.data.lastDeath.dimension }, 'Zum Todespunkt teleportiert')}>Teleport</button></div>
            </div>
          )}
          <div className="sx-row">
            <div className="sx-row-text"><b>Private Nachricht</b><span>Erscheint nur bei {p.name}</span></div>
            <div className="sx-row-ctl mcp-inline">
              <input value={msg} maxLength={240} placeholder="Nachricht…" onChange={(e) => setMsg(e.target.value)} />
              <button type="button" className="btn btn-sm" disabled={needOnline || !msg.trim()} onClick={() => { run({ action: 'message', message: msg }, 'Nachricht gesendet'); setMsg(''); }}><NavIcon name="chat" />Senden</button>
            </div>
          </div>
        </div>
      </section>
      <section className="sx-card">
        <header className="sx-card-head"><div><h3>Moderation</h3></div></header>
        <div className="sx-card-body">
          <div className="sx-row">
            <div className="sx-row-text"><b>IP bannen</b><span>{p.ip ? `Sperrt ${p.ip} für alle Accounts` : 'Letzte IP unbekannt'}</span></div>
            <div className="sx-row-ctl"><button type="button" className="btn btn-sm btn-danger" disabled={!p.ip} onClick={() => { const r = window.prompt(`IP ${p.ip} bannen — Grund:`, ''); if (r !== null) run({ action: 'ban-ip', ip: p.ip, reason: r }, `IP ${p.ip} gebannt`); }}>IP bannen</button></div>
          </div>
        </div>
      </section>
    </div>
  );
}
