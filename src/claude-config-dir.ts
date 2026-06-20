import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Resolve the user's home directory in a way that is overridable for tests
 * and consistent across platforms.
 *
 * On macOS/Linux `os.homedir()` already returns `$HOME`, so honoring `HOME`
 * here changes nothing. On Windows `os.homedir()` reads `USERPROFILE` and
 * ignores `HOME` entirely — which means tests that isolate via `process.env.HOME`
 * silently read the real user profile. We therefore prefer `HOME` when it is a
 * native Windows path (drive-letter rooted, e.g. `C:\Users\me`).
 *
 * We deliberately ignore Unix-style `HOME` values on Windows (e.g. the MSYS/Git
 * Bash `/c/Users/me`), because the statusline can run under Git Bash where
 * `HOME` may be a POSIX path that does not resolve the same way as the native
 * profile. In those cases `os.homedir()` (USERPROFILE) is authoritative.
 */
export function getHomeDir(): string {
  const home = process.env.HOME?.trim();
  if (home) {
    if (process.platform === 'win32') {
      // Only trust native, drive-letter-rooted paths on Windows.
      if (/^[A-Za-z]:[\\/]/.test(home)) {
        return home;
      }
      return os.homedir();
    }
    return home;
  }
  return os.homedir();
}

function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function getClaudeConfigDir(homeDir: string): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude');
  }
  return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}

export function getClaudeConfigJsonPath(homeDir: string): string {
  return `${getClaudeConfigDir(homeDir)}.json`;
}

export function getHudPluginDir(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'plugins', 'claude-hud');
}
