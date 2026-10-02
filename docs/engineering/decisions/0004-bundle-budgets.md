# ADR 0004: Bundle budgets - a hard initial-load gate and a raw backstop

Status: accepted (initial-load metric since 2026-06-18; raw 4,800 KB since 2026-09-27).

## Context

Until mid-2026 CI budgeted the gzip of every chunk, which double-counted
lazy admin and chart code and punished code-splitting; the gate was raised
repeatedly to chase a number that did not reflect what users download. The
real cost is what `app.html` loads eagerly on first paint. Meanwhile the
phone-first redesign and Club v2 add many lazy screens, growing the total.

## Decision

1. **Initial-load gzip of the eager chunks is the primary gate: 480 KB,
   warning at 450 KB. It is never raised.** If a change crosses it, split or
   defer code instead.
2. **Raw total across all chunks is a backstop: 4,800 KB**, warning at
   4,700 KB. It may be raised only with founder approval and a written
   justification in the workflow comment; a new dependency gets a real
   justification, not a quiet bump.
3. Warnings (never failures) for any chunk above 512 KB raw and for a change
   that adds more than 50 KB raw versus its base commit.
4. Supporting rules in `vite.config.ts`: route-level lazy loading,
   `LAZY_ONLY_DEPS` kept out of the eager vendor chunk, admin chart chunks
   stripped from the HTML preload list, no image precache.

## Evidence

- `.github/workflows/ci.yml`, job "Build": the budget script with its full
  history of bumps and reasons (3,200 KB in May 2026 to 4,800 KB in September
  2026; the first-load gate unchanged).
- Commits `b32866e7` (recharts out of the critical path), `3ddb1e09` (lazy
  Club v2 screens), `6a2a6618`, `37fd7f82`, `0f67b780` (founder-approved raw
  bumps).

## Consequences

- Lazy-loading cannot lower the raw metric (it sums every chunk); only
  retiring code does. A TODO in the workflow names the v1 desktop club
  screens as the next candidate.
- The first-load number is the one to quote in performance discussions; the
  raw number is a bloat alarm.
