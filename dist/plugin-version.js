import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { getHomeDir, getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './utils/cache.js';
const PLUGIN_NAME = 'claude-hud';
const VERSION_SCAN_CACHE_TTL_MS = 60_000;
const VERSION_SCAN_CACHE_FILE = '.plugin-version-scan-cache.json';
/** Compare dotted numeric versions. Returns <0, 0, >0 like a comparator. */
export function compareVersions(a, b) {
    const pa = a.split('.').map((part) => parseInt(part, 10));
    const pb = b.split('.').map((part) => parseInt(part, 10));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const na = Number.isFinite(pa[i]) ? pa[i] : 0;
        const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
        if (na !== nb)
            return na - nb;
    }
    return 0;
}
function isVersionString(value) {
    return typeof value === 'string' && /^\d+(\.\d+)*$/.test(value.trim());
}
function readJsonFile(filePath) {
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function readPluginManifestVersion(pluginRootDir) {
    const manifest = readJsonFile(path.join(pluginRootDir, '.claude-plugin', 'plugin.json'));
    if (manifest && isVersionString(manifest.version)) {
        return manifest.version.trim();
    }
    return null;
}
/**
 * Version of the plugin that is actually running, resolved relative to this
 * module (dist/plugin-version.js → ../.claude-plugin/plugin.json). Works both
 * from the plugin cache layout (<cache>/<marketplace>/claude-hud/<version>/)
 * and from a development checkout.
 */
export function getOwnVersion(moduleUrl = import.meta.url) {
    try {
        const moduleDir = path.dirname(fileURLToPath(moduleUrl));
        return readPluginManifestVersion(path.resolve(moduleDir, '..'));
    }
    catch {
        return null;
    }
}
/**
 * Newest claude-hud version advertised by any local marketplace clone.
 * Returns null when no marketplace carries the plugin (e.g. dev installs).
 */
export function getLatestMarketplaceVersion(configDir) {
    const baseDir = configDir ?? getClaudeConfigDir(getHomeDir());
    const marketplacesDir = path.join(baseDir, 'plugins', 'marketplaces');
    let entries;
    try {
        entries = readdirSync(marketplacesDir);
    }
    catch {
        return null;
    }
    let latest = null;
    for (const entry of entries) {
        const marketplaceDir = path.join(marketplacesDir, entry);
        const manifest = readJsonFile(path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'));
        if (!manifest || !Array.isArray(manifest.plugins))
            continue;
        for (const plugin of manifest.plugins) {
            if (plugin?.name !== PLUGIN_NAME || typeof plugin.source !== 'string')
                continue;
            const version = readPluginManifestVersion(path.resolve(marketplaceDir, plugin.source));
            if (version && (latest === null || compareVersions(version, latest) > 0)) {
                latest = version;
            }
        }
    }
    return latest;
}
export function getPluginVersionInfo(options) {
    if (!options) {
        const homeDir = getHomeDir();
        const cachePath = path.join(getHudPluginDir(homeDir), VERSION_SCAN_CACHE_FILE);
        const current = getOwnVersion();
        try {
            const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
            if (typeof cached.checkedAt === 'number'
                && Date.now() - cached.checkedAt < VERSION_SCAN_CACHE_TTL_MS
                && cached.current === current
                && (cached.current === null || isVersionString(cached.current))
                && (cached.latest === null || isVersionString(cached.latest))
                && typeof cached.updateAvailable === 'boolean') {
                return {
                    current: cached.current,
                    latest: cached.latest,
                    updateAvailable: cached.updateAvailable,
                };
            }
        }
        catch {
            // Missing or stale cache falls through to a fresh marketplace scan.
        }
        const latest = getLatestMarketplaceVersion();
        const updateAvailable = current !== null && latest !== null && compareVersions(latest, current) > 0;
        const result = { current, latest, updateAvailable };
        try {
            atomicWriteFileSync(cachePath, JSON.stringify({ ...result, checkedAt: Date.now() }));
        }
        catch {
            // Version display remains available when cache writes fail.
        }
        return result;
    }
    const current = getOwnVersion(options?.moduleUrl);
    const latest = getLatestMarketplaceVersion(options?.configDir);
    const updateAvailable = current !== null && latest !== null && compareVersions(latest, current) > 0;
    return { current, latest, updateAvailable };
}
//# sourceMappingURL=plugin-version.js.map