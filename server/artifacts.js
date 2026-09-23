import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ORBIT_ARTIFACTS_ROOT } from './config.js';

const exec = promisify(execFile);

const ARTIFACT_CHANNEL = 'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/';
const CHANGELOG_API = 'https://changelogs-live.fivem.net/api/changelog/versions/linux/server';

/** @type {{ recommended?: string, latest?: string, recommended_download?: string, latest_download?: string } | null} */
let changelogCache = null;
let changelogAt = 0;

export function artifactsRoot() {
  return ORBIT_ARTIFACTS_ROOT;
}

async function fetchChangelog() {
  if (changelogCache && Date.now() - changelogAt < 60_000) return changelogCache;
  const res = await fetch(CHANGELOG_API, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Changelog-API nicht erreichbar (${res.status}).`);
  changelogCache = await res.json();
  changelogAt = Date.now();
  return changelogCache;
}

export async function fetchRecommendedBuild() {
  try {
    const data = await fetchChangelog();
    const build = String(data.recommended || data.latest || '').trim();
    if (build) return build;
  } catch {
    /* HTML-Fallback */
  }
  const { builds } = await listRecentBuildsFromIndex(1);
  if (!builds.length) throw new Error('Artifact-Liste nicht erreichbar.');
  return String(builds[0]);
}

async function listRecentBuildsFromIndex(limit = 12) {
  const res = await fetch(ARTIFACT_CHANNEL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error('Artifact-Index nicht erreichbar.');
  const html = await res.text();
  // Neue Index-Seite: href="./35945-<hash>/" oder ".../fx.tar.xz"
  const builds = [...html.matchAll(/href="\.?\/?(\d+)-[a-f0-9]+(?:\/(?:fx\.tar\.xz)?)?"/gi)]
    .map((m) => m[1]);
  const unique = [...new Set(builds)].map(Number).filter((n) => n > 0).sort((a, b) => b - a);
  return { builds: unique.slice(0, limit), html };
}

export async function listRecentBuilds(limit = 12) {
  const { builds } = await listRecentBuildsFromIndex(limit);
  let recommended = '';
  try {
    recommended = await fetchRecommendedBuild();
  } catch { /* optional */ }
  return { recommended, builds };
}

async function resolveArtifactUrl(buildNum) {
  try {
    const data = await fetchChangelog();
    for (const key of ['recommended_download', 'latest_download', 'optional_download', 'critical_download']) {
      const url = String(data[key] || '');
      if (url.includes(`/${buildNum}-`) && url.includes('fx.tar')) return url;
    }
  } catch { /* index fallback */ }

  const { html } = await listRecentBuildsFromIndex(50);
  const folder = html.match(new RegExp(`(?:href="\\.?/?)(${buildNum}-[a-f0-9]+)(?:/|/)`, 'i'))?.[1]
    || html.match(new RegExp(`(${buildNum}-[a-f0-9]+)/fx\\.tar\\.xz`, 'i'))?.[1];
  if (!folder) throw new Error(`Build ${buildNum} nicht im Artifact-Index gefunden.`);
  return `${ARTIFACT_CHANNEL}${folder}/fx.tar.xz`;
}

export function installedArtifacts() {
  const root = artifactsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('build-'))
    .map((d) => {
      const full = path.join(root, d.name);
      const hasFx = fs.existsSync(path.join(full, 'alpine/opt/cfx-server/FXServer'));
      return { id: d.name, path: full, ready: hasFx };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Lädt FXServer-Artifact (Linux proot) und entpackt nach ORBIT_ARTIFACTS_ROOT/build-<nr>
 */
export async function installArtifact(build, onLog = () => {}) {
  const buildNum = String(build || '').replace(/\D/g, '');
  if (!buildNum) throw new Error('Build-Nummer fehlt.');
  const root = artifactsRoot();
  fs.mkdirSync(root, { recursive: true });
  const dest = path.join(root, `build-${buildNum}`);
  if (fs.existsSync(path.join(dest, 'alpine/opt/cfx-server/FXServer'))) {
    return { path: dest, build: buildNum, skipped: true };
  }
  fs.mkdirSync(dest, { recursive: true });
  const url = await resolveArtifactUrl(buildNum);
  const archive = path.join(dest, 'fx.tar.xz');
  onLog(`Lade Artifact ${buildNum}…`);
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) {
    throw new Error(`Download fehlgeschlagen (${res.status}). Build ${buildNum} prüfen.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(archive, buf);
  onLog('Entpacke…');
  await exec('tar', ['-xJf', archive, '-C', dest], { timeout: 600_000 });
  fs.unlinkSync(archive);
  if (!fs.existsSync(path.join(dest, 'alpine/opt/cfx-server/FXServer'))) {
    throw new Error('Entpacken OK, aber FXServer-Binary fehlt — Artifact-Layout geändert?');
  }
  onLog(`Artifact bereit: ${dest}`);
  return { path: dest, build: buildNum, skipped: false };
}

/** Aktives FX-Artifact ohne Neu-Download (Pfad in Settings). */
export function resolveInstalledArtifact(build) {
  const buildNum = String(build || '').replace(/\D/g, '');
  if (!buildNum) throw new Error('Build-Nummer fehlt.');
  const dest = path.join(artifactsRoot(), `build-${buildNum}`);
  if (!fs.existsSync(path.join(dest, 'alpine/opt/cfx-server/FXServer'))) {
    throw new Error(`build-${buildNum} ist nicht installiert.`);
  }
  return { path: dest, build: buildNum };
}
