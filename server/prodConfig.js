import fs from 'node:fs';
import path from 'node:path';
import { ORBIT_ARTIFACTS_ROOT, ORBIT_SERVERS_ROOT } from './config.js';

function upsertSetLine(cfg, key, value) {
  const quoted = `"${String(value).replace(/"/g, '')}"`;
  const re = new RegExp(`^\\s*set\\s+${key}\\s+.*$`, 'm');
  const line = `set ${key} ${quoted}`;
  if (re.test(cfg)) return cfg.replace(re, line);
  return `${cfg.trim()}\n${line}\n`;
}

export function applyProdSecretsToCfg(cfgPath, { licenseKey = '', mysqlConnection = '' }) {
  if (!fs.existsSync(cfgPath)) throw new Error(`server.cfg fehlt: ${cfgPath}`);
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  if (licenseKey) cfg = upsertSetLine(cfg, 'sv_licenseKey', licenseKey);
  if (mysqlConnection) cfg = upsertSetLine(cfg, 'mysql_connection_string', mysqlConnection);
  fs.writeFileSync(cfgPath, cfg, 'utf8');
  return cfgPath;
}

export function prodReadiness(dataPath, fxRoot) {
  const issues = [];
  const ok = [];
  for (const [label, p] of [
    ['ORBIT_SERVERS_ROOT', ORBIT_SERVERS_ROOT],
    ['ORBIT_ARTIFACTS_ROOT', ORBIT_ARTIFACTS_ROOT],
  ]) {
    if (!fs.existsSync(p)) issues.push(`${label} existiert nicht: ${p}`);
    else {
      try {
        fs.accessSync(p, fs.constants.W_OK);
        ok.push(`${label} beschreibbar`);
      } catch {
        issues.push(`${label} nicht beschreibbar: ${p}`);
      }
    }
  }
  const fxBin = path.join(fxRoot || '', 'alpine/opt/cfx-server/FXServer');
  if (fxRoot && fs.existsSync(fxBin)) ok.push('FXServer-Binary gefunden');
  else issues.push('FX-Artifact / fxServerRoot fehlt — Einstellungen → FX Builds');
  if (dataPath) {
    const cfg = path.join(dataPath, 'server.cfg');
    if (!fs.existsSync(cfg)) issues.push(`server.cfg fehlt unter ${dataPath}`);
    else ok.push('server.cfg vorhanden');
  }
  return { ok, issues };
}
