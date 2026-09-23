export async function api(path, opts = {}) {
  if (typeof window !== 'undefined' && window.location.protocol !== 'https:'
    && window.location.hostname !== 'localhost'
    && window.location.hostname !== '127.0.0.1') {
    throw new Error('API nur über HTTPS erreichbar.');
  }
  const res = await fetch(path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-TX2-Client': '1',
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Anfrage fehlgeschlagen');
    error.status = res.status;
    throw error;
  }
  return data;
}

export function mergeLines(prev, incoming) {
  const map = new Map(prev.map((line) => [line.id, line]));
  for (const line of incoming) map.set(line.id, line);
  return [...map.values()].sort((a, b) => a.id - b.id).slice(-400);
}
