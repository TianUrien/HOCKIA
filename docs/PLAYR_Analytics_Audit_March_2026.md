# PLAYR Analytics & Observability Audit — March 2026

## Executive Summary

PLAYR has a **solid analytics foundation** — 24 admin pages, 40+ RPCs, heartbeat-based engagement, email delivery tracking via Resend webhooks, and a flexible `events` table with 22+ event types. However, there is a significant **GA4 disconnect** (functions defined but mostly unused), several **cross-feature conversion funnels are missing**, and key user journey steps go untracked.

**Overall coverage: 7.3/10** — strong on engagement, marketplace, and email delivery; weak on search behavior, GA4 utilization, onboarding funnels, and cross-feature attribution.

---

## Part 1: What We Currently Track

### 1.1 Admin Portal (24 Pages, 40+ RPCs)

| Page | Route | What It Measures |
|---|---|---|
| **Overview** | `/admin` | KPIs (users, opportunities, applications, WAU/MAU), growth chart, retention cohorts, activation funnel, health signals |
| **Funnels** | `/admin/funnels` | Networking/opportunity/reference conversion funnels, notification effectiveness, marketplace health (supply/demand, app velocity) |
| **Engagement** | `/admin/engagement` | DAU/WAU/MAU, time-in-app, sessions, avg session length, per-user engagement table, daily trends |
| **Networking** | `/admin/networking` | Messaging metrics, friendship metrics, reference metrics |
| **Discovery** | `/admin/discovery` | AI search queries, intent breakdown, filter frequency, zero-result queries, response times |
| **Feed** | `/admin/feed` | Posts by type/role, likes, comments, daily trends, top posts |
| **Community** | `/admin/community` | Q&A questions, answers, participation |
| **Email** | `/admin/email` | Delivery funnel (sent→delivered→opened→clicked), template performance, campaigns, contacts, engagement by segment |
| **Monthly Report** | `/admin/monthly` | 8-section snapshot with month-over-month deltas across all metrics |
| **Features** | `/admin/features` | Profile views (by role, source, trend), event summary, most viewed profiles |
| **Preferences** | `/admin/preferences` | Notification/privacy preference adoption rates by role |
| **Players** | `/admin/players` | Player funnel (signup→onboard→avatar→video→career→apply), profile completeness distribution |
| **Clubs** | `/admin/clubs` | Club posting activity, vacancies, applications received |
| **Brands** | `/admin/brands` | Brand products, posts, followers, engagement |
| **Opportunities** | `/admin/opportunities` | Vacancy list with app stats, status breakdown, time to first application |
| **Directory** | `/admin/directory` | User search, profile management, block/unblock |
| **Data Issues** | `/admin/data-issues` | Auth orphans, profile orphans, broken foreign keys |
| **Audit Log** | `/admin/audit-log` | Admin action history with filters |
| **World** | `/admin/world` | Club directory management, claim status |
| **Investor** | `/admin/investors` | Shareable KPI dashboard with token management |
| **Outreach** | `/admin/outreach` | Outreach contacts, status funnel, conversion tracking |

### 1.2 Database Event Tracking (22+ Events)

All tracked via `track_event()` RPC → `events` table with JSONB properties:

| Event | Entity Type | Properties | Used By |
|---|---|---|---|
| `session_start` | — | `{ session_id }` | App.tsx |
| `page_view` | — | `{ path }` | App.tsx |
| `profile_view` | profile | `{ viewed_role, source }` | Public profile pages |
| `vacancy_view` | vacancy | `{ position, location }` | OpportunityDetailPage |
| `opportunity_create` | vacancy | `{ type }` | CreateOpportunityModal |
| `application_submit` | vacancy | `{ position }` | ApplyToOpportunityModal |
| `applicant_status_change` | application | `{ new_status }` | ApplicantsList |
| `message_send` | conversation | — | useChat |
| `friend_request_send` | friendship | — | Friend request flow |
| `friend_request_update` | friendship | `{ status }` | Accept/reject flow |
| `reference_request` | reference | `{ relationship_type }` | useTrustedReferences |
| `reference_respond` | reference | `{ accepted }` | Reference response |
| `reference_edit` | reference | — | Reference editing |
| `reference_remove` | reference | — | Reference removal |
| `reference_withdraw` | reference | — | Reference withdrawal |
| `post_create` | post | `{ type }` | Post creation |
| `post_delete` | post | `{ type }` | Post deletion |
| `post_like` | post | `{ liked }` | usePostInteractions |
| `post_comment_create` | post | — | Comment creation |
| `post_comment_delete` | comment | — | Comment deletion |
| `search` | — | `{ type, results_count, query }` | SearchPage |
| `notification_click` | notification | `{ kind }` | NotificationsDrawer |

### 1.3 Engagement Infrastructure

| System | What It Tracks | Retention |
|---|---|---|
| **Heartbeat pings** | 30s intervals while tab active, idle detection (2min), visibility detection | 90 days (raw), daily aggregates kept forever |
| **Daily aggregates** | `total_seconds`, `session_count`, `heartbeat_count` per user per day | Indefinite |
| **Sentry** | Frontend errors + all 17 edge functions, PII scrubbed, 30% trace sample rate | Per Sentry plan |
| **GA4** | Page views only (via `trackPageView()` in AnalyticsTracker) | Per GA4 retention |

### 1.4 Email & Notification Tracking

| Table | What It Tracks |
|---|---|
| `email_sends` | Per-recipient: resend_email_id, template_key, campaign_id, status progression (sent→delivered→opened→clicked→bounced), timestamps |
| `email_events` | Raw Resend webhook events with URLs for clicks |
| `email_templates` | Template performance, versioning, active/inactive status |
| `email_campaigns` | Campaign status, audience filter, recipient count |
| `profile_notifications` | In-app notifications with `read_at`, `seen_at`, `cleared_at` |
| `push_subscriptions` | Web push credentials per device |
| `pwa_installs` | PWA installs by platform (iOS/Android/Desktop) |

### 1.5 Outreach Tracking

| Signal | How It's Tracked |
|---|---|
| Contact status funnel | `imported → contacted → delivered → opened → clicked → signed_up` (auto-progressed via triggers) |
| Conversion | `converted_profile_id` + `converted_at` linked when email matches signup |
| Source | `csv_import` or `manual` |

### 1.6 Discovery (AI Search)

Dedicated `discovery_events` table logs every AI search query with:
- `query_text`, `intent`, `parsed_filters` (JSONB with 13 filter categories)
- `result_count`, `response_time_ms`, `error_message`
- Admin analytics: filter frequency, zero-result queries, daily trends, top users

---

## Part 2: What We Are NOT Tracking (But Should)

### 2.1 CRITICAL — GA4 Is Essentially Dead

**Problem**: `analytics.ts` defines 20+ GA4 event functions, but only `trackPageView()` is actually called anywhere. This means:

- `setUserProperties(userId, role)` — **never called** → GA4 sees anonymous users only
- `trackSignUpStart()` — **never called**
- `trackSignUp()` — **never called**
- `trackLogin()` — **never called**
- `trackOnboardingComplete()` — **never called**
- `trackProfileUpdate()` — **never called**
- `trackConversationStart()` — **never called**
- `trackMessageSend()` — **never called**
- `trackSearch()` — **never called** (DB event exists but GA4 version unused)
- `trackMediaUpload()` — **never called**
- `trackPushSubscribe()` — **never called**
- `trackVacancyCreate()` — **never called** (DB event exists but GA4 version unused)

**Impact**: Cannot use GA4 for user-level analysis, cohort comparison, or audience building. All GA4 data is anonymous page views only.

**Recommendation**: Either wire up all existing GA4 functions (they're already written) or consciously deprecate GA4 in favor of the database event system. If keeping GA4, at minimum call `setUserProperties()` on auth completion.

### 2.2 CRITICAL — Authentication & Onboarding Funnel

| Missing Signal | Why It Matters |
|---|---|
| Signup start event | Can't measure landing → signup conversion |
| Signup completion event | Can't measure signup → email verification conversion |
| Login events | Can't measure returning user frequency outside heartbeats |
| Onboarding step progression (25/50/75%) | Can't identify where users drop off during profile setup |
| Time to onboarding completion by role | Can't optimize the onboarding flow per role |
| Which profile fields are skipped | Can't prioritize which fields to make required vs optional |

### 2.3 CRITICAL — Cross-Feature Conversion Funnels

| Missing Funnel | What We Can't Answer |
|---|---|
| Profile view → message sent | Does viewing a profile lead to outreach? |
| Profile view → friend request | Does viewing a profile lead to networking? |
| Vacancy view → application | What % of opportunity viewers actually apply? |
| Search → result click → action | Is search leading to meaningful engagement? |
| Notification → action taken | Which notification types drive the most valuable actions? |
| Message → application/hire | Does messaging correlate with marketplace conversion? |
| Reference collected → application success | Do references improve hiring outcomes? |
| World browse → profile view → claim | Does the directory drive club signups? |

### 2.4 HIGH — Messaging Depth

| Missing Signal | Why It Matters |
|---|---|
| Conversation start (new vs existing) | Can't measure network growth through messaging |
| Response time (send → read → reply) | Can't identify messaging health or user satisfaction |
| Conversation depth (message count per thread) | Can't distinguish shallow from deep engagement |
| Conversation abandonment (opened, no reply) | Can't identify friction in communication |
| Message context (from profile? from applicants list?) | Can't attribute messaging to features |

### 2.5 HIGH — Search Quality

| Missing Signal | Why It Matters |
|---|---|
| Search result click-through rate | Can't measure if search results are relevant |
| Search → no action (zero-click queries) | Can't identify failing searches |
| Traditional search filter combinations | Can't optimize search UX (only AI discovery tracks filters) |
| Time from search to next action | Can't measure search effectiveness |

### 2.6 MEDIUM — Content & Feed Engagement

| Missing Signal | Why It Matters |
|---|---|
| Post view (impression) tracking | Can't measure feed reach vs engagement |
| Feed scroll depth | Can't optimize feed algorithm or content ranking |
| Post engagement velocity (time to first like) | Can't identify viral content patterns |
| Video play/completion rates | Can't measure highlight video value |
| Media upload success/failure rates | Can't identify upload friction |
| Share/repost events | Can't measure content virality |

### 2.7 MEDIUM — Profile Engagement

| Missing Signal | Why It Matters |
|---|---|
| Profile edit frequency post-completion | Can't measure "live" vs "stale" profiles |
| Which fields are edited most | Can't optimize profile layout |
| Profile strength progression over time | Can't measure onboarding quality beyond binary completion |
| Gallery photo view/engagement | Can't measure photo feature value |

### 2.8 LOWER — Operational Signals

| Missing Signal | Why It Matters |
|---|---|
| Hard vs soft bounce differentiation | Can't clean email lists effectively |
| Per-link click tracking in emails | Can't optimize email CTA placement |
| Push notification delivery confirmation | Can't measure push reliability |
| Notification fatigue (dismiss without reading) | Can't optimize notification frequency |
| Email client/device breakdown | Can't optimize email rendering |
| Page load performance (Web Vitals in DB) | Can't correlate performance with engagement |
| Retry attempt counts in edge functions | Can't measure reliability gaps |
| Login failures / auth errors | Can't detect account issues or attacks |

---

## Part 3: Recommended Metrics to Add

### Tier 1 — Quick Wins (Wire Up Existing Code)

These require minimal code changes since the infrastructure already exists:

| # | Metric | Effort | How |
|---|---|---|---|
| 1 | **GA4 user identity** | 1 line | Call `setUserProperties(userId, role)` on auth completion |
| 2 | **GA4 signup tracking** | 2 lines | Call `trackSignUpStart()` in SignUp.tsx, `trackSignUp()` after auth creation |
| 3 | **GA4 onboarding complete** | 1 line | Call `trackOnboardingComplete()` after profile submission |
| 4 | **GA4 conversation start** | 1 line | Call `trackConversationStart()` in NewMessageModal |
| 5 | **GA4 message send** | 1 line | Call `trackMessageSend()` in useChat alongside DB event |
| 6 | **GA4 vacancy create** | 1 line | Call `trackVacancyCreate()` alongside DB event |
| 7 | **GA4 search** | 1 line | Call `trackSearch()` alongside DB event |
| 8 | **GA4 push subscribe** | 1 line | Call `trackPushSubscribe()` after push permission granted |

### Tier 2 — High-Value New Tracking

| # | Metric | What It Enables | Implementation |
|---|---|---|---|
| 9 | **Conversation start event** | Network growth measurement | New DB event `conversation_start` in useChat when creating new conversation |
| 10 | **Onboarding step events** | Drop-off analysis per step | Track each CompleteProfile step as `onboarding_step` event with step name |
| 11 | **Search result click** | Search quality measurement | Track `search_result_click` with result position, entity type |
| 12 | **Profile view → action attribution** | Cross-feature funnel | Add `referrer_entity` to friend request / message / application events |
| 13 | **Vacancy view → apply conversion** | Marketplace funnel | RPC joining `vacancy_view` events to `application_submit` events per user |
| 14 | **Message response time** | Messaging health | Compute from `messages.sent_at` to next message in conversation |
| 15 | **Feature-level time tracking** | Feature attribution | Add `feature_name` to `page_view` event based on route pattern |

### Tier 3 — Dashboard Additions for Admin Portal

| # | New Admin Section | What It Shows | Priority |
|---|---|---|---|
| 16 | **Onboarding Funnel Detail** | Step-by-step drop-off rates by role, time to complete | High |
| 17 | **Search Quality** | CTR on results, zero-click rate, search → action conversion | High |
| 18 | **Messaging Health** | Response rates, avg response time, conversation depth distribution | Medium |
| 19 | **Cross-Feature Attribution** | Profile view → message/friend/apply conversion rates | Medium |
| 20 | **Content Reach** | Post impressions vs engagement, engagement rate by post type | Medium |
| 21 | **Churn Signals** | Users inactive 7/14/30 days, last action before churn, re-engagement rates | Medium |
| 22 | **Role-Specific Dashboards** | Per-role feature adoption, engagement patterns, conversion rates | Lower |

---

## Part 4: What Should Appear in Admin Portal vs Internal Only

### Should Appear in Admin Portal

| Metric | Rationale |
|---|---|
| Onboarding funnel with step-level drop-off | Directly actionable — tells you which steps to simplify |
| Cross-feature conversion rates | Product health signal — are features working together? |
| Search quality (CTR, zero-click) | Content/discovery optimization |
| Messaging health (response rate, time) | Community health signal |
| Churn cohort analysis | Growth/retention signal |
| Feature adoption by role | Identifies underserved roles (especially Brand at 5/10) |
| Notification → action conversion | Optimize notification strategy |
| Email A/B test results (when added) | Campaign optimization |

### Should Be Tracked Internally Only (Not in Admin Portal)

| Metric | Rationale |
|---|---|
| Raw GA4 event stream | Too granular for admin; use GA4 dashboard directly |
| Individual page load times | Engineering metric, use Sentry Performance |
| Edge function retry counts | Engineering reliability metric |
| Error budget burn rate details | Engineering SRE metric (summary already in Overview) |
| Session recording/heatmap data | Privacy-sensitive, use dedicated tool if needed |
| Auth failure patterns | Security metric, monitor via Sentry alerts |
| Database query performance | Infrastructure metric |
| Webhook delivery latency | Email infrastructure metric |

---

## Part 5: Product Decision & Growth Signals

### Signals That Would Help Product Decisions

| Question | Signal Needed | Current Status |
|---|---|---|
| "Are we retaining users after onboarding?" | Day 1/7/30 retention by role | **Partially tracked** — cohort retention exists but not role-segmented |
| "Which features drive retention?" | Feature usage → return rate correlation | **Not tracked** — no feature-level attribution |
| "Is the marketplace healthy?" | Supply/demand ratio, time-to-fill, application quality | **Partially tracked** — counts exist but no quality signals |
| "Are references valuable?" | Reference count → application success correlation | **Not tracked** — no cross-entity correlation |
| "Should we invest more in Brand role?" | Brand feature adoption, engagement, conversion to value | **Partially tracked** — basic counts only |
| "Is AI Discovery better than traditional search?" | Conversion rates of both, user preference signals | **Partially tracked** — AI has analytics, traditional search minimal |
| "What drives a user to send their first message?" | Action sequence before first message | **Not tracked** — no behavioral sequence analysis |
| "Why do users churn?" | Last actions before inactivity, feature gaps | **Not tracked** — no churn analysis |
| "Which countries should we expand to?" | Engagement depth by country, not just signup count | **Partially tracked** — signup by country exists, engagement by country doesn't |
| "Are notifications helping or annoying?" | Notification → disable rate, notification → action rate | **Partially tracked** — CTR exists, fatigue not tracked |

### Signals That Would Help Growth

| Growth Lever | Signal Needed | Current Status |
|---|---|---|
| Viral coefficient | Invite → signup → active conversion | **Not tracked** — no referral/invite system |
| Organic acquisition | Traffic source → signup → activation by channel | **Not tracked** — GA4 not wired up |
| Reactivation | Dormant user → re-engagement trigger → return | **Not tracked** — no reactivation funnel |
| Network effects | Friend count → engagement correlation | **Not tracked** — no network density metrics |
| Marketplace liquidity | Time-to-first-application, match rate | **Partially tracked** — `time_to_first_app_minutes` exists |
| Content-driven growth | Post → profile view → signup (for public content) | **Not tracked** — no public content analytics |

---

## Part 6: Summary Scorecard

| Area | Data Collection | Admin Visibility | Actionability | Priority Gap |
|---|---|---|---|---|
| **Engagement (time/sessions)** | 9/10 | 9/10 | 9/10 | — |
| **Email delivery** | 9/10 | 9/10 | 8/10 | Per-link clicks |
| **Marketplace** | 8/10 | 8/10 | 7/10 | View→apply funnel |
| **AI Discovery** | 8/10 | 8/10 | 7/10 | Result click-through |
| **Profiles** | 7/10 | 7/10 | 6/10 | Edit tracking, strength progression |
| **Social/Networking** | 7/10 | 7/10 | 6/10 | Response time, depth |
| **Feed/Content** | 7/10 | 7/10 | 5/10 | Impressions, reach |
| **Notifications** | 7/10 | 7/10 | 6/10 | Fatigue, push delivery |
| **Outreach** | 7/10 | 6/10 | 6/10 | Post-conversion tracking |
| **Onboarding** | 5/10 | 5/10 | 4/10 | Step-level funnel |
| **Search (traditional)** | 4/10 | 3/10 | 3/10 | CTR, quality, filters |
| **GA4 integration** | 2/10 | 1/10 | 1/10 | Almost entirely unused |
| **Auth/Login** | 2/10 | 1/10 | 1/10 | No login events |
| **Cross-feature funnels** | 2/10 | 2/10 | 1/10 | No attribution between features |
| **Churn/Retention depth** | 3/10 | 3/10 | 2/10 | Basic cohorts only |

---

## Top 5 Priorities

1. **Wire up GA4** — 8 one-line changes to activate existing code; unlocks user-level analytics outside the admin portal
2. **Onboarding step funnel** — critical for reducing drop-off; currently a black box between signup and completion
3. **Cross-feature attribution** — connect profile views → messages → applications → hires; proves the platform creates value
4. **Search quality metrics** — CTR and zero-click tracking for traditional search; AI discovery already has this
5. **Churn analysis** — identify why users go dormant and what re-engages them; no current visibility

---

*Generated: March 13, 2026*
