import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { getHomeDir, getClaudeConfigDir } from './claude-config-dir.js';

/**
 * Plugin self-version reporting and offline update detection.
 *
 * The HUD shows its own version in the bottom-right corner by default, with
 * an "update available" hint when a newer version is visible. Detection is
 * fully offline: Claude Code keeps a clone of each added marketplace under
 * `<configDir>/plugins/marketplaces/`, and refreshes those clones
 * independently of the installed plugin cache. When the marketplace clone
 * carries a newer claude-hud version than the one currently running, an
 * update is one `/plugin update` away. No network calls are made — the
 * statusline runs every ~300ms and must stay cheap and silent.
 */

export interface PluginVersionInfo {
  /** Version of the running plugin, from its own plugin.json (null if unreadable). */
  current: string | null;
  /** Newest claude-hud version found across local marketplace clones. */
  latest: string | null;
  /** True when latest is a strictly newer semver than current. */
  updateAvailable: boolean;
}

const PLUGIN_NAME = 'claude-hud';

/** Compare dotted numeric versions. Returns <0, 0, >0 like a comparator. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => parseInt(part, 10));
  const pb = b.split('.').map((part) => parseInt(part, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function isVersionString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d+)*$/.test(value.trim());
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readPluginManifestVersion(pluginRootDir: string): string | null {
  const manifest = readJsonFile(path.join(pluginRootDir, '.claude-plugin', 'plugin.json')) as
    | { version?: unknown }
    | null;
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
export function getOwnVersion(moduleUrl: string = import.meta.url): string | null {
  try {
    const moduleDir = path.dirname(fileURLToPath(moduleUrl));
    return readPluginManifestVersion(path.resolve(moduleDir, '..'));
  } catch {
    return null;
  }
}

/**
 * Newest claude-hud version advertised by any local marketplace clone.
 * Returns null when no marketplace carries the plugin (e.g. dev installs).
 */
export function getLatestMarketplaceVersion(configDir?: string): string | null {
  const baseDir = configDir ?? getClaudeConfigDir(getHomeDir());
  const marketplacesDir = path.join(baseDir, 'plugins', 'marketplaces');

  let entries: string[];
  try {
    entries = readdirSync(marketplacesDir);
  } catch {
    return null;
  }

  let latest: string | null = null;
  for (const entry of entries) {
    const marketplaceDir = path.join(marketplacesDir, entry);
    const manifest = readJsonFile(path.join(marketplaceDir, '.claude-plugin', 'marketplace.json')) as
      | { plugins?: Array<{ name?: unknown; source?: unknown }> }
      | null;
    if (!manifest || !Array.isArray(manifest.plugins)) continue;

    for (const plugin of manifest.plugins) {
      if (plugin?.name !== PLUGIN_NAME || typeof plugin.source !== 'string') continue;
      const version = readPluginManifestVersion(path.resolve(marketplaceDir, plugin.source));
      if (version && (latest === null || compareVersions(version, latest) > 0)) {
        latest = version;
      }
    }
  }

  return latest;
}

export function getPluginVersionInfo(options?: {
  configDir?: string;
  moduleUrl?: string;
}): PluginVersionInfo {
  const current = getOwnVersion(options?.moduleUrl);
  const latest = getLatestMarketplaceVersion(options?.configDir);
  const updateAvailable =
    current !== null && latest !== null && compareVersions(latest, current) > 0;
  return { current, latest, updateAvailable };
}
