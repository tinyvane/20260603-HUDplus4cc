import type { RenderContext } from '../../types.js';
/**
 * A small status indicator reminding the user that ACPEC (auto commit & push on
 * session end) exists and whether it is currently enabled:
 *   ACPEC ✓  (green) when on
 *   ACPEC ✗  (red)   when off
 * Opt-in via `display.showAcpec`. Reflects `acpec.enabled` from config.
 */
export declare function renderAcpecLine(ctx: RenderContext): string | null;
//# sourceMappingURL=acpec.d.ts.map