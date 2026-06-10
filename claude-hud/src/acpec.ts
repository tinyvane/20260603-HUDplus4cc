import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
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

const defaultGit: GitRunner = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function tryGit(git: GitRunner, args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const out = (e?.stderr ? e.stderr.toString() : e?.message ?? '').trim();
    return { ok: false, out };
  }
}

function isHomeDirectory(gitToplevel: string): boolean {
  try {
    // git prints forward slashes even on Windows; resolve() normalizes both
    // sides before comparing (case-insensitively on win32).
    const top = resolve(gitToplevel);
    const home = resolve(homedir());
    if (process.platform === 'win32') return top.toLowerCase() === home.toLowerCase();
    return top === home;
  } catch {
    return false;
  }
}

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
export function runAcpec(opts: RunAcpecOptions): AcpecResult {
  const git = opts.git ?? defaultGit;
  const { cwd } = opts;
  const acpec = opts.config.acpec;

  if (!acpec?.enabled) return { action: 'skipped', reason: 'disabled' };
  if (!cwd) return { action: 'skipped', reason: 'no-cwd' };

  const inRepo = tryGit(git, ['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inRepo.ok || inRepo.out !== 'true') return { action: 'skipped', reason: 'not-a-git-repo' };

  // Refuse repos rooted at the user's home directory. A stray `git init` in
  // $HOME would otherwise turn every session under home into an auto-commit
  // of personal files.
  const toplevel = tryGit(git, ['rev-parse', '--show-toplevel'], cwd);
  if (toplevel.ok && isHomeDirectory(toplevel.out)) {
    return { action: 'skipped', reason: 'home-dir-repo' };
  }

  const branchRes = tryGit(git, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const branch = branchRes.out;
  if (!branchRes.ok || !branch || branch === 'HEAD') {
    return { action: 'skipped', reason: 'detached-head' };
  }
  if ((acpec.protectedBranches ?? []).includes(branch)) {
    return { action: 'skipped', reason: 'protected-branch', branch };
  }

  // Stage only tracked modifications/deletions — never new untracked files.
  const add = tryGit(git, ['add', '-u'], cwd);
  if (!add.ok) return { action: 'skipped', reason: 'add-failed', branch };

  const staged = tryGit(git, ['diff', '--cached', '--name-only'], cwd);
  const files = staged.ok ? staged.out.split('\n').filter(Boolean) : [];
  if (files.length === 0) return { action: 'skipped', reason: 'no-changes', branch };

  const now = opts.now ?? new Date();
  const prefix = acpec.commitPrefix || 'chore(acpec): auto-sync';
  const message = `${prefix} ${now.toISOString()}`;
  const commit = tryGit(git, ['commit', '-m', message], cwd);
  if (!commit.ok) return { action: 'skipped', reason: 'commit-failed', branch };

  // Push the current branch. Never force. Prefer the configured upstream;
  // fall back to `origin <branch>` only when an origin remote exists.
  let pushed = false;
  const hasUpstream = tryGit(git, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd).ok;
  if (hasUpstream) {
    pushed = tryGit(git, ['push'], cwd).ok;
  } else if (tryGit(git, ['remote', 'get-url', 'origin'], cwd).ok) {
    pushed = tryGit(git, ['push', '-u', 'origin', branch], cwd).ok;
  }

  return { action: 'committed', branch, filesChanged: files.length, pushed };
}

const SKIP_REASONS: Record<string, string> = {
  disabled: 'disabled',
  'no-cwd': 'no working directory',
  'not-a-git-repo': 'not a git repository',
  'home-dir-repo': 'repository rooted at the home directory',
  'detached-head': 'detached HEAD',
  'protected-branch': 'protected branch',
  'add-failed': 'git add failed',
  'no-changes': 'no tracked changes',
  'commit-failed': 'git commit failed',
};

export function formatAcpecResult(result: AcpecResult): string {
  const tag = '[claude-hud ACPEC]';
  if (result.action === 'committed') {
    const push = result.pushed ? 'and pushed' : 'but push was skipped/failed';
    return `${tag} committed ${result.filesChanged} file(s) on ${result.branch} ${push}`;
  }
  const reason = result.reason === 'protected-branch'
    ? `protected branch ${result.branch}`
    : SKIP_REASONS[result.reason ?? ''] ?? result.reason ?? 'unknown';
  return `${tag} skipped: ${reason}`;
}

/** Read the session cwd from the hook's stdin JSON, falling back to process.cwd(). */
async function resolveCwd(fallback: string): Promise<string> {
  if (process.stdin.isTTY) return fallback;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (raw) {
      const data = JSON.parse(raw) as { cwd?: unknown };
      if (typeof data.cwd === 'string' && data.cwd) return data.cwd;
    }
  } catch {
    // Fall through to the working directory.
  }
  return fallback;
}

export async function mainAcpec(): Promise<number> {
  const cwd = await resolveCwd(process.cwd());
  const config = await loadConfig();
  const result = runAcpec({ cwd, config });
  // SessionEnd surfaces stderr to the user; keep it to a single concise line.
  process.stderr.write(formatAcpecResult(result) + '\n');
  return 0;
}

// Run as a CLI when invoked directly (the SessionEnd hook), not when imported
// by tests. fileURLToPath + realpathSync keeps the entry comparison correct on
// Windows where URL.pathname yields non-native "/C:/..." paths.
const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
  void mainAcpec().then((code) => process.exit(code));
}
