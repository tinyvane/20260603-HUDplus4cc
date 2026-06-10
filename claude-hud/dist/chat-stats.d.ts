/**
 * Per-project conversation (transcript) statistics.
 *
 * Claude Code stores each session as a `<session-id>.jsonl` file inside
 * `<config-dir>/projects/<encoded-cwd>/`. Counting those files tells the user
 * how many conversations exist for the current project — useful when sessions
 * go missing (e.g. a sync conflict) and need restoring from a backup.
 */
export interface ChatStats {
    /** Resolved transcript directory for the current project, or null if unknown. */
    chatDir: string | null;
    /** Number of `.jsonl` session files currently present. */
    count: number;
    /** Highest count ever observed for this project (persisted high-water mark). */
    peak: number;
    /** True when count has dropped below the recorded peak (possible loss). */
    belowPeak: boolean;
    /** Combined size of all session files in bytes. */
    totalBytes: number;
    /** Most recent session mtime in epoch ms, or null when there are none. */
    lastActiveMs: number | null;
}
export declare const EMPTY_CHAT_STATS: ChatStats;
/**
 * Encode a working directory the way Claude Code names its project transcript
 * folders: path separators and the Windows drive colon become '-'.
 * e.g. `C:\Users\me\proj` -> `C--Users-me-proj`.
 */
export declare function encodeProjectDir(cwd: string): string;
/**
 * Resolve the transcript directory for the current project.
 *
 * Prefers the session's `transcriptPath` (its parent directory is exact and
 * platform-agnostic). Falls back to deriving the path from `cwd` + the config
 * dir, which is what the backup/recover commands use when no transcript is
 * piped in.
 */
export declare function resolveChatDir(opts: {
    transcriptPath?: string;
    cwd?: string;
    homeDir?: string;
}): string | null;
/**
 * Compute chat statistics for the current project.
 *
 * When `trackPeak` is enabled (default), the highest count ever seen is
 * persisted under the plugin cache dir and `belowPeak` flags drops below it.
 * Set `trackPeak: false` for read-only callers (e.g. the backup command).
 */
export declare function getChatStats(opts: {
    transcriptPath?: string;
    cwd?: string;
    homeDir?: string;
    trackPeak?: boolean;
}): ChatStats;
//# sourceMappingURL=chat-stats.d.ts.map