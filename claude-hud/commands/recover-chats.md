---
description: Restore missing Claude conversations for the current project from your archive
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Recover Claude conversations

Restores conversation transcripts (`*.jsonl`) from your archive folder back into
the live Claude projects directory. This is **safe by design**: it only copies
sessions that are **missing locally** and never overwrites an existing
conversation. Use it after a sync conflict or accidental deletion drops sessions
that `/claude-hud:backup-chats` previously saved.

Substitute the detected values for `{CLAUDE_DIR}`, `{PLUGIN_DIR}`, `{NODE}`,
`{CONFIG_PATH}`, and `{ARCHIVE_PATH}` as you go.

## Step 1: Resolve paths

Determine the Claude config dir, the installed plugin dir (latest version), the
config file, and the Node binary.

**macOS / Linux / Git Bash:**
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PLUGIN_DIR=$(ls -1d "$CLAUDE_DIR"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1)
CONFIG_PATH="$CLAUDE_DIR/plugins/claude-hud/config.json"
NODE=$(command -v node)
echo "PLUGIN_DIR=$PLUGIN_DIR"; echo "CONFIG_PATH=$CONFIG_PATH"; echo "NODE=$NODE"
```

**Windows (PowerShell):**
```powershell
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$pluginDir = (Get-ChildItem (Join-Path $claudeDir "plugins\cache\*\claude-hud\*") -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
$configPath = Join-Path $claudeDir "plugins\claude-hud\config.json"
$node = (Get-Command node).Source
"PLUGIN_DIR=$pluginDir"; "CONFIG_PATH=$configPath"; "NODE=$node"
```

If `PLUGIN_DIR` is empty, the plugin is not installed — stop and tell the user
to run `/plugin install claude-hud` first. If `NODE` is empty, ask the user to
install Node.js LTS.

## Step 2: Resolve the archive path

Read `{CONFIG_PATH}` and look for `chatArchive.path`.

- **If `chatArchive.path` is a non-empty string**, use it as `{ARCHIVE_PATH}`.
- **If it is missing or empty**, use AskUserQuestion to ask the user for the
  absolute archive folder path, then persist it to `{CONFIG_PATH}` under
  `chatArchive.path` (preserve all existing keys, create the
  `plugins/claude-hud/` directory if needed).

The path **must be absolute** and should point at the same folder used by
`/claude-hud:backup-chats`.

## Step 3: Run the recovery

Run the archive CLI. By default it recovers **only the current project** (its
cwd is your current working directory). Add `--all` only if the user asked to
recover every project found in the archive.

**macOS / Linux / Git Bash:**
```bash
"{NODE}" "{PLUGIN_DIR}dist/chat-archive.js" recover --path "{ARCHIVE_PATH}"
```

**Windows (PowerShell):**
```powershell
& "{NODE}" (Join-Path "{PLUGIN_DIR}" "dist\chat-archive.js") recover --path "{ARCHIVE_PATH}"
```

To recover every archived project, append `--all`.

## Step 4: Report

Show the CLI summary (how many sessions were restored / skipped). Note that
skipped sessions were left untouched because they already existed locally —
nothing is ever overwritten. Suggest the user run `/resume` to see the restored
conversations.
