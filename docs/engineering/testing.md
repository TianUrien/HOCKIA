# Testing

Verified on 2026-10-02 from `client/package.json`, `client/playwright.config.ts`,
`client/vitest.db.config.ts`, `client/vite.config.ts`, `.github/workflows/ci.yml`
and the test directories. E2E rows, section 3a and the E2E flakes re-verified
on 2026-11-11 by running the full Playwright suite against staging (source:
local full and smoke runs, same day).

## 1. Suites

| Suite | Location | Count | Runner | Needs |
|---|---|---|---|---|
| Unit | `client/src/__tests__/**` and co-located `*.test.ts(x)` | 225 files, about 2,300 cases | Vitest 4 + jsdom + Testing Library (`src/test/setup.ts` polyfills ResizeObserver, IntersectionObserver, matchMedia, scrollTo) | nothing external |
| DB integration | `client/src/__tests__/db/*.test.ts` | 7 files: `rls`, `triggers`, `state-machines`, `attribution`, `club-members`, `retention`, `shortLinks` | Vitest with `vitest.db.config.ts` (serial, 30 s timeout) | staging Supabase + E2E accounts |
| E2E | `client/e2e/*.spec.ts` | 29 spec files; 223 test runs across the projects in the full suite, 109 in the smoke suite (2026-11-11) | Playwright 1.57, Chromium (WebKit optional with `PLAYWRIGHT_WEBKIT=1`) | staging Supabase + E2E accounts + dev server or `PLAYWRIGHT_BASE_URL` |
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
npm run test:e2e:all         # every project (about 5 minutes locally, see 3a)
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

## 3a. Full E2E suite status (2026-11-11)

The full suite (`npm run test:e2e:all`) is trustworthy again. Before the
2026-11-11 repair it failed 137 of 371 runs for reasons unrelated to the
release (specs written for the pre-rebrand UI, removed screens, a sign-in
setup waiting on selectors that no longer exist); only `@smoke` could be
trusted. After the repair: **199 passed, 0 failed, 24 skipped** of 223, in
about 5 minutes (two consecutive clean full runs; the second had 198 passed
and 25 skipped because one skip depends on staging data). A failure in the
full suite now means something: read it before a release instead of diffing
against a baseline.

CI still gates on the smoke suite only (97 passed, 12 skipped of 109 on a
quiet machine; see the two smoke flakes under load in section 5). The
full suite is run by hand before a release and after changes to shared
screens.

What the 24 skips are (none is a hidden failure):

| Skips | Spec | Why |
|---|---|---|
| 8 | `notifications.staging.spec.ts` | Runs only with `npm run test:e2e:staging` (`E2E_STAGING_MODE=1`, accounts behave as real users) |
| 7 | `public-profile-share.spec.ts` | Needs `E2E_PUBLIC_*_USERNAME` / `E2E_PUBLIC_BRAND_SLUG`, not set locally or in CI |
| 5 | `ugc-safety.player.spec.ts` | Two `test.fixme` (report submit, block and unblock) on both player projects, one data-dependent skip |
| 3 | `dashboard-menu`, `notifications-drawer` | Desktop-only or phone-only halves of a pair; the other half runs |
| 1 | `onboarding.spec.ts` | The E2E brand is already onboarded |

Harness settings that matter (`client/playwright.config.ts`):

- `timeout: 60s`, `expect.timeout: 15s`. The suite talks to remote staging;
  the Playwright defaults (30s, 5s) assume a local backend and produced
  timeouts that looked like failures.
- `workers: 2` locally, 1 on CI. All workers share one IP against staging: at
  the default (half the cores) requests took 2 to 6s and some returned 429.
- `auth.setup.ts` has a 90s timeout and waits for the dashboard H1.
- A worktree needs the three env files copied from the main checkout:
  `client/.env`, `client/.env.local` and the repository-root `.env.local`.
  Without the root file the dev server has no Supabase URL and every page
  renders blank (`process.env.SUPABASE_URL` is defined as an empty string and
  wins over `VITE_SUPABASE_URL` in `lib/supabase.ts`).

What the suite leaves on staging per run (unchanged by the repair unless
noted):

- Messages sent as the E2E accounts. Removed by `global.teardown.ts` only when
  `E2E_SERVICE_ROLE_KEY` is set (CI); a local run leaves them.
- One "E2E test post" per player project from `home-feed.player.spec.ts`.
- One application to the seeded E2E vacancy, the first time only.
- No offers: `qa-brand-offers.brand.spec.ts` now deletes the draft it creates
  and no longer publishes (it used to leave a live or ended offer). No
  rate-limit rows from `signup.spec.ts` (the checks are answered locally).
- Hand-off screenshots outside the repository are written only with
  `QA_PROBE=1`.

Not covered by E2E after the repair (the specs were deleted because the
screen is gone, or could not run unattended):

- Member-facing brand offers (Home offer card, offer detail, Community ›
  Brands offers rail, the Home gear rail) and the marketplace need chips:
  they need a standing live `[QA]` offer on staging, which does not exist.
- Publishing a brand offer and ending it (needs an uploaded photo and leaves
  an undeletable Ended offer per run; the SQL probe covers the RPC).
- The "Recruiters only" highlight-video toggle (the old spec never found the
  video on the profile v2 dashboard and skipped itself).
- Questions as a post kind in Home (the `/community/questions` list and its
  three specs were removed with the screen on 2026-09-20).
- The filter sheet on Opportunities (the quick chips are covered).

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
| Migration Validation | `node scripts/check-migrations.mjs` (static: grants on new tables/views/functions + rollback file, migrations newer than 20260926100000). Then links to staging. On non-main refs: strict `db push --dry-run --include-all`. On `main`: every migration file must already be applied to staging (staging may be ahead) | pushes and same-repo PRs |
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
| E2E timing failures on CI | Shared staging data, cold edge functions | `retries: 2`, `workers: 1` on CI, traces retained on failure; 60s test and 15s assertion timeouts since 2026-11-11 |
| `messaging.player.spec.ts` › "a wheel tick up stays up" fails with offset 0 in a full run (2026-11-11) | Every messaging spec writes to the same E2E Test FC thread as the same player; a message from another worker lands during the 1s wait and the thread follows it to the bottom | One retry on that describe block (passes 8 of 8 alone). A second consecutive failure is a real regression |
| `signup.spec.ts` › "signup form submits" stays on `/signup/email` (seen 2026-11-11) | The spec submitted the same address every run and staging's per-email signup rate limit refused it after a few runs | The rate-limit RPCs are answered locally in that spec |
| `a11y.player.spec.ts` › `/community` reports `aria-prohibited-attr` on `.grid` (seen once, 2026-11-11, machine load 20) | The scan ran while the Community loading skeleton was still up; the skeleton grids carry `aria-label` on a `div` with no role (`CommunitySkeletons.tsx`), a real defect that is only visible while loading | None yet: fix the skeleton markup (product bug, reported 2026-11-11) |
| `onboarding.spec.ts` › `/dashboard/brand` redirect times out at 10s (seen once, 2026-11-11, machine load 20) | Its own 10s `waitForURL` is shorter than a cold route load on a busy machine | None: rerun; passes on a quiet machine |
| Every page blank, 200+ failures | Worktree without the repository-root `.env.local` (see 3a) | Copy the three env files |
| `auth.setup.ts` club or brand sign-in times out | Before 2026-11-11 the setup waited 15s on pre-rebrand selectors, then ran into the 30s limit under load | Waits for the dashboard H1; 90s setup timeout |
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

- No automated check that a security-relevant migration has a probe (the
  rollback-file and grant checks exist since 2026-10-02:
  `scripts/check-migrations.mjs`).
- No load or performance tests (see capacity.md for the proposed plan).
- Accessibility: since 2026-10-23 an axe guard runs in the smoke suite (see
  §8); it blocks only NEW kinds of serious problems, and automated checks
  never replace a screen-reader and keyboard pass.
- No contract test between `client/src/lib/database.types.ts` and
  `supabase/functions/_shared/database.types.ts`.
- Coverage floor of 27 % leaves most component code unmeasured.

## 8. Bug-detection tools (added 2026-10-23, Claude Code)

- **Accessibility guard** (`e2e/a11y.player.spec.ts`, tag `@smoke`):
  `@axe-core/playwright` scans /home, /community, /opportunities, /messages,
  /dashboard/profile and /search on chromium-player and mobile-player for
  serious/critical WCAG 2.1 A/AA problems. Problems known on 2026-10-23 are
  listed per screen in `e2e/a11y-baseline.json`; a new kind fails the PR.
  When you fix one, remove it from the baseline so it can't come back.
- **Knip** (`npm run knip`, config `client/knip.json`): unused files,
  unused or undeclared dependencies, unresolved imports. Blocking in
  "Lint & Type Check" since the 2026-10-23 cleanup (27 dead files and 5
  unused libraries removed). Exceptions in `knip.json`: `src/lib/polyfills.ts`
  (the tested copy of the inline polyfill in index.html, loaded by its test
  with a query string), `google.maps` (types only) and `/src/lib/crestColor.ts`
  (imported inside the browser by `scripts/backfill-crest-colors.mjs`).
  Unused exports are not checked yet (249 on 2026-10-23).
- **Dependabot** (`.github/dependabot.yml`): weekly grouped update PRs into
  staging for the client, monthly for the device lab and GitHub Actions.
  Security alerts and CodeQL are repository settings (Settings → Code
  security), switched on by the founder.

## Device lab (native app)

`tools/devicelab/` drives the real iOS simulator and Android emulator apps with touch gestures through the core journeys, plus desktop web via Playwright. Run it before every store build and after layout/scroll/modal changes. Guide: `device-lab.md` (added 2026-10-16).
