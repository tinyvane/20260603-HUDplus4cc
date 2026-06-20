import { dim, yellow } from '../colors.js';
import { t } from '../../i18n/index.js';
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
export function renderVersionLine(ctx) {
    if (ctx.config?.display?.showVersion === false) {
        return null;
    }
    const info = ctx.pluginVersion;
    if (!info || !info.current) {
        return null;
    }
    const base = dim(`claude-hud v${info.current}`);
    if (info.updateAvailable && info.latest) {
        return `${base} ${yellow(`(v${info.latest} ${t('label.updateAvailable')})`)}`;
    }
    return base;
}
//# sourceMappingURL=version.js.map