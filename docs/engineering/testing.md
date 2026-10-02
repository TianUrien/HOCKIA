# Testing

Verified on 2026-10-02 from `client/package.json`, `client/playwright.config.ts`,
`client/vitest.db.config.ts`, `client/vite.config.ts`, `.github/workflows/ci.yml`
and the test directories.

## 1. Suites

| Suite | Location | Count | Runner | Needs |
|---|---|---|---|---|
| Unit | `client/src/__tests__/**` and co-located `*.test.ts(x)` | 225 files, about 2,300 cases | Vitest 4 + jsdom + Testing Library (`src/test/setup.ts` polyfills ResizeObserver, IntersectionObserver, matchMedia, scrollTo) | nothing external |
| DB integration | `client/src/__tests__/db/*.test.ts` | 7 files: `rls`, `triggers`, `state-machines`, `attribution`, `club-members`, `retention`, `shortLinks` | Vitest with `vitest.db.config.ts` (serial, 30 s timeout) | staging Supabase + E2E accounts |
| E2E | `client/e2e/*.spec.ts` | 36 spec files, 24 `@smoke`-tagged tests | Playwright 1.57, Chromium (WebKit optional with `PLAYWRIGHT_WEBKIT=1`) | staging Supabase + E2E accounts + dev server or `PLAYWRIGHT_BASE_URL` |
| Edge function unit | `supabase/functions/_shared/*.test.ts` | 17 files, 165 `Deno.test` cases (two are structural: `webhook-auth.test.ts` reads the function sources, `function-config.test.ts` reads `supabase/config.toml`) | `deno test --allow-env --allow-read .` | Deno 2 |
| SQL security probes | `supabase/tests/security/*.probe.sql` | 16 probes | Run by hand on staging via SQL; each rolls itself back | staging |

Coverage thresholds (`vite.config.ts`): 27 % for lines, functions, branches
and statements. These are a floor, not a target.

## 2. Commands

```sh
cd client
npm run lint                 # eslint . (CI adds --max-warnings=0)
npm run typecheck            # tsc -b --noEmit  (the only valid type check)
npm run test:unit            # vitest run
npm run test:unit:coverage   # vitest run --coverage --reporter=verbose
npm run test:db              # DB integration tests against staging
npm run test:e2e:smoke       # @smoke across setup, chromium, player, club, coach, brand, mobile-player
npm run test:e2e             # chromium project only (public pages)
npm run test:e2e:all         # every project
npm run test:e2e:staging     # E2E_STAGING_MODE=1: accounts behave as real users
npm run test:all             # lint, typecheck, unit, build, e2e smoke (run before pushing client code)

cd supabase/functions/_shared
deno test --allow-env --allow-read .
```

Playwright projects (`playwright.config.ts`): `setup` (signs in the role
accounts and stores state under `e2e/.auth/`, gitignored), `chromium`
(public), `chromium-player`, `chromium-club`, `chromium-coach`,
`chromium-brand`, `mobile-player` (Pixel 5 viewport), `staging`
(`*.staging.spec.ts` only). Spec suffix decides the project:
`.player.spec.ts`, `.club.spec.ts`, `.coach.spec.ts`, `.brand.spec.ts`,
`.authenticated.spec.ts` (player + mobile), `.staging.spec.ts`, otherwise public.

## 3. Where credentials come from

Credentials are never in the repository. The harness reads them from the
environment; the **names** are:

- Supabase target: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (staging).
- Role accounts: `E2E_PLAYER_EMAIL/PASSWORD`, `E2E_CLUB_EMAIL/PASSWORD`,
  `E2E_COACH_EMAIL/PASSWORD`, `E2E_BRAND_EMAIL/PASSWORD`,
  `E2E_UMPIRE_EMAIL/PASSWORD`.
- Teardown only: `E2E_SERVICE_ROLE_KEY` (optional; the global teardown deletes
  the messages the specs sent and skips silently without it).

Locally they are loaded by `dotenv` from `client/.env.local`, `client/.env`,
then the repository-root `.env.local` and `.env` (first loaded wins). In CI
they come from GitHub Actions secrets with the same names, written to a
`.env` file in the job (`ci.yml`, job "E2E Tests"), and the staging URL is also
exposed as `E2E_ALLOWED_SUPABASE_URL`.

### E2E write safety gate

`client/e2e/auth.setup.ts` refuses to run unless **both** hold:

1. `E2E_ALLOW_WRITES=1`, and
2. the Supabase URL matches `E2E_ALLOWED_SUPABASE_URL` exactly or
   `E2E_ALLOWED_SUPABASE_URL_REGEX`.

This is the control that keeps the suite off production. Do not weaken it.

The role accounts are flagged `is_test_account = true` in staging so edge
functions and triggers route their notifications to the test-mode notifiers.
`E2E_STAGING_MODE=1` flips them to real-user behaviour for notification
end-to-end specs.

## 4. CI (`.github/workflows/ci.yml`)

Triggers: push to `main` or `staging`, and pull requests targeting them.
Concurrency: a new push to a PR cancels that PR's in-progress run; pushes to
branches always complete.

| Job | What it does | When |
|---|---|---|
| Detect code changes | Sets `code=false` when only `*.md`, `docs/` or issue templates changed, so the two staging-writing jobs are skipped | always |
| Security Checks | gitleaks over full history; `npm ci`; `node scripts/audit-check.mjs` (production deps, high/critical, documented allowlist with expiry) | always |
| Lint & Type Check | `npx eslint . --max-warnings=0`; `npm run typecheck` | always |
| Edge Function Tests | `deno test` in `supabase/functions/_shared` (includes the webhook-auth regression guard) | always |
| Unit Tests | `npm run test:unit:coverage`; Codecov upload is best-effort | always |
| Build | `npm run build` with placeholder env; initial-load gzip and raw budgets; per-chunk warning; growth-vs-base warning; uploads `client/dist` for 3 days | always |
| Migration Validation | Links to staging. On non-main refs: strict `db push --dry-run --include-all`. On `main`: every migration file must already be applied to staging (staging may be ahead) | pushes and same-repo PRs |
| DB Integration Tests | `npm run test:db` against staging | code changes on **push to main or staging** or same-repo PRs; serialized in concurrency group `staging-db-tests` |
| E2E Tests | Chromium install, `.env` from secrets, `npm run test:e2e:smoke`, Playwright report for 3 days | code changes on **push to main** or same-repo PRs; serialized in concurrency group `staging-e2e-tests`; needs Build |

Note: a direct push to `staging` runs the DB integration tests (since
2026-10-02) but not the E2E smoke suite, which runs on the PR to `main` and
on the merge. Open a PR into `staging` when a change touches user flows and
you want the smoke suite before the branch deploys to the preview. The
constant concurrency groups mean a staging push and a PR run queue behind one
another; GitHub keeps one pending run per group, so a third arrival replaces
the pending one (it is not lost: the newest commit is what runs).

Manual workflows: `uptime.yml` (health ping + warm-up) and `synthetic.yml`
(Playwright `@smoke` against production). Scheduled monitoring runs on the
Cloudflare Worker instead; see operations.md.

## 5. Known flakes and their causes

| Symptom | Cause | Mitigation in place |
|---|---|---|
| `duplicate key ... profile_friendships_pair_unique` or similar in DB tests | Two CI runs mutating the same staging fixtures at once | Constant concurrency groups serialize DB and E2E jobs across main, staging and PR runs; `cancel-in-progress: false` so both complete |
| E2E timing failures on CI | Shared staging data, cold edge functions | `retries: 2`, `workers: 1` on CI, traces retained on failure |
| "Remote migration versions not found" on `main` | `main` is behind `staging` by design | The `main` branch uses the tolerant check |
| Setup CLI rate limit | `supabase/setup-cli@latest` hit the GitHub API limit | CLI pinned to 2.67.1 |
| PostHog events missing in automated runs | posthog-js drops captures in headless browsers | Documented in `lib/posthog.ts`; not a test failure |

Keep the `[QA]` fixtures on staging; several specs and probes depend on them.

## 6. Writing tests

- Unit-test pure rule mirrors (`lib/invites.ts`, `lib/signing.ts`,
  `lib/statusTone.ts`) and copy helpers; mock `@/lib/supabase` in component
  tests (see `amberRule.test.tsx`).
- Put RLS, trigger and state-machine assertions in `__tests__/db/` so they run
  against real policies.
- A security-relevant migration ships a `supabase/tests/security/*.probe.sql`
  that switches role with `SET LOCAL ROLE` and `request.jwt.claims`, prints
  PASS/FAIL lines and ends with a `RAISE` so nothing persists.
- Edge-function logic that can be pure (routing, labels, templates, signing)
  lives in `_shared/` with a sibling `*.test.ts`.
- Tag an E2E test `@smoke` only if it must gate every release; the smoke suite
  is serialized and runs on shared data.

## 7. Gaps (verified absence)

- No automated check that a new migration has a rollback file or a probe.
- No load or performance tests (see capacity.md for the proposed plan).
- No accessibility lint or axe run in CI (a manual WCAG pass was done in
  2026-07).
- No contract test between `client/src/lib/database.types.ts` and
  `supabase/functions/_shared/database.types.ts`.
- Coverage floor of 27 % leaves most component code unmeasured.
