import type { RenderContext } from '../../types.js';
/** Compact human-readable byte size, e.g. 1.4MB / 920KB / 12B. */
export declare function formatBytes(bytes: number): string;
/** Compact relative age token, e.g. <1m / 5m / 2h / 3d. */
export declare function formatAge(timestampMs: number, nowMs: number): string;
export declare function renderChatsLine(ctx: RenderContext, nowMs?: number): string | null;
//# sourceMappingURL=chats.d.ts.map