import { readStdin, getUsageFromStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus, getSubmoduleConfig } from "./git.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { getChatStats } from "./chat-stats.js";
import { getPluginVersionInfo } from "./plugin-version.js";
import { resolveEffortLevel } from "./effort.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
export { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
export async function main(overrides = {}) {
    const deps = {
        readStdin,
        getUsageFromStdin,
        getUsageFromExternalSnapshot,
        writeExternalUsageSnapshot,
        parseTranscript,
        countConfigs,
        getGitStatus,
        getSubmoduleConfig,
        loadConfig,
        parseExtraCmdArg,
        runExtraCmd,
        getClaudeCodeVersion,
        getMemoryUsage,
        getChatStats,
        getPluginVersionInfo,
        applyContextWindowFallback,
        render,
        now: () => Date.now(),
        log: console.log,
        ...overrides,
    };
    try {
        const stdin = await deps.readStdin();
        if (!stdin) {
            // Running without stdin - this happens during setup verification
            const config = await deps.loadConfig();
            setLanguage(config.language);
            const isMacOS = process.platform === "darwin";
            deps.log(t("init.initializing"));
            if (isMacOS) {
                deps.log(t("init.macosNote"));
            }
            return;
        }
        const config = await deps.loadConfig();
        setLanguage(config.language);
        const display = config.display;
        const transcriptPath = typeof stdin.transcript_path === "string" ? stdin.transcript_path : "";
        const usage = stdin.context_window?.current_usage;
        const mayNeedCompactHint = Boolean(stdin.context_window
            && (stdin.context_window.used_percentage ?? 0) === 0
            && (usage?.input_tokens ?? 0) === 0
            && (usage?.output_tokens ?? 0) === 0
            && (usage?.cache_creation_input_tokens ?? 0) === 0
            && (usage?.cache_read_input_tokens ?? 0) === 0);
        const needsTranscript = mayNeedCompactHint || Boolean(display.showTools
            || display.showAgents
            || display.showTodos
            || display.showSessionName
            || display.showDuration
            || display.showCost
            || display.showPromptCache
            || display.showSessionTokens
            || display.showSessionStartDate
            || display.showLastResponseAt);
        const transcript = needsTranscript
            ? await deps.parseTranscript(transcriptPath)
            : { tools: [], agents: [], todos: [] };
        deps.applyContextWindowFallback(stdin, {}, transcript.sessionName, {
            lastCompactBoundaryAt: transcript.lastCompactBoundaryAt,
            lastCompactPostTokens: transcript.lastCompactPostTokens,
        });
        const needsConfigCounts = display.showConfigCounts || display.showOutputStyle;
        const { claudeMdCount, rulesCount, mcpCount, hooksCount, outputStyle } = needsConfigCounts
            ? await deps.countConfigs(typeof stdin.cwd === "string" ? stdin.cwd : undefined)
            : { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0, outputStyle: undefined };
        const gitStatus = config.gitStatus.enabled
            ? await deps.getGitStatus(typeof stdin.cwd === "string" ? stdin.cwd : undefined, {
                timeoutMs: config.gitStatus.commandTimeoutMs,
                showAheadBehind: config.gitStatus.showAheadBehind,
                showFileStats: config.gitStatus.showFileStats,
                includeBranchUrl: true,
            })
            : null;
        let usageData = null;
        const shouldReadUsage = config.display.showUsage !== false;
        const shouldWriteUsage = Boolean(config.display.externalUsageWritePath);
        const stdinUsage = shouldReadUsage || shouldWriteUsage
            ? deps.getUsageFromStdin(stdin)
            : null;
        if (shouldWriteUsage && stdinUsage) {
            deps.writeExternalUsageSnapshot(config, stdinUsage, deps.now());
        }
        if (shouldReadUsage) {
            usageData = stdinUsage;
            if (!usageData) {
                usageData = deps.getUsageFromExternalSnapshot(config, deps.now());
            }
        }
        const extraCmd = deps.parseExtraCmdArg();
        const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;
        const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);
        const claudeCodeVersion = config.display.showClaudeCodeVersion
            ? await deps.getClaudeCodeVersion()
            : undefined;
        const effortInfo = config.display.showEffortLevel
            ? resolveEffortLevel(stdin.effort)
            : null;
        const memoryUsage = config.display.showMemoryUsage && config.lineLayout === "expanded"
            ? await deps.getMemoryUsage()
            : null;
        const chatStats = config.display.showChats
            ? deps.getChatStats({ transcriptPath, cwd: stdin.cwd })
            : null;
        const submoduleConfig = config.display.showSubmodulePush
            ? await deps.getSubmoduleConfig(stdin.cwd, { timeoutMs: config.gitStatus.commandTimeoutMs })
            : null;
        const pluginVersion = config.display.showVersion
            ? deps.getPluginVersionInfo()
            : null;
        const ctx = {
            stdin,
            transcript,
            claudeMdCount,
            rulesCount,
            mcpCount,
            hooksCount,
            sessionDuration,
            gitStatus,
            usageData,
            memoryUsage,
            config,
            extraLabel,
            outputStyle,
            claudeCodeVersion,
            effortLevel: effortInfo?.level,
            effortSymbol: effortInfo?.symbol,
            chatStats,
            submoduleConfig,
            pluginVersion,
        };
        deps.render(ctx);
    }
    catch (error) {
        deps.log("[claude-hud] Error:", error instanceof Error ? error.message : "Unknown error");
    }
}
export function formatSessionDuration(sessionStart, now = () => Date.now()) {
    if (!sessionStart) {
        return "";
    }
    const ms = now() - sessionStart.getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1)
        return "<1m";
    if (mins < 60)
        return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
}
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
    void main();
}
//# sourceMappingURL=index.js.map