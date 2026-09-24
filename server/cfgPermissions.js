/**
 * Orbit Permissions-Block für server.cfg — immer am Dateiende.
 *
 * Format:
 *   # Permissions
 *   add_principal group.admin group.user
 *   add_ace group.admin command allow # allow all commands
 *   …
 *
 * resource.es_extended-* nur wenn Setup-Profil ESX.
 * Master fivem:/discord: nur wenn Owner verknüpft.
 */
import fs from 'node:fs';

export const ORBIT_PERM_BEGIN = '# Permissions';
/** Legacy-Marker (werden beim Sync entfernt) */
const LEGACY_PERM_BEGIN = '# --- Orbit Permissions ---';
const LEGACY_PERM_END = '# --- Ende Orbit Permissions ---';

const MANAGED_LINE_RES = [
  /^\s*add_principal\s+group\.admin\s+group\.user\b/i,
  /^\s*add_ace\s+group\.admin\s+command\b/i,
  /^\s*add_ace\s+group\.admin\s+command\.quit\b/i,
  /^\s*add_ace\s+resource\.es_extended\s+command(\.|$|\s)/i,
  /^\s*add_ace\s+resource\.ox_lib\s+command\b/i,
  /^\s*add_ace\s+resource\.qb-core\s+command\b/i,
  /^\s*add_principal\s+identifier\.(fivem|discord):\S+\s+group\.admin\b/i,
  /^\s*#\s*Admin-Befehle\b/i,
  /^\s*#\s*Permissions\s*$/i,
  /^\s*#\s*---\s*Orbit Permissions\s*---\s*$/i,
  /^\s*#\s*---\s*Ende Orbit Permissions\s*---\s*$/i,
];

/**
 * @param {{ cfxId?: string|null, cfxName?: string|null, discordId?: string|null }} [master]
 * @param {{ profile?: string, includeEsx?: boolean, includeQb?: boolean }} [opts]
 */
export function buildOrbitPermissionsBlock(master = {}, opts = {}) {
  const lines = [
    ORBIT_PERM_BEGIN,
    'add_principal group.admin group.user',
    'add_ace group.admin command allow # allow all commands',
    'add_ace group.admin command.quit deny # but don\'t allow quit',
  ];

  const includeEsx = opts.includeEsx === true;
  const includeQb = opts.includeQb === true;

  if (includeEsx) {
    lines.push(
      'add_ace resource.es_extended command.add_ace allow',
      'add_ace resource.es_extended command.add_principal allow',
      'add_ace resource.es_extended command.remove_principal allow',
      'add_ace resource.es_extended command.stop allow',
      'add_ace resource.es_extended command allow',
      'add_ace resource.es_extended command.quit allow',
      'add_ace resource.ox_lib command allow',
    );
  }
  if (includeQb) {
    lines.push('add_ace resource.qb-core command allow');
  }

  const cfxId = String(master.cfxId || '').replace(/\D/g, '');
  const cfxName = String(master.cfxName || '').replace(/[^\w.\- ]/g, '').slice(0, 32);
  const discordId = String(master.discordId || '').replace(/\D/g, '');

  if (cfxId) {
    lines.push(`add_principal identifier.fivem:${cfxId} group.admin${cfxName ? ` #${cfxName}` : ''}`);
  }
  if (discordId) {
    lines.push(`add_principal identifier.discord:${discordId} group.admin${cfxName ? ` #${cfxName}` : ''}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Master (owner) aus DB — nur role=owner. */
export function loadMasterIdentity(db) {
  if (!db) return { cfxId: null, cfxName: null, discordId: null };
  try {
    const row = db.prepare(
      `SELECT cfx_id, cfx_name, discord_id FROM users WHERE role = 'owner' AND disabled = 0 ORDER BY id ASC LIMIT 1`,
    ).get();
    if (!row) return { cfxId: null, cfxName: null, discordId: null };
    return {
      cfxId: row.cfx_id || null,
      cfxName: row.cfx_name || null,
      discordId: row.discord_id || null,
    };
  } catch {
    return { cfxId: null, cfxName: null, discordId: null };
  }
}

/** Setup-/Settings-Profil: esx | qb | blank */
export function resolvePermissionProfile(opts = {}) {
  const explicit = String(opts.profile || opts.recipe || '').toLowerCase().trim();
  if (explicit === 'esx' || explicit === 'qb' || explicit === 'blank') return explicit;
  if (opts.db) {
    try {
      const row = opts.db.prepare(`SELECT v FROM settings WHERE k = 'profileRecipe'`).get();
      const v = String(row?.v || '').toLowerCase().trim();
      if (v === 'esx' || v === 'qb' || v === 'blank') return v;
    } catch { /* */ }
  }
  const t = String(opts.cfgText || '');
  if (/qb-core/i.test(t)) return 'qb';
  if (/es_extended|ensure\s+\[core\]/i.test(t)) return 'esx';
  return 'blank';
}

function stripOrbitPermissionBlocks(text) {
  let out = String(text || '');
  // Legacy Block mit Ende-Marker
  const legacyRe = new RegExp(
    `${LEGACY_PERM_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${LEGACY_PERM_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'gi',
  );
  out = out.replace(legacyRe, '');
  // Ab "# Permissions" bis Dateiende (unser Block ist immer zuletzt)
  out = out.replace(/(?:\r?\n)*#\s*Permissions\s*(?:\r?\n[\s\S]*)?$/i, '');
  const lines = out.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    return !MANAGED_LINE_RES.some((re) => re.test(t));
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Entfernt streuende ACE/Principal-Zeilen und hängt `# Permissions` am Ende an.
 */
export function applyOrbitPermissionsToCfg(cfgText, opts = {}) {
  const profile = resolvePermissionProfile({ ...opts, cfgText });
  const body = stripOrbitPermissionBlocks(cfgText);
  const includeEsx = opts.includeEsx === true || profile === 'esx';
  const includeQb = opts.includeQb === true || profile === 'qb';
  const block = buildOrbitPermissionsBlock(opts.master || {}, {
    profile,
    includeEsx,
    includeQb,
  });
  return `${body}\n\n${block}`;
}

/**
 * Datei syncen. No-op wenn unverändert.
 * @returns {{ changed: boolean, text: string }}
 */
export function syncOrbitPermissionsFile(cfgPath, opts = {}) {
  if (!cfgPath || !fs.existsSync(cfgPath)) return { changed: false, text: '' };
  const prev = fs.readFileSync(cfgPath, 'utf8');
  const master = opts.master || (opts.db ? loadMasterIdentity(opts.db) : {});
  const next = applyOrbitPermissionsToCfg(prev, { ...opts, master, cfgText: prev });
  if (next === prev) return { changed: false, text: prev };
  fs.writeFileSync(cfgPath, next, { encoding: 'utf8', mode: 0o644 });
  return { changed: true, text: next };
}
