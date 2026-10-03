# Agent tooling: installed skills, hooks and the evaluation record

Verified on 2026-10-02 (branch `eng/skills-install`, from `staging`). This
document records what the repository gives a coding agent, which external
skills were copied in, why the rest were not, and how to remove any of it.
The decision itself is [ADR-0007](decisions/0007-no-agent-framework.md); the
two local hooks are described in [hooks.md](hooks.md).

Nothing here adds a paid service. Every copied file is MIT-licensed and kept
verbatim apart from the pruning and the one override header listed below.

## 1. What exists today

| Item | Location | What it does |
|---|---|---|
| Agent working notes | `CLAUDE.md` (root) | Pre-push validation, staging-first flow, data-API grants, native-client gating, hidden-profile invariant, profiles column grants, links to this directory. Wins over every skill by precedence |
| Agent notes pointer | `AGENTS.md` (root) | A pointer to `CLAUDE.md` and this directory for tools that look for that file name |
| Copilot instructions | `.github/copilot-instructions.md` | Architecture summary and code patterns for GitHub Copilot; partly stale |
| Permissions | `.claude/settings.json` | `permissions.allow` list and `additionalDirectories`. Still a history of one-off approvals; curation is pending (section 6) |
| Project skills | `.claude/skills/<name>/` | Seven lazily loaded skills copied from MIT repositories (section 2). Only each skill's `description` line is in context every session; the body loads when the skill triggers |
| Hooks | `scripts/hooks/` + a `hooks` block the founder adds to `.claude/settings.json` | A pre-commit/pre-push secret scan and a post-edit migration lint; see [hooks.md](hooks.md) |
| Agents, commands | `.claude/agents`, `.claude/commands` | None in the repository |
| Engineering memory | `docs/engineering/` | This directory |
| Founder memory | outside the repository | Rulings, incidents and traps accumulated across sessions; a cache of what should live here, not the only copy |

Always-on context cost of the skills: the seven `description` fields total
about 2.9 KB (roughly 700 tokens). Skill bodies (about 200 KB on disk) load
only when a skill is invoked.

## 2. Installed skills (project scope, copied not installed)

All seven live under `.claude/skills/<name>/` so that a collaborator or a new
machine gets them from git and removal is one directory. Each directory
carries the upstream `LICENSE` (or a `NOTICE.md` where upstream has none).
No installer was run; the files were copied from fresh shallow clones and
the clones were deleted. `npx skills add ...` is not used for any pack.

To refresh a skill, repeat the copy from a new clone, re-apply the pruning
listed for it, re-apply the override header where noted, and update the
commit and date here.

### 2.1 `supabase` (from supabase/agent-skills)

| | |
|---|---|
| Source | https://github.com/supabase/agent-skills `skills/supabase`, commit `c9be0e931b7930f7d02126d04774d904c381e7d7` (2026-10-02), MIT; upstream skill version 0.1.2 |
| Files | 2 files, 17.0 KB: `SKILL.md`, `LICENSE` |
| Pruned | `CHANGELOG.md`; `references/skill-feedback.md` and `assets/feedback-issue-template.md` (a flow that opens GitHub issues on the upstream repository) and the "Reference Guides" section that pointed at them |
| Changed | A six-point **HOCKIA overrides** block prepended after the frontmatter: hand-written migration files applied only with `supabase db push --linked` (never MCP `apply_migration`, never "iterate with `execute_sql` then `db pull`"); explicit GRANTs on every new object; rollback file + self-reverting probe; hidden-profile predicate and column-level `profiles` grants; not a Next.js/SSR app; no changelog fetch unless needed; staging first. See ADR-0001 and standards.md section 6 |
| What it is for | The Supabase-specific security checklist (`SECURITY DEFINER` in `public` is callable by everyone, views bypass RLS unless `security_invoker`, UPDATE needs a SELECT policy and `WITH CHECK`, never authorise on `user_metadata`, Data API exposure vs RLS), CLI and MCP troubleshooting, and the rule to read the monitoring docs before diagnosing an error |
| Triggers | Any task that names Supabase: Database, Auth, Edge Functions, Realtime, Storage, migrations, RLS, security audits, CLI or MCP, debugging errors or logs |
| Remove | `rm -rf .claude/skills/supabase` |

### 2.2 `supabase-postgres-best-practices` (from supabase/agent-skills)

| | |
|---|---|
| Source | https://github.com/supabase/agent-skills `skills/supabase-postgres-best-practices`, commit `c9be0e93...` (2026-10-02), MIT; upstream skill version 1.1.1 |
| Files | 35 files, 53.3 KB: `SKILL.md`, `LICENSE`, `references/` (31 rule files plus `_sections.md` and `_template.md`) |
| Pruned | `CHANGELOG.md`, `references/_contributing.md` (upstream contribution flow) |
| Changed | Nothing |
| What it is for | Generic Postgres rules, each with incorrect/correct SQL. The ones that matter here: `security-rls-performance.md` (wrap `auth.uid()` in `(select ...)`, index policy columns), `security-privileges.md`, `schema-foreign-key-indexes.md`, `query-partial-indexes.md`, `data-n-plus-one.md`, `lock-skip-locked.md` (queues) |
| Triggers | Creating or altering tables, columns, indexes, triggers, functions, RLS policies, queues or scheduled jobs; diagnosing slow queries, locks, connection exhaustion or rows visible to the wrong user |
| Remove | `rm -rf .claude/skills/supabase-postgres-best-practices` |

### 2.3 `verification-before-completion` (from obra/superpowers)

| | |
|---|---|
| Source | https://github.com/obra/superpowers `skills/verification-before-completion`, commit `8ca22dba9a94f28898bbce59f2537ff4d87c747d` (2026-09-25), MIT (v6.4.2) |
| Files | 2 files, 4.7 KB: `SKILL.md`, `LICENSE` |
| Pruned / changed | Nothing |
| What it is for | "No completion claims without fresh verification output": run the typecheck, lint, tests or probe and read the result before saying done. The repository's `npm run typecheck` (never `tsc --noEmit`) and probe culture in writing |
| Triggers | About to claim work is complete, fixed or passing; before committing or opening a PR |
| Remove | `rm -rf .claude/skills/verification-before-completion` |

### 2.4 `systematic-debugging` (from obra/superpowers)

| | |
|---|---|
| Source | https://github.com/obra/superpowers `skills/systematic-debugging`, commit `8ca22dba...` (2026-09-25), MIT |
| Files | 7 files, 30.1 KB: `SKILL.md`, `LICENSE`, `root-cause-tracing.md`, `defense-in-depth.md`, `condition-based-waiting.md`, `condition-based-waiting-example.ts`, `find-polluter.sh` (test-pollution bisection helper, executable; the `~/threads/...` imports in the example are a TypeScript path alias from the upstream project, not a local path) |
| Pruned | `CREATION-LOG.md`, `test-academic.md`, `test-pressure-1..3.md` (upstream skill-authoring and evaluation prompts) |
| Changed | Nothing |
| What it is for | Root cause before fix, one variable at a time, no fixes that are guesses; replacing fixed-delay timers with condition polling (a recurring HOCKIA bug class) |
| Triggers | Any bug, test failure or unexpected behaviour, before proposing a fix |
| Remove | `rm -rf .claude/skills/systematic-debugging` |

Not taken from superpowers: the plugin itself (its SessionStart hook injects
about 1.2k tokens per session and its branching and TDD rules fight
`CLAUDE.md`).

### 2.5 `e2e-testing-patterns` (from wshobson/agents)

| | |
|---|---|
| Source | https://github.com/wshobson/agents `plugins/developer-essentials/skills/e2e-testing-patterns`, commit `156b7a5e7a8b93642628a339ee4039c925b34c7f` (2026-09-28), MIT (marketplace 1.7.1) |
| Files | 3 files, 15.4 KB: `SKILL.md`, `LICENSE`, `references/details.md` |
| Pruned / changed | Nothing. Contains Cypress examples alongside Playwright; the repository uses Playwright only (`client/e2e/`) |
| What it is for | Page-object model, selector strategy, flaky-test triage, test isolation and CI sharding for Playwright suites |
| Triggers | Writing E2E tests, debugging flaky tests, setting testing standards |
| Remove | `rm -rf .claude/skills/e2e-testing-patterns` |

### 2.6 `javascript-testing-patterns` (from wshobson/agents)

| | |
|---|---|
| Source | https://github.com/wshobson/agents `plugins/javascript-typescript/skills/javascript-testing-patterns`, commit `156b7a5e...` (2026-09-28), MIT |
| Files | 3 files, 28.5 KB: `SKILL.md`, `LICENSE`, `references/advanced-testing-patterns.md` |
| Pruned / changed | Nothing. Some examples use Jest idioms (`jest.fn`, `jest.mock`); the repository uses Vitest (`vi.fn`, `vi.mock`) |
| What it is for | Unit and integration patterns with Testing Library, mocking, fixtures, async testing |
| Triggers | Writing JavaScript/TypeScript tests, setting up test infrastructure |
| Remove | `rm -rf .claude/skills/javascript-testing-patterns` |

Not taken from wshobson: `tailwind-design-system` (targets Tailwind v4; the
client is on 3.x), `nextjs-*`, and the `protect-mcp` / `review-agent-governance`
plugins (they run `npx protect-mcp` on every tool call).

### 2.7 `composition-patterns` (from vercel-labs/agent-skills)

| | |
|---|---|
| Source | https://github.com/vercel-labs/agent-skills `skills/composition-patterns`, commit `063bee94c3f4df8453406c830b0a7df0f2860278` (2026-08-28). **The upstream repository has no `LICENSE` file**; its README states "License: MIT" and the skill frontmatter declares `license: MIT`. The copy is kept on that basis with a `NOTICE.md` saying so; remove the directory if the licence is ever clarified otherwise |
| Files | 15 files, 50.9 KB: `SKILL.md` (frontmatter name `vercel-composition-patterns`), `AGENTS.md` (the compiled rule set), `README.md`, `NOTICE.md`, `metadata.json`, `rules/` (8 rules plus `_sections.md`, `_template.md`) |
| Pruned / changed | Nothing apart from the added `NOTICE.md`. No Next.js references |
| What it is for | React 19 composition: compound components over boolean props, lifting state into providers, explicit variants, `children` over render props, no `forwardRef` |
| Triggers | Refactoring components with boolean-prop proliferation, building reusable component APIs, compound components, context providers |
| Remove | `rm -rf .claude/skills/composition-patterns` |

Not taken from vercel-labs: `react-best-practices` (416 KB, 13 Next-only rules
to prune; revisit if the bundle-budget work wants it), `deploy-to-vercel`
(its script uploads a tarball of the project to a third-party endpoint),
`web-design-guidelines` and `writing-guidelines` (fetch rules from
raw.githubusercontent on every use), `vercel-optimize`, `react-native-skills`.

## 3. Trail of Bits security plugins (user scope, founder-run; not in the repository)

The trailofbits skills are **CC-BY-SA-4.0**, not MIT. Copying their files
into a public MIT-style repository would require attribution and share-alike
on the copies, so they are installed as Claude Code plugins in user scope,
where nothing enters the tree. These commands are documented here and run by
the founder, not by an agent:

```sh
claude plugin marketplace add trailofbits/skills
claude plugin install differential-review@trailofbits   # /diff-review <sha|pr|diff>: security review with blast radius + test-coverage check
claude plugin install insecure-defaults@trailofbits     # /insecure-defaults:audit <path>: fallback secrets, fail-open switches, permissive access
claude plugin install sharp-edges@trailofbits           # API-misuse / footgun review (has a JavaScript reference)
# optional, needs uv and network: claude plugin install supply-chain-risk-auditor@trailofbits
```

None of the three recommended plugins ships hooks. `differential-review`
writes a markdown report into the current directory; run it with the report
path outside the repository or delete the report before committing.
Plugins to skip: `gh-cli` (a PreToolUse hook on every Bash call), `fp-check`
(Stop-hook prompts, extra model calls), `static-analysis` (needs Semgrep),
`second-opinion` (needs another agent CLI).

Removal:

```sh
claude plugin uninstall differential-review@trailofbits
claude plugin uninstall insecure-defaults@trailofbits
claude plugin uninstall sharp-edges@trailofbits
claude plugin marketplace remove trailofbits
```

## 4. Evaluation criteria (kept for the next round)

Score each candidate 0-3 on each criterion; anything scoring 0 on
compatibility or removal is out.

| Criterion | Question |
|---|---|
| Compatibility | Works with Claude Code as used here (`CLAUDE.md`, `.claude/settings.json`, MCP connectors for Supabase, Vercel, Sentry, Figma)? Does not assume a different stack, a monorepo tool, or a paid service? |
| Memory | Adds durable, repository-local memory that complements `docs/engineering/` rather than a second system that drifts? |
| Verification | Pushes toward tests, probes, typecheck and lint before claiming done? Fits the staging-first, founder-approval loop? |
| Hooks | Can its hooks run `npm run typecheck`, `eslint --max-warnings 0`, gitleaks or the migration lint without slowing every edit? Optional per project? |
| Context overhead | How many tokens in every session? Prefer lazy-loaded skills over always-on prompts; `CLAUDE.md` is about 4.5 KB and a framework that adds 30 KB per session must earn it |
| Removal | One directory delete, no residue in `CLAUDE.md`, settings or git history? Writes outside the repository? |
| Public-repo safety | Stores anything sensitive (credentials, user data, transcripts) inside the repository? |

## 5. Evaluation outcome (2026-10-02)

Eleven repositories were shallow-cloned into a throwaway directory,
installers and hook manifests were read (never executed), and the clones
were deleted. Versions and commits are recorded so the next re-evaluation
starts from facts. Fit is 1-5 against section 4.

| Candidate | Version / commit (date) | Licence | Always-on cost | Outcome | Main reason |
|---|---|---|---|---|---|
| supabase/agent-skills | pkg 0.1.9; `c9be0e9` (2026-10-02) | MIT | 2 descriptions, 1.7 KB | **Copied** (2 skills) | Security checklist matches the 2026-07/08 audit findings one for one; migration workflow overridden by header |
| trailofbits/skills | marketplace 1.0.0; `82fe822` (2026-09-28) | CC-BY-SA-4.0 | 150-300 B per plugin | **Plugins, user scope** (3) | Best security-review material; licence keeps it out of the tree |
| obra/superpowers | v6.4.2; `8ca22db` (2026-09-25) | MIT | plugin 1.2k tokens/session; 2 copied skills 350 B | **Copied** (2 skills), plugin not installed | Verification and debugging skills are harness-neutral; the plugin's SessionStart injection and branching/TDD rules conflict with `CLAUDE.md` |
| wshobson/agents | marketplace 1.7.1; `156b7a5` (2026-09-28) | MIT | 250 B per copied skill | **Copied** (2 skills) | Playwright and Vitest patterns; the pack as a whole is too broad and two of its plugins run `npx` on every tool call |
| vercel-labs/agent-skills | metadata 1.0.0; `063bee9` (2026-08-28) | No LICENSE file (README/frontmatter: MIT) | 340 B per copied skill | **Copied** (1 skill) | Composition patterns are framework-neutral; `deploy-to-vercel` uploads the project to a third-party endpoint and two skills fetch rules remotely per use |
| GitHub Spec Kit | specify-cli 1.1.1.dev0; `8dfb15d` (2026-10-02) | MIT | 1-2 KB | Not installed | Creates a numbered feature branch per spec (contradicts commits on `staging`), a constitution that duplicates `CLAUDE.md`, and a `specs/` tree as a second memory home; `specify init` downloads a template bundle at install |
| OpenSpec | 1.14.0; `2500d6d` (2026-10-02) | MIT | 2-3 KB | Not installed; the only spec framework worth revisiting | Overlaps with `decisions/`; posts telemetry to a vendor endpoint unless `OPENSPEC_TELEMETRY=0` |
| GSD (get-shit-done) | 1.50.0-canary.0; `bdcaab2` (2026-05-31) | MIT | ~12k tokens cold start (~700 with the core profile) | Not installed | 13 hooks registered into `settings.json`, a SessionStart update check that hits the network, planning files that form a third memory system |
| ECC (everything-claude-code) | 2.2.3; `ef648e0` (2026-10-01) | MIT | ~4.6k tokens of rules + injection + 89 KB of descriptions | Not installed | PreToolUse/PostToolUse on `.*`, seven Stop hooks (one runs the `tsc --noEmit` this repository bans), writes under `~/.claude` and `~/.gateguard`, sets `includeCoAuthoredBy: false` in user settings |
| SuperClaude | 4.3.0; `fe68862` (2026-09-27) | MIT | ~4.5 KB of descriptions; 76 KB of core/modes if imported | Not installed | User-global install only, `curl ... \| sh` for a Python toolchain, unpinned `npx -y ...@latest` MCP servers every session, "feature branches only" rule |
| BMAD-METHOD | 6.13.0-next; `4f61d4e` (2026-10-02) | MIT (+ trademark) | ~7 KB of descriptions | Not installed | Installed through a third-party `npx skills add` CLI, auto-commits and offers to push, proposes reducing `CLAUDE.md` to a pointer, another memory system |

Red flags that drove the "not installed" rows were verified in the cloned
files (hook manifests with `.*` matchers, user-settings writes, telemetry and
upload endpoints, update checks on SessionStart). None of the copied skills
contains a hook, a script that runs at install, or a network call at load
time; the `supabase` skill's advice to fetch the changelog is softened by the
override header.

## 6. Independent of any framework (still open)

- Curate `.claude/settings.json`: remove machine-specific paths and one-off
  commands; keep a small allowlist for git, gh, supabase CLI, npm scripts and
  the MCP tools in use.
- Add the two hooks from [hooks.md](hooks.md) to `.claude/settings.json`
  (founder step).
- Keep founder rulings that constrain code inside `docs/engineering/` (ADRs
  and standards), so the session memory outside the repository is a cache,
  not the only copy.
- Optionally add one sentence to `CLAUDE.md`: "Project skills under
  `.claude/skills/` defer to this file and `docs/engineering/standards.md`;
  on migrations ADR-0001 wins." Precedence already works that way; saying so
  stops an agent from following a skill's generic workflow on staging.
