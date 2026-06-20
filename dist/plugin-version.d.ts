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
/** Compare dotted numeric versions. Returns <0, 0, >0 like a comparator. */
export declare function compareVersions(a: string, b: string): number;
/**
 * Version of the plugin that is actually running, resolved relative to this
 * module (dist/plugin-version.js → ../.claude-plugin/plugin.json). Works both
 * from the plugin cache layout (<cache>/<marketplace>/claude-hud/<version>/)
 * and from a development checkout.
 */
export declare function getOwnVersion(moduleUrl?: string): string | null;
/**
 * Newest claude-hud version advertised by any local marketplace clone.
 * Returns null when no marketplace carries the plugin (e.g. dev installs).
 */
export declare function getLatestMarketplaceVersion(configDir?: string): string | null;
export declare function getPluginVersionInfo(options?: {
    configDir?: string;
    moduleUrl?: string;
}): PluginVersionInfo;
//# sourceMappingURL=plugin-version.d.ts.map