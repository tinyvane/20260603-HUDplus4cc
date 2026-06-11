export interface LineDiff {
    added: number;
    deleted: number;
}
export interface TrackedFile {
    basename: string;
    fullPath: string;
    type: 'modified' | 'added' | 'deleted';
    lineDiff?: LineDiff;
}
export interface FileStats {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    trackedFiles: TrackedFile[];
}
export interface GitStatus {
    branch: string;
    isDirty: boolean;
    ahead: number;
    behind: number;
    fileStats?: FileStats;
    lineDiff?: LineDiff;
    branchUrl?: string;
}
export interface GitCommandOptions {
    /**
     * Per-git-command timeout in milliseconds. On machines where spawning git
     * is slow (e.g. antivirus real-time scanning on Windows), the default 1s
     * can silently kill commands and drop git info from the statusline; raise
     * it via `gitStatus.commandTimeoutMs`.
     */
    timeoutMs?: number;
}
export interface SubmoduleConfig {
    /** Number of gitlink entries (mode 160000) — nested git repos / submodules. */
    count: number;
    /** Raw value of `push.recurseSubmodules`, or null when unset. */
    recurseValue: string | null;
    /** True when `push.recurseSubmodules` is `on-demand` (the safe setting). */
    recurseOnDemand: boolean;
}
/**
 * Detect nested git repos committed as gitlinks and whether
 * `push.recurseSubmodules` is configured so that pushing the parent also
 * pushes those nested repos. Works even when there is no `.gitmodules`
 * mapping (a bare gitlink), which `git submodule status` cannot handle.
 *
 * Returns `count: 0` when the repo has no gitlinks (nothing to warn about),
 * or null when `cwd` is missing / not a git repo.
 */
export declare function getSubmoduleConfig(cwd?: string, options?: GitCommandOptions): Promise<SubmoduleConfig | null>;
export declare function getGitBranch(cwd?: string, options?: GitCommandOptions): Promise<string | null>;
export declare function getGitStatus(cwd?: string, options?: GitCommandOptions): Promise<GitStatus | null>;
//# sourceMappingURL=git.d.ts.map