import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import GameMark from '../../components/GameMark.jsx';
import { toast } from '../../components/toast.jsx';
import { Page, PageHeader } from '../../components/Ui.jsx';
import { NavIcon } from '../../layout/icons.jsx';
import { TYPE_META, fmtDur, fmtMb, phaseOf, serverAddress } from './mcShared.js';
import './mc.css';

export default function Instances() {
  const navigate = useNavigate();
  const { user, live, serverStatus } = useOutletContext();
  const [mc, setMc] = useState(null);
  const [host, setHost] = useState(null);
  const [fivem, setFivem] = useState([]);
  const [busy, setBusy] = useState('');
  const canManage = user.role === 'owner' || user.role === 'admin';

  const load = useCallback(() => {
    api('/api/mc/instances').then((d) => { setMc(d.instances || []); setHost(d.host); }).catch(() => setMc([]));
    api('/api/servers').then((d) => setFivem(d.servers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  async function control(inst, action) {
    setBusy(`${inst.id}:${action}`);
    try {
      await api(`/api/mc/instances/${inst.id}/control`, { method: 'POST', body: { action } });
      toast.ok(`${inst.name}: ${action === 'start' ? 'wird gestartet' : action === 'stop' ? 'gestoppt' : 'Neustart'}`);
      load();
    } catch (e) {
      toast.err(e.message);
    }
    setBusy('');
  }

  const running = (mc || []).filter((i) => i.status.pid);
  const usedMc = running.reduce((n, i) => n + (i.status.rssMb || 0), 0);
  const total = host?.totalMb || 0;
  const pctMc = total ? (usedMc / total) * 100 : 0;
  const pctOther = total ? Math.max(0, ((total - (host?.availableMb || 0) - usedMc) / total) * 100) : 0;

  return (
    <Page className="mcx-page">
      <PageHeader
        eyebrow="Multi-Game"
        title="Instanzen"
        description="Alle Server auf diesem Host — FiveM und Minecraft laufen parallel."
        actions={canManage ? (
          <>
            <Link to="/instances/import" className="btn btn-sm"><NavIcon name="switch" />Importieren</Link>
            <Link to="/instances/new" className="btn btn-primary btn-sm"><NavIcon name="plus" />Neue Instanz</Link>
          </>
        ) : null}
      />

      {host && (
        <section className="mcx-host card">
          <div className="mcx-host-head">
            <span><NavIcon name="memory" />Arbeitsspeicher des Hosts</span>
            <b>{fmtMb(total - host.availableMb)} <small>von {fmtMb(total)} belegt</small></b>
          </div>
          <div className="mcx-host-bar">
            <i className="mc" style={{ width: `${pctMc}%` }} title={`Minecraft: ${fmtMb(usedMc)}`} />
            <i className="other" style={{ width: `${pctOther}%` }} title="System, FiveM und andere Prozesse" />
          </div>
          <div className="mcx-host-legend">
            <span className="mc"><i />Minecraft-Instanzen {fmtMb(usedMc)}</span>
            <span className="other"><i />System, FiveM & Rest</span>
            <span className="free"><i />Frei {fmtMb(host.availableMb)}</span>
          </div>
        </section>
      )}

      <div className="mcx-grid">
        {fivem.map((s) => {
          const active = !!s.is_active;
          const on = active ? serverStatus === 'online' : s.supervisorPhase === 'running';
          return (
            <article key={`fx-${s.id}`} className={`mcx-card card${on ? ' on' : ''}`}>
              <header>
                <GameMark game="fivem" />
                <div className="mcx-card-title">
                  <b>{s.name}</b>
                  <span>FiveM · Port {s.port}</span>
                </div>
                <span className={`mcx-state tone-${on ? 'ok' : 'idle'}`}><i />{on ? 'Online' : 'Offline'}</span>
              </header>
              <dl className="mcx-facts">
                <div><dt>Spieler</dt><dd>{active ? `${live?.clients ?? 0} / ${live?.maxClients ?? s.max_clients ?? '–'}` : `– / ${s.max_clients ?? '–'}`}</dd></div>
                <div><dt>Panel</dt><dd>{active ? 'Aktiv' : 'Inaktiv'}</dd></div>
                <div><dt>Port</dt><dd>{s.port}</dd></div>
                <div><dt>Typ</dt><dd>FXServer</dd></div>
              </dl>
              <footer>
                {active
                  ? <button type="button" className="btn btn-sm" onClick={() => navigate('/panel')}>Öffnen<NavIcon name="arrowRight" /></button>
                  : <Link className="btn btn-sm" to="/settings?section=host&tab=servers">Verwalten</Link>}
              </footer>
            </article>
          );
        })}

        {(mc || []).map((inst) => {
          const ph = phaseOf(inst);
          const tm = TYPE_META[inst.type] || {};
          const st = inst.status;
          return (
            <article key={`mc-${inst.id}`} className={`mcx-card card tone-${ph.tone}`}>
              <header>
                <GameMark game="minecraft" color={tm.color} />
                <div className="mcx-card-title">
                  <Link to={`/mc/${inst.id}`}><b>{inst.name}</b></Link>
                  <span>{tm.label} {inst.mcVersion} · {serverAddress(inst)}</span>
                </div>
                <span className={`mcx-state tone-${ph.tone}`}><i />{ph.label}</span>
              </header>
              <dl className="mcx-facts">
                <div><dt>Spieler</dt><dd>{st.online ? `${st.players ?? 0} / ${st.maxPlayers ?? '–'}` : '–'}</dd></div>
                <div><dt>RAM</dt><dd title={`Heap-Limit ${fmtMb(inst.ramMb)}`}>{st.pid ? fmtMb(st.rssMb) : fmtMb(inst.ramMb)}</dd></div>
                <div><dt>CPU</dt><dd>{st.pid ? `${st.cpu}%` : '–'}</dd></div>
                <div><dt>Uptime</dt><dd>{st.startedAt ? fmtDur(Date.now() - st.startedAt) : '–'}</dd></div>
              </dl>
              <footer>
                {inst.state === 'ready' && (st.pid ? (
                  <>
                    <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => control(inst, 'restart')}><NavIcon name="restart" /></button>
                    <button type="button" className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => control(inst, 'stop')}><NavIcon name="stop" />Stoppen</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-sm mcx-go" disabled={!!busy} onClick={() => control(inst, 'start')}><NavIcon name="play" />Starten</button>
                ))}
                <Link to={`/mc/${inst.id}`} className="btn btn-sm btn-ghost">Öffnen<NavIcon name="arrowRight" /></Link>
              </footer>
            </article>
          );
        })}

        {canManage && (
          <Link to="/instances/new" className="mcx-card mcx-add">
            <span><NavIcon name="plus" /></span>
            <b>Neue Instanz</b>
            <small>Minecraft: Vanilla, Paper, Purpur, Fabric, Forge oder NeoForge</small>
          </Link>
        )}
        {canManage && (
          <Link to="/instances/import" className="mcx-card mcx-add">
            <span><NavIcon name="switch" /></span>
            <b>Server importieren</b>
            <small>Bestehenden Minecraft-Server samt Welten, Plugins/Mods und Einstellungen übernehmen</small>
          </Link>
        )}
      </div>
    </Page>
  );
}
