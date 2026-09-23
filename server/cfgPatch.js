/** server.cfg: OneSync, Game Build und Slots ohne die ganze Datei zu ersetzen */

const ONESYNC_LINE = /^\s*(?:##\s*)?set\s+onesync\s+/i;
const ONESYNC_VALIDATOR = /^\s*##\s*\[txAdmin CFG validator\]:\s*onesync\s+/i;
const GAME_BUILD_LINE = /^\s*(?:set\s+)?sv_enforceGameBuild\s+/i;

export function parseOnesyncFromCfg(text) {
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (ONESYNC_VALIDATOR.test(t)) {
      const m = t.match(/onesync\s+(\w+)/i);
      if (m) {
        const v = m[1].toLowerCase();
        if (v === 'off' || v === 'legacy' || v === 'on') return v;
      }
    }
    const m = t.match(/^set\s+onesync\s+(on|legacy|off)/i);
    if (m) return m[1].toLowerCase();
    if (/^##\s*set\s+onesync\s+off/i.test(t)) return 'off';
  }
  return 'on';
}

export function parseGameBuildFromCfg(text) {
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^(?:set\s+)?sv_enforceGameBuild\s+(\d+)/i);
    if (m) return m[1];
  }
  return '';
}

function onesyncLines(mode) {
  const onesync = mode === 'off' ? 'off' : mode === 'legacy' ? 'legacy' : 'on';
  // Kein `set onesync` in cfg — internes ConVar, nur per FX-Launch +set
  return [
    `## [Orbit]: onesync ${onesync} (via FX-Launch +set)`,
  ];
}

function upsertQuoted(lines, re, line) {
  let ok = false;
  const out = lines.map((l) => {
    if (re.test(l.trim())) {
      ok = true;
      return line;
    }
    return l;
  });
  if (!ok) out.push(line);
  return out;
}

/**
 * @param {string} text
 * @param {{ onesync?: string, gameBuild?: string, maxClients?: number, hostname?: string, project?: string, tags?: string, locale?: string }} opts
 */
export function patchCfgServerOpts(text, opts) {
  let lines = String(text || '').split('\n');
  const drop = (re) => { lines = lines.filter((l) => !re.test(l.trim())); };

  if (opts.onesync !== undefined) {
    drop(ONESYNC_VALIDATOR);
    drop(ONESYNC_LINE);
    drop(/^##\s*set\s+onesync\s+off/i);
    const ins = onesyncLines(opts.onesync);
    const idx = lines.findIndex((l) => /^sv_maxclients\s+/i.test(l.trim()));
    const at = idx >= 0 ? idx + 1 : 0;
    lines.splice(at, 0, '', ...ins);
  }

  if (opts.maxClients !== undefined && Number.isInteger(opts.maxClients)) {
    let replaced = false;
    lines = lines.map((l) => {
      if (/^sv_maxclients\s+/i.test(l.trim())) {
        replaced = true;
        return `sv_maxclients ${opts.maxClients}`;
      }
      return l;
    });
    if (!replaced) {
      const idx = lines.findIndex((l) => /^sv_hostname\s+/i.test(l.trim()));
      lines.splice(idx >= 0 ? idx + 1 : 0, 0, `sv_maxclients ${opts.maxClients}`);
    }
  }

  if (opts.gameBuild !== undefined) {
    drop(GAME_BUILD_LINE);
    const gb = String(opts.gameBuild || '').trim();
    if (gb && /^\d{4,5}$/.test(gb)) {
      const idx = lines.findIndex((l) => ONESYNC_LINE.test(l.trim()) || ONESYNC_VALIDATOR.test(l.trim()));
      const at = idx >= 0 ? idx + 1 : lines.length;
      lines.splice(at, 0, `set sv_enforceGameBuild ${gb}`);
    }
  }

  if (opts.hostname) {
    const safe = String(opts.hostname).replace(/"/g, '');
    lines = upsertQuoted(lines, /^sv_hostname\s+/i, `sv_hostname "${safe}"`);
  }
  if (opts.project) {
    const safe = String(opts.project).replace(/"/g, '');
    lines = upsertQuoted(lines, /^sets\s+sv_projectName\s+/i, `sets sv_projectName "${safe}"`);
  }
  if (opts.tags !== undefined) {
    const safe = String(opts.tags || '').replace(/"/g, '');
    lines = upsertQuoted(lines, /^sets\s+tags\s+/i, `sets tags "${safe}"`);
  }
  if (opts.locale) {
    const safe = String(opts.locale).replace(/"/g, '');
    lines = upsertQuoted(lines, /^sets\s+locale\s+/i, `sets locale "${safe}"`);
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}
