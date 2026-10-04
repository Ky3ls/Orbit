/** Dauer-Presets — gespiegelt zu server/moderation.js (UI). Labels via i18n. */
export const BAN_DURATION_PRESETS = [
  { id: '1d', labelKey: 'ban.1d' },
  { id: '2d', labelKey: 'ban.2d' },
  { id: '7d', labelKey: 'ban.7d' },
  { id: '14d', labelKey: 'ban.14d' },
  { id: '30d', labelKey: 'ban.30d' },
  { id: 'perm', labelKey: 'ban.perm' },
];

/** @param {number|string} hours */
export function hoursToDurationId(hours) {
  const n = Math.max(1, Math.min(9999, Math.floor(Number(hours) || 0)));
  return `${n}h`;
}

/** @param {string} id */
export function parseDurationId(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  if (s === 'perm') return { kind: 'perm', id: s };
  const preset = BAN_DURATION_PRESETS.find((p) => p.id === s);
  if (preset) return { kind: 'preset', id: s };
  const m = /^(\d{1,4})(h|d|w)$/i.exec(s);
  if (!m) return null;
  const amount = Number(m[1]);
  const u = m[2].toLowerCase();
  const unit = u === 'h' ? 'hours' : u === 'w' ? 'weeks' : 'days';
  return { kind: 'flex', id: s, amount, unit };
}

/** @param {string} id @param {(k: string, vars?: Record<string, string|number>) => string} [t] */
export function banDurationLabel(id, t) {
  const preset = BAN_DURATION_PRESETS.find((p) => p.id === id);
  if (preset) return t ? t(preset.labelKey) : preset.labelKey;
  const flex = parseDurationId(id);
  if (flex?.kind === 'flex' && t) {
    if (flex.unit === 'hours') return t('ban.nh', { n: flex.amount });
    if (flex.unit === 'weeks') return t('ban.nw', { n: flex.amount });
    return t('ban.nd', { n: flex.amount });
  }
  if (id === 'custom' && t) return t('ban.custom');
  return id || '—';
}
