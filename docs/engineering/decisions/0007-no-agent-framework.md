# ADR 0007: No primary agent workflow framework

Status: accepted (founder ruling 2026-10-02, after the evaluation recorded
in [skills.md](../skills.md) section 5).

## Context

`docs/engineering/skills.md` set out to pick at most one workflow framework
and two skill packs for coding agents working in this repository. Eleven
candidates were evaluated on 2026-10-02 against seven criteria
(compatibility, memory, verification, hooks, context overhead, removal,
public-repo safety) by reading their installers, hook manifests and skill
files from fresh clones; nothing was installed during the evaluation.

What an agent already has here: a 4.5 KB `CLAUDE.md` that wins by
precedence, the founder's out-of-repo memory, `docs/engineering/` with six
ADRs, and CI that enforces lint, `tsc -b`, unit coverage, bundle budgets,
gitleaks, `npm audit`, Deno tests and a migration dry run. The gaps were
"how to work" guidance (verification loops, debugging method), domain
expertise for Supabase/Postgres security and performance, and edit-time
enforcement of two conventions that CI only catches afterwards.

## Decision

1. **No primary workflow framework.** The working model stays `CLAUDE.md`
   (short, links out) + founder memory (a cache) + `docs/engineering/`
   (standards, ADRs, runbooks) + lazily loaded project skills + two
   hand-written hooks.
2. **Skills are copied, not installed.** Seven MIT-licensed skills live in
   `.claude/skills/<name>/` with their upstream licence text, pruned of
   changelogs and upstream feedback flows, and documented one by one in
   skills.md section 2 with source commit, size, trigger and removal. Only
   the `supabase` skill is altered: a short override header makes ADR-0001
   and standards.md section 6 win over its generic migration workflow.
3. **Security-review material comes from Trail of Bits plugins in user
   scope** (`differential-review`, `insecure-defaults`, `sharp-edges`),
   installed and removed by the founder with the commands in skills.md
   section 3. Their CC-BY-SA licence keeps them out of the public tree.
4. **Two hooks, written here** (hooks.md): a secret scan that blocks
   `git commit` / `git push` on a gitleaks finding and fails open when
   gitleaks is absent, and a post-edit migration lint that reruns
   `scripts/check-migrations.mjs` on the file just written. Scripts are
   committed; registration in `.claude/settings.json` is a per-developer
   step.
5. **No third-party installers** (`npx skills add`, `specify init`,
   framework `install.sh`) run against this repository; copies come from
   shallow clones that are read first and deleted after.

## Red flags that decided the "not installed" rows

Each was verified in the candidate's files and is listed with its location
in skills.md section 5:

- Hooks on every tool call (`PreToolUse`/`PostToolUse` with matcher `.*`,
  `npx <package>` per call), or Stop hooks that run `tsc --noEmit`, the exact
  no-op this repository bans in favour of `tsc -b`.
- Writes to user-level settings or home directories (`includeCoAuthoredBy:
  false`, `~/.claude/metrics`, `~/.gateguard`, `~/.cache/<tool>`), which
  change commit attribution and leave residue after removal.
- Network at install or at every session: template bundles downloaded by
  the installer, `npm view` update checks on SessionStart, telemetry to a
  vendor endpoint, `curl ... | sh`, unpinned `npx -y ...@latest` MCP servers,
  a deploy script that uploads a tarball of the project to a third-party
  host, rules fetched from raw.githubusercontent on each use.
- Branching and process rules that contradict "commits land on `staging`,
  the founder merges to `main`": feature branch per spec, "never work on
  main", auto-commit with an offer to push and open a PR.
- A second (or third) memory system next to `docs/engineering/` and founder
  memory: `specs/`, `openspec/`, `.planning/`, `_bmad-output/`, `docs/pdca/`.
- Always-on context from 1k to 12k tokens per session for material that is
  mostly generic.
- A non-MIT licence (CC-BY-SA) or no licence file at all, which matters
  because the repository is public (ADR-0006).

## Evidence

- `.claude/skills/*/SKILL.md` frontmatter and `LICENSE`/`NOTICE.md` files;
  `.claude/skills/supabase/SKILL.md` override header.
- `scripts/hooks/pre-commit-gitleaks.sh`, `scripts/hooks/post-edit-migration-lint.mjs`,
  `scripts/check-migrations.mjs`; the test record in hooks.md.
- `docs/engineering/skills.md` sections 2, 3 and 5 (versions, commits, sizes,
  always-on bytes).
- `.claude/settings.json` carries no `hooks`, `agents` or `commands` keys
  from any framework; `CLAUDE.md` is unchanged by this decision.

## Consequences

- Always-on cost of the tooling is about 2.9 KB of skill descriptions
  (roughly 700 tokens); skill bodies (about 200 KB) load on demand.
- Removal of everything in this ADR is `rm -rf .claude/skills scripts/hooks`,
  the three `claude plugin uninstall` commands, and deleting the `hooks`
  block from settings. No `CLAUDE.md` residue.
- Copied skills do not update themselves. Refreshing one is a deliberate
  re-copy recorded in skills.md with the new commit and date.
- Spec-shaped work for new tables and RPC families (D2-D6) continues to use
  ADRs and `docs/engineering/`; if a deliverable needs a technical spec, add
  `docs/engineering/specs/<id>.md` using the ADR template rather than a
  framework.
- The `supabase` skill still describes workflows (declarative schemas, MCP
  `execute_sql` iteration, Next.js SSR) that do not apply here; the header
  says so, and `CLAUDE.md` wins by precedence. Agents must not follow the
  skill's "iterate with `execute_sql`" advice on staging.

## Revisit when

Any of these holds; re-run the evaluation from the versions in skills.md
section 5 rather than from impressions:

- A second regular contributor joins and needs a shared planning format
  that `docs/engineering/` does not provide (then OpenSpec, with telemetry
  disabled, is the first candidate).
- The `specs/` or ADR directory outgrows a flat list (more than roughly 20
  active documents).
- The copied skills drift more than one upstream major version behind, or
  upstream publishes an override mechanism that removes the need for the
  `supabase` header.
- Claude Code changes hook or skill semantics so that the two scripts or the
  `description`-only loading no longer behave as documented in hooks.md.
- A framework is found that adds under 1k always-on tokens, registers no
  `.*` hooks, writes nothing outside the project, phones nowhere, and has no
  branching opinion.

## Alternatives considered

- **OpenSpec** (proposals that amend living specs): lightest of the spec
  frameworks and the only one worth revisiting; rejected for now because
  ADRs and the Figma handoff digest are the spec and a second home for
  decisions would drift.
- **Superpowers as a plugin** rather than two copied skills: rejected for
  its SessionStart injection and its "skill must be invoked" and TDD/branch
  rules.
- **Copying the Trail of Bits skills into the tree**: rejected on licence
  grounds.
- **Spec Kit, GSD, ECC, SuperClaude, BMAD**: rejected for the red flags
  above.
