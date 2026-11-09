/*
 * Audit-Log: Filter, Seiten und Statistik direkt in SQLite.
 * Kategorien werden über Aktions-Präfixe bestimmt (siehe CATS) — dieselbe Logik nutzt die Oberfläche.
 */
export const CATS = {
  auth: ["action IN ('login','logout','lockout','master.create','cfx.claim','cfx.link','cfx.unlink')", "action LIKE 'totp%'", "action LIKE 'password%'", "action LIKE 'session%'"],
  fivem: ["action LIKE 'server.%'", "action LIKE 'fx.%'", "action LIKE 'resource%'", "action LIKE 'cfg.%'", "action IN ('console','message','setup','settings')", "action LIKE 'setup.%'", "action LIKE 'schedule%'", "action LIKE 'db.%'", "action LIKE 'ingame%'"],
  players: ["action IN ('ban','unban','kick','warn','unwarn','note')", "action LIKE 'player.%'", "action LIKE 'whitelist%'", "action LIKE 'allowlist%'", "action LIKE 'ban.%'"],
  minecraft: ["action LIKE 'mc.%'"],
  host: ["action LIKE 'host.%'"],
  team: ["action LIKE 'user.%'", "action LIKE 'admin.%'", "action LIKE 'role%'", "action LIKE 'team.%'", "action LIKE 'template%'"],
  system: ["action LIKE 'orbit.%'", "user = 'system'"],
};
const CAT_SQL = (k) => `(${CATS[k].join(' OR ')})`;
const CRITICAL = "(action LIKE '%stop%' OR action LIKE '%ban%' OR action LIKE '%delete%' OR action LIKE '%drop%' OR action LIKE '%kill%' OR action LIKE '%fail%' OR action = 'lockout' OR action LIKE '%restore%')";

export function auditQuery(db, params) {
  const where = [];
  const args = [];
  const showSystem = params.get('system') === '1';
  if (!showSystem) where.push(`NOT ${CAT_SQL('system')}`);
  const cat = params.get('cat');
  if (cat && CATS[cat]) where.push(CAT_SQL(cat));
  if (params.get('critical') === '1') where.push(CRITICAL);
  const user = params.get('user');
  if (user) { where.push('user = ?'); args.push(user); }
  const q = String(params.get('q') || '').trim();
  if (q) { where.push("(user LIKE ? OR action LIKE ? OR detail LIKE ? OR ip LIKE ?)"); const like = `%${q}%`; args.push(like, like, like, like); }
  const from = Number(params.get('from'));
  if (from > 0) { where.push('created >= ?'); args.push(from); }
  const before = Number(params.get('before'));
  const limit = Math.max(20, Math.min(500, Number(params.get('limit')) || 150));
  const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageWhere = before > 0 ? `${baseWhere ? `${baseWhere} AND` : 'WHERE'} id < ?` : baseWhere;
  const rows = db.prepare(`SELECT * FROM audit ${pageWhere} ORDER BY id DESC LIMIT ?`).all(...args, ...(before > 0 ? [before] : []), limit + 1);
  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit);

  let stats = null;
  if (!before) {
    const now = Date.now();
    const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const base = showSystem ? '' : `WHERE NOT ${CAT_SQL('system')}`;
    const andOr = (cond) => (base ? `${base} AND ${cond}` : `WHERE ${cond}`);
    const one = (sql, ...a) => db.prepare(sql).get(...a)?.n || 0;
    const byCat = {};
    for (const k of Object.keys(CATS)) byCat[k] = k === 'system' && !showSystem ? one(`SELECT COUNT(*) n FROM audit WHERE ${CAT_SQL('system')}`) : one(`SELECT COUNT(*) n FROM audit ${andOr(CAT_SQL(k))}`);
    const since30 = now - 30 * 86400_000;
    const days = db.prepare(`SELECT created FROM audit ${andOr('created >= ?')}`).all(since30);
    const perDay = {};
    for (const r of days) { const d = new Date(r.created); d.setHours(0, 0, 0, 0); perDay[d.getTime()] = (perDay[d.getTime()] || 0) + 1; }
    const byDay = [];
    for (let i = 29; i >= 0; i -= 1) { const d = new Date(day0.getTime() - i * 86400_000); byDay.push({ day: d.getTime(), n: perDay[d.getTime()] || 0 }); }
    stats = {
      total: one(`SELECT COUNT(*) n FROM audit ${base}`),
      today: one(`SELECT COUNT(*) n FROM audit ${andOr('created >= ?')}`, day0.getTime()),
      week: one(`SELECT COUNT(*) n FROM audit ${andOr('created >= ?')}`, now - 7 * 86400_000),
      critical: one(`SELECT COUNT(*) n FROM audit ${andOr(`${CRITICAL} AND created >= ?`)}`, now - 7 * 86400_000),
      users: db.prepare(`SELECT user, COUNT(*) n, MAX(created) last FROM audit ${base} GROUP BY user ORDER BY n DESC LIMIT 12`).all(),
      byCat,
      byDay,
    };
  }
  return { entries, hasMore, stats };
}
