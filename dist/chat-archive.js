import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { getClaudeConfigDir, getHomeDir, getHudPluginDir } from './claude-config-dir.js';
import { encodeProjectDir, resolveChatDir } from './chat-stats.js';
function listJsonl(dir) {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
            .map((entry) => entry.name);
    }
    catch {
        return [];
    }
}
function listSubdirs(dir) {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => entry.name);
    }
    catch {
        return [];
    }
}
function projectsRoot(homeDir) {
    return path.join(getClaudeConfigDir(homeDir), 'projects');
}
/** Copy src -> dest through a sibling temp file, preserving mtime. */
function copyPreservingMtime(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    try {
        fs.copyFileSync(src, tmp);
        const stat = fs.statSync(src);
        fs.utimesSync(tmp, stat.atime, stat.mtime);
        fs.renameSync(tmp, dest);
    }
    catch {
        try {
            fs.rmSync(tmp, { force: true });
        }
        catch {
            // Preserve the original copy error.
        }
        throw new Error(`Failed to copy transcript ${src} to ${dest}`);
    }
}
function filePrefixMatches(prefixPath, fullPath, bytes) {
    const prefixFd = fs.openSync(prefixPath, 'r');
    const fullFd = fs.openSync(fullPath, 'r');
    const prefixBuffer = Buffer.allocUnsafe(64 * 1024);
    const fullBuffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    try {
        while (offset < bytes) {
            const length = Math.min(prefixBuffer.length, bytes - offset);
            const prefixRead = fs.readSync(prefixFd, prefixBuffer, 0, length, offset);
            const fullRead = fs.readSync(fullFd, fullBuffer, 0, length, offset);
            if (prefixRead !== fullRead || !prefixBuffer.subarray(0, prefixRead).equals(fullBuffer.subarray(0, fullRead))) {
                return false;
            }
            if (prefixRead === 0)
                return offset === bytes;
            offset += prefixRead;
        }
        return true;
    }
    finally {
        fs.closeSync(prefixFd);
        fs.closeSync(fullFd);
    }
}
/** Only replace an archive when the local transcript strictly extends it. */
function backupDecision(src, dest) {
    if (!fs.existsSync(dest))
        return 'copy';
    const source = fs.statSync(src);
    const archived = fs.statSync(dest);
    if (source.size < archived.size)
        return 'conflict';
    if (source.size === archived.size) {
        return filePrefixMatches(dest, src, archived.size) ? 'skip' : 'conflict';
    }
    return filePrefixMatches(dest, src, archived.size) ? 'copy' : 'conflict';
}
function hashFile(filePath) {
    const hash = createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead > 0)
                hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
    }
    finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex').slice(0, 12);
}
function preserveConflict(src, archivePath, project, name) {
    const parsed = path.parse(name);
    const conflictName = `${parsed.name}.local-${hashFile(src)}${parsed.ext}`;
    const conflictPath = path.join(archivePath, '.conflicts', project, conflictName);
    if (!fs.existsSync(conflictPath)) {
        copyPreservingMtime(src, conflictPath);
    }
}
/** Resolve the project folders to operate on (single from cwd, or all). */
function resolveProjects(opts, homeDir) {
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
export function backupChats(opts, homeDir = getHomeDir()) {
    const root = projectsRoot(homeDir);
    const projects = resolveProjects(opts, homeDir);
    const details = [];
    for (const project of projects) {
        const sourceDir = path.join(root, project);
        const destDir = path.join(opts.archivePath, project);
        const copied = [];
        const skipped = [];
        const conflicts = [];
        for (const name of listJsonl(sourceDir)) {
            const src = path.join(sourceDir, name);
            const dest = path.join(destDir, name);
            const decision = backupDecision(src, dest);
            if (decision === 'copy') {
                copyPreservingMtime(src, dest);
                copied.push(name);
            }
            else if (decision === 'skip') {
                skipped.push(name);
            }
            else {
                preserveConflict(src, opts.archivePath, project, name);
                conflicts.push(name);
            }
        }
        if (copied.length > 0 || skipped.length > 0 || conflicts.length > 0) {
            details.push({ project, copied, skipped, conflicts });
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
export function recoverChats(opts, homeDir = getHomeDir()) {
    const root = projectsRoot(homeDir);
    // When recovering, the source of truth for "which projects" is the archive.
    const projects = opts.all
        ? listSubdirs(opts.archivePath)
        : resolveProjects(opts, homeDir);
    const details = [];
    for (const project of projects) {
        const archiveDir = path.join(opts.archivePath, project);
        const localDir = path.join(root, project);
        const localExisting = new Set(listJsonl(localDir));
        const copied = [];
        const skipped = [];
        const conflicts = [];
        for (const name of listJsonl(archiveDir)) {
            if (localExisting.has(name)) {
                skipped.push(name);
                continue;
            }
            copyPreservingMtime(path.join(archiveDir, name), path.join(localDir, name));
            copied.push(name);
        }
        if (copied.length > 0 || skipped.length > 0) {
            details.push({ project, copied, skipped, conflicts });
        }
    }
    return summarize('recover', opts.archivePath, details);
}
function summarize(mode, archivePath, details) {
    return {
        mode,
        archivePath,
        projects: details.length,
        copied: details.reduce((sum, d) => sum + d.copied.length, 0),
        skipped: details.reduce((sum, d) => sum + d.skipped.length, 0),
        conflicts: details.reduce((sum, d) => sum + d.conflicts.length, 0),
        details,
    };
}
export function runArchive(opts, homeDir = getHomeDir()) {
    return opts.mode === 'backup' ? backupChats(opts, homeDir) : recoverChats(opts, homeDir);
}
function listJsonlSizes(dir) {
    const sizes = new Map();
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return sizes;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl'))
            continue;
        try {
            sizes.set(entry.name, fs.statSync(path.join(dir, entry.name)).size);
        }
        catch {
            sizes.set(entry.name, 0);
        }
    }
    return sizes;
}
/** Compare the current project's local sessions against the archived copies. */
export function compareChats(opts) {
    const homeDir = opts.homeDir ?? getHomeDir();
    const localDir = resolveChatDir({ cwd: opts.cwd, homeDir });
    const archiveDir = path.join(opts.archivePath, encodeProjectDir(opts.cwd));
    const local = localDir ? listJsonlSizes(localDir) : new Map();
    const archive = listJsonlSizes(archiveDir);
    const names = Array.from(new Set([...local.keys(), ...archive.keys()])).sort();
    const entries = names.map((name) => ({
        name,
        localBytes: local.has(name) ? (local.get(name) ?? 0) : null,
        archiveBytes: archive.has(name) ? (archive.get(name) ?? 0) : null,
    }));
    const sum = (m) => {
        let total = 0;
        for (const b of m.values())
            total += b;
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
function formatBytesShort(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
function shortSessionName(name) {
    const base = name.replace(/\.jsonl$/, '');
    return base.length > 12 ? `${base.slice(0, 8)}…${base.slice(-3)}` : base;
}
function padRight(text, width) {
    return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}
export function formatComparison(cmp) {
    const COL = 34;
    const rule = '─'.repeat(COL);
    const lines = [
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
    if (cmp.onlyLocal > 0)
        lines.push(`\n⚠ ${cmp.onlyLocal} session(s) not yet backed up`);
    if (cmp.onlyArchive > 0)
        lines.push(`⚠ ${cmp.onlyArchive} session(s) missing locally (recoverable)`);
    return lines.join('\n');
}
/**
 * Read the persisted "back up every project by default" preference from the
 * HUD config (`chatArchive.backupAll`). Kept deliberately lean — it parses the
 * one boolean it needs and treats any read/parse error as "not enabled" so a
 * malformed config never blocks a backup.
 */
export function readBackupAllDefault(homeDir = getHomeDir()) {
    try {
        const configPath = path.join(getHudPluginDir(homeDir), 'config.json');
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return parsed?.chatArchive?.backupAll === true;
    }
    catch {
        return false;
    }
}
export function parseArchiveArgs(argv) {
    const args = argv.slice(2);
    const parsed = {
        mode: null,
        archivePath: '',
        cwd: process.cwd(),
        all: null,
        json: false,
    };
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === 'backup' || arg === 'recover' || arg === 'compare') {
            parsed.mode = arg;
        }
        else if (arg === '--all') {
            parsed.all = true;
        }
        else if (arg === '--no-all') {
            parsed.all = false;
        }
        else if (arg === '--json') {
            parsed.json = true;
        }
        else if (arg === '--path') {
            parsed.archivePath = args[++i] ?? '';
        }
        else if (arg.startsWith('--path=')) {
            parsed.archivePath = arg.slice('--path='.length);
        }
        else if (arg === '--cwd') {
            parsed.cwd = args[++i] ?? parsed.cwd;
        }
        else if (arg.startsWith('--cwd=')) {
            parsed.cwd = arg.slice('--cwd='.length);
        }
    }
    return parsed;
}
function formatSummary(result) {
    const verb = result.mode === 'backup' ? 'Backed up' : 'Recovered';
    const lines = [
        `${verb} ${result.copied} session(s) across ${result.projects} project(s) → ${result.archivePath}`,
    ];
    if (result.skipped > 0) {
        const reason = result.mode === 'backup' ? 'already up to date' : 'already present locally';
        lines.push(`Skipped ${result.skipped} (${reason}).`);
    }
    if (result.conflicts > 0) {
        lines.push(`Preserved ${result.conflicts} divergent local session(s) under ${path.join(result.archivePath, '.conflicts')}.`);
    }
    for (const detail of result.details) {
        if (detail.copied.length > 0) {
            lines.push(`  ${detail.project}: +${detail.copied.length}`);
        }
    }
    return lines.join('\n');
}
export function mainArchive(argv = process.argv, homeDir = getHomeDir()) {
    const parsed = parseArchiveArgs(argv);
    if (!parsed.mode) {
        process.stderr.write('Usage: chat-archive <backup|recover|compare> --path <dir> [--all|--no-all] [--cwd <dir>] [--json]\n');
        return 2;
    }
    if (!parsed.archivePath || !path.isAbsolute(parsed.archivePath)) {
        process.stderr.write('error: --path must be an absolute archive directory\n');
        return 2;
    }
    if (parsed.mode === 'compare') {
        const comparison = compareChats({ archivePath: parsed.archivePath, cwd: parsed.cwd, homeDir });
        process.stdout.write((parsed.json ? JSON.stringify(comparison) : formatComparison(comparison)) + '\n');
        return 0;
    }
    // An explicit --all/--no-all wins; otherwise backup honors the persisted
    // `chatArchive.backupAll` default. Recovery stays opt-in (explicit --all only).
    const all = parsed.all !== null
        ? parsed.all
        : parsed.mode === 'backup' && readBackupAllDefault(homeDir);
    const result = runArchive({
        mode: parsed.mode,
        archivePath: parsed.archivePath,
        cwd: parsed.cwd,
        all,
    }, homeDir);
    process.stdout.write(parsed.json ? JSON.stringify(result) : formatSummary(result));
    process.stdout.write('\n');
    return 0;
}
// Run as a CLI when invoked directly (not when imported by tests). Uses
// fileURLToPath + realpathSync so the entry comparison works on Windows, where
// URL.pathname yields "/C:/..." paths that do not match the native argv[1].
const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a, b) => {
    try {
        return realpathSync(a) === realpathSync(b);
    }
    catch {
        return a === b;
    }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
    process.exit(mainArchive());
}
//# sourceMappingURL=chat-archive.js.map