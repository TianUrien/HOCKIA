# Agent tooling: inventory and evaluation plan

Verified on 2026-10-02. This is an inventory of what the repository gives a
coding agent today and a plan to evaluate external frameworks and skill packs.
**Evaluation only: nothing is installed by this document.** The stack and the
"no new paid services" rule are not affected; everything listed is open source.

## 1. What exists today

| Item | Location | What it does |
|---|---|---|
| Agent working notes | `CLAUDE.md` (root) | Pre-push validation, staging-first flow, data-API grants, native-client gating, hidden-profile invariant, profiles column grants, plus the "Engineering memory" links to this directory |
| Duplicate notes | `AGENTS.md` (root) | An older copy of the first four sections of `CLAUDE.md` for other agents; keep in sync or replace with a pointer |
| Copilot instructions | `.github/copilot-instructions.md` | Architecture summary and code patterns for GitHub Copilot; partly stale (`supabase_setup/` as a backend source) |
| Permissions | `.claude/settings.json` | A single `permissions.allow` list (git, gh, supabase CLI, playwright, selected MCP tools, selected WebFetch domains) and `additionalDirectories` pointing at a sibling worktree. Several entries reference machine-specific absolute paths and one-off commands and are dead weight |
| Agents, hooks, skills, commands | `.claude/agents`, `.claude/hooks`, `.claude/skills`, `.claude/commands` | **None in the repository** |
| Engineering memory | `docs/engineering/` | This directory |
| Release checklist | `RELEASE_CHECKLIST.md` | Human runbook from 2026-02; partially stale (see operations.md) |
| Founder memory | outside the repository (the user's Claude memory directory) | Rulings, incidents and traps accumulated across sessions; the de-facto long-term memory today, not shared with the repository |

Observations:

- Repository-level guidance is strong on **what not to break** (grants,
  fences, native gating) and thin on **how to work** (planning, verification
  loops, review). The session memory outside the repository carries most of
  that, which does not survive a new machine or a new collaborator.
- There are no hooks, so none of the conventions in standards.md are enforced
  at edit time; they are enforced by CI after the fact.
- The permissions list is a history of one-off approvals rather than a
  curated policy.

## 2. Evaluation criteria

Score each candidate 0-3 on each criterion; anything scoring 0 on
compatibility or removal is out.

| Criterion | Question |
|---|---|
| Compatibility | Works with Claude Code as used here (CLAUDE.md, `.claude/settings.json`, MCP connectors for Supabase, Vercel, Sentry, Figma)? Does not assume a different stack, a monorepo tool, or a paid service? |
| Memory | Does it add durable, repository-local memory (specs, decisions, progress) that complements `docs/engineering/` rather than a second system that drifts? |
| Verification | Does it push toward tests, probes, typecheck and lint before claiming done? Does it fit the staging-first, founder-approval loop? |
| Hooks | Can its hooks run `npm run typecheck`, `eslint --max-warnings 0`, gitleaks or a migration-grant lint without slowing every edit? Are hooks optional per project? |
| Context overhead | How many tokens does it put in every session (instructions, personas, skill indexes)? Prefer lazy-loaded skills over always-on prompts. The current CLAUDE.md is about 4.5 KB; a framework that adds 30 KB per session must earn it |
| Removal | Can it be removed with a single directory delete and no residue in CLAUDE.md, settings or git history? Does it write outside the repository? |
| Public-repo safety | Does it store anything sensitive (prompts with credentials, user data, transcripts) inside the repository? |

## 3. Candidates

Summaries are from public descriptions and must be re-verified at evaluation
time; versions change quickly.

### Workflow frameworks

| Candidate | What it is (high level) | Expected fit | Main risk |
|---|---|---|---|
| ECC (Everything Claude Code) | A large bundle of agents, skills, hooks and commands for Claude Code | Broad, but most of it is generic; HOCKIA needs a few targeted pieces | Context overhead and permission sprawl; hard to remove partially |
| BMAD Method | Persona-driven agile workflow (analyst, PM, architect, dev, QA) producing PRD, architecture and story documents | HOCKIA already has founder briefs and Figma as the spec source; the persona layer duplicates that | Heavy always-on instructions; document formats that compete with Figma and this directory |
| GSD (Get Shit Done) | Planning and execution loop with explicit context management and progress files | Could structure multi-leaf work (Club v2 leaves, D1-D6) with persisted progress in the repo | Another progress format to keep in sync; check that it does not require pushing or branching conventions that conflict with staging-first |
| Spec Kit | Spec-driven development: constitution, specify, plan, tasks commands producing a `specs/` tree | Good match for new tables and RPC families (D5, D6) where the Figma brief needs a technical spec | Specs would need the gender-neutral/no-user-data rules; adds a directory agents must read |
| OpenSpec | Change proposals that amend living specs under `openspec/`, with a review step | Lightweight; proposals map well to "founder ruling -> migration + probe" | Overlaps with ADRs; choose one home for decisions |
| Superpowers | A skills library (brainstorming, TDD, systematic debugging, verification before completion) loaded on demand, plus optional hooks | Verification and debugging skills align with the probe/typecheck culture; on-demand loading keeps overhead low | Opinions on TDD and branching need tailoring to the Vitest/Playwright/probe mix |
| SuperClaude | Command and persona framework with MCP integrations | Overlaps with existing connectors; personas add overhead | Highest always-on context cost of the list |

### Skill packs

| Pack | Focus | Expected fit | Check |
|---|---|---|---|
| trailofbits | Security review skills (static analysis, audit methodology, dependency checks) | Strong fit for the open hardening workstreams and migration reviews | Must not require new paid scanners; confirm it works on SQL and Deno, not only on typical web stacks |
| wshobson | Large catalogue of subagents and skills by domain | Useful as a source of individual agents (SQL review, React performance) | Take only what is needed; the whole catalogue is too much context |
| vercel-labs | Front-end and deployment best practices, React and performance guidance | Relevant to bundle budgets, prerender and PWA work | Verify guidance matches Vite + React 19 rather than Next.js defaults |
| supabase | Supabase agent skills: Postgres, migrations, RLS, functions | Directly relevant; likely the best single pack for this codebase | Compare its migration and RLS guidance with standards.md; adopt only where consistent with explicit grants, probes and CLI-only pushes |

## 4. Evaluation method

1. **Read first**: for each candidate, read its README and the files it would
   add; measure the always-on token footprint (count the bytes it injects into
   CLAUDE.md or the system prompt).
2. **Dry trial in a throwaway worktree** (`git worktree add`), never on
   `staging`; no pushes. Run three representative tasks:
   - a migration with grants, rollback and probe (D5 or a hardening item);
   - a Club v2 phone screen from a Figma node with the amber/neutral-copy
     rules;
   - a security review of an edge function.
3. **Score** against section 2; note the token cost per task and whether the
   candidate tried to install packages, run network calls or write outside
   the repo.
4. **Remove** and confirm the tree is clean (`git status`, no residue in
   settings).
5. **Recommend** at most: one workflow (likely Spec Kit or OpenSpec for specs,
   or GSD for progress) and two skill packs (supabase, trailofbits), adopted
   piecemeal. Record the decision as an ADR.

## 5. Independent of any framework

These are worth doing regardless of the evaluation outcome:

- Curate `.claude/settings.json`: remove machine-specific paths and one-off
  commands; keep a small allowlist for git, gh, supabase CLI, npm scripts and
  the MCP tools in use.
- Replace `AGENTS.md` with a pointer to `CLAUDE.md` and this directory.
- Add two hooks once a hook mechanism is chosen: a pre-commit that runs
  gitleaks on staged files, and a check that a new migration has a rollback
  file and explicit grants (also useful as a CI job).
- Keep founder rulings that constrain code inside `docs/engineering/` (ADRs
  and standards), so the session memory outside the repository is a cache,
  not the only copy.
