# Local Claude Code hooks

Two hooks, approved by the founder on 2026-10-02, written in this repository
(no framework). They are scoped by matcher so ordinary edits and commands
cost nothing: the first only acts on `git commit` / `git push`, the second
only on files under `supabase/migrations/`. Both are small scripts under
`scripts/hooks/` that any contributor can read in a minute.

The scripts are committed; **the registration is not**. Hooks run shell
commands on the developer's machine, so each developer adds the block below
to `.claude/settings.json` (or `.claude/settings.local.json`) themselves.
Nothing in the repository turns a hook on by itself.

## Registration (add to `.claude/settings.json`)

Add a top-level `hooks` key next to the existing `permissions` key:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/hooks/pre-commit-gitleaks.sh",
            "timeout": 60
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/scripts/hooks/post-edit-migration-lint.mjs",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

`$CLAUDE_PROJECT_DIR` is set by Claude Code to the project root, so the same
block works in every worktree. After editing settings, start a new session
(or run `/hooks` to confirm both are listed).

Removal: delete the `hooks` key from settings and, if wanted,
`rm -rf scripts/hooks` and this document. No other residue.

## Hook 1: secret scan before `git commit` / `git push`

| | |
|---|---|
| Event | `PreToolUse`, matcher `Bash` |
| Script | `scripts/hooks/pre-commit-gitleaks.sh` (bash; uses `node` only to parse the JSON on stdin) |
| Fires on | Commands of the form `git [options] commit ...` or `git [options] push ...`, including `cd x && git commit`, `git -C path commit`, `git --no-pager push`. Not on `git log --grep commit` or `npm run commitlint` |
| Runs | commit: `gitleaks protect --staged --no-banner --redact`. push: `gitleaks detect --no-banner --redact --log-opts=<upstream>..HEAD` over the commits that are about to leave the machine; if there is no upstream it falls back to the staged scan; if the range is empty it exits at once |
| On findings | Exit 2: the git command does **not** run; the agent sees "BLOCKED `git commit` because gitleaks found possible secrets" plus the redacted finding list (file, rule, line; the secret value is never printed) |
| gitleaks missing | Fails **open**: exit 0 with a `systemMessage` shown to the user: "gitleaks is not installed (brew install gitleaks). The local secret scan was skipped; CI still runs gitleaks on push." |
| gitleaks error (any exit other than 0/1) | Fails open the same way, quoting the last lines of the error |
| Config | gitleaks reads `.gitleaks.toml` at the repository root, the same file CI uses |

`gitleaks protect` is the founder-approved form. Recent gitleaks releases
print a deprecation note and offer `gitleaks git --pre-commit --staged` as
the replacement; both work on 8.x. Change the two command lines in the script
if `protect` is ever removed.

The hook is a courtesy for the public repository: CI runs gitleaks over the
full history on every push and PR regardless (ADR-0006), so a skipped local
scan is never the last line of defence.

## Hook 2: migration lint after a `Write` or `Edit`

| | |
|---|---|
| Event | `PostToolUse`, matcher `Write\|Edit` |
| Script | `scripts/hooks/post-edit-migration-lint.mjs` (node) |
| Fires on | `tool_input.file_path` matching `supabase/migrations/<file>.sql` (absolute or relative). Rollback files, probes, `supabase/migrations/archive/` and everything else exit immediately |
| Runs | `node scripts/check-migrations.mjs <file>`: the same two rules as the CI job "Migration Validation" (standards.md section 6): every table, view or function the file is the first to create must have a `GRANT` or `REVOKE` naming it; every migration newer than `20260926100000` needs `supabase/rollbacks/<version>_*.down.sql` (or a combined rollback listing the version) |
| On problems | Exit 2: the edit has already happened; the lint output is shown to the agent so it fixes the migration before moving on |
| Clean | Exit 0, silent |

A "no rollback file" line right after creating a migration only means the
rollback has not been written yet; writing it clears the finding. The lint
is static text analysis and never connects to a database.

## Local test record (2026-10-02)

Both scripts were exercised by piping Claude Code's stdin JSON shape into
them, with fake `gitleaks` executables on `PATH` for the finding, clean and
error cases (gitleaks itself was not installed on the machine) and two
throwaway migrations for the lint (deleted afterwards):

| Case | Result |
|---|---|
| `ls -la`, `git log --grep commit`, `npm run commitlint` | exit 0, no scan |
| `git commit`, gitleaks not on PATH | exit 0 + systemMessage (fail open) |
| `git commit`, gitleaks reports a finding | exit 2, BLOCKED message with redacted finding |
| `git -C /x commit`, `cd client && git commit`, gitleaks clean | exit 0 |
| `git commit`, gitleaks exits 126 | exit 0 + systemMessage quoting the error |
| `git push` with an upstream and nothing to push | exit 0, no scan |
| malformed stdin | exit 0 |
| Edit of `client/src/App.tsx`, of a rollback file | exit 0, no lint |
| Write of a migration creating a table and a function without grants and with no rollback | exit 2, three findings reported |
| Write of a migration with `REVOKE`/`GRANT` and a rollback file | exit 0 |
| `node scripts/check-migrations.mjs` after cleanup | 25 files, no problems |

Re-run the table above after changing either script.
