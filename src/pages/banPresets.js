/** Dauer-Presets — gespiegelt zu server/moderation.js (UI). */
export const BAN_DURATION_PRESETS = [
  { id: '2h', label: '2 Stunden' },
  { id: '8h', label: '8 Stunden' },
  { id: '1d', label: '1 Tag' },
  { id: '2d', label: '2 Tage' },
  { id: '7d', label: '7 Tage' },
  { id: '14d', label: '14 Tage' },
  { id: '30d', label: '30 Tage' },
  { id: 'perm', label: 'Permanent' },
];

export function banDurationLabel(id) {
  return BAN_DURATION_PRESETS.find((p) => p.id === id)?.label || id || '—';
}
