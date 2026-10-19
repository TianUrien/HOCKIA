# Analytics audit and tracking plan

Written 2026-10-15 from the production database (read-only), `client/src/lib/analytics.ts`,
`client/src/lib/trackDbEvent.ts`, `client/src/lib/attribution.ts`, the `ga4-funnel` edge
function and the admin Overview. Audience: the founder reading the admin portal. Every
number below is a query result over the stated window, not an estimate.

## 1. What is measured today

| Layer | What it is | Where it lands | Coverage | Gating |
|---|---|---|---|---|
| **Supabase events** (first party) | `trackDbEvent(name, …)` → RPC `track_event` → table `events`; the admin reads the view `analytics_events` (drops Playwright rows and test accounts) | Postgres, 52,713 rows all-time, 20,321 in the last 30 days | Web, PWA, iOS and Android, signed-in and anonymous | None. IP stored only as a salted hash; no PII in properties |
| **GA4** (`G-NE620GQKTX`) | `trackEvent({action, …})` → `gtag`; 42 actions defined | Google Analytics | Web only, and only after cookie consent | Consent; also blocked by ad blockers |
| **Attribution v2** | First touch captured on first visit, written at registration (`signup_attribution`), rules in `attribution_channel_rules`; short links `/l/<code>` log `short_link_clicks`; Play Install Referrer on Android | Postgres | Every registration | None |
| **PostHog** | SDK installed and consent-gated, mirrored from `trackDbEvent` | Nowhere: no production key | 0 | — |
| **Sentry** | Errors and performance | Sentry `playr-6m` | All platforms | — |

Supabase is the system of record for product decisions. GA4 is a consent-limited sample of
the anonymous web top-of-funnel and should be read as such.

## 2. Findings

### 2.1 GA4 sees less than half of what happens
Last 30 days, same window: GA4 counted 8 "Sign-up CTA clicked" and 2 "Wall → clicked to
join"; Supabase counted 26 `registration_started`, 26 new auth users and 22 new real
profiles. Native apps never load GA4, and on the web consent plus ad blockers remove more.
**Decision:** keep GA4 only for landing-page reach (195 landing views / 30 d) and never put a
GA4 number next to a Supabase number without saying which is which. The admin already labels
the GA4 funnel "estimate"; keep it that way.

### 2.2 The recruiting loop is only half instrumented
Last 30 days: 3 roles posted · 295 role views by 113 people · 42 applications by 27 people ·
status mix `no_response 27, pending 11, shortlisted 2, maybe 1, rejected 1` · 2 invites and 0
offers all-time · 0 signings. The loop is the product's reason to exist and today only
`vacancy_view`, `application_submit`, `applicant_status_change` (5 events) and `invite_sent`
are events. Shortlisting, offers, decline reasons and signings are state in tables, with
timestamps, so they can be charted without new client events — but the admin does not chart
them yet. **Decision:** build the loop as one funnel from tables (section 4) and add
server-side events for the three transitions that have no timestamp of their own.

### 2.3 Attribution: most sign-ups are inferred, not measured
Last 90 days by method: `backfilled 54, none 23, referrer 16, install_referrer 5, snapshot 4,
migrated 2, legacy_client 1, utm 1`. Only 22 of 106 (referrer + install referrer + utm) were
measured at the moment of first contact; "none" (23) are app installs with no prior web
visit, which iOS cannot attribute. Short links exist for 9 placements and had 9 clicks in
30 days. **Decision:** bio/story/DM links must point at the web (`/l/ig`, `/l/ig-story`, …),
not straight at the stores, until Apple gives an install referrer; report the Instagram share
from `first_touch_source = instagram` only, and label app-store-only installs as unmeasured.

### 2.4 Naming and dead code
- `quick_action.message_clicked` (dot-separated, last seen 2026-09-19) is a legacy name
  next to `message_send` / `conversation_start`. Retire it.
- `profile_preview` (730) and `profile_view` (723) are two surfaces (Community preview card
  vs full profile). Keep both, document both.
- GA4 trackers `trackProfileUpdate`, `trackProfileStrengthMilestone`, `trackMediaUpload`
  are exported and never called; the Supabase `profile_edit` event (28 / 30 d) is the one
  the dashboards use. Delete the three GA4 ones.
- `page_view` + `session_start` are 69% of all rows (13,943 of 20,321 / 30 d). Fine at this
  size; revisit retention of `events` when it passes ~1 M rows.

### 2.5 Things that are healthy
- Onboarding: 26 started → 22 profiles → 18 `onboarding_completed` (82%), consistent across
  events, `profiles` and the admin funnel.
- Engagement: MAU 149 (command centre) vs 146 profiles with `last_active_at` in 30 d.
- Notifications: 509 `notification_click` by 85 people; CTR per kind is on the Overview.
- Privacy: no PII in event properties, IP hashed with a salt, GA4 behind consent.

## 3. Event dictionary (Supabase, in use)

Names are `object_action`, lowercase with underscores. Properties are event-specific; the
RPC promotes `session_id`, `anonymous_id`, `device`, `browser`, `referrer_source`, `utm` to
columns.

| Event | Fires when | Key properties | Informs | 30 d |
|---|---|---|---|---|
| `page_view` | Route change | path | Reach per screen | 11,823 |
| `session_start` | App/tab opens | platform | DAU/WAU/MAU, sessions | 2,120 |
| `registration_started` / `registration_from_wall` | Sign-up form opened / from a sign-up wall | wall kind | Funnel top | 26 / 2 |
| `onboarding_step` / `onboarding_completed` | Each onboarding step / finish | step, role | Onboarding completion by role | 84 / 18 |
| `login` / `login_wall_shown` | Sign-in / wall shown to a guest | method | Guest friction | 106 / 15 |
| `profile_view` / `profile_preview` / `profile_edit` | Full profile / Community preview / own edit | target role | Profile demand, completion | 723 / 730 / 28 |
| `vacancy_view` / `opportunity_create` / `application_submit` / `applicant_status_change` / `invite_sent` / `invite_declined` | Recruiting loop | opportunity_id, status | North star | 295 / 3 / 42 / 5 / 2 / 0 |
| `conversation_start` / `message_send` | Messaging | — | Connections | 162 / 253 |
| `friend_request_send` / `friend_request_update` | Friends | — | Network | 238 / 16 |
| `post_impression` / `post_create` / `post_like` / `post_comment_create` / `post_delete` | Feed | kind | Content | 392 / 3 / 4 / 0 / 0 |
| `notification_click` | Push or in-app notification tapped | kind | Notification CTR | 509 |
| `search` / `search_result_click` | Hockia AI search | intent | AI usage (1 query / 30 d in `discovery_events`) | 24 / 3 |
| `cta_click` / `home_module_click` / `landing_scroll_depth` | Landing and Home | placement | Landing conversion | 56 / 37 / 270 |
| `home_card_impression` / `home_card_click` / `home_feed_scroll` / `next_step_impression` / `next_step_action` / `profile_viewers_view` / `congrats_toggle` / `feed_item_comment_create` | Home v1 (§4.6, 2026-10-19) | module_id, position, item_type, destination, source, surface | Home rethink | new |
| `app_rating_prompt_*` | Rating prompt | — | Store ratings | 66 / 35 / 2 |
| `reference_request` / `reference_respond` / `reference_*` | References | — | Trust loop (1 request / 30 d) | 1 / 0 |
| `product_view` / `brand_product_click` | Brand pages | — | Brand value | 6 / — |
| `quick_action.message_clicked` | Legacy, retire | — | — | 26 |

GA4 mirrors a subset under its own names (`sign_up`, `sign_up_start`, `onboarding_complete`,
`vacancy_view`, `application_submit`, `message_send`, …); see `lib/analytics.ts`.

## 4. Plan

### 4.1 Admin: recruiting-loop funnel from tables (no client change)
One admin RPC `admin_get_recruiting_funnel(p_days)` built from `opportunities`,
`analytics_events.vacancy_view`, `opportunity_applications` (`applied_at`, `status`,
`signed_at`), `opportunity_invites` (`sent_at`, `responded_at`) and `opportunity_offers`
(`sent_at`, `responded_at`): roles posted → viewed → applied → shortlisted → invited →
offered → signed, with people counts and median time between steps. Shown on the Overview as
a funnel chart in place of the six North Star tiles. This is the one chart that answers
"is the product working".

### 4.2 Server-side events for transitions without a timestamp
Triggers on `opportunity_applications` (status change → `application_status_changed` with
`from`, `to`), on `opportunity_offers` (insert → `offer_sent`, response → `offer_responded`)
and on the signing confirmation (`signing_confirmed`). Written into `events` by the database
so they cannot be lost to a closed tab, and the client `applicant_status_change` event is
then removed. Admin-gated reads only.

### 4.3 Attribution
- Instagram and other placements: web landing links only (done for `ig`, `ig-story`, `ig-dm`,
  `ig-reel`, `ig-app` exists for the stores when needed).
- Add "attribution method" (measured vs inferred vs unmeasured) as a small donut on the
  Attribution page so the share of guessing is visible.
- Weekly query for the Instagram agent: `signup_attribution` where
  `first_touch_source = 'instagram'` grouped by `link_id`, `first_touch_campaign`, joined to
  `profiles.role` and `onboarding_completed`.

### 4.4 Clean-up
- Delete `trackProfileUpdate`, `trackProfileStrengthMilestone`, `trackMediaUpload` (GA4).
- Remove the `quick_action.message_clicked` emitter.
- Mark GA4 conversions: `sign_up`, `onboarding_complete`, `application_submit`,
  `message_send` (Admin → Events in GA4; no code).

### 4.5 PostHog
Not switched on. GA4 + Supabase already cover reach and product events; PostHog would add
session replay and funnels on the same events at the cost of a second consent-gated SDK and
another place to look. Decision deferred until there is a question the admin cannot answer.

### 4.6 Home v1 instrumentation — added 2026-10-19
Source: `docs/product/user-research.md` › Gaps 1–8 (Home usage analytics, 2026-10-19) and
the founder's choices the same day: events land in Supabase `events` (mirrored to PostHog
when it has a key), GA4 untouched; feed depth as 25/50/75/100 % milestones plus the last
card seen; the "New signing" item type stays until two weeks of data say otherwise.
Code: `client/src/lib/homeInstrumentation.ts`, `client/src/lib/navSource.ts`, the Home v1
components, `OpportunityDetailPage`, `submitApplication`, push tap handlers.

| Gap | Event / field | Fires when | Properties |
|---|---|---|---|
| 1 | `home_card_impression` (entity `feed_item`) | A feed card nears the viewport, once per card per session | `module_id` = `v1_feed`, `position` (0-based index), `item_type` |
| 2 | `home_module_impressions` rows (table) | A Home v1 module nears the viewport, once per hour | `module_id` ∈ `v1_next_step` 0 · `v1_people_new` / `v1_people_available` 1 · `v1_feed` 2 · `v1_roles_rail` 3 · `v1_end_of_feed` 4 · `v1_people_pymk` 5 · `v1_roles_rail_end` / `v1_people_available_end` 6 |
| 3 | `home_feed_scroll` | The member's deepest visible card crosses 25/50/75/100 % of the cards loaded so far (each once per Home visit) | `milestone`, `last_index`, `loaded`, `has_more` — 100 % means the last loaded card, not the end of the feed; `v1_end_of_feed` in the impressions table is the true end |
| 4 | `surface` on `post_impression`, `post_like`, `post_comment_create`, new `congrats_toggle`, new `feed_item_comment_create` | As before; `surface` is derived from the route (`home_v1`, `community`, `profile`, `pulse`, …) | `surface`; `congrats_toggle` adds `has` |
| 5 | `destination` on `home_module_click`; new `home_card_click` | A module or feed card tap that leaves Home or opens a sheet | `destination` with ids replaced by `:id` (`/opportunities/:id`, `/community`, `member_deck`, `compose`) |
| 6 | `source` on `vacancy_view` and `application_submit` (+ `via`) | Role page open / application sent | `source` ∈ `home_role_card`, `home_feed_card`, `home_next_step`, `opportunities`, `inbox`, `hockia_ai`, `push`, `direct`; `via` ∈ `apply_sheet`, `hockia_ai`. Carried by router state (`navState`) or `?src=` (push taps, web and native) |
| 7 | `profile_viewers_view` (entity `profile`) | "Who viewed you" opens on Your activity or the brand profile | `source` ∈ `home` (from the views card), `pulse`, `profile` |
| 8 | `next_step_impression`, `next_step_action` | The Next step card on screen / acted on | `key` = step family only (`photo`, `roles`, `views`, `quiet`, `checkin`, …), `action` ∈ `open`, `compose`, `confirm_availability`, `dismiss`, `surface` |

Why gap 8 is an event and not `pulse_items.seen_at`: since Home v1 (11 Oct) players, coaches
and clubs never see the Pulse item list — the Next step card and Your activity replaced it —
so `seen_at` is only stamped on the brand and umpire dashboards (`PulseSection`, which stamps
every loaded item whether or not it was scrolled to). The card impression is what members
actually saw. Dismissals still reach `mark_pulse_dismissed` for the check-in.

Questions these answer: which Home cards get seen and tapped, how far people scroll, which
surface starts role views and applications, and whether "who viewed you" is a reason to open
the app. First read after two weeks of data (≈ 2 Nov 2026).

## 5. Conventions and QA
- Names: `object_action`, lowercase, underscores; context in properties, not in the name.
- Every new event lands in this file with the decision it informs; an event nobody reads is
  removed.
- Never put PII in properties (names, emails, free text). The RPC hashes IPs.
- Test accounts (`profiles.is_test_account`) and Playwright (`properties.is_automated`) are
  excluded by the `analytics_events` view; new admin queries must read the view, not `events`.
- Rates divide a numerator and denominator over the same closed window; cohorts still inside
  their window are "pending", not failed (the retention service already does this).
- Check after a release: `select event_name, count(*) from analytics_events where created_at >
  now() - interval '1 day' group by 1` must still list the events the release touched.
