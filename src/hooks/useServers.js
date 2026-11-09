import { useCallback, useEffect, useRef, useState } from 'react';
import { api, sameJson } from '../api.js';
import { PHASE_TONE } from '../games.js';

/**
 * Alle Server dieses Hosts in einer Liste — egal welches Spiel.
 * Jeder Eintrag: { key, game, id, name, sub, phase, tone, players, max, active, modKind, to }
 * Zusätzlich der Live-Status des aktiven FiveM-Servers (für dessen Steuerung).
 */
export function useServers() {
  const [fx, setFx] = useState({ status: 'offline', clients: 0, maxClients: 0, hostname: '', serverLabel: '', controlEnabled: true, fxControlMode: 'systemd', fxCommandReady: false, known: false });
  const [fxList, setFxList] = useState(null);
  const [mcList, setMcList] = useState(null);
  const fxStatus = useRef('offline');

  const refreshFx = useCallback(() => {
    if (document.hidden) return;
    api('/api/server/status')
      .then((d) => {
        const next = {
          status: d.status || (d.online ? 'online' : 'offline'),
          clients: d.clients ?? 0,
          maxClients: d.maxClients ?? 0,
          hostname: d.hostname || '',
          serverLabel: d.serverLabel || d.hostname || 'FiveM',
          controlEnabled: d.controlEnabled !== false,
          fxControlMode: d.fxControlMode || 'systemd',
          fxCommandReady: !!d.fxCommandReady,
          known: true,
        };
        fxStatus.current = next.status;
        setFx((prev) => (sameJson(prev, next) ? prev : next));
      })
      .catch(() => {});
  }, []);

  const refreshLists = useCallback(() => {
    if (document.hidden) return;
    api('/api/servers').then((d) => {
      const next = d.servers || [];
      setFxList((prev) => (sameJson(prev, next) ? prev : next));
    }).catch(() => setFxList((p) => p || []));
    api('/api/mc/instances').then((d) => {
      const next = (d.instances || []).map((i) => ({
        id: i.id, name: i.name, type: i.type, mcVersion: i.mcVersion, phase: i.status?.phase || 'offline',
        players: i.status?.players ?? null, max: i.status?.maxPlayers ?? null, modKind: i.modKind, address: i.address,
        state: i.state, pid: i.status?.pid || null,
      }));
      setMcList((prev) => (sameJson(prev, next) ? prev : next));
    }).catch(() => setMcList((p) => p || []));
  }, []);

  const refresh = useCallback(() => { refreshFx(); refreshLists(); }, [refreshFx, refreshLists]);

  useEffect(() => {
    refreshFx();
    const busy = ['starting', 'stopping', 'restarting'].includes(fx.status);
    const id = setInterval(refreshFx, busy ? 2000 : 10_000);
    return () => clearInterval(id);
  }, [refreshFx, fx.status]);

  useEffect(() => {
    refreshLists();
    const id = setInterval(refreshLists, 6000);
    const vis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [refreshLists, refresh]);

  const servers = [];
  for (const s of fxList || []) {
    const active = !!s.is_active;
    const phase = active ? (fx.status === 'online' ? 'running' : fx.status) : (s.supervisorPhase === 'running' ? 'running' : 'offline');
    servers.push({
      key: active ? 'fivem:active' : `fivem:${s.id}`,
      game: 'fivem',
      id: s.id,
      name: active && fx.serverLabel ? fx.serverLabel : s.name,
      sub: `FiveM · Port ${s.port}`,
      phase,
      tone: PHASE_TONE[phase] || 'idle',
      players: active && phase === 'running' ? fx.clients : null,
      max: active ? (fx.maxClients || s.max_clients) : s.max_clients,
      active,
      to: active ? '/panel' : '/settings?section=host&tab=servers',
    });
  }
  if (fxList && !fxList.length && fx.known && fx.hostname) {
    // FiveM eingerichtet, aber (noch) kein Eintrag in der Server-Liste
    const phase = fx.status === 'online' ? 'running' : fx.status;
    servers.push({ key: 'fivem:active', game: 'fivem', id: 'active', name: fx.serverLabel, sub: 'FiveM', phase, tone: PHASE_TONE[phase] || 'idle', players: phase === 'running' ? fx.clients : null, max: fx.maxClients, active: true, to: '/panel' });
  }
  for (const m of mcList || []) {
    servers.push({
      key: `minecraft:${m.id}`,
      game: 'minecraft',
      id: m.id,
      name: m.name,
      sub: `${m.type} ${m.mcVersion}`,
      phase: m.phase,
      tone: PHASE_TONE[m.phase] || 'idle',
      players: m.phase === 'running' ? m.players : null,
      max: m.max,
      modKind: m.modKind,
      address: m.address,
      to: `/mc/${m.id}`,
      raw: m,
    });
  }

  return { servers, loaded: fxList !== null && mcList !== null, fx, mcList: mcList || [], refresh, refreshFx };
}
