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
export declare function getHomeDir(): string;
export declare function getClaudeConfigDir(homeDir: string): string;
export declare function getClaudeConfigJsonPath(homeDir: string): string;
export declare function getHudPluginDir(homeDir: string): string;
//# sourceMappingURL=claude-config-dir.d.ts.map