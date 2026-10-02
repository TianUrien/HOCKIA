#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Bash). See docs/engineering/hooks.md.
#
# Reads the tool call as JSON on stdin. When the command is a `git commit`
# or `git push`, runs gitleaks before the command executes:
#   commit -> gitleaks protect --staged     (the staged changes)
#   push   -> gitleaks detect over the commits not yet on the upstream
#             (falls back to the staged scan when there is no upstream)
#
# Exit codes (Claude Code semantics):
#   0  let the command run (also used to fail open when gitleaks is missing
#      or errors; a systemMessage on stdout tells the user why)
#   2  block the command; stderr is shown to the agent
#
# Findings are printed with --redact so no secret value reaches the
# transcript. CI runs gitleaks over the full history regardless of this hook.
set -u

input=$(cat)
cmd=$(printf '%s' "$input" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(String((j.tool_input && j.tool_input.command) || ""));
  } catch {
    process.stdout.write("");
  }
});
' 2>/dev/null)

# Only `git [options] commit` / `git [options] push` are of interest (options such as
# `-C <path>` or `--no-pager` may sit between `git` and the subcommand; `git log --grep commit` does not match).
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])git([[:space:]]+-[^[:space:]]*([[:space:]]+[^[:space:]-][^[:space:]|;&]*)?)*[[:space:]]+(commit|push)([[:space:]]|$)'; then
  exit 0
fi

mode=commit
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])git([[:space:]]+-[^[:space:]]*([[:space:]]+[^[:space:]-][^[:space:]|;&]*)?)*[[:space:]]+push([[:space:]]|$)'; then
  mode=push
fi

fail_open() {
  # Exit 0 with a systemMessage: the command runs, the user sees why the scan was skipped.
  node -e 'process.stdout.write(JSON.stringify({ systemMessage: process.argv[1] }))' "gitleaks hook: $1 The local secret scan was skipped; CI still runs gitleaks on push."
  exit 0
}

if ! command -v gitleaks >/dev/null 2>&1; then
  fail_open "gitleaks is not installed (brew install gitleaks)."
fi

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root" || fail_open "could not enter the project directory."

if [ "$mode" = push ]; then
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
  if [ -n "$upstream" ]; then
    if [ -z "$(git rev-list "$upstream..HEAD" 2>/dev/null)" ]; then
      exit 0 # nothing to push, nothing to scan
    fi
    output=$(gitleaks detect --no-banner --redact --log-opts="$upstream..HEAD" 2>&1)
    status=$?
  else
    output=$(gitleaks protect --staged --no-banner --redact 2>&1)
    status=$?
  fi
else
  output=$(gitleaks protect --staged --no-banner --redact 2>&1)
  status=$?
fi

case "$status" in
  0) exit 0 ;;
  1)
    {
      echo "gitleaks hook: BLOCKED \`git $mode\` because gitleaks found possible secrets."
      echo "Remove the secret (or add a reviewed allowlist entry in .gitleaks.toml), re-stage, then retry."
      echo
      echo "$output"
    } >&2
    exit 2
    ;;
  *)
    fail_open "gitleaks exited with status $status: $(printf '%s' "$output" | tail -n 3 | tr '\n' ' ')"
    ;;
esac
