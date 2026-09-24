const DROP_PATTERNS = [
  /player\s+(\S+)\s+.*(?:dropped|disconnected).*?(?:reason|Reason)[:\s]+(.+)/i,
  /\[script:[^\]]+\]\s+(\S+)\s+dropped\s+\(([^)]+)\)/i,
  /(\S+)\s+left\s+\(([^)]+)\)/i,
  /Disconnecting:\s+([^\s]+).*reason:\s*(.+)/i,
];

export function parseDropFromLogLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  for (const re of DROP_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return {
        name: m[1].slice(0, 64),
        reason: m[2].slice(0, 200),
      };
    }
  }
  if (/dropped|disconnect|timed out|exiting/i.test(text) && text.length < 400) {
    return { name: '—', reason: text.slice(0, 200) };
  }
  return null;
}

export function recordDrop(db, { name, reason, identifier = '' }) {
  db.prepare(`
    INSERT INTO player_drops (player_name, identifier, reason, created)
    VALUES (?, ?, ?, ?)
  `).run(name || '—', identifier || '', reason || 'unknown', Date.now());
}

export function listDrops(db, hours = 24, limit = 200) {
  const since = Date.now() - hours * 3600_000;
  const rows = db.prepare(`
    SELECT id, player_name, identifier, reason, created
    FROM player_drops WHERE created >= ? ORDER BY id DESC LIMIT ?
  `).all(since, limit);
  const stats = db.prepare(`
    SELECT reason, COUNT(*) AS c FROM player_drops
    WHERE created >= ? GROUP BY reason ORDER BY c DESC LIMIT 15
  `).all(since);
  const bucketMs = hours <= 24 ? 3600_000 : 3 * 3600_000;
  const bucketCount = Math.max(1, Math.ceil((hours * 3600_000) / bucketMs));
  const series = Array.from({ length: bucketCount }, (_, i) => {
    const t = since + (i + 1) * bucketMs;
    return { t, drops: 0 };
  });
  for (const row of rows) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((row.created - since) / bucketMs)));
    series[idx].drops += 1;
  }
  return { rows, stats, hours, series, total: rows.length };
}

export function ensureDropsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_drops (
      id INTEGER PRIMARY KEY,
      player_name TEXT,
      identifier TEXT,
      reason TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drops_created ON player_drops(created DESC);
  `);
}
