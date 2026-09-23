export const HOST = process.env.ORBIT_BIND_HOST || '127.0.0.1';
export const PORT = Number(process.env.ORBIT_PANEL_PORT) || 40220;
export const ORIGIN = String(process.env.ORBIT_PUBLIC_URL || 'https://tx2.ky3ls.space').replace(/\/$/, '');
export const CFG_PATH = process.env.FX_CFG_PATH || '/root/RoleplayServer/txData/Roleplay/server.cfg';
export const FX_SERVER_ROOT = process.env.FX_SERVER_ROOT || '/root/RoleplayServer';
export const FX_DATA_PATH = process.env.FX_DATA_PATH || '/root/RoleplayServer/txData/Roleplay';
/** Eigene Orbit-Server-Instanzen (Daten, nicht FX-Artifact) */
export const ORBIT_SERVERS_ROOT = process.env.ORBIT_SERVERS_ROOT || '/opt/orbit/servers';
export const ORBIT_ARTIFACTS_ROOT = process.env.ORBIT_ARTIFACTS_ROOT || '/opt/orbit/artifacts';
export const DATA_DIR = '/opt/tx2/data';
export const DB_PATH = '/opt/tx2/data/tx2.sqlite';
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const IDLE_MS = 2 * 60 * 60 * 1000;
export const COOKIE = '__Host-tx2';
export const TICKET_COOKIE = '__Host-tx2t';
