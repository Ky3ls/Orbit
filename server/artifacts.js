import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ORBIT_ARTIFACTS_ROOT } from './config.js';

const exec = promisify(execFile);

const ARTIFACT_CHANNEL = 'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/';
const CHANGELOG_API = 'https://changelogs-live.fivem.net/api/changelog/versions/linux/server';
/** Neue Quelle: docs.fivem.net (Index-Seite redirected seit 2026). */
const DOCS_DOWNLOAD = 'https://docs.fivem.net/docs/server-download/?platform=legacy&os=linux';

const LINUX_FX_RE = /https:\/\/runtime\.fivem\.net\/artifacts\/fivem\/build_proot_linux\/master\/(\d+)-([a-f0-9]+)\/fx\.tar\.xz/gi;

/** @type {{ recommended?: string, latest?: string, recommended_download?: string, latest_download?: string, builds?: { build: string, url: string }[] } | null} */
let catalogCache = null;
let catalogAt = 0;

export function artifactsRoot() {
  return ORBIT_ARTIFACTS_ROOT;
}

function parseLinuxLinks(html) {
  const seen = new Set();
  const builds = [];
  LINUX_FX_RE.lastIndex = 0;
  let m;
  while ((m = LINUX_FX_RE.exec(html))) {
    const build = m[1];
    const url = m[0];
    if (seen.has(build)) continue;
    seen.add(build);
    builds.push({ build, url, folder: `${build}-${m[2]}` });
  }
  return builds;
}

/**
 * Katalog aus docs.fivem.net (__NEXT_DATA__ / HTML) + optional Changelog-API.
 */
async function fetchArtifactCatalog() {
  if (catalogCache && Date.now() - catalogAt < 60_000) return catalogCache;

  /** @type {{ recommended?: string, latest?: string, recommended_download?: string, latest_download?: string, builds: { build: string, url: string }[] }} */
  const out = { builds: [] };

  try {
    const res = await fetch(DOCS_DOWNLOAD, {
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'text/html', 'User-Agent': 'OrbitPanel/1.0' },
      redirect: 'follow',
    });
    if (res.ok) {
      const html = await res.text();
      // __NEXT_DATA__: legacy.recommended / legacy.latest
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nd) {
        try {
          const data = JSON.parse(nd[1]);
          const legacy = data?.props?.pageProps?.downloads?.legacy
            || data?.props?.pageProps?.legacy
            || findLegacyNode(data);
          const recUrl = pickLinuxUrl(legacy?.recommended);
          const latUrl = pickLinuxUrl(legacy?.latest);
          if (recUrl) {
            out.recommended_download = recUrl;
            out.recommended = buildFromUrl(recUrl);
          }
          if (latUrl) {
            out.latest_download = latUrl;
            out.latest = buildFromUrl(latUrl);
          }
        } catch { /* HTML-Fallback */ }
      }
      out.builds = parseLinuxLinks(html);
      if (!out.recommended && out.builds[0]) {
        out.recommended = out.builds[0].build;
        out.recommended_download = out.builds[0].url;
      }
      if (!out.latest) {
        const newest = [...out.builds].sort((a, b) => Number(b.build) - Number(a.build))[0];
        if (newest) {
          out.latest = newest.build;
          out.latest_download = newest.url;
        }
      }
    }
  } catch { /* changelog fallback */ }

  // Changelog-API (oft null seit 2026 — trotzdem versuchen)
  try {
    const res = await fetch(CHANGELOG_API, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        if (data.recommended) out.recommended = String(data.recommended);
        if (data.latest) out.latest = String(data.latest);
        if (data.recommended_download) out.recommended_download = String(data.recommended_download);
        if (data.latest_download) out.latest_download = String(data.latest_download);
      }
    }
  } catch { /* ignore */ }

  if (!out.builds.length && !out.recommended_download && !out.latest_download) {
    throw new Error('Artifact-Katalog nicht erreichbar (docs.fivem.net / Changelog).');
  }

  catalogCache = out;
  catalogAt = Date.now();
  return out;
}

function findLegacyNode(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (obj.recommended?.linux || obj.latest?.linux) return obj;
  if (obj.legacy) return findLegacyNode(obj.legacy, depth + 1);
  for (const v of Object.values(obj)) {
    const found = findLegacyNode(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function pickLinuxUrl(block) {
  if (!block) return '';
  const list = Array.isArray(block.linux) ? block.linux : (Array.isArray(block) ? block : []);
  for (const item of list) {
    const url = String(item?.downloadURL || item?.url || '');
    if (url.includes('build_proot_linux') && url.includes('fx.tar')) return url;
  }
  return '';
}

function buildFromUrl(url) {
  const m = String(url).match(/\/(\d+)-[a-f0-9]+\/fx\.tar\.xz/i);
  return m ? m[1] : '';
}

export async function fetchRecommendedBuild() {
  const cat = await fetchArtifactCatalog();
  const build = String(cat.recommended || cat.latest || cat.builds?.[0]?.build || '').trim();
  if (!build) throw new Error('Kein empfohlener FX-Build gefunden.');
  return build;
}

export async function listRecentBuilds(limit = 12) {
  const cat = await fetchArtifactCatalog();
  const builds = (cat.builds || [])
    .map((b) => Number(b.build))
    .filter((n) => n > 0);
  const unique = [...new Set(builds)].sort((a, b) => b - a).slice(0, limit);
  return { recommended: cat.recommended || '', builds: unique };
}

async function resolveArtifactUrl(buildNum) {
  const cat = await fetchArtifactCatalog();
  const want = String(buildNum);
  for (const key of ['recommended_download', 'latest_download']) {
    const url = String(cat[key] || '');
    if (url.includes(`/${want}-`) && url.includes('fx.tar')) return url;
  }
  const hit = (cat.builds || []).find((b) => b.build === want);
  if (hit?.url) return hit.url;
  // Direkter Versuch (Hash unbekannt → nur wenn Katalog den Ordner hat)
  throw new Error(`Build ${buildNum} nicht im Artifact-Katalog gefunden.`);
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
  try {
    const { ensureFxNodePackageSentinel } = await import('./orbitBridgeSync.js');
    ensureFxNodePackageSentinel(dest, onLog);
  } catch { /* optional */ }
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

/** Erstes fertiges Artifact unter /opt/orbit/artifacts (für Auto-Repair). */
export function findAnyInstalledArtifact() {
  const list = installedArtifacts().filter((a) => a.ready);
  return list[0] || null;
}
