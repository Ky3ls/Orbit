# Seed nur Defaults — Master-Account entsteht im Browser unter /install.
# Optional: TX2_BOOT_USER + TX2_BOOT_PASSWORD setzen, dann wird der Inhaber hier angelegt.

import { hashPassword, passwordOk, userOk } from './auth.js';
import { getDb, setSetting } from './db.js';
import { readCfg } from './fivem.js';

const db = getDb();
const now = Date.now();

let pub = { hostname: 'Ky3ls Roleplay', maxClients: 48, project: 'Ky3ls', tags: '', locale: 'de-DE' };
let resources = [];
try {
  const parsed = readCfg();
  pub = { ...pub, ...parsed.pub };
  resources = parsed.resources;
} catch (err) {
  console.error('server.cfg nicht gelesen:', err.message);
}

const defaults = {
  hostname: pub.hostname || 'Ky3ls Roleplay',
  project: pub.project || 'Ky3ls',
  tags: pub.tags || '',
  locale: pub.locale || 'de-DE',
  maxClients: String(pub.maxClients || 48),
  fivemHost: '127.0.0.1',
  fivemPort: '30120',
  controlEnabled: '1',
  ipAllowlist: '',
  serverLabel: 'FiveM',
  brand: 'Orbit',
  autoRestartEnabled: '1',
};
for (const [k, v] of Object.entries(defaults)) {
  const row = db.prepare('SELECT v FROM settings WHERE k = ?').get(k);
  if (!row) setSetting(db, k, v);
}

const insertRes = db.prepare('INSERT OR IGNORE INTO resources (name, actual, updated) VALUES (?, ?, ?)');
for (const name of resources) insertRes.run(name, 'unknown', now);

const username = process.env.TX2_BOOT_USER || '';
const password = process.env.TX2_BOOT_PASSWORD || '';
const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (users === 0 && username && password) {
  if (!userOk(username) || !passwordOk(password)) {
    console.error('TX2_BOOT_USER / TX2_BOOT_PASSWORD ungültig.');
    process.exit(1);
  }
  db.prepare(`
    INSERT INTO users (username, password_hash, role, must_change, created)
    VALUES (?, ?, 'owner', 0, ?)
  `).run(username, await hashPassword(password), now);
  console.log(`Master angelegt: ${username}`);
} else if (users === 0) {
  console.log('Kein Master. Öffne https://tx2.ky3ls.space/install');
} else {
  console.log(`Benutzer vorhanden: ${users}`);
}

console.log(`Defaults ok, Ressourcen ${resources.length}`);
