---
description: Toggle ACPEC — auto commit + push tracked changes when each conversation ends
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# ACPEC — Auto Commit & Push Every Conversation

Manages the ACPEC feature: a Claude Code **SessionEnd** hook that, when enabled,
stages **tracked** changes (`git add -u`), commits, and pushes the current
branch of the project you were working in. It is **disabled by default** and
**opt-in**.

Safety contract (do not weaken):
- Only tracked changes are committed — never new untracked files (`git add -u`).
- Never force-push. Skips non-repos, detached HEADs, and protected branches.
- Refuses repos rooted at the user's home directory (a stray `git init` in
  `$HOME` must never auto-commit personal files).
- Pushes the current branch only.

## Step 0: Parse the subcommand

The user invokes this as `/claude-hud:acpec <on|off|status>`. Read the argument:
- `on` → enable (run the .gitignore safety gate, set config, register the hook)
- `off` → disable (set config; the hook stays registered but becomes inert)
- `status` or empty → report current state, make no changes

## Step 1: Resolve paths (all subcommands)

**macOS / Linux / Git Bash:**
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PLUGIN_DIR=$(ls -1d "$CLAUDE_DIR"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1)
CONFIG_PATH="$CLAUDE_DIR/plugins/claude-hud/config.json"
SETTINGS_PATH="$CLAUDE_DIR/settings.json"
NODE=$(command -v node)
```

**Windows (PowerShell):**
```powershell
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$pluginDir = (Get-ChildItem (Join-Path $claudeDir "plugins\cache\*\claude-hud\*") -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
$configPath = Join-Path $claudeDir "plugins\claude-hud\config.json"
$settingsPath = Join-Path $claudeDir "settings.json"
$node = (Get-Command node).Source
```

## Step 2 (status): Report and stop

Read `chatArchive`-style: from `{CONFIG_PATH}` read `acpec.enabled` (default
false). Check whether `{SETTINGS_PATH}` has a `hooks.SessionEnd` entry whose
command references `acpec`. Report:
- enabled/disabled, hook registered/not, protected branches, commit prefix.

Stop here for `status`.

## Step 3 (on): .gitignore safety gate — RUN THIS FIRST

This protects against pushing secrets. Operate in the user's current project
(cwd). Use Bash.

1. Confirm cwd is a git repo (`git rev-parse --is-inside-work-tree`). If not,
   tell the user ACPEC only runs in git repos and stop.

2. **Check for already-tracked secrets** (these would be pushed and `.gitignore`
   cannot stop them):
   ```bash
   git ls-files | grep -iE '(^|/)(\.env|\.env\..*|.*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|.*credential.*|.*secret.*|\.npmrc|\.pypirc)$' || true
   ```
   If any are found, WARN the user clearly and offer to untrack them with
   `git rm --cached <file>` (keeps the local file). Do not proceed to enable
   until the user has decided.

3. **Ensure a .gitignore exists with sensitive patterns.**
   - If `{cwd}/.gitignore` is **missing**: scan the repo to infer stack (look
     for `package.json`, `requirements.txt`/`pyproject.toml`, `go.mod`,
     `Cargo.toml`, `*.csproj`, etc.) and create a `.gitignore` combining the
     relevant language ignores with the SENSITIVE BASELINE below.
   - If `.gitignore` **exists**: read it and append any missing entries from the
     SENSITIVE BASELINE (do not duplicate; preserve existing content).

   In both cases show the proposed additions and use AskUserQuestion to confirm
   before writing.

   **SENSITIVE BASELINE** (always ensure these are present):
   ```gitignore
   # Secrets & credentials (added by claude-hud ACPEC)
   .env
   .env.*
   !.env.example
   *.pem
   *.key
   *.p12
   *.pfx
   id_rsa
   id_ed25519
   *.credentials
   *credentials*.json
   *secret*
   .npmrc
   .pypirc
   .aws/
   .ssh/
   # Build artifacts / noise
   node_modules/
   dist/
   build/
   .DS_Store
   *.log
   ```
   Adjust to the user's stack, but never drop the secrets section.

## Step 4 (on): Enable config

Read `{CONFIG_PATH}` (or `{}`), set `acpec.enabled = true` (create the `acpec`
object if absent; leave `commitPrefix` and `protectedBranches` to their defaults
unless the user asked otherwise), and write it back preserving all other keys.
Create `plugins/claude-hud/` if needed. Use a real JSON serializer.

## Step 5 (on): Register the SessionEnd hook

The hook must invoke the plugin's `dist/acpec.js` and survive plugin version
bumps, so use a small wrapper that resolves the latest plugin dir at runtime
(same approach as the statusline).

**Windows:** write `{CLAUDE_DIR}\plugins\claude-hud\acpec-hook.ps1` (UTF-8, no
BOM — use `[System.IO.File]::WriteAllText(path, body, (New-Object System.Text.UTF8Encoding $false))`):
```powershell
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$pluginDir = (Get-ChildItem (Join-Path $claudeDir 'plugins\cache\*\claude-hud\*') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+(\.\d+)+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
if (-not $pluginDir) { exit 0 }
$input | & '{NODE}' (Join-Path $pluginDir 'dist\acpec.js')
```
Register command: `powershell -NoProfile -ExecutionPolicy Bypass -File "{CLAUDE_DIR}\plugins\claude-hud\acpec-hook.ps1"`

**macOS / Linux / Git Bash:** register this command directly:
```bash
bash -c 'd=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1); [ -n "$d" ] && exec "{NODE}" "${d}dist/acpec.js"'
```

Then merge this into `{SETTINGS_PATH}` under `hooks.SessionEnd` (create arrays as
needed; do not duplicate an existing claude-hud acpec entry; preserve all other
settings). Use a real JSON serializer and back up settings.json first.

```json
{
  "hooks": {
    "SessionEnd": [
      { "matcher": "clear|logout|prompt_input_exit|other",
        "hooks": [ { "type": "command", "command": "{HOOK_COMMAND}" } ] }
    ]
  }
}
```

## Step 6 (on): Confirm

Tell the user ACPEC is enabled: when a conversation ends, tracked changes are
committed and pushed on the current branch (never main/master if they added it
to `acpec.protectedBranches`; never force; untracked files are never committed).
Note that it takes effect on the **next** session end, and that the change is
visible in `settings.json` (`hooks.SessionEnd`).

## Step 3' (off): Disable

Set `acpec.enabled = false` in `{CONFIG_PATH}` (preserve other keys). Tell the
user ACPEC is off — the SessionEnd hook remains registered but now no-ops. To
remove it entirely, delete the claude-hud acpec entry from
`{SETTINGS_PATH}` `hooks.SessionEnd`.
