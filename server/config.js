export const HOST = process.env.ORBIT_BIND_HOST || '127.0.0.1';
export const PORT = Number(process.env.ORBIT_PANEL_PORT) || 40220;
export const ORIGIN = String(process.env.ORBIT_PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
export const CFG_PATH = process.env.FX_CFG_PATH || '';
export const FX_SERVER_ROOT = process.env.FX_SERVER_ROOT || '';
export const FX_DATA_PATH = process.env.FX_DATA_PATH || '';
/** Eigene Orbit-Server-Instanzen (Daten, nicht FX-Artifact) */
export const ORBIT_SERVERS_ROOT = process.env.ORBIT_SERVERS_ROOT || '/opt/orbit/servers';
export const ORBIT_ARTIFACTS_ROOT = process.env.ORBIT_ARTIFACTS_ROOT || '/opt/orbit/artifacts';
export const DATA_DIR = process.env.ORBIT_DATA_DIR || '/opt/orbit/data';
export const DB_PATH = process.env.ORBIT_DB_PATH || `${DATA_DIR}/orbit.sqlite`;
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const IDLE_MS = 2 * 60 * 60 * 1000;
export const COOKIE = '__Host-orbit';
export const TICKET_COOKIE = '__Host-orbitt';
