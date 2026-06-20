import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getClaudeConfigDir, getHomeDir, getHudPluginDir } from './claude-config-dir.js';

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

export const EMPTY_CHAT_STATS: ChatStats = {
  chatDir: null,
  count: 0,
  peak: 0,
  belowPeak: false,
  totalBytes: 0,
  lastActiveMs: null,
};

/**
 * Encode a working directory the way Claude Code names its project transcript
 * folders: path separators and the Windows drive colon become '-'.
 * e.g. `C:\Users\me\proj` -> `C--Users-me-proj`.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[\\/:]/g, '-');
}

/**
 * Resolve the transcript directory for the current project.
 *
 * Prefers the session's `transcriptPath` (its parent directory is exact and
 * platform-agnostic). Falls back to deriving the path from `cwd` + the config
 * dir, which is what the backup/recover commands use when no transcript is
 * piped in.
 */
export function resolveChatDir(opts: {
  transcriptPath?: string;
  cwd?: string;
  homeDir?: string;
}): string | null {
  const transcriptPath = opts.transcriptPath?.trim();
  if (transcriptPath) {
    const dir = path.dirname(transcriptPath);
    if (dir && dir !== '.') {
      return dir;
    }
  }

  const cwd = opts.cwd?.trim();
  if (cwd) {
    const homeDir = opts.homeDir ?? getHomeDir();
    return path.join(getClaudeConfigDir(homeDir), 'projects', encodeProjectDir(cwd));
  }

  return null;
}

function scanChatDir(chatDir: string): Pick<ChatStats, 'count' | 'totalBytes' | 'lastActiveMs'> {
  let count = 0;
  let totalBytes = 0;
  let lastActiveMs: number | null = null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(chatDir, { withFileTypes: true });
  } catch {
    return { count, totalBytes, lastActiveMs };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }
    count += 1;
    try {
      const stat = fs.statSync(path.join(chatDir, entry.name));
      totalBytes += stat.size;
      if (lastActiveMs === null || stat.mtimeMs > lastActiveMs) {
        lastActiveMs = stat.mtimeMs;
      }
    } catch {
      // Ignore files that vanish between readdir and stat.
    }
  }

  return { count, totalBytes, lastActiveMs };
}

function peakCachePath(chatDir: string, homeDir: string): string {
  const hash = createHash('sha256').update(chatDir).digest('hex').slice(0, 16);
  return path.join(getHudPluginDir(homeDir), 'chat-stats', `${hash}.json`);
}

function readStoredPeak(cachePath: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { peak?: unknown };
    if (typeof parsed.peak === 'number' && Number.isInteger(parsed.peak) && parsed.peak >= 0) {
      return parsed.peak;
    }
  } catch {
    // Missing or corrupt cache -> treat as no recorded peak.
  }
  return 0;
}

function writeStoredPeak(cachePath: string, peak: number): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ peak }), 'utf8');
  } catch {
    // Peak persistence is best-effort; never block rendering on it.
  }
}

/**
 * Compute chat statistics for the current project.
 *
 * When `trackPeak` is enabled (default), the highest count ever seen is
 * persisted under the plugin cache dir and `belowPeak` flags drops below it.
 * Set `trackPeak: false` for read-only callers (e.g. the backup command).
 */
export function getChatStats(opts: {
  transcriptPath?: string;
  cwd?: string;
  homeDir?: string;
  trackPeak?: boolean;
}): ChatStats {
  const homeDir = opts.homeDir ?? getHomeDir();
  const chatDir = resolveChatDir({ ...opts, homeDir });
  if (!chatDir) {
    return { ...EMPTY_CHAT_STATS };
  }

  const { count, totalBytes, lastActiveMs } = scanChatDir(chatDir);

  let peak = count;
  let belowPeak = false;
  if (opts.trackPeak !== false) {
    const cachePath = peakCachePath(chatDir, homeDir);
    const stored = readStoredPeak(cachePath);
    peak = Math.max(stored, count);
    if (peak !== stored) {
      writeStoredPeak(cachePath, peak);
    }
    belowPeak = count < peak;
  }

  return { chatDir, count, peak, belowPeak, totalBytes, lastActiveMs };
}
