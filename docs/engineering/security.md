# Security

This document describes trust boundaries, controls and policies. It
deliberately contains no exploitable detail, no credentials, no user data and
no identifiers of real users. The repository is public. Verified on
2026-10-02 unless marked **assumption**.

## 1. Trust boundaries

```
untrusted            |  semi-trusted            |  trusted
---------------------+--------------------------+-----------------------------
browser / WebView    |  PostgREST with user JWT |  SECURITY DEFINER functions
anon key (public)    |  RLS policies            |  service-role client in edge fns
third-party webhooks |  gateway verify_jwt      |  pg_cron, database webhooks
logged-out email     |  in-handler getUser      |  Supabase platform (auth, storage)
links                |  signature checks        |
```

Principles the code follows:

1. **RLS is the gate on every public table**; grants are the outer fence.
2. **Rules that decide who may do what live in SQL functions**, not in the
   client. Direct client writes to rule-bearing tables are blocked or
   constrained by guard triggers that act only when `current_user =
   'authenticated'`, so server paths are untouched.
3. **The anon key and `verify_jwt = true` are not authorization.** Anything a
   browser could call must authenticate the actor itself.
4. **Service-role code bypasses RLS**, so every service-role or
   SECURITY DEFINER read that returns people must apply the hidden-profile
   predicate itself.
5. **Test accounts are fenced** from real users for counts, notifications and
   emails.

## 2. Authentication

- Supabase Auth with email/password, Google OAuth and magic links. The client
  uses the implicit flow with a project-specific storage key
  (`client/src/lib/supabase.ts`).
- Admin access is a JWT `app_metadata` claim checked server-side by
  `is_platform_admin()`; the client only hides UI (`features/admin/README.md`).
- Native apps are first-party clients identified by their WebView origin
  (`https://app.inhockia.com`), which is on the CORS allowlist; CORS is not an
  auth boundary (`_shared/cors.ts`).
- Login, signup and several public endpoints are rate-limited through the
  database-backed `check_rate_limit` RPC; callers fail closed when the RPC
  errors (`client/src/lib/rateLimit.ts`, `public-opportunities`, `age-gate`,
  `application-action`, `nl-search`).

## 3. Authorization in the database

### 3.1 RLS and grants

- 100+ migration files create or replace policies; new tables get RLS and
  policies in the same migration as the table.
- Views use `security_invoker = true` (15 files) so RLS applies through them.
- Explicit grants on every new object (`REVOKE ALL FROM PUBLIC`, then per-role
  grants). From 2026-10-30 Supabase stops providing default ACLs for new
  objects, which makes this mandatory (see standards.md and the open
  workstream below).
- Service-role-only tables (queues, scheduler state) revoke all access from
  `anon` and `authenticated`.

### 3.2 Column-level grants on `profiles`

`date_of_birth` is owner/admin/server-only. Both `anon` and `authenticated`
hold **column-level** SELECT grants on `public.profiles`
(`20260707180000_age_gate_dob_revoke.sql`). Consequences:

- Every new `profiles` column must ship an explicit column `GRANT SELECT` or
  every `select('*')` on profiles breaks app-wide (PostgREST expands `*`
  literally).
- Owners read their own row through the `profiles_self` view; visitors get a
  server-computed age via `get_profile_ages`. Never re-grant DOB.
- A column `REVOKE` is a silent no-op against a table-level grant; audit with
  `information_schema.column_privileges`.

### 3.3 SECURITY DEFINER functions

- 404 migration files define SECURITY DEFINER functions; 455 pin
  `search_path`. New functions must pin it.
- Pattern: actor check first (`auth.uid()`, `is_platform_admin()`, ownership),
  rule enforcement, write, history row, return.
- Functions that must not be callable by clients revoke EXECUTE from `anon`
  and `authenticated` and grant it to `service_role` only (example:
  `is_minor`).

### 3.4 Hidden, blocked and frozen profiles

`profile_is_hidden(is_blocked, frozen_minor_at)` is true for admin-banned
accounts and frozen minors; `profile_is_uncontactable(...)` additionally
covers person accounts whose DOB-confirmation grace lapsed (organizations are
never uncontactable through that branch). Base RLS applies the predicate only
to direct table reads. **Every RPC, view, edge function or service-role read
that returns or counts people must apply it explicitly** (46 migration files
do). A 2026-07 audit found eight surfaces that leaked by omission; the
invariant is restated in the root `CLAUDE.md`.

### 3.5 Age gate and 18+ rules

- DOB is captured once and immutable; minors are blocked at signup and
  existing accounts without a known DOB get a grace period before becoming
  uncontactable.
- Club-facing recruiting surfaces are 18+: invites require a known adult DOB
  (`send_invite`), club name search and suggestions are adults-only, youth
  roles are rejected. Minors are never exposed to recruiting.
- `age-gate` is the only anon-facing function for this flow and is IP
  rate-limited, fail-closed.

### 3.6 Recruiting pipeline guards

- Clients only read `opportunity_invites`, `opportunity_offers` and the
  recruiting columns on `opportunity_applications`; status changes go through
  the SECURITY DEFINER functions (see architecture.md section 5).
- Guard triggers keep direct client writes inside the review states, keep
  conversation participants immutable, keep references from being flipped
  back to accepted, and prevent spoofed cards in messages and posts
  (`20260926100000_phase1_close_client_write_holes.sql`).
- Withdrawn applications are readable by the publisher but immutable.
- Offer terms are visible only to that club and that player.
- Spam limits on new conversations and invites are founder-specified and
  enforced server-side (daily caps, stricter in the first week).

### 3.7 Test-account fencing

`profiles.is_test_account` is referenced by 234 migration files, 22 client
files and 29 edge-function files. Test content is routed to `notify-test-*`
functions that send only to env-configured recipients; analytics and
founder metrics exclude test rows.

## 4. Edge functions

| Concern | Control |
|---|---|
| Caller identity (user-facing) | `auth.getUser` on the bearer token in-handler, then role/ownership checks; 13 functions |
| Caller identity (database webhooks and cron) | `assertServiceRole(req)` requires a service-role JWT; 16 functions; `_shared/webhook-auth.test.ts` fails CI if one stops calling it |
| Third-party webhooks | Signature verification: Svix for Resend, HMAC for Cloudflare Stream |
| Logged-out links | Hashed single-use, expiring capability tokens (`_shared/action-tokens.ts`) |
| Gateway `verify_jwt` | Pinned per function in `supabase/config.toml` so deploys cannot flip it; functions that verify in-handler or receive third-party calls run with it off |
| CORS | Allowlist of app origins, Vercel previews and the native origin; open CORS only for public APIs and webhook handlers |
| Rate limiting | `check_rate_limit` RPC; fail-closed |
| Secrets | Read from `Deno.env`; never logged |
| Errors | Sentry envelope reporter; no PII in messages by convention |

Known gap: `notify-test-vacancy` and `notify-test-application` rely on the
gateway only; their blast radius is the configured test recipients.

## 5. Client-side controls

- Vercel headers (`client/vercel.json`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  a restrictive `Permissions-Policy` and a Content-Security-Policy that
  enumerates Supabase, Sentry, PostHog, Google, Cloudflare Stream and video
  embed hosts; `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`.
- Only `VITE_`-prefixed env vars are inlined into the bundle
  (`envPrefix` in `vite.config.ts`); a production build inlines the production
  URL and anon key so store binaries never carry staging values.
- The service worker never caches `/rest/v1/` responses (user-scoped data on
  shared devices).
- Analytics are consent-gated, off on native and off for automated browsers;
  autocapture is disabled to avoid collecting names and message text.
- Open-redirect protection for auth returns (`lib/safeRedirect.ts`).
- Report and block flows exist for user-generated content
  (`components/ReportUserModal.tsx`, `components/safety/`).

## 6. Secrets: where they live (names only)

| Location | Secret names |
|---|---|
| Supabase function secrets (per project) | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, `CF_STREAM_WEBHOOK_SECRET`, `CF_STREAM_KEY_ID`, `CF_STREAM_JWK`, `SENTRY_DSN`, `LLM_PROVIDER`, `CLAUDE_MODEL` and the provider API keys, `TEST_NOTIFICATION_RECIPIENTS`, `BLOCKED_NOTIFICATION_RECIPIENTS`; platform-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` |
| Postgres Vault (production) | Secrets used by `run_storage_cleanup()` to call the cleanup function over `pg_net` |
| GitHub Actions secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `PROD_SUPABASE_ANON_KEY` (manual uptime workflow only), `E2E_*_EMAIL`, `E2E_*_PASSWORD` |
| Vercel environment | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENVIRONMENT`, `VITE_SENTRY_DSN`, `VITE_GA_MEASUREMENT_ID`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| Cloudflare Worker secrets | `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `ALERT_TO` |
| Local only (gitignored) | `client/.env.local`, root `.env.local`, `~/.config/hockia/cloudflare.env` |

The service-role key must never appear in the client, in CI logs, in the
repository or in trigger definitions that are dumped into migrations.

## 7. Repository and supply chain

- gitleaks runs on every push and PR over full history; the allowlist covers
  only the CI placeholder key and generated types.
- `scripts/audit-check.mjs` fails CI on any high or critical advisory in
  production dependencies unless it is allowlisted with a justification and a
  review-by date; expired or stale entries fail loudly. The allowlist is
  empty.
- CI artifacts expire after 3 days; Playwright reports and build output are
  the only artifacts.
- Commit and PR text is neutral; no vulnerability detail, no user data.
- 2026-09-26 scan: the production service key was found nowhere outside live
  trigger definitions (repo, history, CI artifacts, disk).

## 8. Operational security

- Migrations are applied only via the Supabase CLI after a dry run; prod
  probes are rolled back SQL run by hand (see operations.md).
- Bulk updates on `profiles` must disable the `updated_at` trigger first
  (2026-08-28 incident).
- Breaking API changes (grant revokes, removed columns or RPCs) are gated on
  the oldest native client in the field (`app_version_requirements`).
- Staging and production have separate Supabase projects, separate Resend
  keys and webhooks (production only today), and should have separate
  Cloudflare Stream accounts (**assumption**: the per-account signing host fix
  in September implies staging now has its own; verify the three `CF_*`
  secrets differ between projects).

## 9. Open hardening workstreams

Named only; scope, findings and sequencing are tracked outside the public
repository (founder plan doc + session memory).

1. **Advisor hardening batch** - periodic review of function grants and
   `search_path` pinning against the Supabase advisor output.
2. **Service key off triggers** - move webhook authorization in trigger
   definitions away from embedding the service key.
3. **Oct 30 GRANT template + CI lint** - the CI lint exists since
   2026-10-02 (`scripts/check-migrations.mjs`, tables/views/functions);
   still open: a migration template, and sequences/types in the lint.
4. **Edge-function auth consistency** - one shared service-role assertion on
   every webhook-style function, covered by the source-reading regression test.
5. **`verify_jwt` consolidation** - done 2026-10-02: one source of truth in
   `supabase/config.toml` mirroring live production, guarded by
   `_shared/function-config.test.ts`; the one staging drift fix is listed
   in operations.md 2.3.1.
6. **Staging mail isolation** - staging gets its own transactional-mail key
   and webhook.

## 10. Incident history (what to learn from)

| Date | What happened | Control added |
|---|---|---|
| 2026-07-07 | A grant revoke broke every native client's profile fetch | Gate breaking API changes on `app_version_requirements.min_version` |
| 2026-07 | Eight DEFINER/service-role surfaces leaked hidden profiles | Hidden-predicate invariant on every people-returning surface |
| 2026-08-08 | Webhook functions were callable with the public anon key | `assertServiceRole` + source-reading regression test |
| 2026-08-27 | Analytics events readable by members; a DEFINER view made `profiles_self` writable | Policies fixed; advisor hardening batch |
| 2026-08-28 | Batch update re-stamped `updated_at` on 301 production profiles | Disable trigger for bulk writes; restore recipe |
| 2026-09-25 | Five client write paths exploitable | Guard triggers on direct client writes |
