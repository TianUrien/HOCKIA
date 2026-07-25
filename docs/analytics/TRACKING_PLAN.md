# HOCKIA Tracking Plan

The single source of truth for product analytics. Every event we fire must be
listed here with its properties. If it isn't in this doc, it doesn't ship.

**Principles**
- **Own the data.** The first-party `events` table (Postgres) is the source of
  truth for anything joined to business data. PostHog (Phase 2) sits on top for
  funnels/experiments; GA4 is marketing attribution only.
- **One taxonomy.** `object_action` snake_case names. Typed properties.
- **No PII in properties.** IDs and roles only — never names, emails, or raw
  URLs with UUIDs. IP is salted-hashed server-side, never stored raw.
- **Identity stitching.** Every event carries a durable `anonymous_id`; on
  registration it's aliased to the user (`resolved_user_id`) so pre-signup
  exploration joins to the account.

## Automatic context (stamped on every event by `track_event`)

Populated from `analyticsContext()` (client) + request headers (server). No
caller needs to pass these.

| Column | Source | Notes |
|---|---|---|
| `anonymous_id` | client (localStorage, consent-gated) | durable visitor id → unique/returning |
| `session_id` | client (30-min sliding window) | sessionization |
| `resolved_user_id` | server (`link_signup_attribution`) | identity stitching |
| `user_id`, `role` | server (`auth.uid()`) | null = anonymous at event time |
| `country` | server (`cf-ipcountry` header) | 2-letter; null in non-PostgREST calls |
| `ip_hash` | server (salted md5 of IP) | pseudonymous dedup, never raw IP |
| `device`, `browser` | client (UA parse) | desktop/mobile/tablet |
| `referrer_source` | client (first-touch) | google/linkedin/meta/direct/… |
| `utm` | client (URL, when present) | {source,medium,campaign,term,content} |

## Funnel events

### Acquisition / landing
| Event | Key properties | Status |
|---|---|---|
| `session_start` | `resumption?` | ✅ live |
| `page_view` | `path`, `feature` | ✅ live (now incl. entry view) |
| `landing_scroll_depth` | `pct` (25/50/75/100) | ⏳ Phase 1 |
| `cta_click` | `cta` (`create_profile`\|`explore_hockia`), `location` | ⏳ Phase 1 (DB) |
| `time_on_page` | `path`, `seconds` | ⏳ Phase 1 (heartbeats) |

### Exploration (logged-out demand)
| Event | Key properties | Status |
|---|---|---|
| `profile_view` / `profile_preview` | `role`, `entity_id` | ✅ live |
| `vacancy_view` / `opportunity_viewed` | `entity_id` | ✅ live |
| `community_post_viewed` | `entity_id` | ⏳ Phase 1 |
| `world_viewed` | `country` | ⏳ Phase 1 |

### Conversion
| Event | Key properties | Status |
|---|---|---|
| `registration_started` | `source_path` | ⏳ Phase 1 (wizard mount) |
| `onboarding_step` | `step`, `role` | ✅ live |
| `onboarding_completed` / registration_completed | `role` | ✅ live (+ alias) |
| `login_wall_shown` | `action` (apply/message/connect/…), `entity_type` | ⏳ Phase 1 |
| `registration_from_wall` | `action` | ⏳ Phase 1 |

The last two are the hypothesis test: `login_wall_shown` = thwarted intent while
exploring; `registration_from_wall` = whether that intent converts.

## The funnel (how to read it)

```
landing page_view (path='/')
  → explored ≥1 public item (profile/opportunity/community/world)   [the "explore before join" cohort]
  → cta_click(create_profile)  OR  login_wall_shown → registration_from_wall
  → registration_started
  → onboarding_step(form_submitted)
  → onboarding_completed        [aliased: anon exploration now joins to the user]
```

Conversion & drop-off at each edge; segment by `referrer_source`, `country`,
`device`, and `cta`. Explorers vs non-explorers is the core question.

## Attribution

`signup_attribution` stores first-touch per user (`anonymous_id`, `first_source`,
`utm`, `landing_path`, `first_seen_at`) written once at registration. Join
`events.resolved_user_id` to see every pre-signup event that led to an account.

## Consent & privacy

Durable `anonymous_id` and first-touch persist to localStorage only after the
user accepts analytics cookies; before/decline they use per-tab sessionStorage
(no cross-session cookie). No PII in properties. IP is salted-hashed. GA4 stays
gated behind consent and is not loaded on native.
