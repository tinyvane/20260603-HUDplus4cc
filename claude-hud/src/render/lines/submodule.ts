import type { RenderContext } from '../../types.js';
import { label, green, yellow, dim } from '../colors.js';

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
export function renderSubmoduleLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showSubmodulePush !== true) {
    return null;
  }

  const sm = ctx.submoduleConfig;
  if (!sm || sm.count === 0) {
    return null;
  }

  const count = sm.count > 1 ? dim(` ×${sm.count}`) : '';
  const status = sm.recurseOnDemand
    ? green('✓ on-demand')
    : yellow('✗ run on-demand');

  return `${label('Submodule', ctx.config?.colors)}${count} ${status}`;
}
