import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export function atomicWriteFileSync(
  filePath: string,
  content: string,
  options: { mode?: number; mtimeMs?: number } = {},
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );

  try {
    fs.writeFileSync(tmpPath, content, {
      encoding: 'utf8',
      mode: options.mode ?? 0o600,
      flag: 'wx',
    });
    if (options.mtimeMs !== undefined) {
      const seconds = options.mtimeMs / 1000;
      fs.utimesSync(tmpPath, seconds, seconds);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function sweepCacheDirSync(
  cacheDir: string,
  options: { maxAgeMs: number; maxEntries: number; now?: number; suffix?: string },
): void {
  const now = options.now ?? Date.now();
  const suffix = options.suffix ?? '.json';
  const survivors: Array<{ path: string; mtimeMs: number }> = [];

  try {
    for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
      const filePath = path.join(cacheDir, entry.name);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > options.maxAgeMs) {
          fs.rmSync(filePath, { force: true });
        } else {
          survivors.push({ path: filePath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // A cache entry may disappear during a concurrent sweep.
      }
    }

    survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of survivors.slice(0, Math.max(0, survivors.length - options.maxEntries))) {
      try {
        fs.rmSync(entry.path, { force: true });
      } catch {
        // Cache eviction is best-effort.
      }
    }
  } catch {
    // Missing or unreadable cache directories are harmless.
  }
}
