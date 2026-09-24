import { settingMap, audit } from './db.js';
import { dispatchFxCommand, fxConsoleReady } from './fxCommand.js';
import { ORIGIN } from './config.js';
import {
  menuPermsForUser,
  fullAceMenuPerms,
  canIngameAction,
  findUserByIdentifiers,
  resolveIngameAdmin,
  createWebEmbedTicket,
  consumeWebEmbedTicket,
} from './ingamePerms.js';
import { createSession, cookieHeader, COOKIE, SESSION_MS } from './auth.js';

function str(v, max) {
  return String(v ?? '').slice(0, max);
}

function primaryId(identifiers) {
  const list = identifiers || [];
  return list.find((id) => id.startsWith('license:')) || list[0] || '';
}

function parseIdentifiersHeader(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 32);
}

function queueCommand(db, kind, payload, author, ip) {
  db.prepare('INSERT INTO queue (kind, payload, author, status, created) VALUES (?, ?, ?, ?, ?)')
    .run(kind, JSON.stringify(payload), author, 'queued', Date.now());
  audit(db, author, kind, JSON.stringify(payload).slice(0, 240), ip || 'ingame');
}

function resolveMenuUser(db, body) {
  const author = str(body.author, 48);
  if (author && author !== 'ingame') {
    const byName = db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(author);
    if (byName) return byName;
  }
  const ids = body.identifiers;
  if (Array.isArray(ids) && ids.length) return findUserByIdentifiers(db, ids);
  return null;
}

function tokenOk(settings, t) {
  const token = str(t, 128);
  return token && token === settings.ingameToken ? token : null;
}

/**
 * Öffentliche Ingame-API (Pipe-Token, kein Panel-Cookie) — vor Session/mutationOk.
 * @returns {boolean}
 */
export async function handleIngamePublicApi(ctx) {
  const { req, res, url, method, pathname, db, json, readBody, runtime, logLine, ip } = ctx;
  if (!pathname.startsWith('/api/ingame/')) return false;
  // Token-Erzeugung / Link nur mit Panel-Session
  if (pathname === '/api/ingame/token' || pathname === '/api/ingame/link') return false;

  const settings = settingMap(db);

  if (method === 'GET' && pathname === '/api/ingame/ping') {
    if (!tokenOk(settings, url.searchParams.get('token') || req.headers['x-orbit-token'] || req.headers['x-orbit-ingame'])) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    json(res, 200, {
      ok: true,
      panel: 'orbit',
      players: (runtime.players || []).length,
      playersSyncedAt: runtime.playersSyncedAt || 0,
      names: (runtime.players || []).map((p) => p.name).slice(0, 32),
    });
    return true;
  }

  /**
   * Live-Playerlist vom FX-Resource (wie txAdmin FxPlayerlist):
   * event=full | playerJoining | playerDropped — Quelle ist GetPlayers(), nicht players.json / DB.
   */
  if (method === 'POST' && pathname === '/api/ingame/players-sync') {
    const body = await readBody(req);
    if (!tokenOk(settings, body.token || req.headers['x-orbit-token'] || req.headers['x-orbit-ingame'])) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const now = Date.now();
    const event = String(body.event || 'full');
    const up = db.prepare(`
      INSERT INTO players (identifier, name, ping, ids, first_seen, last_seen, play_ms)
      VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(identifier) DO UPDATE SET
        name = excluded.name,
        ping = excluded.ping,
        ids = excluded.ids,
        last_seen = excluded.last_seen,
        play_ms = play_ms + 3000
    `);

    const normalize = (p) => {
      const id = Number(p?.id);
      if (!Number.isFinite(id)) return null;
      const identifiers = Array.isArray(p.identifiers)
        ? p.identifiers.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 16)
        : [];
      // Fallback-Key wenn Identifier noch fehlen (Join-Frame) — trotzdem live anzeigen
      const identifier = primaryId(identifiers) || `fivem:${id}`;
      const name = String(p.name || 'Unbekannt').slice(0, 64);
      const ping = Number(p.ping) || 0;
      return { id, name, ping, identifiers, identifier };
    };

    const persist = (row) => {
      if (!row?.identifier) return;
      try {
        up.run(row.identifier, row.name, row.ping, JSON.stringify(row.identifiers || []), now, now);
      } catch { /* */ }
    };

    let list = Array.isArray(runtime.players) ? [...runtime.players] : [];

    if (event === 'playerDropped') {
      const dropId = Number(body.id);
      list = list.filter((p) => Number(p.id) !== dropId);
    } else if (event === 'playerJoining') {
      const row = normalize(body.player || body);
      if (row) {
        list = list.filter((p) => Number(p.id) !== row.id);
        list.push({ id: row.id, name: row.name, ping: row.ping, identifiers: row.identifiers });
        persist(row);
      }
    } else {
      // full snapshot
      const raw = Array.isArray(body.players) ? body.players : [];
      list = [];
      for (const p of raw) {
        const row = normalize(p);
        if (!row) continue;
        list.push({ id: row.id, name: row.name, ping: row.ping, identifiers: row.identifiers });
        persist(row);
      }
    }

    runtime.players = list;
    runtime.playersSyncedAt = now;
    runtime.clients = list.length;
    if (list.length && !runtime.online) runtime.online = true;
    try { logLine?.('ok', `players-sync ${event}: ${list.length}`); } catch { /* */ }
    json(res, 200, { ok: true, event, count: list.length });
    return true;
  }

  /** txAdmin-Style: Auth über Player-Identifiers */
  if (method === 'GET' && pathname === '/api/ingame/auth/self') {
    if (!tokenOk(settings, req.headers['x-orbit-token'] || req.headers['x-orbit-ingame'] || url.searchParams.get('token'))) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const identifiers = parseIdentifiersHeader(req.headers['x-orbit-identifiers'] || '');
    const user = resolveIngameAdmin(db, identifiers);
    if (!user) {
      json(res, 200, {
        logout: true,
        reason: 'Kein Panel-Admin (Cfx.re im Panel verbinden oder Owner einmal /orbit öffnen).',
      });
      return true;
    }
    const menu = menuPermsForUser(user);
    if (!menu || (!menu.main && !menu.players && !menu.panel)) {
      json(res, 200, { logout: true, reason: 'Keine Menü-Rechte' });
      return true;
    }
    json(res, 200, {
      name: user.username,
      permissions: menu,
      role: user.role,
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/ingame/embed/exchange') {
    const body = await readBody(req);
    const ticket = str(body.ticket, 128);
    const user = consumeWebEmbedTicket(db, ticket);
    if (!user) json(res, 401, { error: 'Ticket ungültig oder abgelaufen.' });
    const sessionToken = createSession(db, user, req);
    audit(db, user.username, 'ingame.embed.login', '', ip);
    json(res, 200, { ok: true, user: { username: user.username, role: user.role } }, [
      ['Set-Cookie', cookieHeader(COOKIE, sessionToken, SESSION_MS / 1000, 'Lax')],
    ]);
    return true;
  }

  if (method === 'POST' && pathname === '/api/ingame/session') {
    const body = await readBody(req);
    if (!tokenOk(settings, body.token || req.headers['x-orbit-token'] || req.headers['x-orbit-ingame'])) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const identifiers = Array.isArray(body.identifiers) ? body.identifiers.map((id) => str(id, 120)) : [];
    const user = resolveIngameAdmin(db, identifiers);
    if (!user) {
      json(res, 200, {
        ok: false,
        reason: 'no_panel_user',
        hint: 'Cfx.re im Panel verbinden — oder als einziger Owner /orbit öffnen (Auto-Link).',
      });
      return true;
    }
    const menu = menuPermsForUser(user);
    if (!menu || (!menu.main && !menu.players && !menu.panel)) {
      json(res, 200, { ok: false, reason: 'no_permissions' });
      return true;
    }
    const { ticket } = createWebEmbedTicket(db, user.id);
    const webEmbedUrl = `${ORIGIN}/ingame/embed?ticket=${encodeURIComponent(ticket)}`;
    json(res, 200, {
      ok: true,
      username: user.username,
      role: user.role,
      menu,
      webEmbedUrl,
      panelUrl: ORIGIN,
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/ingame/action') {
    const body = await readBody(req);
    if (!tokenOk(settings, body.token || req.headers['x-orbit-token'] || req.headers['x-orbit-ingame'])) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const action = str(body.action, 32);
    const author = str(body.author, 48) || 'ingame';
    const panelUser = resolveMenuUser(db, body) || resolveIngameAdmin(db, body.identifiers || []);
    const menu = panelUser ? menuPermsForUser(panelUser) : fullAceMenuPerms();
    if (panelUser && !canIngameAction(menu, action)) {
      json(res, 403, { error: 'Keine Berechtigung für diese Aktion.' });
      return true;
    }
    const auditAuthor = panelUser?.username || author;

    try {
      if (action === 'kick') {
        const pid = Number(body.playerId);
        const reason = str(body.reason, 120) || 'Orbit';
        if (!fxConsoleReady(settings)) {
          json(res, 200, { ok: false, fallback: true });
          return true;
        }
        await dispatchFxCommand(settings, `kick ${pid} ${reason}`);
        json(res, 200, { ok: true });
        return true;
      }

      if (action === 'announce') {
        const msg = str(body.message, 200);
        if (!msg) json(res, 400, { error: 'Leer' });
        if (!fxConsoleReady(settings)) {
          json(res, 200, { ok: false, fallback: true });
          return true;
        }
        await dispatchFxCommand(settings, `say ${msg}`);
        json(res, 200, { ok: true });
        return true;
      }

      if (action === 'warn' || action === 'message') {
        const pid = Number(body.playerId);
        const reason = str(body.reason, 180) || str(body.message, 180);
        if (reason.length < 2) json(res, 400, { error: 'Grund zu kurz' });
        const player = (runtime.players || []).find((p) => p.id === pid);
        if (!player) json(res, 404, { error: 'Spieler offline' });
        const identifier = primaryId(player.identifiers);
        if (action === 'warn' && identifier) {
          db.prepare('INSERT INTO warns (identifier, name, reason, author, created) VALUES (?, ?, ?, ?, ?)')
            .run(identifier, player.name, reason, auditAuthor, Date.now());
        }
        queueCommand(db, action, { id: pid, name: player.name, identifier, reason }, auditAuthor, ip);
        json(res, 200, { ok: true, queued: true });
        return true;
      }

      if (action === 'ban') {
        const pid = Number(body.playerId);
        const reason = str(body.reason, 180) || 'Orbit Ban';
        const hours = Math.min(Math.max(Number(body.hours) || 0, 0), 8760);
        const player = (runtime.players || []).find((p) => p.id === pid);
        if (!player) json(res, 404, { error: 'Spieler offline' });
        const identifier = primaryId(player.identifiers);
        if (!identifier) json(res, 400, { error: 'Kein Identifier' });
        const expires = hours > 0 ? Date.now() + hours * 3600_000 : null;
        db.prepare('INSERT INTO bans (identifier, name, reason, author, expires, created, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)')
          .run(identifier, player.name, reason, auditAuthor, expires, Date.now());
        queueCommand(db, 'ban', { identifier, name: player.name, reason, hours }, auditAuthor, ip);
        if (fxConsoleReady(settings)) {
          await dispatchFxCommand(settings, `kick ${pid} ${reason}`);
        }
        json(res, 200, { ok: true });
        return true;
      }

      json(res, 400, { error: 'Unbekannte action' });
      return true;
    } catch (err) {
      logLine?.('warn', `ingame: ${err.message}`);
      json(res, 400, { error: err.message });
      return true;
    }
  }

  return false;
}
