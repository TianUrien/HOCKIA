# Standards

Conventions that are enforced by tooling or visible in the code. Each entry
says where it is enforced. "Convention" means it is followed in recent code
but not machine-checked. Verified on 2026-10-02.

## 1. Toolchain gates (client)

| Gate | Command | Enforced by |
|---|---|---|
| Type check | `cd client && npm run typecheck` (`tsc -b --noEmit`, project references) | CI job "Lint & Type Check" |
| Lint, zero warnings | `cd client && npx eslint . --max-warnings=0` | CI job "Lint & Type Check" |
| Unit tests + coverage | `npm run test:unit:coverage` (thresholds 27 % lines/functions/branches/statements) | CI job "Unit Tests" |
| Build + bundle budgets | `npm run build` then the budget script | CI job "Build" |
| Dependency audit | `node scripts/audit-check.mjs` (high/critical fail; allowlist with review dates; currently empty) | CI job "Security Checks" |
| Secrets scan | gitleaks with `.gitleaks.toml` | CI job "Security Checks" |
| Edge function tests | `cd supabase/functions/_shared && deno test --allow-env --allow-read .` | CI job "Edge Function Tests" |
| Migration dry-run | `supabase db push --linked --dry-run --include-all` against staging | CI job "Migration Validation" |
| Full local pipeline | `cd client && npm run test:all` (lint, typecheck, unit, build, e2e smoke) | Convention before pushing client changes (root `CLAUDE.md`) |

Rules the toolchain encodes:

- **Never substitute `tsc --noEmit` for `npm run typecheck`.** In `client/`
  the root `tsconfig.json` has `files: []` and only references, so a plain
  `tsc --noEmit` checks nothing; the CI form is the correct one.
- ESLint config (`client/eslint.config.js`): `@eslint/js` recommended,
  `typescript-eslint` recommended, `react-hooks` recommended-latest,
  `react-refresh` for Vite, and `no-empty` with empty catch blocks forbidden.
  `e2e/`, `android/`, `ios/`, `dist/` and `src/lib/database.types.ts` are
  ignored.
- Node 20 is the CI version (`NODE_VERSION` in `ci.yml`). There is no
  `.nvmrc` or `engines` field; use Node 20 locally.
- `client/src/lib/database.types.ts` is generated (`npm run gen:types` with
  `SUPABASE_PROJECT_ID`); re-sync `supabase/functions/_shared/database.types.ts`
  after regenerating.

## 2. Bundle budgets

Enforced in `.github/workflows/ci.yml`, job "Build" (verified):

| Metric | Hard limit | Warning | Notes |
|---|---|---|---|
| Initial-load JS (gzip of the chunks `app.html` eagerly loads) | 560 KB | 520 KB | Raised from 480 KB on 2026-10-07 (founder approval) when the Sentry Capacitor SDK joined the eager set. If a change pushes it over, split the code instead; planned recoveries: lazy Sentry replay/tracing, signed-in-only paths out of the eager graph |
| Raw JS across all chunks | 6,600 KB | 6,500 KB | Total-bloat backstop; raised to 6,000, 6,300 and then 6,600 KB on 2026-11-16 with founder approval (Spanish interface stages 1 to 3: translation runtime and catalog keys; measured 5,847, 6,150 and 6,299 KB; history in the workflow comments) |
| Single chunk | - | 512 KB raw | Warning only |
| Growth vs base commit | - | +50 KB raw | Warning only; flags a new heavy dependency or code leaking out of a lazy chunk |

Supporting conventions in `client/vite.config.ts`:

- Route-level code splitting: pages are imported with `lazyWithRetry` in
  `App.tsx`; Club v2 phone screens are all lazy.
- `LAZY_ONLY_DEPS` keeps `posthog-js`, `recharts`, `papaparse`,
  `tus-js-client` and friends out of the eager `vendor` chunk.
- Admin chart chunks are stripped from the HTML modulepreload list.
- Images are never precached by the service worker.
- Catalogs (2026-11-16): Spanish text is JSON fetched on demand, outside both gates. An English catalog travels with whatever imports its `i18n/ns/<ns>` module, so a namespace that start-up code needs is split into `<ns>.core.json` (start-up keys) and `<ns>.json` (the rest); start-up files import `i18n/ns/<ns>.core`. `scripts/check-locales.mjs` fails when a start-up file uses a key outside the core file.

See decisions/ADR-0004.

## 3. Copy and status rules (user-facing)

| Rule | Where it is enforced |
|---|---|
| **Gender-neutral copy**: never his/her/him; use the person's name or "they" | Convention; the only remaining pronouns in `client/src` are two code comments. `client/src/lib/signing.ts` and the D2/D3 commits state it explicitly |
| **Amber only when the viewer must act**: the same status is amber for one viewer and grey for another; trust signals are gold, never amber | `client/src/lib/statusTone.ts` (`noReplyTone`, `invitationPendingTone`, `pendingVerificationTone`) and `client/src/__tests__/amberRule.test.tsx` |
| **One set of words per application status** | `client/src/lib/applicationStatus.ts` (`APPLICATION_STATUS_LABELS`); tests in `applicationStatus.test.ts` |
| **Players never see counts, scores, levels or reply-time estimates** | Header comment and helpers in `client/src/lib/opportunityCopy.ts` |
| **Status labels and copy come from shared helpers**, not inline strings | `lib/applicationStatus.ts`, `lib/opportunityCopy.ts`, `lib/clubInviteCopy.ts`, `lib/clubSquadCopy.ts`, `lib/careerCopy.ts`, `lib/videoCopy.ts`, `lib/invites.ts`, `lib/signing.ts` |
| **Two languages (2026-11-16, Claude Code)**: new or changed member-facing copy goes into `client/src/locales/en` and `es` in the same PR; dates, times, numbers and lists come from `client/src/i18n/format.ts` or `lib/dayFirst.ts`. Admin stays English | ESLint `i18next/no-literal-string` on the files listed in `I18N_MIGRATED` (`client/eslint.config.js`; the list only grows) and `client/scripts/check-locales.mjs` (part of `npm run lint`); how-to in `client/src/locales/README.md` |
| **No middle-dot or bullet separators in member-facing text (2026-11-19, founder decision, Claude Code)**: same-kind facts are joined with a comma ("Player, Argentina"); different kinds (a role, then a time) get no separator character, the second sits in its own element with a gap and the secondary text colour; a title of two phrases uses a full stop or a line break; the dot is never swapped for another glyph; English and Spanish change together. a label and its count read "Squad (24)" or "See all 5", or the count sits in its own element. Applies to every screen, the admin screens included (whole app done 2026-11-19). UI indicators that are elements, not text, are outside the rule and stay: unread dots (inbox, tabs, navigation) and the category colour dot inside chips (founder decision 2026-11-20) | `client/src/__tests__/appNoMiddleDot.test.ts` scans every source file and every locale file (code comments are skipped); per-area tests (`homeNoMiddleDot`, `recruitingNoMiddleDot`, `profileNoMiddleDot`, `communityNoMiddleDot`, `adminNoMiddleDot`) pin each area's helpers |
| **No Save/bookmark surfaces in the player redesign** | Founder ruling (see memory); not machine-checked |
| **Figma "03 Player" / "04 Club" pages are the source of truth for the redesign** | Component headers cite Figma node ids |

## 4. Client-side rule mirrors

When the client needs a server rule to decide what to render, mirror it as a
pure function in `client/src/lib/` with a header that names the SQL function
that owns it (`lib/invites.ts`, `lib/signing.ts`). The server stays the
authority; the mirror must never be the only place the rule exists. Cover the
mirror with a unit test.

## 5. Phone-first Club v2

Club v2 screens are phone-only (`<1024px`) and lazy-loaded; the v1 desktop
club screens remain reachable at `>=1024px`. New club features are built for
the phone surface first (commit history "Club phone: ..." leaves 1-10). Do not
let a phone-only screen into the eager bundle.

## 5a. Photo sizes (2026-10-23, Claude Code; measured in production)

The Community member deck shows photos full screen on phones (about 1179 × 2556 px), so:
- **Display:** full-screen photos use the `immersive` render preset (`lib/imageUrl.ts`: width 1440, height 2500, contain). Never `feed-full` (800 wide), which was stretched 3–5×.
- **Uploads:** profile photos are kept as a 1440 px square (`optimizeAvatarImage`; was 512). Gallery photos keep their shape up to 2048 px (was 1200). The native picker allows 2048 px (was 1024). Resizes use the high-quality smoothing filter, and the size caps (3 MB) are high enough that the quality loop doesn't kick in for normal photos.
- **Existing photos:** profile photos uploaded before this were stored at 512 × 512; the originals were not kept, so they stay soft until the member re-uploads.

## 6. Migration conventions (`supabase/migrations`)

Verified in the 2026-09/10 migrations; older migrations predate some of these.

1. **File name**: `YYYYMMDDHHMMSS_short_description.sql` (older files use a
   12-digit prefix; keep the 14-digit form). The timestamp is the version.
2. **Header comment**: what the migration does, which founder ruling or brief
   it implements, and `Rollback: supabase/rollbacks/<version>.down.sql`.
3. **Rollback file**: every migration since 2026-09-26 ships
   `supabase/rollbacks/<version>_<name>.down.sql` restoring the previous
   function bodies, policies and grants. 598 older migrations have no rollback
   file; forward-fix is the path for those. **Enforced** by
   `scripts/check-migrations.mjs` (CI job "Migration Validation"): a
   combined rollback may cover several versions by listing them in its text;
   eight 2026-09-26/28 migrations are baseline-exempt inside the script.
4. **Probe**: a security-relevant migration ships a
   `supabase/tests/security/<name>.probe.sql` that switches identities with
   `SET LOCAL ROLE` + `request.jwt.claims`, asserts PASS/FAIL lines, and
   **rolls itself back** with a final `RAISE`. Probes run on staging only.
5. **Explicit grants on every new object**: `REVOKE ALL ... FROM PUBLIC` then
   grant only what each role needs. Supabase stops providing default ACLs for
   new objects on 2026-10-30, and the default-privileges migration
   (`20260528110000_explicit_data_api_grants.sql`) only covers tables created
   by the `postgres` role. Treat the explicit form as mandatory for tables,
   views, sequences and functions. **Enforced** for tables, views and
   functions by `scripts/check-migrations.mjs`: the first migration to create
   a name must also contain a `GRANT` or `REVOKE` naming it (a later
   `CREATE OR REPLACE` keeps the ACL and is not flagged). Run it locally with
   `node scripts/check-migrations.mjs` (or with file paths to lint only those).
6. **`profiles` columns**: every `ALTER TABLE public.profiles ADD COLUMN`
   ships `GRANT SELECT (col) ON public.profiles TO authenticated` (and `anon`
   if public). See security.md.
7. **Functions**: `SECURITY DEFINER` only when needed, always with
   `SET search_path = public` (or `TO 'public'`), the actor check first
   (`auth.uid()`, `is_platform_admin()`), and the hidden-profile predicate on
   anything that returns people.
8. **Views**: `security_invoker = true` unless there is a documented reason.
9. **Service-role-only tables** (queues, scheduler state): `REVOKE ALL ON
   TABLE ... FROM anon, authenticated`.
10. **Test fencing**: anything that counts or notifies people excludes
    `is_test_account` rows (234 migration files reference it).
11. **No seed data in migrations**; E2E fixtures live in `client/e2e/*.sql`.
12. **Applied only with the CLI**: `supabase db push --linked` after a
    `--dry-run`; never through a dashboard SQL editor or an MCP tool. See
    decisions/ADR-0001.
13. **Rewrite a function from its latest body** (added 2026-11-18, source:
    the `create_user_post` regression). Before a `CREATE OR REPLACE`, find the
    newest migration that defines the function
    (`grep -ln "FUNCTION public.<name>" supabase/migrations/* | tail -1`) and
    start from that text. Twice a rewrite from an older copy dropped this
    function's rate limit (2026-04-11 and 2026-09-20).

## 7. Edge function conventions (`supabase/functions`)

- One directory per function with `index.ts`; shared code only in `_shared/`.
- Import the service client from `_shared/supabase-client.ts`; never create a
  second client with a hard-coded key.
- CORS: `getCorsHeaders(origin)` for user-facing functions; the open
  `corsHeaders` only for public APIs and webhook handlers (`_shared/cors.ts`).
- Webhook-invoked functions call `assertServiceRole(req)` before any work;
  `_shared/webhook-auth.test.ts` reads the function sources and fails if one
  stops doing so.
- Errors go through `captureException` from `_shared/sentry.ts`.
- Any function that returns people or their content applies
  `profile_is_hidden` / `profile_is_uncontactable` itself.
- `verify_jwt` is pinned per function in `supabase/config.toml`
  (`[functions.<name>]`). Deploy with `--no-verify-jwt` when the function
  verifies auth in-handler. See operations.md for the drift trap.
- Tests sit next to the module (`*.test.ts`) and run with `deno test`.

## 8. Repository hygiene (public repository)

- Commit messages and PR text are **neutral**: describe the change, never a
  vulnerability, a user, an email, an id or a credential.
- No secrets, keys or user data anywhere in the tree; gitleaks runs on every
  push and pull request (`.gitleaks.toml` allowlists only the CI placeholder
  key and generated type files).
- CI artifacts are retained for 3 days (`retention-days: 3`).
- No new paid services without a founder decision.
- Branch flow: feature branch or direct commit to `staging`, PR
  `staging -> main` opened and merged by the founder after verification.
- Commits end with the co-author trailer used in this repository.

## 9. Documentation drift to fix

These files contradict the standards above and should be updated or retired:
`supabase_setup/` (pre-migration bootstrap), `client/README.md` (the stack
line is current since 2026-10-02; the rest describes the original template).
`RELEASE_CHECKLIST.md` and `client/e2e/README.md` were brought in line on
2026-10-02 (pointer, and counts delegated to testing.md).
