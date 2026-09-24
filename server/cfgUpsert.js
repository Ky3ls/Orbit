/**
 * Idempotente server.cfg-Zeilen (set key / bare key / Kommentar-Platzhalter).
 */

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Setzt `set <key> "value"` — ersetzt aktive Zeile, Kommentar-Platzhalter oder hängt an.
 * Für Keys wie sv_licenseKey auch ohne `set`-Prefix.
 */
export function upsertCfgSet(cfg, key, value, { allowBare = false } = {}) {
  const quoted = `"${String(value).replace(/"/g, '')}"`;
  const k = escapeRe(key);
  const setLine = `set ${key} ${quoted}`;
  const bareLine = `${key} ${quoted}`;

  // Aktive set-Zeile
  const setRe = new RegExp(`^\\s*set\\s+${k}\\s+.*$`, 'mi');
  if (setRe.test(cfg)) return cfg.replace(setRe, setLine);

  // Bare (sv_licenseKey "…")
  if (allowBare) {
    const bareRe = new RegExp(`^\\s*${k}\\s+.*$`, 'mi');
    if (bareRe.test(cfg)) return cfg.replace(bareRe, bareLine);
  }

  // Kommentar-Platzhalter: # set key … / # key …
  const commentSetRe = new RegExp(`^\\s*#\\s*set\\s+${k}\\b.*$`, 'mi');
  if (commentSetRe.test(cfg)) return cfg.replace(commentSetRe, setLine);

  if (allowBare) {
    const commentBareRe = new RegExp(`^\\s*#\\s*${k}\\b.*$`, 'mi');
    if (commentBareRe.test(cfg)) return cfg.replace(commentBareRe, bareLine);
  }

  // Generischer Hinweis-Kommentar (mysql_connection_string wird …)
  const hintRe = new RegExp(`^\\s*#\\s*${k}\\b.*$`, 'mi');
  if (hintRe.test(cfg)) return cfg.replace(hintRe, setLine);

  return `${String(cfg).trimEnd()}\n${setLine}\n`;
}

/** setr key value (bools/Zahlen) oder setr key "value". */
export function upsertCfgSetr(cfg, key, value, { quoted = false } = {}) {
  const k = escapeRe(key);
  const val = quoted ? `"${String(value).replace(/"/g, '')}"` : String(value);
  const line = `setr ${key} ${val}`;
  const re = new RegExp(`^\\s*setr\\s+${k}\\s+.*$`, 'mi');
  if (re.test(cfg)) return cfg.replace(re, line);
  const commentRe = new RegExp(`^\\s*#\\s*setr\\s+${k}\\b.*$`, 'mi');
  if (commentRe.test(cfg)) return cfg.replace(commentRe, line);
  return `${String(cfg).trimEnd()}\n${line}\n`;
}

/** ensure-Zeile nur einmal; Namen mit [brackets] korrekt. */
export function ensureOnce(cfg, resourceName) {
  const name = String(resourceName || '').trim();
  if (!name) return cfg;
  const re = new RegExp(`^\\s*ensure\\s+${escapeRe(name)}(?:\\s|$|#)`, 'mi');
  if (re.test(cfg)) return cfg;
  return `${String(cfg).trimEnd()}\nensure ${name}\n`;
}
