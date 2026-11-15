import { settingMap, setSetting } from '../db.js';

/*
 * Minecraft-Benachrichtigungen: Discord-Webhook (eigener für MC) + Liste im Panel.
 * Arten: crash, crashloop, backup, disk, unreachable, lag
 */
export const ALERT_KINDS = {
  crash: 'Absturz',
  crashloop: 'Crash-Schleife',
  backup: 'Backup fehlgeschlagen',
  disk: 'Speicherplatz knapp',
  unreachable: 'Server nicht erreichbar',
  lag: 'Starker Lag',
};
const COLORS = { crash: 0xff453a, crashloop: 0xff453a, backup: 0xff9f0a, disk: 0xff9f0a, unreachable: 0xff453a, lag: 0xffd60a, test: 0x32d74b };

let DB = null;
const recent = []; // für die Anzeige im Panel
const lastSent = new Map(); // kind:instance → Zeit (Spam-Schutz)

export function initMcAlerts(db) { DB = db; }

export function alertConfig() {
  const s = DB ? settingMap(DB) : {};
  let kinds = {};
  try { kinds = JSON.parse(s.mcAlertKinds || '{}'); } catch { /* */ }
  const out = {};
  for (const k of Object.keys(ALERT_KINDS)) out[k] = kinds[k] !== false;
  return { webhook: String(s.mcAlertWebhook || ''), kinds: out };
}

export function setAlertConfig(patch) {
  if (patch.webhook !== undefined) {
    const w = String(patch.webhook || '').trim();
    if (w && !/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(w)) {
      throw new Error('Das ist kein Discord-Webhook-Link (https://discord.com/api/webhooks/…).');
    }
    setSetting(DB, 'mcAlertWebhook', w);
  }
  if (patch.kinds) {
    const cur = alertConfig().kinds;
    for (const k of Object.keys(ALERT_KINDS)) if (patch.kinds[k] !== undefined) cur[k] = !!patch.kinds[k];
    setSetting(DB, 'mcAlertKinds', JSON.stringify(cur));
  }
  return alertConfig();
}

export function recentAlerts(instId) {
  return recent.filter((a) => instId == null || a.instance === Number(instId)).slice(-30).reverse();
}

async function post(webhook, payload) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord antwortet mit ${res.status}`);
}

/**
 * Meldung auslösen. `minGapMs` verhindert, dass dieselbe Art für denselben Server ständig feuert.
 */
export function mcAlert(kind, inst, title, text, { minGapMs = 30 * 60_000, fields = [] } = {}) {
  const key = `${kind}:${inst?.id ?? '-'}`;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < minGapMs) return;
  lastSent.set(key, now);
  recent.push({ kind, instance: inst ? Number(inst.id) : null, server: inst?.name || null, title, text, at: now });
  if (recent.length > 200) recent.splice(0, recent.length - 200);
  const cfg = alertConfig();
  if (!cfg.webhook || cfg.kinds[kind] === false) return;
  post(cfg.webhook, {
    username: 'Orbit',
    embeds: [{
      title: `${inst?.name ? `${inst.name} · ` : ''}${title}`,
      description: String(text || '').slice(0, 3800),
      color: COLORS[kind] ?? 0xff7a1a,
      fields: fields.slice(0, 10).map((f) => ({ name: String(f.name).slice(0, 250), value: String(f.value || '–').slice(0, 1000), inline: !!f.inline })),
      footer: { text: `Minecraft · ${ALERT_KINDS[kind] || kind}` },
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => { /* Discord nicht erreichbar */ });
}

export async function testAlert() {
  const cfg = alertConfig();
  if (!cfg.webhook) throw new Error('Erst einen Webhook-Link eintragen.');
  await post(cfg.webhook, { username: 'Orbit', embeds: [{ title: 'Testnachricht', description: 'Minecraft-Benachrichtigungen von Orbit kommen hier an. ✅', color: COLORS.test, timestamp: new Date().toISOString() }] });
}
