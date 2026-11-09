/** Rechte im Frontend — dieselbe Liste, die der Server in user.permissions liefert (inkl. Ableitungen). */
export function can(user, perm) {
  const list = user?.permissions || [];
  if (user?.role === 'owner' || list.includes('*')) return true;
  return list.includes(perm);
}

/** Server-Beschränkung: null = alle Server */
export function scopes(user) {
  if (!user || user.role === 'owner') return null;
  const s = (user.permissions || []).filter((p) => p.startsWith('server:')).map((p) => p.slice(7));
  return s.length ? s : null;
}

export function canSeeServer(user, key) {
  const s = scopes(user);
  if (!s) return true;
  if (String(key).startsWith('fivem')) return s.some((x) => x.startsWith('fivem'));
  return s.includes(key);
}
