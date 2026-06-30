---
description: Back up the current project's Claude conversations to your archive folder
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Back up Claude conversations

Copies the current project's conversation transcripts (`*.jsonl`) into a
configurable archive folder. Backups are **non-destructive**: an existing archive
is refreshed only when the local transcript strictly appends to it, and truncated
or divergent local files are preserved under `.conflicts/`. Archive files are
never deleted, so a session lost locally stays recoverable. Pair this with
`/claude-hud:recover-chats` to restore.

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

Read `{CONFIG_PATH}` (it may not exist yet) and look for `chatArchive.path`.

- **If `chatArchive.path` is a non-empty string**, use it as `{ARCHIVE_PATH}`.
- **If it is missing or empty**, use AskUserQuestion to ask:
  - header: "Archive folder"
  - question: "Where should Claude HUD back up your conversations? Enter an absolute folder path (ideally inside a synced location like Dropbox)."
  - Provide the user's likely Dropbox/sync folder as a suggested option if you can infer one, plus an "Other" free-text path.

  Then persist it: read the existing config JSON (or `{}`), set
  `chatArchive.path` to the chosen absolute path, and write it back to
  `{CONFIG_PATH}` with a real JSON serializer (create the
  `plugins/claude-hud/` directory if needed). Preserve all existing keys.

The path **must be absolute**. If the user gives a relative path, resolve it or
ask again.

## Step 2.5: Show a before/after comparison

Before copying anything, show the user a side-by-side view of their local
sessions vs the archive so they know exactly what will change:

**macOS / Linux / Git Bash:**
```bash
"{NODE}" "{PLUGIN_DIR}dist/chat-archive.js" compare --path "{ARCHIVE_PATH}"
```

**Windows (PowerShell):**
```powershell
& "{NODE}" (Join-Path "{PLUGIN_DIR}" "dist\chat-archive.js") compare --path "{ARCHIVE_PATH}"
```

Show the table verbatim. Rows marked **"not backed up"** (left-only) will be
copied by this backup; rows marked **"lost locally"** (right-only) exist only in
the archive and can be restored with `/claude-hud:recover-chats`. Proceed to the
backup.

## Step 2.7: Resolve the backup scope

Read `chatArchive.backupAll` from `{CONFIG_PATH}` (it defaults to `false`).

- **`backupAll` is `false` (default)** — the CLI backs up **only the current
  project**. The before/after table in Step 2.5 already reflects this.
- **`backupAll` is `true`** — the CLI backs up **every project** automatically,
  with no flag needed.

If the user asks to "back up all projects by default" / "永久保存所有项目对话",
set `chatArchive.backupAll` to `true`: read the existing config JSON (or `{}`),
set the key, and write it back to `{CONFIG_PATH}` with a real JSON serializer,
preserving all existing keys (including `chatArchive.path`). After that, every
`/claude-hud:backup-chats` run covers all projects until they turn it off.

## Step 3: Run the backup

Run the archive CLI. The scope follows `chatArchive.backupAll` from Step 2.7
(current project by default, or every project when enabled). For a **one-off
override** that ignores the saved default, pass `--all` (force every project) or
`--no-all` (force current project only).

**macOS / Linux / Git Bash:**
```bash
"{NODE}" "{PLUGIN_DIR}dist/chat-archive.js" backup --path "{ARCHIVE_PATH}"
```

**Windows (PowerShell):**
```powershell
& "{NODE}" (Join-Path "{PLUGIN_DIR}" "dist\chat-archive.js") backup --path "{ARCHIVE_PATH}"
```

One-off scope overrides: append `--all` to back up every project this run, or
`--no-all` to back up only the current project this run.

## Step 4: Report

Show the CLI summary to the user (how many sessions were backed up / skipped and
to where). Remind them that `/claude-hud:recover-chats` restores missing
sessions, and that enabling the `chats` HUD element (`display.showChats`) shows
a ⚠ alert when the live count drops below its recorded peak.
