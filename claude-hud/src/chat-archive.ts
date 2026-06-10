import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { getClaudeConfigDir, getHomeDir } from './claude-config-dir.js';
import { encodeProjectDir, resolveChatDir } from './chat-stats.js';

export type ArchiveMode = 'backup' | 'recover';

export interface ArchiveProjectResult {
  project: string;
  copied: string[];
  skipped: string[];
}

export interface ArchiveResult {
  mode: ArchiveMode;
  archivePath: string;
  projects: number;
  copied: number;
  skipped: number;
  details: ArchiveProjectResult[];
}

export interface ArchiveOptions {
  mode: ArchiveMode;
  archivePath: string;
  cwd?: string;
  all?: boolean;
  homeDir?: string;
}

function listJsonl(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function projectsRoot(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'projects');
}

/** Copy src -> dest, creating parent dirs and preserving mtime for idempotency. */
function copyPreservingMtime(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  try {
    const stat = fs.statSync(src);
    fs.utimesSync(dest, stat.atime, stat.mtime);
  } catch {
    // mtime preservation is best-effort.
  }
}

/**
 * True when src should be (re)copied to dest during backup.
 *
 * Copies when the archive copy is missing, a different size (a transcript that
 * grew), or meaningfully newer. A 2s mtime tolerance absorbs filesystem
 * timestamp-precision loss from utimes so unchanged files are reliably skipped
 * on repeat backups instead of being copied every run.
 */
function needsCopy(src: string, dest: string): boolean {
  try {
    const s = fs.statSync(src);
    const d = fs.statSync(dest);
    if (s.size !== d.size) return true;
    return s.mtimeMs > d.mtimeMs + 2000;
  } catch {
    return true; // dest missing
  }
}

/** Resolve the project folders to operate on (single from cwd, or all). */
function resolveProjects(opts: ArchiveOptions, homeDir: string): string[] {
  if (opts.all) {
    return listSubdirs(projectsRoot(homeDir));
  }
  const cwd = opts.cwd?.trim();
  return cwd ? [encodeProjectDir(cwd)] : [];
}

/**
 * Back up project transcripts to the archive path.
 *
 * Non-destructive: refreshes archive copies that are missing or stale and
 * NEVER deletes archive files — so a session lost locally stays recoverable
 * from a prior backup.
 */
export function backupChats(opts: ArchiveOptions, homeDir = getHomeDir()): ArchiveResult {
  const root = projectsRoot(homeDir);
  const projects = resolveProjects(opts, homeDir);
  const details: ArchiveProjectResult[] = [];

  for (const project of projects) {
    const sourceDir = path.join(root, project);
    const destDir = path.join(opts.archivePath, project);
    const copied: string[] = [];
    const skipped: string[] = [];

    for (const name of listJsonl(sourceDir)) {
      const src = path.join(sourceDir, name);
      const dest = path.join(destDir, name);
      if (needsCopy(src, dest)) {
        copyPreservingMtime(src, dest);
        copied.push(name);
      } else {
        skipped.push(name);
      }
    }

    if (copied.length > 0 || skipped.length > 0) {
      details.push({ project, copied, skipped });
    }
  }

  return summarize('backup', opts.archivePath, details);
}

/**
 * Restore transcripts from the archive.
 *
 * Safe by design: only copies files that are MISSING locally and never
 * overwrites an existing local session.
 */
export function recoverChats(opts: ArchiveOptions, homeDir = getHomeDir()): ArchiveResult {
  const root = projectsRoot(homeDir);
  // When recovering, the source of truth for "which projects" is the archive.
  const projects = opts.all
    ? listSubdirs(opts.archivePath)
    : resolveProjects(opts, homeDir);
  const details: ArchiveProjectResult[] = [];

  for (const project of projects) {
    const archiveDir = path.join(opts.archivePath, project);
    const localDir = path.join(root, project);
    const localExisting = new Set(listJsonl(localDir));
    const copied: string[] = [];
    const skipped: string[] = [];

    for (const name of listJsonl(archiveDir)) {
      if (localExisting.has(name)) {
        skipped.push(name);
        continue;
      }
      copyPreservingMtime(path.join(archiveDir, name), path.join(localDir, name));
      copied.push(name);
    }

    if (copied.length > 0 || skipped.length > 0) {
      details.push({ project, copied, skipped });
    }
  }

  return summarize('recover', opts.archivePath, details);
}

function summarize(mode: ArchiveMode, archivePath: string, details: ArchiveProjectResult[]): ArchiveResult {
  return {
    mode,
    archivePath,
    projects: details.length,
    copied: details.reduce((sum, d) => sum + d.copied.length, 0),
    skipped: details.reduce((sum, d) => sum + d.skipped.length, 0),
    details,
  };
}

export function runArchive(opts: ArchiveOptions, homeDir = getHomeDir()): ArchiveResult {
  return opts.mode === 'backup' ? backupChats(opts, homeDir) : recoverChats(opts, homeDir);
}

// --- comparison (local vs archive, side-by-side) ----------------------------

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

function listJsonlSizes(dir: string): Map<string, number> {
  const sizes = new Map<string, number>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return sizes;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    try {
      sizes.set(entry.name, fs.statSync(path.join(dir, entry.name)).size);
    } catch {
      sizes.set(entry.name, 0);
    }
  }
  return sizes;
}

/** Compare the current project's local sessions against the archived copies. */
export function compareChats(opts: { archivePath: string; cwd: string; homeDir?: string }): ChatComparison {
  const homeDir = opts.homeDir ?? getHomeDir();
  const localDir = resolveChatDir({ cwd: opts.cwd, homeDir });
  const archiveDir = path.join(opts.archivePath, encodeProjectDir(opts.cwd));

  const local = localDir ? listJsonlSizes(localDir) : new Map<string, number>();
  const archive = listJsonlSizes(archiveDir);

  const names = Array.from(new Set([...local.keys(), ...archive.keys()])).sort();
  const entries: ChatCompareEntry[] = names.map((name) => ({
    name,
    localBytes: local.has(name) ? (local.get(name) ?? 0) : null,
    archiveBytes: archive.has(name) ? (archive.get(name) ?? 0) : null,
  }));

  const sum = (m: Map<string, number>): number => {
    let total = 0;
    for (const b of m.values()) total += b;
    return total;
  };

  return {
    localDir,
    archiveDir,
    entries,
    localCount: local.size,
    localBytes: sum(local),
    archiveCount: archive.size,
    archiveBytes: sum(archive),
    onlyLocal: entries.filter((e) => e.localBytes !== null && e.archiveBytes === null).length,
    onlyArchive: entries.filter((e) => e.archiveBytes !== null && e.localBytes === null).length,
  };
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function shortSessionName(name: string): string {
  const base = name.replace(/\.jsonl$/, '');
  return base.length > 12 ? `${base.slice(0, 8)}…${base.slice(-3)}` : base;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

export function formatComparison(cmp: ChatComparison): string {
  const COL = 34;
  const rule = '─'.repeat(COL);
  const lines: string[] = [
    `${padRight('LOCAL (current project)', COL)}  ARCHIVE (backup)`,
    `${rule}  ${rule}`,
  ];

  for (const entry of cmp.entries) {
    const left = entry.localBytes !== null
      ? `${padRight(shortSessionName(entry.name), 14)} ${formatBytesShort(entry.localBytes)}`
      : '— (lost locally)';
    const right = entry.archiveBytes !== null
      ? `${padRight(shortSessionName(entry.name), 14)} ${formatBytesShort(entry.archiveBytes)}`
      : '— (not backed up)';
    lines.push(`${padRight(left, COL)}  ${right}`);
  }

  lines.push(`${rule}  ${rule}`);
  lines.push(`${padRight(`${cmp.localCount} session(s) · ${formatBytesShort(cmp.localBytes)}`, COL)}  ${cmp.archiveCount} session(s) · ${formatBytesShort(cmp.archiveBytes)}`);

  if (cmp.onlyLocal > 0) lines.push(`\n⚠ ${cmp.onlyLocal} session(s) not yet backed up`);
  if (cmp.onlyArchive > 0) lines.push(`⚠ ${cmp.onlyArchive} session(s) missing locally (recoverable)`);

  return lines.join('\n');
}

interface ParsedArgs {
  mode: ArchiveMode | 'compare' | null;
  archivePath: string;
  cwd: string;
  all: boolean;
  json: boolean;
}

export function parseArchiveArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = {
    mode: null,
    archivePath: '',
    cwd: process.cwd(),
    all: false,
    json: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === 'backup' || arg === 'recover' || arg === 'compare') {
      parsed.mode = arg;
    } else if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--path') {
      parsed.archivePath = args[++i] ?? '';
    } else if (arg.startsWith('--path=')) {
      parsed.archivePath = arg.slice('--path='.length);
    } else if (arg === '--cwd') {
      parsed.cwd = args[++i] ?? parsed.cwd;
    } else if (arg.startsWith('--cwd=')) {
      parsed.cwd = arg.slice('--cwd='.length);
    }
  }

  return parsed;
}

function formatSummary(result: ArchiveResult): string {
  const verb = result.mode === 'backup' ? 'Backed up' : 'Recovered';
  const lines = [
    `${verb} ${result.copied} session(s) across ${result.projects} project(s) → ${result.archivePath}`,
  ];
  if (result.skipped > 0) {
    const reason = result.mode === 'backup' ? 'already up to date' : 'already present locally';
    lines.push(`Skipped ${result.skipped} (${reason}).`);
  }
  for (const detail of result.details) {
    if (detail.copied.length > 0) {
      lines.push(`  ${detail.project}: +${detail.copied.length}`);
    }
  }
  return lines.join('\n');
}

export function mainArchive(argv: string[] = process.argv): number {
  const parsed = parseArchiveArgs(argv);

  if (!parsed.mode) {
    process.stderr.write('Usage: chat-archive <backup|recover|compare> --path <dir> [--all] [--cwd <dir>] [--json]\n');
    return 2;
  }
  if (!parsed.archivePath || !path.isAbsolute(parsed.archivePath)) {
    process.stderr.write('error: --path must be an absolute archive directory\n');
    return 2;
  }

  if (parsed.mode === 'compare') {
    const comparison = compareChats({ archivePath: parsed.archivePath, cwd: parsed.cwd });
    process.stdout.write((parsed.json ? JSON.stringify(comparison) : formatComparison(comparison)) + '\n');
    return 0;
  }

  const result = runArchive({
    mode: parsed.mode,
    archivePath: parsed.archivePath,
    cwd: parsed.cwd,
    all: parsed.all,
  });

  process.stdout.write(parsed.json ? JSON.stringify(result) : formatSummary(result));
  process.stdout.write('\n');
  return 0;
}

// Run as a CLI when invoked directly (not when imported by tests). Uses
// fileURLToPath + realpathSync so the entry comparison works on Windows, where
// URL.pathname yields "/C:/..." paths that do not match the native argv[1].
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
  process.exit(mainArchive());
}
