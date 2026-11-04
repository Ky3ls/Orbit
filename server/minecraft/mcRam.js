import fs from 'node:fs';
import os from 'node:os';

/** MemAvailable aus /proc/meminfo (os.freemem zählt Page-Cache nicht mit) */
export function hostMemory() {
  const total = Math.round(os.totalmem() / 1048576);
  let available = Math.round(os.freemem() / 1048576);
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
    if (m) available = Math.round(Number(m[1]) / 1024);
  } catch { /* */ }
  return { totalMb: total, availableMb: available };
}

const BASE = { vanilla: 2048, paper: 2048, purpur: 2048, fabric: 3072, forge: 4096, neoforge: 4096 };
const PER_MOD = { fabric: 48, forge: 80, neoforge: 80, paper: 24, purpur: 24, vanilla: 0 };
const PER_PLAYER = { vanilla: 64, paper: 48, purpur: 48, fabric: 96, forge: 128, neoforge: 128 };

const roundUp = (mb, step = 512) => Math.ceil(mb / step) * step;

/**
 * RAM-Empfehlung für eine Instanz.
 * @param {{ type: string, mods?: number, players?: number, viewDistance?: number, reservedMb?: number, currentMb?: number }} p
 */
export function suggestRam({ type, mods = 0, players = 20, viewDistance = 10, reservedMb = 0, currentMb = 0 }) {
  const host = hostMemory();
  const reasons = [];
  let mb = BASE[type] ?? 2048;
  reasons.push(`Grundbedarf ${type === 'vanilla' ? 'Vanilla' : type}: ${mb} MB`);
  const modMb = Math.max(0, mods) * (PER_MOD[type] ?? 0);
  if (modMb) {
    mb += modMb;
    reasons.push(`${mods} ${type === 'paper' || type === 'purpur' ? 'Plugins' : 'Mods'}: +${modMb} MB`);
  }
  const playerMb = Math.max(0, players) * (PER_PLAYER[type] ?? 64);
  mb += playerMb;
  reasons.push(`${players} Spieler-Slots: +${playerMb} MB`);
  if (viewDistance > 10) {
    const extra = (viewDistance - 10) * 192;
    mb += extra;
    reasons.push(`Sichtweite ${viewDistance}: +${extra} MB`);
  }
  let recommended = roundUp(mb);
  // Budget: freier Speicher + was diese Instanz schon belegt, abzüglich Reserve fürs System
  const budget = Math.max(1024, host.availableMb + currentMb - reservedMb - 1536);
  let capped = false;
  if (recommended > budget) {
    recommended = Math.max(1024, Math.floor(budget / 512) * 512);
    capped = true;
    reasons.push(`Begrenzt auf verfügbaren Speicher (${budget} MB frei)`);
  }
  const min = Math.min(recommended, roundUp(Math.max(1024, (BASE[type] ?? 2048) * 0.6)));
  const max = Math.max(recommended, Math.floor(Math.min(host.totalMb * 0.8, budget) / 512) * 512);
  let level = 'ok';
  if (capped) level = 'warn';
  if (recommended < (BASE[type] ?? 2048)) level = 'bad';
  return { recommended, min, max, host, budget, reasons, level };
}

/** JVM-Flags: Aikar-Flags (G1GC) — bewährt für alle Server-Typen */
export function jvmFlags(ramMb) {
  const big = ramMb >= 12 * 1024;
  return [
    `-Xms${ramMb}M`,
    `-Xmx${ramMb}M`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${big ? 40 : 30}`,
    `-XX:G1MaxNewSizePercent=${big ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${big ? '16M' : '8M'}`,
    `-XX:G1ReservePercent=${big ? 15 : 20}`,
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    `-XX:InitiatingHeapOccupancyPercent=${big ? 20 : 15}`,
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
  ];
}
