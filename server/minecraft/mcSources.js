/**
 * Versions- und Download-Quellen für Minecraft-Server.
 * Vanilla (Mojang), Paper (Fill v3), Purpur, Fabric, Forge, NeoForge.
 */
export const UA = 'Ky3ls/Orbit (orbit panel; github.com/Ky3ls/Orbit)';

export const MC_TYPES = [
  { id: 'vanilla', label: 'Vanilla', kind: 'vanilla', hint: 'Original-Server von Mojang — ohne Plugins oder Mods.' },
  { id: 'paper', label: 'Paper', kind: 'plugins', hint: 'Schnell und stabil, unterstützt Bukkit/Spigot/Paper-Plugins. Empfohlen für Plugin-Server.' },
  { id: 'purpur', label: 'Purpur', kind: 'plugins', hint: 'Paper-Fork mit vielen zusätzlichen Einstellungen. Plugins kompatibel.' },
  { id: 'fabric', label: 'Fabric', kind: 'mods', hint: 'Leichter Mod-Loader, schnell aktualisiert. Viele Performance- und QoL-Mods.' },
  { id: 'forge', label: 'Forge', kind: 'mods', hint: 'Klassischer Mod-Loader für große Modpacks.' },
  { id: 'neoforge', label: 'NeoForge', kind: 'mods', hint: 'Moderner Forge-Nachfolger, Standard für aktuelle Modpacks.' },
];

export function typeMeta(type) {
  return MC_TYPES.find((t) => t.id === type) || null;
}

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.text();
}

const TEN_MIN = 10 * 60_000;

/** Mojang-Manifest (alle Releases) */
export function mojangManifest() {
  return cached('mojang', TEN_MIN, () => getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
}

/** Versions-JSON einer MC-Version (enthält Java-Major + Server-Download) */
export async function mojangVersion(mcVersion) {
  return cached(`mojang:${mcVersion}`, 60 * 60_000, async () => {
    const m = await mojangManifest();
    const entry = m.versions.find((v) => v.id === mcVersion);
    if (!entry) throw new Error(`Minecraft ${mcVersion} unbekannt.`);
    return getJson(entry.url);
  });
}

/** Benötigte Java-Hauptversion laut Mojang (Fallback per Heuristik) */
export async function requiredJava(mcVersion) {
  try {
    const v = await mojangVersion(mcVersion);
    if (v?.javaVersion?.majorVersion) return Number(v.javaVersion.majorVersion);
  } catch { /* offline / unbekannt */ }
  const [a, b, c] = String(mcVersion).split('.').map((x) => Number(x) || 0);
  if (a >= 25) return 25;
  if (b >= 21 || (b === 20 && c >= 5)) return 21;
  if (b >= 18) return 17;
  if (b === 17) return 16;
  return 8;
}

function releaseIds(manifest) {
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}

/** NeoForge-Version → MC-Version (21.1.x → 1.21.1, 26.3.0.x → 26.3) */
export function neoToMc(v) {
  const p = String(v).split('.');
  if (Number(p[0]) >= 25) {
    const mc = p.slice(0, -1);
    while (mc.length > 2 && mc[mc.length - 1] === '0') mc.pop();
    return mc.join('.');
  }
  return p[1] && p[1] !== '0' ? `1.${p[0]}.${p[1]}` : `1.${p[0]}`;
}

/**
 * Liste der MC-Versionen je Typ (neueste zuerst) inkl. Loader-Versionen.
 * @returns {Promise<Array<{ mc: string, loader?: string, loaders?: string[], recommended?: boolean }>>}
 */
export async function listVersions(type) {
  return cached(`versions:${type}`, TEN_MIN, async () => {
    if (type === 'vanilla') {
      return releaseIds(await mojangManifest()).map((mc) => ({ mc }));
    }
    if (type === 'paper') {
      const d = await getJson('https://fill.papermc.io/v3/projects/paper');
      const all = Object.values(d.versions || {}).flat().filter((v) => !/-(rc|pre)/i.test(v));
      return all.map((mc) => ({ mc }));
    }
    if (type === 'purpur') {
      const d = await getJson('https://api.purpurmc.org/v2/purpur');
      return [...(d.versions || [])].reverse().map((mc) => ({ mc }));
    }
    if (type === 'fabric') {
      const [games, loaders] = await Promise.all([
        getJson('https://meta.fabricmc.net/v2/versions/game'),
        getJson('https://meta.fabricmc.net/v2/versions/loader'),
      ]);
      const loader = (loaders.find((l) => l.stable) || loaders[0])?.version;
      return games.filter((g) => g.stable).map((g) => ({ mc: g.version, loader, loaders: loaders.slice(0, 8).map((l) => l.version) }));
    }
    if (type === 'forge') {
      const d = await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      const byMc = new Map();
      for (const [key, ver] of Object.entries(d.promos || {})) {
        const m = key.match(/^(.+)-(latest|recommended)$/);
        if (!m) continue;
        const cur = byMc.get(m[1]) || { mc: m[1] };
        cur[m[2]] = ver;
        byMc.set(m[1], cur);
      }
      const order = releaseIds(await mojangManifest());
      return [...byMc.values()]
        .sort((x, y) => order.indexOf(x.mc) - order.indexOf(y.mc))
        .filter((x) => order.includes(x.mc))
        .map((x) => ({ mc: x.mc, loader: x.recommended || x.latest, loaders: [...new Set([x.recommended, x.latest].filter(Boolean))], recommended: !!x.recommended }));
    }
    if (type === 'neoforge') {
      const xml = await getText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
      const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => !/beta|alpha/i.test(v));
      const byMc = new Map();
      for (const v of versions) {
        const mc = neoToMc(v);
        if (!byMc.has(mc)) byMc.set(mc, []);
        byMc.get(mc).push(v);
      }
      const order = releaseIds(await mojangManifest());
      return [...byMc.entries()]
        .filter(([mc]) => order.includes(mc))
        .sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]))
        .map(([mc, list]) => {
          const sorted = list.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
          return { mc, loader: sorted[0], loaders: sorted.slice(0, 8) };
        });
    }
    throw new Error(`Unbekannter Server-Typ: ${type}`);
  });
}

/**
 * Was für eine Installation geladen werden muss.
 * @returns {Promise<{ url: string, file: string, installer?: boolean, loaderVersion?: string }>}
 */
export async function resolveDownload(type, mcVersion, loaderVersion) {
  if (type === 'vanilla') {
    const v = await mojangVersion(mcVersion);
    const url = v?.downloads?.server?.url;
    if (!url) throw new Error(`Für ${mcVersion} gibt es keinen offiziellen Server.`);
    return { url, file: 'server.jar' };
  }
  if (type === 'paper') {
    const b = await getJson(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(mcVersion)}/builds/latest`);
    const dl = b?.downloads?.['server:default'];
    if (!dl?.url) throw new Error(`Kein Paper-Build für ${mcVersion}.`);
    return { url: dl.url, file: 'server.jar', loaderVersion: String(b.id) };
  }
  if (type === 'purpur') {
    const d = await getJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mcVersion)}`);
    const build = d?.builds?.latest;
    if (!build) throw new Error(`Kein Purpur-Build für ${mcVersion}.`);
    return { url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mcVersion)}/${build}/download`, file: 'server.jar', loaderVersion: String(build) };
  }
  if (type === 'fabric') {
    const [loaders, installers] = await Promise.all([
      getJson('https://meta.fabricmc.net/v2/versions/loader'),
      getJson('https://meta.fabricmc.net/v2/versions/installer'),
    ]);
    const loader = loaderVersion || (loaders.find((l) => l.stable) || loaders[0]).version;
    const installer = (installers.find((i) => i.stable) || installers[0]).version;
    return {
      url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/server/jar`,
      file: 'server.jar',
      loaderVersion: loader,
    };
  }
  if (type === 'forge') {
    const list = await listVersions('forge');
    const fv = loaderVersion || list.find((x) => x.mc === mcVersion)?.loader;
    if (!fv) throw new Error(`Kein Forge für ${mcVersion}.`);
    const full = `${mcVersion}-${fv}`;
    return {
      url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
      file: 'installer.jar',
      installer: true,
      loaderVersion: fv,
    };
  }
  if (type === 'neoforge') {
    const list = await listVersions('neoforge');
    const nv = loaderVersion || list.find((x) => x.mc === mcVersion)?.loader;
    if (!nv) throw new Error(`Kein NeoForge für ${mcVersion}.`);
    return {
      url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${nv}/neoforge-${nv}-installer.jar`,
      file: 'installer.jar',
      installer: true,
      loaderVersion: nv,
    };
  }
  throw new Error(`Unbekannter Server-Typ: ${type}`);
}
