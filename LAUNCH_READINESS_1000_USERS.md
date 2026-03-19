# HOCKIA — Launch Readiness for 1,000 Users (Go/No‑Go)

Date: 2025-12-11

This is a practical, testable checklist to answer: “Are we ready for 1,000 real users?”

## 1) Product Quality (User-Facing)

**Go criteria (must-have)**
- Mobile navigation is reliable across all dashboard pages (menu visible, tappable; no clipped dropdowns).
- Role/label correctness across profile surfaces (no misleading pills like wrong “Open to …” copy).
- Dates/timestamps are consistently formatted and correct (no future dates, negative ages, wrong ordering).
- Critical flows are stable:
  - Sign up → complete profile → land on correct dashboard
  - Player: browse opportunities → view details → apply
  - Club: view vacancy applicants
  - Messaging: send/receive, unread state, and conversation list correctness

**Signals we should not ignore**
- “Works on desktop, breaks on iOS” regressions.
- Copy/label mistakes (trust/correctness issues) on the primary profile screen.
- Any UI state that opens but is invisible (clipping/z-index/overflow).

## 2) Reliability & Error Handling

**Go criteria (must-have)**
- Centralized error monitoring (e.g., Sentry) with alerts for:
  - auth failures
  - API errors spikes
  - client crashes / unhandled rejections
- A clear fallback UI for failures (network down, Supabase hiccup, RPC errors).
- No console errors on core routes in typical use.

## 3) Performance

**Go criteria (must-have)**
- Baseline measurements recorded for:
  - landing / dashboard initial render
  - opportunities list load and filter interactions
  - messaging view load
- Confirm mobile performance is acceptable (no long main-thread blocks; acceptable scroll).

## 4) Security & Abuse Readiness

**Go criteria (must-have)**
- Rate limits or abuse controls for sign-in/sign-up and messaging endpoints.
- No sensitive tokens persisted or exposed in client logs.
- RLS policies validated for user data access boundaries.

### Identity, Visibility & Role Structure Cleanup (Non-Disruptive) — A–D Record

Date: 2025-12-12

**A) Summary of fixes applied (non-breaking)**
- Added network-view route aliases for member profiles: `/members/:username` and `/members/id/:id` (old `/players/*` and `/clubs/*` routes left intact).
- Fixed a dead unauthenticated redirect in references messaging CTA (`/sign-in` → `/`).
- Aligned UI semantics away from “Public” toward “Network / HOCKIA members” across banners and dashboard CTAs.
- Reduced accidental sensitive exposure:
  - Network-view profile fetches no longer select `email`.
  - Contact email display logic no longer falls back to account/login email.
- Tightened role/field integrity in the edit modal (club-facing labels and fields).

**B) Before → After logic (what changed, concretely)**
- **Profile visibility semantics**
  - Before: UI used “Public View” wording and some CTAs routed to `/players/id/:id` despite the product rule that profiles are network-only.
  - After: UI uses “Network View” wording; primary CTAs route to `/members/id/:id` (while keeping old routes to avoid breaking existing links).
- **Unauthenticated messaging CTA (references)**
  - Before: attempted to send users to `/sign-in` (dead route), undermining trust.
  - After: sends users to `/` with a clear toast (“Sign in to message HOCKIA members.”).
- **Contact email visibility**
  - Before: if a user enabled “show email” but left `contact_email` blank, the system could fall back to the account/login email (unintended exposure).
  - After: only an explicitly saved `contact_email` can be displayed; account/login email is never displayed in network views.

**C) Risk / blast radius**
- Users who previously relied on fallback-to-login-email may become less reachable until they set a `contact_email`.
- Mitigation: copy now explicitly communicates that contact email must be set to share it, and that login email is never shown.
- Compatibility: existing profile routes are preserved; `/members/*` is additive.

**D) Constraint confirmation (non-negotiables respected)**
- Opportunities and vacancies remain public and indexable (no changes to public routing or indexing posture).
- Profiles and dashboards remain network-only (still behind the auth gate); this cleanup only aligns naming, routing aliases, and data exposure.
- Verification: client unit tests are green (`npm test`).

## 5) Operations

**Go criteria (must-have)**
- Support playbook for common issues (login problems, profile stuck incomplete, missing data).
- Canary rollout plan (start with 50–100 users, then 1,000).
- Post-launch monitoring dashboard and on-call ownership.

## 6) Automated Evidence (What we should have in CI)

**Minimum E2E suite**
- Public smoke:
  - `/` landing loads
  - `/signup` role selection loads
  - `/opportunities` loads + unauth apply shows sign-in prompt
- Player smoke:
  - `/dashboard/profile` loads
  - dashboard menu is visible on mobile viewport
  - opportunities seeded vacancy flow works
- Club smoke:
  - applicants page for seeded vacancy loads
- Messaging smoke (next):
  - open conversation + send + verify received

## Recommendation

As of this date, **No-Go** until the “Product Quality” and “Automated Evidence” items are green and we have monitoring in place. The fastest path is:
1) lock mobile dashboard stability + labels + dates
2) add smoke E2E coverage for dashboard + messaging
3) roll out to 50–100 users for 1–2 weeks
