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
export declare function getSubmoduleConfig(cwd?: string): Promise<SubmoduleConfig | null>;
export declare function getGitBranch(cwd?: string): Promise<string | null>;
export declare function getGitStatus(cwd?: string): Promise<GitStatus | null>;
//# sourceMappingURL=git.d.ts.map