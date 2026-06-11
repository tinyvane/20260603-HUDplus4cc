import type { RenderContext } from '../../types.js';
/**
 * Plugin version footer, shown by default (opt out via `display.showVersion`).
 * Rendered as the last HUD line, right-aligned by render() when the terminal
 * width is known:
 *
 *   claude-hud v0.3.0                          (up to date / unknown)
 *   claude-hud v0.3.0 (v0.4.0 update available)   (newer version visible)
 *
 * The update hint appears when a local marketplace clone advertises a newer
 * version than the running one — fix is `/plugin update claude-hud`.
 */
export declare function renderVersionLine(ctx: RenderContext): string | null;
//# sourceMappingURL=version.d.ts.map