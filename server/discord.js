export async function discordWebhook(settings, payload) {
  if (settings.discordEnabled !== '1') return { skipped: true };
  const url = String(settings.discordWebhook || '').trim();
  if (!url) return { skipped: true };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return { ok: true };
}

export function embedStatus(title, description, color = 0xff7a1a) {
  return {
    embeds: [{
      title,
      description,
      color,
      timestamp: new Date().toISOString(),
    }],
  };
}

export async function notifyServerEvent(settings, title, body) {
  try {
    return await discordWebhook(settings, embedStatus(title, body));
  } catch {
    return { ok: false };
  }
}

export async function notifyPlayerDrop(settings, { name, reason }) {
  if (settings.discordNotifyDrops !== '1') return { skipped: true };
  const title = 'Spieler disconnected';
  const description = `**${String(name || '—').slice(0, 64)}**\n${String(reason || '').slice(0, 500)}`;
  return notifyServerEvent(settings, title, description);
}
