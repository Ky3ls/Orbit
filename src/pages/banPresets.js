/** Dauer-Presets — gespiegelt zu server/moderation.js (UI). Labels via i18n. */
export const BAN_DURATION_PRESETS = [
  { id: '2h', labelKey: 'ban.2h' },
  { id: '8h', labelKey: 'ban.8h' },
  { id: '1d', labelKey: 'ban.1d' },
  { id: '2d', labelKey: 'ban.2d' },
  { id: '7d', labelKey: 'ban.7d' },
  { id: '14d', labelKey: 'ban.14d' },
  { id: '30d', labelKey: 'ban.30d' },
  { id: 'perm', labelKey: 'ban.perm' },
];

/** @param {string} id @param {(k: string) => string} [t] */
export function banDurationLabel(id, t) {
  const preset = BAN_DURATION_PRESETS.find((p) => p.id === id);
  if (!preset) return id || '—';
  return t ? t(preset.labelKey) : preset.labelKey;
}
