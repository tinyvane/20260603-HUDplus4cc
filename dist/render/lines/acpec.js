import { label, green, red } from '../colors.js';
/**
 * A small status indicator reminding the user that ACPEC (auto commit & push on
 * session end) exists and whether it is currently enabled:
 *   ACPEC ✓  (green) when on
 *   ACPEC ✗  (red)   when off
 * Opt-in via `display.showAcpec`. Reflects `acpec.enabled` from config.
 */
export function renderAcpecLine(ctx) {
    const display = ctx.config?.display;
    if (display?.showAcpec !== true) {
        return null;
    }
    const enabled = ctx.config?.acpec?.enabled === true;
    const mark = enabled ? green('✓') : red('✗');
    return `${label('ACPEC', ctx.config?.colors)} ${mark}`;
}
//# sourceMappingURL=acpec.js.map