# HOCKIA engineering memory

Persistent engineering documentation for HOCKIA (field-hockey transfer-market
app). It is written for engineers and coding agents who need to change the
system safely. Every statement is either **verified** from the repository at
the time of writing (2026-10-02, branch `staging`) or labelled as an
**assumption** that must be checked before being relied on.

This directory contains no credentials, tokens, user data or exploit detail.
The repository is public.

## Documents

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | Responsibilities and boundaries of each layer, data flows, where business rules live, the recruiting pipeline D1-D4 |
| [standards.md](standards.md) | Conventions that are enforced or visible in the code: typecheck, lint, copy rules, budgets, migration conventions, commit text |
| [testing.md](testing.md) | Test suites, commands, what each CI job does, where test credentials come from, known flakes |
| [security.md](security.md) | Trust boundaries, RLS and grants, SECURITY DEFINER rules, fences, secrets by name, open hardening workstreams |
| [operations.md](operations.md) | Environments, release runbook, rollback paths, backups, monitoring, known traps |
| [capacity.md](capacity.md) | Workload model for 1,000 registered users, what is measured today, a proposed load-test plan (not run), platform limits to verify |
| [skills.md](skills.md) | What exists in `.claude/` today, the seven copied project skills (source, commit, size, trigger, removal), the founder-run Trail of Bits plugins, and the 2026-10-02 framework evaluation record |
| [hooks.md](hooks.md) | The two local Claude Code hooks (secret scan before commit/push, migration lint after edit): what they do, the settings block to register them, test record |
| [decisions/](decisions/README.md) | Architecture decision records that can be verified from the repository and its history |

## Consult when...

| Situation | Read first |
|---|---|
| Writing or reviewing a migration | security.md (grants, RLS, hidden-profile fence) then standards.md (migration conventions, rollback file, probe) |
| Adding a column to `public.profiles` | security.md "Column-level grants on profiles" and the root `CLAUDE.md` |
| Adding or changing an RPC, view or edge function that returns people | security.md "Hidden, blocked and frozen profiles" |
| Changing an edge function | security.md "Edge functions" and operations.md "Edge function deploys" (verify_jwt flags) |
| Preparing a release to production | operations.md "Release runbook" |
| Something is broken in production | operations.md "Rollback paths" and "Monitoring" |
| Adding a dependency or a heavy component | standards.md "Bundle budgets" |
| Writing user-facing copy or status colours | standards.md "Copy and status rules" |
| Adding tests or debugging CI | testing.md |
| Planning for growth or a campaign | capacity.md |
| Considering an agent framework or skill pack, or refreshing a copied skill | skills.md, then decisions/0007 |
| Setting up Claude Code hooks on a new machine | hooks.md |
| Wondering why something is the way it is | decisions/ |

## How to keep this current

- Update the relevant document in the same pull request as the change it describes.
- When a statement stops being true, correct it or delete it; do not leave stale guidance.
- Add an ADR under `decisions/` when a decision constrains future work and
  would otherwise have to be rediscovered from history.
- Keep the root `CLAUDE.md` short; it links here rather than duplicating content.
