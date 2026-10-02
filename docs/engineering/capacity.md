# Capacity

Target set by the founder: **1,000 registered users**. Today (2026-10-02):
about 360 profiles, 32 clubs, 61 coaches. This document builds a workload
model for that target, states what is measured today, and proposes a load
test on staging that has **not** been run. Every number below is either a
verified configuration value or an explicit assumption.

## 1. Scenarios

| Scenario | Registered | Daily active (DAU) | Peak concurrent | Basis |
|---|---|---|---|---|
| Today | ~360 | **assumption** 50-90 | **assumption** 5-15 | 15-25 % DAU/registered is a typical range for a niche vertical app with weekly digests; verify in the founder dashboard (D7/D15/D30 retention service exists) |
| Target | 1,000 | 150-250 | 20-40 | Founder brief; same ratios |
| Campaign peak | 1,000 | 250-350 for a day | 60-100 for an hour | **assumption**: a digest or outreach wave concentrates sessions; 3x the normal peak |

Peak concurrent means sessions active in the same minute, each issuing a
handful of requests; it is not simultaneous HTTP requests.

## 2. Critical journeys and what each one costs

Costs are derived from the code (hooks, RPCs, functions) and labelled.

| Journey | Server work per step | Notes |
|---|---|---|
| Open the app (web or native) | Session refresh (Auth), `profiles_self` read, home feed RPC(s), unread counts, notifications list, 1-2 realtime subscriptions | `useHomeFeed`, `useMyPulse`, `lib/unread.ts`, `lib/notifications.ts`; React Query dedupes repeats within 30 s |
| Browse opportunities | One list query with filters (PostgREST or RPC), detail read on tap, open-role counts | `useOpportunitiesForYou`, `useOpportunityDetail`, `useOpenRoleCounts` |
| Community / Find players | `discover_profiles` or community RPCs with ranking and the hidden-profile predicate; fit explanation computed client-side | Server-side ranking is the heaviest SQL on the read path |
| Hockia AI search | `nl-search`: `check_rate_limit`, 1-2 LLM calls (parse, synthesis), `discover_profiles` and/or opportunity search | Measured earlier at roughly 1.5 s in profile-token mode; dominated by LLM latency; **the only journey with external per-call cost** |
| Apply / invite / offer / sign | One SECURITY DEFINER RPC, history row, trigger -> webhook -> `notify-*` function -> Resend | Fast SQL; email is async |
| Messaging | Insert via PostgREST, realtime fan-out to the other participant, unread count update, optional push via `send-push` | One realtime channel per open conversation plus two global channels |
| Profile with media | Signed thumbnail tokens per video (`video-playback-token`, local RS256 signing, no Cloudflare round trip), Supabase image transforms | Thumbnails are cached client-side |
| Video upload (native) | `video-create-upload` then bytes go directly to Cloudflare (tus); webhook on ready | Bytes never touch Supabase |
| Founder dashboard | `admin_get_engagement_overview` and friends: many `COUNT(*)` over `profiles`, applications, messages | Admin-only; fine at 1,000 users, revisit at 10x |

## 3. Workload model at the target

Assumptions: 200 DAU, 2.5 sessions per DAU, 25 PostgREST/RPC requests per
session, 3 realtime subscriptions per active session, 15 % of sessions run one
AI search, 20 % send a message, 10 % take a recruiting action.

| Resource | Daily | Peak hour (assume 20 % of daily traffic) | Peak concurrent (40 sessions) |
|---|---|---|---|
| PostgREST + RPC requests | ~12,500 | ~2,500 (0.7 rps) | ~4 rps bursts |
| Realtime connections | - | - | ~120 channels on ~40 sockets |
| `nl-search` invocations | ~75 | ~15 | <1 per minute |
| LLM calls | ~150 | ~30 | - |
| Transactional emails | ~100-300 (notifications + digests) | bursts at digest time | - |
| Push notifications | ~100-300 | bursts | - |
| Edge function invocations (all) | ~1,000-2,000 incl. webhooks and cron | - | - |
| Storage egress | dominated by avatars and gallery images via image transforms | - | - |
| Stream minutes | depends on video views; signed URL minting is free of network calls | - | - |

Reading: at the target, the database sees single-digit requests per second at
peak and a few hundred realtime channels. This is far below what a small
Postgres instance handles; the risks are **latency outliers** (cold edge
functions, LLM latency, unindexed ad-hoc queries) and **quota ceilings**
(realtime connections, function invocations, email volume, Actions minutes),
not throughput.

## 4. What is measured today

| Measured | Where |
|---|---|
| Production health and warm-up every 5 min; key pages every 6 h | Cloudflare worker (`ops/uptime-worker`) |
| Client errors, 30 % traces, 5 % replays | Sentry |
| Web vitals | `lib/monitor.ts` `initWebVitals` (client-side; sent with analytics consent) |
| Client error budget (1 %) | `lib/errorBudget.ts` (in-app) |
| Funnels, retention D7/D15/D30, activation, signings | Founder dashboard SQL services; PostHog |
| AI usage and zero-result rates | `discovery_events` and `_meta.kind`; `/admin/ai-opinions` |
| Bundle size | CI budgets (initial-load gzip 480 KB hard, raw 4,800 KB) |

Not measured today (verified absence in the repository):

- Database query latency distribution (p50/p95) per RPC; `pg_stat_statements`
  is available in Supabase but nothing reads it.
- Edge function cold-start rate and p95 per function (Supabase logs hold the
  data; no dashboard or alert).
- Realtime connection counts and message rates.
- Email delivery volume against the Resend plan limit.
- LLM spend per day against the USD 50 alert (**assumption**: provider-side
  alert only).
- Supabase plan usage: database size, egress, function invocations, storage.

## 5. Indexing and query notes (from migrations)

- Core tables carry purpose-built indexes from the initial schema
  (`202511130104_indexes_views.sql`, 33 indexes) and later migrations:
  messages (11 named indexes), conversations (10), opportunity_applications
  (4), notifications (2), opportunity_invites (5 partial/composite),
  opportunity_offers (5), profiles (8+).
- 42 migration files use `ILIKE '%...%'` patterns in search functions while 7
  files add trigram or GIN indexes. World-club and name searches may fall back
  to sequential scans; at 1,000 users and a few thousand world clubs this is
  milliseconds, but it is the first thing to `EXPLAIN` when search latency
  grows.
- `discover_profiles` and the community RPCs rank in SQL with the hidden
  predicate; they are the right place to add covering indexes if p95 rises.
- Founder metrics functions scan `profiles`, applications and messages with
  `COUNT(*) FILTER`; acceptable at this scale, admin-only.

## 6. Proposed load test (staging only; not run)

Purpose: establish p95 latency and error rate baselines for the critical
journeys at the three scenarios, and confirm no quota is approached.

Constraints:

- **Staging only** (`ivjkdaylalhsteyyclvl`); never production.
- Use the E2E role accounts (credentials from the environment as in
  testing.md); never create real-looking users.
- Respect the CI concurrency groups: do not run while `staging-db-tests` or
  `staging-e2e-tests` is active, or the shared fixtures will collide.
- Cap external cost: `nl-search` at most 2 requests per minute during the
  test, and only after confirming the staging LLM provider and the spend
  alert; or stub the provider with `LLM_PROVIDER` set to the cheapest option.
- No email fan-out: keep accounts flagged `is_test_account` so notifications
  route to the test notifiers; confirm `TEST_NOTIFICATION_RECIPIENTS` is set
  to an inbox you control.
- Tool: k6 (open source, no new paid service). Run from a laptop; a single
  machine covers these rates easily.
- Duration: at most 10 minutes per scenario; ramp 1 minute, hold 5, ramp down.

Scenarios and virtual users (VUs):

| Scenario | VUs | Request mix (per VU iteration, with think time 5-15 s) |
|---|---|---|
| Today | 10 | app open (session + profile + feed + counts), browse 3 opportunities, 1 community query |
| Target peak | 40 | same mix + 20 % send a message + 10 % apply/shortlist via RPC |
| Campaign peak | 100 for 5 minutes | same mix, AI search still capped at 2/min overall |

Thresholds (fail the run if breached):

| Metric | Threshold |
|---|---|
| PostgREST reads p95 | < 400 ms |
| RPC writes (apply, shortlist, invite) p95 | < 800 ms |
| Home feed RPC p95 | < 800 ms |
| `nl-search` p95 | < 4 s (LLM-bound) |
| HTTP error rate (non-429) | < 1 % |
| 429 from `check_rate_limit` | expected for the AI path; must not appear on reads |

What to watch during the run: Supabase dashboard (CPU, connections, slow
queries), edge function logs (cold starts, 5xx), Sentry (new issues), and the
worker health check (must stay green).

Deliverable: a short results table per scenario appended to this document,
plus the k6 script committed under `ops/load/` with the caps hard-coded.

## 7. Platform limits to verify (not asserted here)

For each provider, record the plan and the relevant ceilings in this table
before the load test; the values differ by plan and change over time.

| Provider | Values to record |
|---|---|
| Supabase (per project) | plan; database size; compute tier; max connections and pooler size; realtime concurrent connections and messages/month; edge function invocations/month; storage size and egress; backup retention and PITR |
| Vercel | plan; bandwidth; build minutes; serverless/edge usage (the app is static plus rewrites) |
| Cloudflare | Stream stored minutes and delivered minutes; Workers requests/day and KV operations (the monitor is tiny) |
| Resend | emails/day and /month on the current plan; webhook limits |
| Sentry | events and replays quota; sampling already set to 30 % / 5 % |
| PostHog | events/month on the free tier |
| LLM provider(s) | rate limits per minute; daily spend alert (USD 50 ruling) |
| GitHub Actions | minutes/month on a public repository (unlimited for public; the repository is public for this reason) |
| Apple / Google | none for capacity |

## 8. Next validation steps

1. Read the actual DAU and peak-hour session counts from the founder
   dashboard and PostHog; replace the assumptions in section 1.
2. Enable `pg_stat_statements` reading on staging and production and record
   the top 20 queries by total time; add indexes where `EXPLAIN` shows
   sequential scans on tables above a few thousand rows.
3. Fill the limits table (section 7) from each provider's dashboard.
4. Write and run the k6 plan on staging under the constraints above; append
   results.
5. Add two cheap alerts: Supabase database CPU or connection saturation, and
   Resend daily volume; both exist as dashboard metrics today without alerts
   (**to verify**).
