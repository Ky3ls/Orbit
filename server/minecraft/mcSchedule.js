import { getMcInstance, listMcInstances } from './mcDb.js';
import { isRunning, restartMc, sendMc } from './mcProcess.js';

/* Geplante Neustarts pro Minecraft-Instanz (Uhrzeiten in Europe/Berlin) */
const TZ = 'Europe/Berlin';
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimes(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return [...new Set(list.map((x) => String(x).trim()).filter((x) => HM_RE.test(x)))].sort().slice(0, 8);
}

function berlinMinutes(d = new Date()) {
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

/** Nächster geplanter Neustart: { at, hhmm } oder null */
export function nextRestart(inst) {
  const times = parseTimes(inst.restart_times);
  if (!times.length) return null;
  const now = new Date();
  const cur = berlinMinutes(now);
  let best = null;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    let mins = h * 60 + m - cur;
    if (mins <= 0) mins += 24 * 60;
    if (!best || mins < best.mins) best = { mins, hhmm: t };
  }
  const at = new Date(now.getTime() + best.mins * 60_000);
  at.setSeconds(0, 0);
  return { at: at.getTime(), hhmm: best.hhmm };
}

/** Geplante Befehle: [{ at: 'HH:MM', cmd }] — max. 20, ohne führenden Slash */
export function parseCmds(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw || '[]'); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({ at: String(x?.at || '').trim(), cmd: String(x?.cmd || '').replace(/[\r\n]/g, ' ').trim().replace(/^\//, '').slice(0, 300) }))
    .filter((x) => HM_RE.test(x.at) && x.cmd)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 20);
}

const firedCmd = new Set();
const fired = new Map(); // id → Schlüssel der letzten Aktion
const warn = (inst, text) => {
  const msg = JSON.stringify(['', { text: '» ', color: 'dark_gray' }, { text: 'Geplanter Neustart', color: 'gold', bold: true }, { text: ` ${text}`, color: 'yellow' }]);
  try { sendMc(inst, `tellraw @a ${msg}`); } catch { /* */ }
};

let timer = null;
export function initMcSchedule(db, log = () => {}) {
  clearInterval(timer);
  timer = setInterval(() => {
    for (const inst of listMcInstances(db)) {
      if (!isRunning(inst.id)) continue;
      const cur = berlinMinutes();
      const day = new Date().toISOString().slice(0, 10);
      for (const c of parseCmds(inst.scheduled_cmds)) {
        const [h, m] = c.at.split(':').map(Number);
        const key = `${inst.id} ${day} ${c.at} ${c.cmd}`;
        if (h * 60 + m === cur && !firedCmd.has(key)) {
          firedCmd.add(key);
          if (firedCmd.size > 2000) firedCmd.clear();
          try { sendMc(inst, c.cmd); log('info', `[MC:${inst.slug}] geplanter Befehl (${c.at}): ${c.cmd}`); } catch { /* */ }
        }
      }
      const times = parseTimes(inst.restart_times);
      for (const t of times) {
        const [h, m] = t.split(':').map(Number);
        let left = h * 60 + m - cur;
        if (left < 0) left += 24 * 60;
        const day = new Date().toISOString().slice(0, 10);
        const key = (stage) => `${day} ${t} ${stage}`;
        const last = fired.get(inst.id) || '';
        if (left === 5 && last !== key(5)) { fired.set(inst.id, key(5)); warn(inst, 'in 5 Minuten.'); }
        else if (left === 1 && last !== key(1)) { fired.set(inst.id, key(1)); warn(inst, 'in 1 Minute.'); }
        else if (left === 0 && last !== key(0)) {
          fired.set(inst.id, key(0));
          log('info', `[MC:${inst.slug}] geplanter Neustart (${t})`);
          const fresh = getMcInstance(db, inst.id);
          restartMc(db, fresh.id, log).catch((e) => log('warn', `[MC:${inst.slug}] geplanter Neustart: ${e.message}`));
        }
      }
    }
  }, 15_000);
  timer.unref?.();
}
