import { hasPerm, sha256, randomToken } from './auth.js';

/** Menü-Rechte aus Panel-Permissions (txAdmin-Granularität). */
export function menuPermsForUser(user) {
  if (!user || user.disabled) return null;
  const ownerOrStar = user.role === 'owner' || hasPerm(user, 'all_permissions');
  const playersHub = ownerOrStar || hasPerm(user, 'players');
  const p = (id) => ownerOrStar || hasPerm(user, id) || (playersHub && [
    'players.warn', 'players.kick', 'players.dm', 'players.freeze',
    'players.heal', 'players.spectate', 'players.teleport', 'menu.viewids',
  ].includes(id));

  return {
    panel: ownerOrStar || hasPerm(user, 'overview') || hasPerm(user, 'monitor') || hasPerm(user, 'console'),
    main: playersHub || hasPerm(user, 'control') || hasPerm(user, 'players.playermode'),
    players: playersHub,
    vehicle: ownerOrStar || hasPerm(user, 'menu.vehicle'),
    noclip: ownerOrStar || hasPerm(user, 'players.playermode'),
    god: ownerOrStar || hasPerm(user, 'players.playermode'),
    superjump: ownerOrStar || hasPerm(user, 'players.playermode'),
    ids: p('menu.viewids'),
    teleport: p('players.teleport'),
    healSelf: p('players.heal'),
    healAll: ownerOrStar || hasPerm(user, 'control') || hasPerm(user, 'players.heal'),
    clearArea: ownerOrStar || hasPerm(user, 'menu.clear_area'),
    announce: ownerOrStar || hasPerm(user, 'announcement') || hasPerm(user, 'control') || hasPerm(user, 'console'),
    kick: p('players.kick'),
    warn: p('players.warn'),
    message: p('players.dm'),
    ban: ownerOrStar || hasPerm(user, 'bans') || hasPerm(user, 'players.ban'),
    goto: p('players.teleport'),
    bring: p('players.teleport'),
    spectate: p('players.spectate'),
    freeze: p('players.freeze'),
    troll: ownerOrStar || hasPerm(user, 'players.troll'),
  };
}

export function fullAceMenuPerms() {
  const t = true;
  return {
    panel: t, main: t, players: t, vehicle: t, noclip: t, god: t, superjump: t, ids: t,
    teleport: t, healSelf: t, healAll: t, clearArea: t, announce: t, kick: t, warn: t,
    message: t, ban: t, goto: t, bring: t, spectate: t, freeze: t, troll: t,
  };
}

const ACTION_PERM = {
  kick: 'kick',
  warn: 'warn',
  message: 'message',
  ban: 'ban',
  announce: 'announce',
};

export function canIngameAction(menu, action) {
  if (!menu) return false;
  const key = ACTION_PERM[action];
  if (!key) return true;
  return !!menu[key];
}

export function findUserByIdentifiers(db, identifiers) {
  const list = Array.isArray(identifiers) ? identifiers : [];
  const license = list.find((id) => typeof id === 'string' && id.startsWith('license:'));
  if (license) {
    const row = db.prepare('SELECT * FROM users WHERE ingame_license = ? AND disabled = 0').get(license);
    if (row) return row;
  }
  const fivem = list.find((id) => typeof id === 'string' && id.startsWith('fivem:'));
  if (fivem) {
    const cfxId = fivem.slice('fivem:'.length);
    const row = db.prepare('SELECT * FROM users WHERE cfx_id = ? AND disabled = 0').get(cfxId);
    if (row) return row;
  }
  const discord = list.find((id) => typeof id === 'string' && id.startsWith('discord:'));
  if (discord) {
    const did = discord.slice('discord:'.length);
    const row = db.prepare('SELECT * FROM users WHERE discord_id = ? AND disabled = 0').get(did);
    if (row) return row;
  }
  return null;
}

function bindLicense(db, userId, license) {
  db.prepare('UPDATE users SET ingame_license = ? WHERE id = ?').run(license, userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/**
 * License automatisch an Panel-Admin binden — ohne manuelles Verknüpfen.
 */
export function tryAutoClaimAdmin(db, identifiers) {
  const list = Array.isArray(identifiers) ? identifiers : [];
  const license = list.find((id) => typeof id === 'string' && id.startsWith('license:'));
  if (!license) return null;

  const taken = db.prepare('SELECT id FROM users WHERE ingame_license = ?').get(license);
  if (taken) {
    return db.prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(taken.id) || null;
  }

  const unbound = db.prepare(`
    SELECT * FROM users
    WHERE disabled = 0 AND role IN ('owner', 'admin')
      AND (ingame_license IS NULL OR ingame_license = '')
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id ASC
  `).all();

  if (unbound.length === 1) {
    return bindLicense(db, unbound[0].id, license);
  }

  const owners = unbound.filter((u) => u.role === 'owner');
  if (owners.length === 1) {
    return bindLicense(db, owners[0].id, license);
  }

  return null;
}

export function resolveIngameAdmin(db, identifiers) {
  return findUserByIdentifiers(db, identifiers) || tryAutoClaimAdmin(db, identifiers);
}

export function createWebEmbedTicket(db, userId) {
  const ticket = randomToken();
  const expires = Date.now() + 20 * 60_000;
  db.prepare('INSERT INTO ingame_web_tickets (token_hash, user_id, expires) VALUES (?, ?, ?)')
    .run(sha256(ticket), userId, expires);
  return { ticket, expires };
}

export function consumeWebEmbedTicket(db, ticket) {
  const row = db.prepare(`
    SELECT t.user_id, u.*
    FROM ingame_web_tickets t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.expires > ? AND u.disabled = 0
  `).get(sha256(ticket), Date.now());
  if (!row) return null;
  db.prepare('DELETE FROM ingame_web_tickets WHERE token_hash = ?').run(sha256(ticket));
  return row;
}
