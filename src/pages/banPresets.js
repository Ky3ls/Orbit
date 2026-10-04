/** Dauer-Presets — gespiegelt zu server/moderation.js (UI). Labels via i18n. */
export const BAN_DURATION_PRESETS = [
  { id: '1d', labelKey: 'ban.1d' },
  { id: '2d', labelKey: 'ban.2d' },
  { id: '7d', labelKey: 'ban.7d' },
  { id: '14d', labelKey: 'ban.14d' },
  { id: '30d', labelKey: 'ban.30d' },
  { id: 'perm', labelKey: 'ban.perm' },
];

const HHMM_RE = /^(\d{1,2}):([0-5]\d)$/;

/**
 * HH:MM validieren (00:00–23:59). Leerer String → { ok: true, hours: 0, minutes: 0 }.
 * @param {string} raw
 * @returns {{ ok: true, hours: number, minutes: number } | { ok: false, error: 'empty'|'format'|'range' }}
 */
export function parseHhMm(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: true, hours: 0, minutes: 0 };
  const m = HHMM_RE.exec(s);
  if (!m) return { ok: false, error: 'format' };
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23) return { ok: false, error: 'range' };
  return { ok: true, hours, minutes };
}

/**
 * Custom Tage + HH:MM → Flex-ID (z. B. 2d3h30m / 12h / 45m).
 * @param {number|string} days
 * @param {string} hhmm
 * @returns {{ ok: true, id: string, totalMinutes: number } | { ok: false, error: 'hhmm'|'zero'|'days' }}
 */
export function customDurationToId(days, hhmm) {
  const d = Math.floor(Number(days) || 0);
  if (!Number.isFinite(d) || d < 0 || d > 9999) return { ok: false, error: 'days' };
  const time = parseHhMm(hhmm);
  if (!time.ok) return { ok: false, error: 'hhmm' };
  const totalMinutes = d * 24 * 60 + time.hours * 60 + time.minutes;
  if (totalMinutes < 1) return { ok: false, error: 'zero' };

  let rem = totalMinutes;
  const outDays = Math.floor(rem / (24 * 60));
  rem %= 24 * 60;
  const outHours = Math.floor(rem / 60);
  const outMins = rem % 60;

  let id = '';
  if (outDays) id += `${outDays}d`;
  if (outHours) id += `${outHours}h`;
  if (outMins) id += `${outMins}m`;
  return { ok: true, id, totalMinutes };
}

/** @deprecated Prefer customDurationToId — kept for simple hour presets. */
export function hoursToDurationId(hours) {
  const n = Math.max(1, Math.min(9999, Math.floor(Number(hours) || 0)));
  return `${n}h`;
}

/** Flex-/Compound-ID → Formularfelder Tage + HH:MM. */
export function durationIdToCustomParts(id) {
  const flex = parseDurationId(id);
  if (!flex) return null;
  let totalMinutes = 0;
  if (flex.kind === 'compound') totalMinutes = flex.totalMinutes;
  else if (flex.kind === 'flex') {
    if (flex.unit === 'minutes') totalMinutes = flex.amount;
    else if (flex.unit === 'hours') totalMinutes = flex.amount * 60;
    else if (flex.unit === 'days') totalMinutes = flex.amount * 24 * 60;
    else if (flex.unit === 'weeks') totalMinutes = flex.amount * 7 * 24 * 60;
    else return null;
  } else return null;
  if (totalMinutes < 1) return null;
  const days = Math.floor(totalMinutes / (24 * 60));
  const rem = totalMinutes % (24 * 60);
  const hours = Math.floor(rem / 60);
  const minutes = rem % 60;
  return {
    days: String(days),
    hhmm: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  };
}

/** @param {string} id */
export function parseDurationId(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  if (s === 'perm') return { kind: 'perm', id: s };
  const preset = BAN_DURATION_PRESETS.find((p) => p.id === s);
  if (preset) return { kind: 'preset', id: s };

  const simple = /^(\d{1,4})(h|d|w|m)$/i.exec(s);
  if (simple) {
    const amount = Number(simple[1]);
    const u = simple[2].toLowerCase();
    const unit = u === 'h' ? 'hours' : u === 'w' ? 'weeks' : u === 'm' ? 'minutes' : 'days';
    return { kind: 'flex', id: s, amount, unit };
  }

  const compound = /^(?:(\d{1,4})d)?(?:(\d{1,4})h)?(?:(\d{1,4})m)?$/i.exec(s);
  if (compound && (compound[1] || compound[2] || compound[3])) {
    const days = Number(compound[1] || 0);
    const hours = Number(compound[2] || 0);
    const minutes = Number(compound[3] || 0);
    return {
      kind: 'compound',
      id: s,
      days,
      hours,
      minutes,
      totalMinutes: days * 24 * 60 + hours * 60 + minutes,
    };
  }
  return null;
}

/** @param {string} id @param {(k: string, vars?: Record<string, string|number>) => string} [t] */
export function banDurationLabel(id, t) {
  const preset = BAN_DURATION_PRESETS.find((p) => p.id === id);
  if (preset) return t ? t(preset.labelKey) : preset.labelKey;
  const flex = parseDurationId(id);
  if (flex?.kind === 'flex' && t) {
    if (flex.unit === 'hours') return t('ban.nh', { n: flex.amount });
    if (flex.unit === 'weeks') return t('ban.nw', { n: flex.amount });
    if (flex.unit === 'minutes') return t('ban.nm', { n: flex.amount });
    return t('ban.nd', { n: flex.amount });
  }
  if (flex?.kind === 'compound' && t) {
    const parts = [];
    if (flex.days) parts.push(t('ban.nd', { n: flex.days }));
    if (flex.hours) parts.push(t('ban.nh', { n: flex.hours }));
    if (flex.minutes) parts.push(t('ban.nm', { n: flex.minutes }));
    return parts.join(' · ') || id;
  }
  if (id === 'custom' && t) return t('ban.custom');
  return id || '—';
}
