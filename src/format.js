export function fmtTime(ts) {
  if (!ts) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts);
}

export function fmtFull(ts) {
  if (!ts) return '–';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtUptime(from) {
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 48) return `${Math.floor(h / 24)} Tage`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtPlaytime(ms) {
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d, ${h}h, ${m}m`;
  if (h > 0) return `${h}h, ${m}m`;
  if (m > 0) return `${m}m`;
  return '–';
}

export function roleLabel(role) {
  if (role === 'owner') return 'Inhaber';
  if (role === 'admin') return 'Admin';
  if (role === 'custom') return 'Individuell';
  return 'Moderator';
}
