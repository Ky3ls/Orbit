import { probeFiveM } from './fivem.js';
import { listOrbitServers } from './orbitServersDb.js';
import { supervisorRunning } from './fxSupervisor.js';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export async function refreshInstanceMonitors(db, host = '127.0.0.1') {
  const servers = listOrbitServers(db);
  const rows = await Promise.all(servers.map(async (s) => {
    const port = Number(s.port) || 30120;
    const probe = await probeFiveM(host, port);
    const key = String(s.id);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      port,
      dataPath: s.data_path,
      isActive: !!s.is_active,
      supervisorPhase: supervisorRunning(key) ? 'running' : 'idle',
      online: probe.online,
      clients: probe.clients,
      maxClients: probe.maxClients || s.max_clients,
      hostname: probe.hostname || s.name,
    };
  }));
  return rows;
}
