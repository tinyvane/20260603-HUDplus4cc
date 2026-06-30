export type ArchiveMode = 'backup' | 'recover';
export interface ArchiveProjectResult {
    project: string;
    copied: string[];
    skipped: string[];
    conflicts: string[];
}
export interface ArchiveResult {
    mode: ArchiveMode;
    archivePath: string;
    projects: number;
    copied: number;
    skipped: number;
    conflicts: number;
    details: ArchiveProjectResult[];
}
export interface ArchiveOptions {
    mode: ArchiveMode;
    archivePath: string;
    cwd?: string;
    all?: boolean;
    homeDir?: string;
}
/**
 * Back up project transcripts to the archive path.
 *
 * Non-destructive: refreshes archive copies that are missing or stale and
 * NEVER deletes archive files — so a session lost locally stays recoverable
 * from a prior backup.
 */
export declare function backupChats(opts: ArchiveOptions, homeDir?: string): ArchiveResult;
/**
 * Restore transcripts from the archive.
 *
 * Safe by design: only copies files that are MISSING locally and never
 * overwrites an existing local session.
 */
export declare function recoverChats(opts: ArchiveOptions, homeDir?: string): ArchiveResult;
export declare function runArchive(opts: ArchiveOptions, homeDir?: string): ArchiveResult;
export interface ChatCompareEntry {
    name: string;
    localBytes: number | null;
    archiveBytes: number | null;
}
export interface ChatComparison {
    localDir: string | null;
    archiveDir: string;
    entries: ChatCompareEntry[];
    localCount: number;
    localBytes: number;
    archiveCount: number;
    archiveBytes: number;
    onlyLocal: number;
    onlyArchive: number;
}
/** Compare the current project's local sessions against the archived copies. */
export declare function compareChats(opts: {
    archivePath: string;
    cwd: string;
    homeDir?: string;
}): ChatComparison;
export declare function formatComparison(cmp: ChatComparison): string;
/**
 * Read the persisted "back up every project by default" preference from the
 * HUD config (`chatArchive.backupAll`). Kept deliberately lean — it parses the
 * one boolean it needs and treats any read/parse error as "not enabled" so a
 * malformed config never blocks a backup.
 */
export declare function readBackupAllDefault(homeDir?: string): boolean;
interface ParsedArgs {
    mode: ArchiveMode | 'compare' | null;
    archivePath: string;
    cwd: string;
    /** null = not specified on the CLI (fall back to the config default). */
    all: boolean | null;
    json: boolean;
}
export declare function parseArchiveArgs(argv: string[]): ParsedArgs;
export declare function mainArchive(argv?: string[], homeDir?: string): number;
export {};
//# sourceMappingURL=chat-archive.d.ts.map