# Operations

Environments, release runbook, rollback paths, backups, monitoring and known
traps. Verified on 2026-10-02 from `scripts/`, `RELEASE_CHECKLIST.md`,
`docs/ENVIRONMENT_SETUP.md`, `supabase/config.toml`, `ops/uptime-worker/` and
the workflows; practice notes come from the project memory and are marked.

## 1. Environments

| | Production | Staging |
|---|---|---|
| Supabase project ref | `xtertgftujnebubxgqit` | `ivjkdaylalhsteyyclvl` |
| Git branch | `main` | `staging` |
| Web | inhockia.com (Vercel Production, auto-deploy on merge) | staging.inhockia.com / Vercel Preview (auto-deploy on push) |
| Who writes to it | real users, native apps, cron, webhooks | CI (DB tests, E2E smoke), QA, probes |
| Resend | own key + webhook | disabled today (own key + webhook planned) |
| Cloudflare Stream | own account | should be separate; verify `CF_*` secrets differ |

The CLI link is global state: `cat supabase/.temp/project-ref` tells you which
project `db push` and `functions deploy` will hit. Always check before a push.

Local development: `supabase start` (Docker) or point `client/.env.local` at
staging (`docs/ENVIRONMENT_SETUP.md`). Never point local tooling at
production for E2E or writes.

## 2. Release runbook (as practised)

This section is the release runbook. It reconciles the former
`RELEASE_CHECKLIST.md` (2026-02, folded in here on 2026-10-02 and now a
pointer), `docs/ENVIRONMENT_SETUP.md`, and
`scripts/promote-to-production.sh` with the sequence actually followed in
2026-09/10 (project memory).

### 2.1 Before merging

1. Branch parity: `git log --oneline origin/main..origin/staging` shows only
   the intended commits; `origin/staging..origin/main` is empty.
2. CI green on the PR `staging -> main`: Security, Lint & Type Check, Edge
   Function Tests, Unit Tests, Build, Migration Validation, DB Integration
   Tests, E2E Tests, plus the Vercel preview check.
3. Staging verified by the founder (visual approval on the preview for UI
   work; QA agent loop; `[QA]` fixtures kept).
4. If an edge function changed: it is already deployed to staging and
   exercised there.
5. No competing PR into `main` (`gh pr list --state open --base main`), or
   coordinate the order.
6. Review greps over the release's new migration files (each hit must be
   intentional):
   - seed or fixture data: `grep -ril 'INSERT INTO.*test\|is_test_account.*true\|seed' <files>`
   - destructive statements: `grep -Ein 'DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM' <files>`
   - policy changes: `grep -l 'security_invoker\|SECURITY DEFINER\|CREATE POLICY\|DROP POLICY' <files>`
     (views must use `security_invoker = true`)
   - staging identifiers in app code: `grep -r 'ivjkdaylalhsteyyclvl' client/src/` must be empty.
7. Environment parity (once per quarter or when something changed): Vercel
   production env vars present (security.md section 6), Supabase Auth
   redirect URLs include `https://www.inhockia.com/**`, and the CSP in
   `client/vercel.json` allows both Supabase projects.

### 2.2 Database

1. **Backup**: confirm the latest Supabase daily backup in the dashboard. For
   a destructive migration, take a manual dump as well (requires Docker for
   `supabase db dump`).
2. **Dry run**: `supabase link --project-ref xtertgftujnebubxgqit` then
   `supabase db push --linked --dry-run --include-all`; the list must contain
   only the expected versions. If the history has drifted, reconcile with
   `supabase migration repair` first (never by editing files already applied).
3. **Push**: `supabase db push --linked --include-all`.
4. **Probes**: run the migration's `supabase/tests/security/*.probe.sql`
   on production through a SQL session; each probe prints PASS/FAIL lines and
   rolls itself back. Fix forward or roll back on any FAIL.
5. **Re-link to staging** so the next habitual command does not hit
   production.

Rules: migrations are applied **only** with `supabase db push --linked`; not
with a dashboard editor and not with an MCP `apply_migration` tool
(decisions/ADR-0001). Bulk `UPDATE` on `profiles` must disable the
`set_profiles_updated_at` trigger first.

### 2.3 Edge functions

Deploy only the functions whose source changed, with the correct gateway
flag:

```sh
supabase functions deploy <name> --project-ref xtertgftujnebubxgqit [--no-verify-jwt]
```

`--no-verify-jwt` is required for functions that verify auth in-handler or
receive third-party calls. **The single source of truth is
`[functions.<name>] verify_jwt` in `supabase/config.toml`** (consolidated
2026-10-02): every function folder has an entry, the per-function
`supabase/functions/<name>/config.toml` files are gone, the deploy scripts
read the root file and refuse an unpinned function, and
`_shared/function-config.test.ts` fails CI when a folder has no entry. The
CLI also reads the root entry on `functions deploy`; passing the flag as well
is harmless and keeps the intent visible in shell history.

Off (`--no-verify-jwt`, 10): `health`, `sitemap`, `nl-search`,
`resend-webhook`, `video-create-upload`, `video-webhook`,
`video-playback-token`, `application-action`, `age-gate`, `video-delete`.
On (29): everything else, including `delete-account`, `admin-actions`,
`admin-send-campaign`, `admin-send-test-email`, `ga4-funnel`,
`public-opportunities` and `notify-feedback-submitted` (whose removed
per-function files wrongly said `false`).

**Rule**: `supabase/config.toml` must always mirror what is live on
production (verified with the platform's function listing). When they
differ, live is changed to match the file, and only after an explicit
founder OK; never edit the file to paper over a drift you have not
understood.

**Trap**: before the consolidation a plain `supabase functions deploy`
reset an unpinned function to the platform default, which 401'd legitimate
traffic twice (nl-search, resend-webhook). After deploying, confirm the
setting in the dashboard (Edge Functions -> function -> Details) and with a
request from the app.

#### 2.3.1 Follow-up to the 2026-10-02 consolidation

The file was written from the live production values, so **no production
redeploy** results from this change. The only action is a one-off
**staging-only** redeploy to fix the single drift found (`admin-actions` was
`false` on staging, `true` on production):

```sh
supabase functions deploy admin-actions --project-ref ivjkdaylalhsteyyclvl --use-api
```

No flag, so the gateway check comes on. Afterwards confirm with the
function listing that staging `admin-actions` shows `verify_jwt = true` and
that an admin action still works on the staging preview. Delete this
subsection once done.

Shared code lives in `_shared/`; deploying one function bundles the shared
modules it imports, so a `_shared` change needs every dependent function
redeployed.

### 2.4 Web and native

1. Merge the PR `staging -> main` (founder does this). Vercel builds and
   promotes production automatically.
2. Smoke on production: landing, sign-in as a test role, feed, opportunities,
   a message, a profile with media. `curl -sI https://www.inhockia.com`
   returns 200; `/functions/v1/health` returns `healthy`. The full manual
   flow, run on the staging preview before the merge and repeated in part
   after it: landing loads without console errors; signup form validates;
   player and club sign-in reach their dashboards; club posts a role (draft
   then publish) and it appears in the feed; player applies with a note;
   club sets and clears applicant tiers; a profile with highlights and
   references renders; a message between two accounts arrives in real time;
   the same at a 375 px viewport without overflow.
3. Watch Supabase logs and Sentry for 15-30 minutes.
4. Native: the SPA inside the store binaries does not change until a new build
   ships. Before any breaking server change, raise
   `app_version_requirements.min_version` and wait for adoption. Native
   builds use `npm run cap:build` (asserts a production bundle, copies
   `app.html` to `index.html`, syncs iOS and Android); versions live in the
   Xcode project (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`) and
   `android/app/build.gradle`. The full native procedure (versions, crash
   reporting, symbols, device checks, Sentry verification) is in
   [native-release.md](native-release.md).

### 2.5 After the release

- Tag (`git tag -a v<YYYY.MM.DD> -m "Release: <summary>"`, push the tag,
  publish a GitHub Release with the summary) and sync branches so
  `origin/main..origin/staging` is empty.
- Record rollback notes for any irreversible migration.
- Update the docs changed by the release (this directory included).

## 3. Rollback paths

| Component | Path | Time |
|---|---|---|
| Web | Vercel dashboard -> Deployments -> Instant Rollback (or `vercel rollback --prod`) | under a minute |
| Edge function | Redeploy the previous source: `git checkout <sha> -- supabase/functions/<name>` then deploy with the right flag; or redeploy a previous version from the dashboard | minutes |
| Migration since 2026-09-26 | Apply `supabase/rollbacks/<version>.down.sql` as a **new forward migration** (copy it into `supabase/migrations/` with a new timestamp, dry-run, push) so the migration history stays linear | 5-10 minutes |
| Older migration | Write a reverse migration by hand (forward fix) | varies |
| Data damage | Supabase point-in-time recovery, or the 2026-08-28 pattern: "Restore to new project" into a temporary copy, read the good values, write them back with the trigger disabled, delete the copy | 30-90 minutes |
| Feature flags | `video_posts_enabled`, `VITE_ENABLE_AI_OPINION`, `LLM_PROVIDER` (unset to return to the default provider) | immediate |
| Native | No rollback; ship a new build or raise `min_version` to force an update | days |

## 4. Backups

- Supabase daily physical backups on both projects (**assumption**: retention
  per plan; verify in the dashboard).
- Point-in-time recovery availability depends on the plan (**to verify**).
- A logical dump via `supabase db dump` needs Docker locally; it is optional
  before destructive migrations.
- Storage objects are not covered by database backups; the
  `storage-cleanup` queue deletes orphaned objects after a 7-day grace
  measured from first sighting.

## 5. Monitoring

| Signal | Where | Notes |
|---|---|---|
| Production health, every 5 min | Cloudflare Worker `hockia-uptime-monitor` (`ops/uptime-worker`) | `GET /functions/v1/health`, then warms `nl-search`, `notify-vacancy`, `notify-application`, `send-push`, `delete-account`, `public-opportunities` with CORS preflights. Email on failure and on recovery via Resend; state in KV; no public URL |
| Key pages and public APIs, every 6 h | same worker | home, `/opportunities`, `public-opportunities`, `sitemap` |
| Browser smoke on production | `.github/workflows/synthetic.yml` (manual) | Playwright `@smoke`, opens a GitHub issue on failure |
| Client errors, traces, replays | Sentry (`@sentry/react`), release tagged with the Vercel SHA or the native version; traces 30 % in production | `isNetworkFailureMessage` and auth-lifecycle filters keep noise down |
| Edge function errors | Sentry via `_shared/sentry.ts` | fire-and-forget envelope |
| Database and function logs | Supabase dashboard logs (also via the Supabase MCP) | first stop after a deploy |
| Product funnels | PostHog (consent-gated), GA4, first-party `events` table, founder dashboard at `/admin` | |
| AI spend | Founder alert threshold USD 50 (ruling) | **assumption**: alert configured at the provider; verify |
| Client-side error budget | `lib/errorBudget.ts` (1 % budget, warning at 70 %) | in-app signal only |

Alert recipients are configured in the worker's `ALERT_TO` secret.

## 6. Scheduled work

`pg_cron` jobs (names): `application_expiry_daily`,
`application_status_emails`, `archive_messages_daily`,
`expire_stale_open_to_play_cards`, `prune_profile_notifications_daily`,
`publisher_responsiveness_daily`, `recruiting_expiry_daily`,
`storage_cleanup_enqueue`, `storage_cleanup_process`. Email digests and
reminders are dispatched through database webhooks to the `notify-*`
functions. A cron that invokes an HTTP function must use a cooldown shorter
than its cadence or it will skip runs (2026-07 recap fix).

## 7. Known traps

- **Wrong project linked**: check `supabase/.temp/project-ref` before every
  `db push` or `functions deploy`.
- **verify_jwt drift**: see 2.3.
- **Native clients pin old bundles**: gate breaking server changes on
  `min_version`.
- **`profiles` column grants**: a new column without a column grant breaks
  every `select('*')` on profiles.
- **Hidden-profile predicate**: not inherited by DEFINER functions or
  service-role reads.
- **`updated_at` trigger on bulk writes**: disable it first.
- **Migration history drift**: `migration repair` before `db push`.
- **Deleted storage objects** can keep serving from CDN cache for a long
  time; swap the DB reference before deleting the old object.
- **Cloudflare delivery host**: signed Stream URLs must use the customer
  subdomain, never `videodelivery.net` (ISP blocking; ADR-0005).
- **Stream signing secrets**: a trailing newline in the JWK secret makes
  signing fail with 401; probe before enabling.
- **CORS for native**: `curl` bypasses CORS, so it cannot reproduce a WebView
  origin problem; test from the app.
- **GitHub Actions minutes**: the repository is public to stay within the
  free Actions allowance; scheduled monitoring runs on Cloudflare for the same
  reason.
- **Supabase CLI version**: CI pins 2.67.1; keep local in step when migration
  behaviour matters.

## 8. Access and accounts (names only)

Supabase (two projects), Vercel team, Cloudflare account (Stream + Workers),
Resend, Sentry, Google Cloud (Maps/Places, GA4), PostHog, Apple App Store
Connect, Google Play Console, GitHub. Credentials are held by the founder;
agent tooling uses the connectors and the local secret files listed in
security.md section 6.
