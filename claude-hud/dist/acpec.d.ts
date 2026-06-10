import type { HudConfig } from './config.js';
/**
 * ACPEC — "auto commit and push every conversation".
 *
 * Invoked from a Claude Code SessionEnd hook. When enabled in config it stages
 * tracked changes (`git add -u`), commits, and pushes the current branch of the
 * session's working directory. Guarded so it never touches non-repos, detached
 * heads, protected branches, or pushes by force. Disabled by default.
 */
export type AcpecAction = 'committed' | 'skipped';
export interface AcpecResult {
    action: AcpecAction;
    reason?: string;
    branch?: string;
    filesChanged?: number;
    pushed?: boolean;
}
export type GitRunner = (args: string[], cwd: string) => string;
export interface RunAcpecOptions {
    cwd: string;
    config: HudConfig;
    now?: Date;
    git?: GitRunner;
}
/**
 * Run the ACPEC flow against a working directory. Pure of process/stdin so it
 * can be unit-tested against real temp git repos with a `git` injector.
 */
export declare function runAcpec(opts: RunAcpecOptions): AcpecResult;
export declare function formatAcpecResult(result: AcpecResult): string;
export declare function mainAcpec(): Promise<number>;
//# sourceMappingURL=acpec.d.ts.map