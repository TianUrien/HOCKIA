# Architecture

Status: verified against the repository on 2026-10-02 (branch `staging`,
612 migrations, 39 edge functions). Items marked **assumption** were not
verified against a live environment.

## 1. System at a glance

```
            Web (Vercel)                     Native (Capacitor 8)
   inhockia.com / staging.inhockia.com      iOS 1.3.16 (27) / Android 1.17 (19)
            |                                        |
            +----------- same React SPA bundle -------+
                                 |
          PostgREST (RLS)   |   RPC (SQL functions)   |   Realtime   |   Storage
                                 |
                      Supabase Postgres 17 (one project per environment)
                                 |
            pg_cron + pg_net  -->  Edge functions (Deno)  <--  database webhooks
                                 |
       Cloudflare Stream (video)   Resend (email)   Sentry   PostHog / GA4   LLM providers
```

- **Client**: one React 19 + Vite (rolldown-vite 7.1) + Tailwind 3.4 single-page
  app in `client/`. The same build is served by Vercel and bundled into the
  iOS and Android binaries by Capacitor. (`client/package.json`,
  `client/capacitor.config.ts`)
- **Backend**: Supabase. Postgres is the system of record and the rule
  engine. Two projects: production `xtertgftujnebubxgqit`, staging
  `ivjkdaylalhsteyyclvl` (`docs/ENVIRONMENT_SETUP.md`, `scripts/*.sh`).
- **Edge functions**: 39 Deno functions in `supabase/functions/`, sharing
  `_shared/` (CORS, service client, webhook auth, email templates, LLM client,
  Stream signing, Sentry envelope reporter).
- **Hosting and delivery**: Vercel (web), Cloudflare Stream (player video),
  Resend (transactional email), Sentry (errors, traces), PostHog + GA4
  (consent-gated product analytics).
- **Monitoring**: a Cloudflare Worker cron (`ops/uptime-worker`) replaces the
  GitHub Actions uptime job; see operations.md.

## 2. Responsibilities by layer

### 2.1 Client (`client/src`)

| Area | Size (files) | Role |
|---|---|---|
| `pages/` | 56 | Route-level screens; 75 of them are code-split with `lazyWithRetry` in `App.tsx` (125 `<Route>` elements) |
| `components/` | 370 | UI, grouped by domain (`club/`, `community/`, `home/`, `inbox/`, `opportunities/`, `profile/`, `recruiting/`, `safety/`, `search/`, `settings/`, `ui/`) |
| `features/` | 128 | Two feature modules with their own api/hooks/pages: `admin` (founder portal) and `chat-v2` |
| `hooks/` | 122 | Data hooks on React Query; one hook per domain query (`useHomeFeed`, `useChat`, `useInvites`, `useSigning`, ...) |
| `lib/` | 164 | Supabase client, Zustand stores, query-key factory, copy/label helpers, pure rule mirrors |
| `__tests__/` | 234 | Vitest unit tests (plus `__tests__/db/` integration tests) |

Verified patterns:

- **Data access is direct to PostgREST** for reads and simple writes
  (590 `.from(` call sites), **RPC for anything with rules** (215 `.rpc(` call
  sites to 134 distinct SQL functions), and **edge functions only for things
  Postgres cannot do** (16 `functions.invoke` sites to 8 functions: `nl-search`,
  `ai-opinion`, `application-feedback`, `role-description-draft`,
  `notify-feedback-submitted`, `video-create-upload`, `video-delete`,
  `video-playback-token`).
- **Server state** lives in React Query (`lib/queryClient.ts`: staleTime 30 s,
  gcTime 5 min, no refetch on focus, 2 retries). Every key comes from
  `lib/queryKeys.ts` (`qk`), the single vocabulary for invalidation.
- **Global client state** is Zustand (`lib/auth.ts`, `lib/toast.ts`,
  `lib/unread.ts`, `lib/notifications.ts`, `lib/uploadManager.ts`, plus a few
  hook-level stores). `lib/requestCache.ts` is legacy and still imported by 4
  files (see the audit report).
- **Realtime** is used in exactly four places: `hooks/useChat.ts`,
  `lib/notifications.ts`, `lib/unread.ts`, `pages/MessagesPage.tsx`.
- **Auth** uses Supabase Auth with the implicit flow and a custom storage key
  (`lib/supabase.ts`); Google OAuth and magic links are supported
  (`lib/oauthSignIn.ts`, `lib/magicLink.ts`, `lib/nativeOAuth.ts`).
- **Native wrappers** add push notifications, camera, haptics, splash, status
  bar, badge, in-app browser, deep-link routing
  (`components/NativeDeepLinkRouter.tsx`) and an update prompt driven by the
  `app_version_requirements` table (`hooks/useAppUpdateCheck.ts`). The WebView
  origin is `https://app.inhockia.com` on both platforms so API-key referrer
  rules and CORS treat the app as a first-party client.
- **PWA**: `vite-plugin-pwa` with `autoUpdate`; `/app.html` is the SPA shell
  and `/index.html` the prerendered landing (`scripts/prerender-landing.mjs`).
  No runtime caching of `/rest/v1/` by design (user-scoped responses).

### 2.2 Database (`supabase/migrations`)

- 612 migrations from 2025-11-13 to 2026-10-02, defining 94 distinct tables
  (`CREATE TABLE` count), 100+ RLS policy files, 15 `security_invoker` views,
  9 `pg_cron` jobs and 9 storage buckets (`avatars`, `gallery`, `journey`,
  `player-media`, `club-media`, `user-posts`, `brand-posts`, `brand-products`,
  `world-club-logos`).
- Business rules live in SQL: 404 migration files define `SECURITY DEFINER`
  functions and 455 pin `search_path`. Clients call them via RPC.
- Scheduled jobs (names from `cron.schedule`): `application_expiry_daily`,
  `application_status_emails`, `archive_messages_daily`,
  `expire_stale_open_to_play_cards`, `prune_profile_notifications_daily`,
  `publisher_responsiveness_daily`, `recruiting_expiry_daily`,
  `storage_cleanup_enqueue`, `storage_cleanup_process`.
- `supabase_setup/` is an older consolidated bootstrap (001-008). It is not
  the source of truth; `supabase/migrations/` is.

### 2.3 Edge functions (`supabase/functions`)

Grouped by how they are invoked and authenticated (verified from the handlers
and `supabase/config.toml`):

| Group | Functions | Auth model |
|---|---|---|
| User-facing APIs | `nl-search`, `ai-opinion`, `role-description-draft`, `application-feedback`, `notify-feedback-submitted`, `delete-account`, `admin-actions`, `admin-send-campaign`, `admin-send-test-email`, `video-create-upload`, `video-delete`, `video-playback-token`, `ga4-funnel` | Verify the user JWT in-handler (`auth.getUser`), then act with the service client; admin functions also check the admin claim |
| Database webhooks | `notify-vacancy`, `notify-application`, `notify-application-status`, `notify-application-digest`, `notify-application-expiry`, `notify-friend-request`, `notify-message-digest`, `notify-onboarding-reminder`, `notify-opportunity-renewal`, `notify-profile-views`, `notify-reference-request`, `notify-reference-response`, `notify-reference-reminder`, `notify-age-gate`, `send-push`, `admin-market-digest`, `storage-cleanup` | `assertServiceRole` (`_shared/webhook-auth.ts`): the caller must present a service-role JWT, which only Supabase-side webhooks and cron hold |
| Third-party webhooks | `resend-webhook`, `video-webhook` | Signature verification (Svix, HMAC) with `verify_jwt = false` |
| Logged-out capability links | `application-action`, `age-gate` | Hashed single-use tokens or email-keyed waitlist; IP rate-limited, fail-closed |
| Public read | `public-opportunities`, `sitemap`, `health` | Anonymous; `public-opportunities` is rate-limited via `check_rate_limit` |
| Test-mode notifiers | `notify-test-vacancy`, `notify-test-application` | Gateway JWT only; send only to env-configured recipients for test-account content |

All functions except `ga4-funnel` use the lazy service-role singleton in
`_shared/supabase-client.ts`, so **RLS does not apply inside edge functions**;
each handler must apply the hidden-profile predicate itself (see security.md).

### 2.4 External services

| Service | Used for | Where configured |
|---|---|---|
| Cloudflare Stream | Native player video: direct tus upload from the client, transcode webhook, per-view signed playback tokens signed locally with a Stream signing key (`_shared/stream-signing.ts`), delivered from the customer subdomain (decisions/ADR-0005) | `supabase/functions/CLOUDFLARE_STREAM.md` |
| Resend | Transactional email (shared templates in `_shared/*-email.ts`), inbound event webhook (`resend-webhook`), uptime alerts | Function secrets |
| Sentry | Client errors and traces (`@sentry/react`, traces 30 % in production, replays 5 % web only), edge-function errors via the envelope API (`_shared/sentry.ts`) | `client/src/main.tsx`, function secrets |
| PostHog + GA4 | Consent-gated product analytics mirroring the first-party `events` pipeline; never on native, never on automated browsers | `client/src/lib/posthog.ts`, `lib/cookieConsent.ts` |
| LLM providers | `nl-search` and AI features through `_shared/llm-client.ts` (Gemini default, Claude or OpenAI by env var) | Function secrets |
| Google Maps/Places | Location autocomplete | `hooks/useGooglePlaces.ts` |

## 3. Data flows

### 3.1 Read path

`component -> hook (React Query, qk key) -> supabase-js -> PostgREST -> RLS policy -> table/view`

RLS is the gate for every direct read. Hidden profiles are filtered by base
RLS only on direct table reads; RPCs and views must filter explicitly.

### 3.2 Rule-bearing write path

`component -> supabase.rpc('fn') -> SECURITY DEFINER function (search_path pinned) -> table`

The function validates the actor (`auth.uid()`, role, ownership), enforces the
rule, writes the row and the history, and returns. Triggers then enqueue
notifications. Direct client writes to rule-bearing tables are blocked or
constrained by guard triggers (`20260926100000_phase1_close_client_write_holes.sql`,
`guard_application_client_write` in `20260928110000_recruiting_invites_offers_schema.sql`).

### 3.3 Notification path

`row change -> trigger -> database webhook (service-role JWT) -> notify-* edge function -> Resend / push`

Plus scheduled digests from `pg_cron`. Test-account content is routed to
`notify-test-*` and never to real recipients (`supabase/functions/NOTIFICATIONS.md`).

### 3.4 Video path

`client -> video-create-upload (JWT) -> Cloudflare tus URL -> client uploads bytes -> Cloudflare transcodes -> video-webhook (HMAC) -> player_videos.status = ready -> client asks video-playback-token per view`

### 3.5 AI search path

`client -> nl-search (JWT, check_rate_limit) -> LLM parse -> discover_profiles RPC / opportunity search -> LLM synthesis -> response`

This is the most expensive request in the system (two LLM round trips plus a
ranked query); see capacity.md.

## 4. Where business rules live

| Rule family | Authority | Client role |
|---|---|---|
| Application status transitions (pending, shortlisted, maybe, rejected, withdrawn, filled, offered, accepted, signed_pending_confirmation, signed) | SQL functions and guard triggers; `record_application_status_history` records the real actor | Reads; renders labels via `lib/applicationStatus.ts` |
| Invites (one open invite per player per club, 18+ by known DOB, 20/day or 5/day in the first week) | `send_invite`, `respond_invite`, expiry cron | Mirrors in `lib/invites.ts` are render-only |
| Offers and signing (versioned offers, 90-day open-until, 14-day confirmation, both-sides confirmation) | `make_offer`, `withdraw_offer`, `respond_offer`, `mark_signed`, `undo_mark_signed`, `confirm_signing`, `set_trial`, `withdraw_application`, `fill_role` | Mirrors in `lib/signing.ts` are render-only |
| Hidden / blocked / frozen-minor visibility | `profile_is_hidden`, `profile_is_uncontactable`, RLS, every RPC | None |
| Age gate (DOB immutable, 18+ for club-facing surfaces) | Column-level grants, `is_minor`, `age-gate` function | `components/AgeGate.tsx` for UX only |
| Rate limits | `check_rate_limit` RPC (database-backed, fail-closed) | `lib/rateLimit.ts` wraps the RPC |
| Attribution and short links | SQL `attribution_channel_rules` with a client mirror kept in parity by a DB corpus test | `lib/attributionRules.ts` |
| Fit / matching explanations | Mixed: SQL ranking in `discover_profiles` and friends; client-side explanation in `lib/clubFit.ts`, `lib/coachFit.ts`, `lib/interestFit.ts` | Computes display-only fit from fetched data |

Rule of thumb that the code follows: **if a rule decides who may do what, it
is in SQL; if it decides what to render, it may be mirrored in `lib/`.**

## 5. Recruiting pipeline (D1-D4)

Verified from migrations `20260928110000` onwards and `client/src/lib/{invites,signing,applicationStatus}.ts`.

```
D1 Club v2 (phone)      post a role -> opportunities (status open/closed/filled)
D2 30-second profile    player completeness, open_to_play, permits, 18+ search
D3 Invite to apply      opportunity_invites (sent -> applied | declined | expired)
                        send_invite -> conversation + fixed recruiting card -> respond_invite
D4 From yes to signed   opportunity_applications: shortlisted -> offered -> accepted
                        -> signed_pending_confirmation -> signed
                        opportunity_offers (versioned; live/superseded/withdrawn/accepted/declined/expired)
                        career_history.signed_via_hockia set by confirm_signing
```

- New tables have RLS from day one and explicit grants on every object
  (`REVOKE ALL FROM PUBLIC` then per-role grants).
- Clients only read these tables; every status change goes through the
  SECURITY DEFINER functions listed above.
- Offer terms are visible only to that club and that player.
- Expiry of invites and offers runs in `recruiting_expiry_daily`.
- The founder north-star metric "Signings via HOCKIA" is computed in
  `admin_get_engagement_overview` (`20261002100000_d4_signings_metric.sql`).

## 6. Environments

| | Production | Staging | Local |
|---|---|---|---|
| Supabase project | `xtertgftujnebubxgqit` | `ivjkdaylalhsteyyclvl` | `supabase start` (Docker) |
| Web | inhockia.com (Vercel Production) | staging.inhockia.com / Vercel Preview | `npm run dev` on :5173 |
| Branch | `main` | `staging` | feature branches |
| Native builds | point at production | n/a | n/a |

Staging is the only environment CI and E2E tests write to. **Assumption**:
staging and production run on the same Supabase plan tier; verify in the
dashboard before capacity work.

## 7. Known architectural debts (summary; details in the audit report)

- `lib/requestCache.ts` survives the React Query migration in 4 importers.
- The desktop club screens (v1) coexist with the phone-only Club v2 screens;
  the raw bundle budget carries both.
- `supabase_setup/` and `client/README.md` describe an older stack and are
  not maintained.
