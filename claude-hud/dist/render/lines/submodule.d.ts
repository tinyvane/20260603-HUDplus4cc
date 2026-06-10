import type { RenderContext } from '../../types.js';
/**
 * A reminder that the repo contains nested git repos (gitlinks) and whether
 * `push.recurseSubmodules` is set to `on-demand`. When it is NOT on-demand,
 * pushing the parent will not push the nested repos — so tools that rely on it
 * (e.g. a codesync workflow) silently do nothing useful. The fix is to run:
 *
 *   git config push.recurseSubmodules on-demand
 *
 * Shows:
 *   Submodule ✓ on-demand   (green) when configured correctly
 *   Submodule ✗ run on-demand (yellow) when it still needs to be turned on
 *
 * Only appears when the repo actually has nested git repos. Opt-in via
 * `display.showSubmodulePush`.
 */
export declare function renderSubmoduleLine(ctx: RenderContext): string | null;
//# sourceMappingURL=submodule.d.ts.map