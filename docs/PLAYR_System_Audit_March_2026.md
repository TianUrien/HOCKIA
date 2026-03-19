# HOCKIA Platform System Audit

**Date:** March 6, 2026
**Auditor:** Lead Engineer
**Scope:** Full-system audit to evaluate readiness for the first 1,000 real users
**Method:** Direct codebase inspection of current `staging` branch

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Phase 1: Onboarding & Authentication](#2-phase-1-onboarding--authentication)
3. [Phase 2: Profile System (4 Roles)](#3-phase-2-profile-system-4-roles)
4. [Phase 3: Navigation & Layout](#4-phase-3-navigation--layout)
5. [Phase 4: Core Features](#5-phase-4-core-features)
6. [Phase 5: Cross-Feature Consistency](#6-phase-5-cross-feature-consistency)
7. [Phase 6: UX & UI Quality](#7-phase-6-ux--ui-quality)
8. [Phase 7: System Reliability & Performance](#8-phase-7-system-reliability--performance)
9. [Phase 8: Data Model & Backend Logic](#9-phase-8-data-model--backend-logic)
10. [Phase 9: Admin Portal](#10-phase-9-admin-portal)
11. [Phase 10: PWA & Cross-Device Behavior](#11-phase-10-pwa--cross-device-behavior)
12. [Consolidated Issue Tracker](#12-consolidated-issue-tracker)
13. [Recommended Fix Order](#13-recommended-fix-order)
14. [Product Readiness Evaluation](#14-product-readiness-evaluation)

---

## 1. Executive Summary

HOCKIA is a field hockey marketplace and community platform with 4 user roles (Player, Coach, Club, Brand), built on React 18 + Vite + Tailwind (frontend) and Supabase (backend). The platform includes ~55 routes, 18 edge functions, 58+ database tables, and a comprehensive set of features including messaging, opportunities marketplace, AI-powered search, community Q&A, and a world directory.

**Overall Assessment: 7.5/10 -- Conditionally Ready for Launch**

The platform is architecturally sound and feature-rich. The auth system, messaging, opportunities marketplace, and home feed are production-grade. However, there are 6 critical issues and 35 medium issues that should be addressed before or immediately after acquiring the first 1,000 users. None of the critical issues are showstoppers that would prevent launch, but they represent real security and UX risks at scale.

**Key Strengths:**
- Robust auth with 3-tier role recovery, PKCE, session expiry handling
- Comprehensive error boundaries on every route with Sentry integration
- Database-backed rate limiting (not just client-side)
- Real-time messaging with read receipts, rate limiting, idempotency
- Well-structured code splitting and PWA configuration
- 18 edge functions with consistent patterns

**Key Weaknesses:**
- Password change does not verify current password (security)
- Shared notification toggle loading state (UX bug)
- Brand role significantly underdeveloped vs other 3 roles
- 51 `as any` type casts indicating stale generated types
- Rate limiting identifier is session-based, not IP-based (bypassable)

---

## 2. Phase 1: Onboarding & Authentication

### Scope
Signup flow, email verification, auth callback, profile completion, role selection, and the complete journey from landing page to first authenticated view.

### Key Files Inspected
- `client/src/pages/SignUp.tsx` -- Role selection + email/password signup
- `client/src/pages/AuthCallback.tsx` -- PKCE exchange with 30s polling fallback
- `client/src/pages/CompleteProfile.tsx` -- Post-verification onboarding form
- `client/src/pages/VerifyEmail.tsx` -- Verification instructions page
- `client/src/lib/auth.ts` -- Zustand auth store with session management
- `client/src/lib/rateLimit.ts` -- Client-side rate limit wrappers
- `client/src/components/ProtectedRoute.tsx` -- Route guard

### Findings

**[C-01] CRITICAL: Rate Limit Identifier is Bypassable**
File: [rateLimit.ts:20-29](client/src/lib/rateLimit.ts#L20-L29)

The `getClientIdentifier()` function generates a random UUID stored in `sessionStorage`. This means:
- Opening a new tab/incognito window generates a new identifier
- The rate limit can be trivially bypassed by clearing sessionStorage
- The comment on line 23 acknowledges this: "In production, this should be enhanced with server-side IP detection"

The RPCs (`check_login_rate_limit`, `check_signup_rate_limit`) accept `p_ip` as a parameter from the client -- the server trusts whatever the client sends. This is effectively no rate limiting for a motivated attacker.

**Impact:** An attacker could brute-force login or flood signups without hitting any limit.

**[M-01] MEDIUM: No Draft Persistence in CompleteProfile**
File: `client/src/pages/CompleteProfile.tsx`

The main onboarding form (for player/coach/club) does NOT persist drafts to localStorage, unlike `EditProfileModal` which uses `profileDrafts.ts` with 400ms debounced auto-save. If a user accidentally navigates away mid-onboarding, all progress is lost.

The brand onboarding form (`BrandOnboardingPage`) DOES have draft persistence, creating an inconsistency.

**[M-02] MEDIUM: Placeholder Profile Creation Race Condition**
File: [auth.ts:122-163](client/src/lib/auth.ts#L122-L163)

When `fetchProfile` returns null, the store attempts to create a "placeholder profile" using metadata from the user object. If the metadata (`role`, `email`) is not yet available (line 162), it silently fails with a log error. The 3-tier fallback (metadata -> localStorage -> profile record) is robust, but there's a window where a user could land in a broken state if all 3 fail.

**[C-06] CRITICAL: CompleteProfile Mutex Never Released on Error**
File: `client/src/pages/CompleteProfile.tsx` (lines 41, 114-179)

The profile creation flow uses a mutex ref to prevent concurrent submissions. Once acquired (`profileCreationMutexRef.current = true`), it is **intentionally never reset** -- even on error. The code comment says "We intentionally do NOT release the mutex on success," but there's also no release on failure.

Real scenario:
1. User clicks submit
2. Mutex acquired
3. Network error mid-save
4. Error caught, but mutex stays `true`
5. User clicks submit again -- silently returns (no error shown, no submission)
6. User is stuck -- can never complete onboarding without refreshing

This is a **blocking bug** for any user who hits a transient network error during onboarding.

**[M-25] MEDIUM: CompleteProfile Prefill Race Condition**
File: `client/src/pages/CompleteProfile.tsx` (lines 225-280)

Profile prefilling uses a `useRef` flag (`profilePrefilledRef`) that guards execution only once. If the auth store hasn't fetched the profile yet when the effect first runs, `profile` is null and the effect exits. When profile data arrives later, `profilePrefilledRef.current` is already `true`, so **prefill is skipped**.

Consequence: User sees empty form even though their profile data exists on the server. Submitting could overwrite saved data.

**[M-26] MEDIUM: Email Leaked in Browser History on "Already Registered" Redirect**
File: `client/src/pages/SignUp.tsx` (lines 94-96)

```
navigate(`/?email=${encodeURIComponent(formData.email)}`)
```

When a user tries to sign up with an existing email, they're redirected to the login page with the email in the URL. This leaks the email into browser history and could expose it if the browser is shared or history is synced.

**[I-01] MINOR: Auth Callback 30-Second Timeout**
File: `client/src/pages/AuthCallback.tsx`

The PKCE exchange polls at 500ms intervals for up to 60 attempts (30s). This is generous and handles slow email providers well. The fallback to implicit flow is a good safety net. No issues found here -- this is well-engineered.

**[I-02] MINOR: ProtectedRoute PUBLIC_ROUTES Uses startsWith**
File: [ProtectedRoute.tsx:10](client/src/components/ProtectedRoute.tsx#L10)

The `PUBLIC_ROUTES` array uses `startsWith` matching, which means `/opportunities` also matches `/opportunities-admin` if such a route existed. Currently safe because no such routes exist, but worth noting for future route additions.

### Onboarding Verdict: 7/10
The auth flow is well-engineered with multiple fallbacks. However, the mutex bug in CompleteProfile is a real blocker -- any user who hits a network error during onboarding is stuck until they refresh. The prefill race condition can cause data overwrite.

---

## 3. Phase 2: Profile System (4 Roles)

### Scope
All 4 role dashboards, profile editing, profile strength calculation, public profile views, and cross-role feature parity.

### Key Files Inspected
- `client/src/pages/PlayerDashboard.tsx` -- 5 tabs, 7 strength buckets
- `client/src/pages/CoachDashboard.tsx` -- 6 tabs, 6 strength buckets
- `client/src/pages/ClubDashboard.tsx` -- 6 tabs, 4 strength buckets
- `client/src/pages/BrandDashboard.tsx` -- 5 tabs, 6 strength buckets
- `client/src/components/EditProfileModal.tsx` -- Unified edit for player/coach/club
- `client/src/hooks/useProfileStrength.ts` -- Player strength calculation
- `client/src/hooks/useCoachProfileStrength.ts` -- Coach strength calculation
- `client/src/hooks/useBrandProfileStrength.ts` -- Brand strength calculation

### Findings

**[C-02] CRITICAL: EditProfileModal Excludes Brand Role**
File: [EditProfileModal.tsx:22-26](client/src/components/EditProfileModal.tsx#L22-L26)

```typescript
interface EditProfileModalProps {
  isOpen: boolean
  onClose: () => void
  role: 'player' | 'coach' | 'club'  // Brand NOT supported
}
```

Brand users have a completely separate editing flow (`BrandForm` inside `BrandDashboard`). This means:
- Brand profile editing is inline (not modal), creating UX inconsistency
- Brand users don't get draft persistence from `profileDrafts.ts`
- Any future shared edit features must be duplicated

**[M-03] MEDIUM: Brand Role Feature Gap (5/10 maturity)**
The Brand dashboard has 5 tabs (overview, products, posts, ambassadors, followers) but is significantly behind other roles:
- Cannot initiate messages (only receive)
- No reviews system
- No analytics beyond basic follower count
- No brand-to-brand connections
- Followers tab fetches via raw RPC with `as any` cast

At 1,000 users, if even 5-10% are brands, the thin experience could cause churn.

**[M-04] MEDIUM: 51 `as any` Type Casts Across 24 Files**
Files: Multiple (see grep results)

The generated `database.types.ts` is stale -- columns added by migrations (denormalized counts, notification preferences, etc.) are accessed via `as any` or `as unknown as` casts. This is a maintenance hazard:
- No compile-time safety for these fields
- Refactoring is error-prone
- Contributors won't know which fields are real vs cast

Key offenders: `useHomeFeed.ts` (2), `useUserPosts.ts` (5), `useBrandAmbassadors.ts` (3), `usePostInteractions.ts` (4).

**[M-18] MEDIUM: CoachDashboard Missing Self-Message Guard**
File: `client/src/pages/CoachDashboard.tsx` (lines 145-209)

Unlike PlayerDashboard (which checks `user.id === profileData.id` before allowing messaging), CoachDashboard does NOT prevent a coach from trying to message themselves. This results in a database error instead of a user-friendly toast. ClubDashboard has the check but doesn't block brand users from seeing the message button (inconsistent with PlayerDashboard which hides it for brands).

**[M-19] MEDIUM: Club Profiles Have No References Section**
Files: `PlayerDashboard.tsx:634`, `CoachDashboard.tsx:550`, `ClubDashboard.tsx` (absent)

Player and Coach profiles prominently display `<PublicReferencesSection />` for trust signals. Club profiles completely omit this section. If references are the platform's core trust infrastructure ("core moat"), clubs -- who are the primary CONSUMERS of reference data -- should also be able to receive references (e.g., from coaches or players who worked with them).

**[M-20] MEDIUM: EditProfileModal Validation Only Checks Players**
File: [EditProfileModal.tsx:87-99](client/src/components/EditProfileModal.tsx#L87-L99)

The `validateFormData` function only validates player-specific fields (primary vs secondary position, social links). For coach and club roles, no required field validation runs at all. A coach could submit an empty form. No validation that dual nationalities differ.

**[I-03] MINOR: Profile Strength Weights Vary by Role**
Player uses 7 buckets (basic 15%, photo 15%, video 20%, journey 15%, gallery 10%, friends 10%, references 15%). Coach uses 6 buckets. Club uses 4 buckets. Brand uses 6 buckets. The different granularity means profile strength percentages are not comparable across roles.

**[I-18] MINOR: Profile Strength Toast Inconsistency Across Roles**
PlayerDashboard shows "+5%. Keep going!" (motivational delta). CoachDashboard and ClubDashboard show bare percentage ("50%"). BrandDashboard has no toast at all. Inconsistent motivational feedback.

**[I-19] MINOR: No "Unsaved Changes" Warning in EditProfileModal**
File: `client/src/components/EditProfileModal.tsx`
User can close the modal after making changes without confirmation. Drafts auto-save to localStorage (mitigating data loss), but no visual warning that changes will be lost if they don't save.

### Profile System Verdict: 6.5/10
Player and Coach dashboards are mature. Club is solid. Brand is the clear weak link. The `as any` epidemic needs a `supabase gen types` refresh.

---

## 4. Phase 3: Navigation & Layout

### Scope
Header, mobile bottom nav, layout structure, route organization, responsive behavior, and navigation consistency.

### Key Files Inspected
- `client/src/components/Header.tsx` -- Fixed top nav (desktop + mobile)
- `client/src/components/MobileBottomNav.tsx` -- Fixed bottom nav (mobile only)
- `client/src/App.tsx` -- Route definitions (~55 routes)
- `client/src/components/Layout.tsx` -- Wrapping layout component

### Findings

**[M-05] MEDIUM: Duplicate Navigation Logic**
Files: [Header.tsx](client/src/components/Header.tsx), [MobileBottomNav.tsx](client/src/components/MobileBottomNav.tsx)

Both components independently:
- Compute `isActive(path)` with identical logic (line 72 in Header, line 59 in MobileBottomNav)
- Track keyboard visibility (MobileBottomNav only)
- Maintain separate hidden-route lists (MobileBottomNav line 85)
- Both import and use `useOpportunityNotifications` and `useNotificationStore`

This creates a risk of navigation inconsistency if one is updated without the other. Desktop nav has: Home, World, Opportunities, Community, Messages, Discover, Notifications, Dashboard. Mobile bottom nav has: Home, World, Opportunities, Community, Dashboard. Mobile top has: Discover, Messages, Notifications.

**[I-04] MINOR: Header Height CSS Custom Properties**
File: [Header.tsx:28-65](client/src/components/Header.tsx#L28-L65)

The Header dynamically sets `--app-header-height` and `--app-header-offset` CSS custom properties via ResizeObserver. This is a good pattern for handling dynamic header sizing, but the fallback when ResizeObserver is unavailable (older browsers) just calls `updateHeaderMetrics()` once on mount -- no ongoing updates.

**[I-05] MINOR: MobileBottomNav Keyboard Detection Threshold**
File: [MobileBottomNav.tsx:72](client/src/components/MobileBottomNav.tsx#L72)

The 150px threshold for keyboard detection (`heightDiff > 150`) is hardcoded. On smaller devices or with split keyboards, this could misfire. The approach itself (visualViewport comparison) is the correct modern approach.

### Navigation Verdict: 8/10
Clean responsive behavior. The dual-component navigation is the main concern. Header CSS property approach is well-done.

---

## 5. Phase 4: Core Features

### 5.1 Messaging (8/10)

**Key Files:** `MessagesPage.tsx`, `ChatWindowV2`, `useChat`, `MessageList.tsx`

Strengths:
- Realtime with 200ms debounce to prevent render storms
- Server-side rate limiting (30/min + 100/hr via DB trigger)
- Read receipt batching
- IntersectionObserver for scroll-based message loading
- Page size of 25 with pagination

**[M-13] MEDIUM: Conversation Realtime Updates May Reorder Incorrectly**
File: `client/src/pages/MessagesPage.tsx` (lines 454-474)

When a conversation is updated via realtime, conversations are re-sorted by `last_message_at || updated_at`. However, the realtime payload (`payload.new`) may not have these timestamps populated correctly if the update doesn't touch those columns. This causes conversations to get stuck in wrong positions until the next full refresh.

**[M-14] MEDIUM: Read Receipt Flush Race on Unmount**
File: `client/src/hooks/useChat.ts` (lines 824-832)

On unmount, `flushPendingReadReceipts()` is called via useEffect cleanup. But if a new message arrives between the user closing the chat and the cleanup firing, `queueReadReceipt` may be called after teardown, and the message won't be marked as read.

**[I-06] MINOR: Old ChatWindow.tsx Still Present**
Both `ChatWindow.tsx` and the `features/chat-v2/` directory exist. The old component still has an IntersectionObserver setup (line 93). Dead code should be cleaned up.

### 5.2 Opportunities Marketplace (8.5/10)

**Key Files:** `OpportunitiesPage.tsx`, `OpportunityDetailPage.tsx`, `ApplicantsList.tsx`

Strengths:
- 7-dimension filtering (role, position, gender, location, level, compensation, search)
- URL param sync for filter persistence
- Grid/list toggle view
- 4-tier applicant management (pending, shortlisted, accepted, declined)
- Dual-role support (coaches can both post and apply)

**[M-15] MEDIUM: Opportunities Not Searchable from Global Search**
File: `client/src/hooks/useSearch.ts`
The `search_content` RPC returns posts, people, clubs, and brands -- but NOT opportunities. Users must navigate to the dedicated Opportunities page to search vacancies. This is a significant discovery gap -- with 1,000 users, opportunities are a primary reason to visit the platform.

**[M-16] MEDIUM: Closed Opportunities Show "Not Found" Instead of "Closed"**
File: `client/src/pages/OpportunityDetailPage.tsx` (lines 59-61)
The detail query filters `eq('status', 'open')`. If a user bookmarked an opportunity that later closed, they see "Opportunity Not Found" with no explanation. Should show "This opportunity has closed" with a link back to the listings.

### 5.3 Home Feed (8/10)

**Key Files:** `useHomeFeed.ts`, `HomeFeed.tsx`, `FeedVideoPlayer.tsx`

Strengths:
- True infinite scroll via IntersectionObserver (only feature with this)
- 7 feed types with optimistic likes
- New posts banner with RPC-based detection (5s cooldown)
- 10s query timeout for resilience

**[M-06] MEDIUM: Cold Start Problem**
When a new user completes onboarding and lands on `/home`, the feed is likely empty -- they have no connections, no followed content. There's no onboarding prompt, suggested follows, or discovery guidance on the home page. The user sees a blank feed.

### 5.4 Community / Q&A (7/10)

**Key Files:** `CommunityPage.tsx`, `QuestionsListView.tsx`, `QuestionCard.tsx`

Strengths:
- 6 tab types (all, players, coaches, clubs, brands, questions)
- Search with 500ms debounce
- Category filtering and sorting
- Sign-in prompt for unauthenticated actions

**[M-07] MEDIUM: Manual "Load More" Pagination**
File: [QuestionsListView.tsx:210-219](client/src/components/community/QuestionsListView.tsx#L210-L219)

Community pages use manual "Load More" buttons instead of infinite scroll. With 1,000+ users generating content, this creates friction vs. the infinite scroll experience on the Home feed.

### 5.5 Search & Discover (7.5/10)

**Key Files:** `SearchPage.tsx`, `useSearch.ts`, `DiscoverPage.tsx`, `useDiscover.ts`

Strengths:
- Search uses `useInfiniteQuery` with proper pagination
- Discover (AI) uses visual viewport tracking for iOS keyboard
- Conversation history (last 10 turns) in Discover
- Example queries for onboarding

**[I-08] MINOR: Search Missing Autocomplete**
No typeahead/autocomplete as the user types. Search only triggers on explicit submission or debounced input.

### 5.6 World Directory (7.5/10)

Strengths:
- Country -> Province (optional) -> League -> Club hierarchy
- 135 clubs across 8 countries
- Daily club shuffle for discovery
- Club claiming flow with world integration

### 5.7 Notifications (7.5/10)

**Key Files:** `NotificationsDrawer.tsx`, `lib/notifications.ts`

Strengths:
- Unified Zustand store (single source of truth)
- Realtime channel subscription
- Auto mark-all-read on drawer open
- Inline friend/ambassador request actions

**[M-17] MEDIUM: ApplicantsList Reference Fetch Silently Fails**
File: `client/src/pages/ApplicantsList.tsx` (lines 135-188)

Reference data fetch is wrapped in try-catch with silent failure. If it fails, `referenceMap` stays empty -- clubs see applicants WITHOUT reference counts or endorsements, and no error indicator is shown. Since references are the platform's core trust signal ("core moat"), silently hiding them from the club's applicant management view undermines the platform's key differentiator.

**[I-07] MINOR: Search Tab Filters Don't Persist on Reload**
File: `client/src/pages/SearchPage.tsx` (lines 42-47)
URL params update the query string but don't persist the active tab. On refresh, users return to the default tab instead of the one they were viewing.

**[I-09] MINOR: No Notification Preferences Granularity for In-App**
Settings page controls EMAIL notification preferences (opportunities, applications, friends, references, messages). But there's no way to control which IN-APP notifications appear. All types are shown.

### Core Features Verdict: 7.5/10
Messaging and Opportunities are standout features. The cold start problem and pagination inconsistency are the main gaps.

---

## 6. Phase 5: Cross-Feature Consistency

### Findings

**[M-08] MEDIUM: Inconsistent Pagination Strategy**
- Home Feed: True infinite scroll (IntersectionObserver)
- Brand Feed: Infinite scroll (useInfiniteQuery)
- Profile Posts: Infinite scroll (useInfiniteQuery)
- Search: Infinite scroll (useInfiniteQuery)
- Community People/Clubs/Brands: Manual "Load More"
- Community Questions: Manual "Load More"
- Notifications: All loaded at once (no pagination visible)

The inconsistency between infinite scroll on some pages and manual loading on others is a UX friction point. Users will expect infinite scroll everywhere once they experience it on the Home feed.

**[M-09] MEDIUM: Notification Toggle Shared Loading State**
File: [SettingsPage.tsx:51](client/src/pages/SettingsPage.tsx#L51)

All 5 notification toggles share a single `notificationLoading` boolean. When toggling one preference:
- ALL toggles show loading spinners simultaneously
- Rapid toggling of different preferences creates visual confusion
- The toggle button shows a spinner instead of the toggle knob for ALL toggles

Each toggle handler (lines 71-209) independently sets `setNotificationLoading(true)`. If a user quickly toggles "Opportunities" then "Messages", both spinners activate and the first one's `finally` block clears loading for all.

**[I-10] MINOR: Inconsistent Empty States**
Some empty states have illustrations and CTAs (Questions, Opportunities), while others are plain text. No standardized empty state component exists.

### Cross-Feature Consistency Verdict: 7/10
The main issues are pagination inconsistency and the shared notification loading state.

---

## 7. Phase 6: UX & UI Quality

### Findings

**[C-03] CRITICAL: Password Change Does Not Verify Current Password**
File: [SettingsPage.tsx:229-271](client/src/pages/SettingsPage.tsx#L229-L271)

The password change form collects `currentPassword` (line 37) and renders an input for it (line 431), but the `handlePasswordChange` function (line 247) only sends the NEW password to Supabase:

```typescript
const { error } = await supabase.auth.updateUser({
  password: passwordForm.newPassword,
})
```

The `currentPassword` field is collected but NEVER sent or verified. This means:
- If a session is hijacked, the attacker can change the password without knowing the current one
- The form gives users a FALSE sense of security by asking for the current password

Supabase's `updateUser` does NOT require the current password by default -- it relies on the JWT being valid. The current password field is UX theater.

Good: Line 255 signs out all OTHER sessions after password change.

**[M-10] MEDIUM: No Email Change Flow**
File: [SettingsPage.tsx:418-419](client/src/pages/SettingsPage.tsx#L418-L419)

```
Contact support to change your email
```

Users cannot change their own email. They must contact `team@inhockia.com`. At 1,000 users, this creates manual support burden. Supabase supports email change via `updateUser({ email })` with confirmation.

**[I-11] MINOR: Form Validation is Minimal**
Password change only validates length >= 8 and match. No complexity requirements (uppercase, number, special char). No real-time validation feedback as the user types.

**[I-12] MINOR: Only One `dangerouslySetInnerHTML` Usage**
File: `client/src/components/OpportunityJsonLd.tsx`

Used for JSON-LD structured data injection, which is the correct use case. No XSS risk. All other user content rendering uses React's built-in escaping.

### UX/UI Verdict: 7/10
The password verification gap is the biggest concern. The rest of the UI is clean and well-crafted.

---

## 8. Phase 7: System Reliability & Performance

### Findings

**[M-11] MEDIUM: Rate Limiting Fails Open**
File: [rateLimit.ts:44-47](client/src/lib/rateLimit.ts#L44-L47)

Every rate limit check function returns `null` on error, and callers treat `null` as "allow the request":

```typescript
if (error) {
  logger.error('[RATE_LIMIT] Login rate limit check failed', { error })
  return null  // On error, allow the request (fail open)
}
```

This is intentional (fail-open to not block legitimate users) but means that if the rate limit RPC is down or slow, ALL rate limiting is disabled.

**Performance Architecture (Positive Findings):**

- **Code Splitting:** Vite config has 6 manual chunk groups (react, supabase, tanstack, state, icons, datetime) plus a vendor catch-all. All heavy pages are lazy-loaded via `React.lazy`.
- **Bundle Warning Limit:** Set to 700KB (`chunkSizeWarningLimit: 700`).
- **Caching Strategy:** PWA service worker uses NetworkFirst for Supabase API calls (5min cache), CacheFirst for images (30 days) and fonts (1 year).
- **Query Timeouts:** Home feed has a 10s timeout via `withTimeout()`.
- **Request Deduplication:** Auth store uses `requestCache.dedupe()` to prevent duplicate profile fetches.
- **Image Optimization:** Avatar uploads use `optimizeAvatarImage` (imported in EditProfileModal).

**Error Handling (Positive Findings):**

- Every major route wrapped in `<ErrorBoundary>` with route-specific fallback
- Root-level `Sentry.ErrorBoundary` with `RootErrorFallback`
- Stale asset detection (post-deploy module load failures) with user-friendly "HOCKIA has been updated" message
- All 18 edge functions instrumented with Sentry
- Auth store has comprehensive breadcrumbing for Sentry traces

**[I-13] MINOR: Test Coverage Thresholds are Low**
File: [vite.config.ts:151-156](client/vite.config.ts#L151-L156)

```
lines: 27, functions: 27, branches: 28, statements: 27
```

27-28% coverage thresholds are very low. For a platform handling real user data and financial transactions (opportunity applications), coverage should be at least 50-60% for critical paths (auth, messaging, payment-adjacent flows).

### Reliability Verdict: 8/10
The architecture is solid. Rate limiting is the weak point. Error handling and monitoring are excellent.

---

## 9. Phase 8: Data Model & Backend Logic

### Findings

**18 Edge Functions:**
`admin-actions`, `admin-send-campaign`, `admin-send-test-email`, `delete-account`, `health`, `nl-search`, `notify-application`, `notify-friend-request`, `notify-message-digest`, `notify-onboarding-reminder`, `notify-reference-request`, `notify-test-application`, `notify-test-vacancy`, `notify-vacancy`, `public-opportunities`, `resend-webhook`, `send-push`, `sitemap`

**[M-12] MEDIUM: No Idempotency Guard on Vacancy Notification Sends**
The `notify-vacancy` edge function sends email notifications when a new vacancy is published. If the webhook triggers twice (Resend/Svix duplicate delivery), users could receive duplicate emails. No idempotency key or deduplication check is present.

**Database Architecture (Positive Findings):**
- 227+ migrations indicates a mature, well-evolved schema
- Connection pooling configured (transaction mode, pool 20, max 200)
- Advisory lock-based rate limiting at the DB level
- Comprehensive RLS policies (every table inspected has RLS enabled)
- 60+ RPCs for complex operations (avoids raw client queries)
- 25+ triggers for denormalization and side effects
- `pg_cron` for scheduled maintenance (digests, archival, pruning, storage cleanup)

**[M-30] MEDIUM: File Upload Validation is Client-Side Only**
Files: `client/src/lib/imageOptimization.ts` (lines 452-476), `supabase/migrations/202512141000_security_hardening.sql` (lines 15-22)

Image and video upload validation (file extension, MIME type, file size) happens entirely in the browser via `validateImage()`. The Supabase storage RLS policy only checks path ownership (`split_part(name, '/', 1) = auth.uid()`) -- it does NOT validate file types server-side. An attacker can bypass client validation using browser dev tools and upload arbitrary files (e.g., `.exe` with fake `image/jpeg` MIME type) to storage buckets that have public read policies (gallery_photos, club_media).

**[I-14] MINOR: `security_invoker = true` Maintenance Risk**
The `public_opportunities` view requires `security_invoker = true`. Any `CREATE OR REPLACE VIEW` statement resets this to `SECURITY DEFINER`, potentially exposing data. A migration (`202512101000_fix_security_definer_views.sql`) has already addressed this, but it's a recurring risk for future view modifications.

**RLS & Security Audit (Positive Findings):**
- All user-facing tables have RLS enabled with proper policies
- No `dangerouslySetInnerHTML` in user content rendering (1 safe usage in JSON-LD)
- No raw SQL -- all queries use Supabase client library methods (`.eq()`, `.insert()`, etc.)
- Sentry PII scrubbing in place (`main.tsx` lines 114-131)
- Storage upload policies enforce user-folder ownership
- No XSS or SQL injection vectors found

**[M-31] MEDIUM: ILIKE Wildcard Injection in Brand Search RPCs**
File: `supabase/migrations/202601291003_brands_rpc_functions.sql`

Brand search RPCs use `ILIKE '%' || p_query || '%'` with unsanitized user input. A user submitting `%` or `_` as search terms matches all rows (Postgres ILIKE wildcards). Not a SQL injection risk (parameterized), but allows data enumeration -- a user can retrieve the full brand directory by searching `%`. Should escape `%` and `_` characters in the input before interpolation.

**[M-32] MEDIUM: admin-send-campaign Edge Function Has No Rate Limiting**
File: `supabase/functions/admin-send-campaign/index.ts`

The campaign email sender has no rate limiting or send-count cap. An admin (or compromised admin session) can trigger unlimited email sends to the entire user base. At minimum, should enforce a daily send cap and require a confirmation step for campaigns targeting >100 recipients.

### Data Model Verdict: 8/10
The backend is well-architected. The vacancy notification idempotency gap, client-only file upload validation, and ILIKE wildcard injection are the main concerns.

---

## 10. Phase 9: Admin Portal

### Findings

The admin portal includes 18+ pages covering KPIs, user management, email campaigns, outreach, world CRUD, and system monitoring. However, deep inspection reveals significant gaps.

**[C-05] CRITICAL: 4 Missing Admin Pages (404 in Production)**
File: `client/src/components/admin/AdminLayout.tsx` (nav items at lines 40-54)

The admin sidebar navigation links to 4-5 pages that DO NOT EXIST:
- `/admin/opportunities` -- No `AdminOpportunities.tsx` page. Cannot track vacancy fill rates, application pipeline, or time-to-close.
- `/admin/feature-usage` -- No backing page. Cannot identify underused features.
- `/admin/outreach` -- No page. Nav link will 404.
- `/admin/investors` -- No page. Nav link will 404.
- `/admin/settings` -- No implementation. Cannot configure rate limits, email templates, or thresholds without code deploys.

These broken links exist in the production admin UI. Any admin clicking them hits a crash or blank page.

**[M-21] MEDIUM: No Audit Trail for Admin Actions**
Admin actions (block/unblock users, delete orphan profiles, force-claim clubs) are executed with no logged reason, timestamp, or admin identity beyond the optional `blockReason` field. At 1,000+ users, it will be impossible to trace who modified what and when.

The `admin_log_action()` function exists in the database, but migrations don't show triggers that automatically log admin RPC calls. Logging depends on each Edge Function manually calling it -- easy to forget.

**[M-22] MEDIUM: Admin Dashboard Performance at Scale**
Each admin dashboard load runs 15+ COUNT(*) subqueries (profiles, vacancies, applications by status). Multiple tabs (Overview, Players, Clubs) each call separate stat functions. No caching or materialized views. At 1,000 users this is likely fine, but at 5,000+ it will noticeably slow down.

Missing indexes: `(role, created_at, onboarding_completed)` for funnel queries; admin player funnel runs 7 separate queries.

**[M-23] MEDIUM: Admin Search Capped at 20 Results, No Bulk Operations**
File: `client/src/pages/admin/AdminDirectory.tsx` (line 40)

Admin directory search returns max 20 results. Common admin task (e.g., "find all profiles with 'test' in email") is impossible if >20 match. No CSV export or bulk filtering capability.

**[M-24] MEDIUM: Admin Deletion is Irreversible Without Warning**
`deleteOrphanProfile()` hard-deletes from the profiles table. No soft-delete, no undo capability, no backup confirmation. The only safeguard is database-level backups. The "Data Issues" scan page also only allows one-by-one deletion of orphan records -- no batch cleanup.

**[I-15] MINOR: Admin Access Server-Enforced (Positive)**
Admin access is controlled by `AdminGuard` + `is_platform_admin()` RLS check. However, the guard doesn't check for session expiry mid-navigation -- if an admin session expires while the portal is open, they continue to see cached admin pages until the next API call fails.

**[I-20] MINOR: Admin World Club Force-Claim Validation Gap**
`forceClaimWorldClub()` accepts any UUID-format string but only validates format (regex), not whether the UUID corresponds to an actual existing profile with role='club'. Could silently create orphaned club ownership.

### Admin Verdict: 6/10
The existing admin pages are functional, but 4 broken nav links, no audit logging, and no bulk operations significantly limit operational readiness.

---

## 11. Phase 10: PWA & Cross-Device Behavior

### Findings

**PWA Configuration (Positive Findings):**
- `VitePWA` plugin with `registerType: 'prompt'` (user controls updates)
- Custom manifest.json (not auto-generated)
- Push notification support via `push-sw.js` imported into the service worker
- `navigateFallback` to `/index.html` for SPA routing
- `clientsClaim: true` ensures updated SW takes control
- `skipWaiting: false` -- user-prompted updates prevent mid-session breakage

**Responsive Design (Positive Findings):**
- Mobile bottom nav hidden on keyboard open (visualViewport detection)
- Safe area insets used throughout (`env(safe-area-inset-bottom)`, `env(safe-area-inset-top)`)
- `md:hidden` / `hidden md:flex` breakpoints for mobile/desktop nav switching
- DiscoverPage uses `100dvh` for proper mobile viewport handling

**[M-27] MEDIUM: Mobile Header Buttons Missing Accessibility Labels**
File: `client/src/components/Header.tsx` (lines 103-130)

Mobile header discovery/messages/notifications buttons are icon-only with NO `aria-label` attributes. Screen reader users cannot identify these buttons. Additionally, touch targets are only ~24px (`p-2` padding) -- well below the WCAG AA minimum of 44x44px. Desktop nav has proper text labels.

**[M-28] MEDIUM: Install Prompt Covers Bottom Navigation**
File: `client/src/components/InstallPrompt.tsx` (lines 168, 207)

Both iOS Safari and standard install prompts are positioned at `bottom-20` (fixed 80px from bottom), overlapping the bottom nav. Users cannot access Home/World/Opportunities tabs while the install prompt is shown. Must dismiss prompt to navigate.

**[M-29] MEDIUM: NotificationsDrawer Missing aria-labelledby and Safe Area Handling**
File: `client/src/components/NotificationsDrawer.tsx` (lines 357-390)

Drawer sets `aria-modal` but no `aria-labelledby` pointing to the heading -- screen reader just announces "dialog" with no context. Also, the close button (`top-2 right-2`) sits behind the notch on iPhone 12+ since no safe area insets are applied to the drawer.

**[I-16] MINOR: No Dedicated Offline Page for First-Time Visitors**
The service worker has `navigateFallback: '/index.html'` and a route exists for `/offline`, but the offline experience depends on cached assets. Mitigated for returning users by aggressive caching.

**[I-17] MINOR: InstallPrompt Uses `as any` for Browser Event**
Standard TypeScript limitation for `beforeinstallprompt` event type.

**[I-21] MINOR: iOS Install Prompt Shows Android Icon**
File: `client/src/components/InstallPrompt.tsx` (line 179)
iOS Safari prompt renders an Android launcher icon instead of an iOS-specific asset.

**[I-22] MINOR: No Empty State for Zero Conversations in Messages**
When a new user opens Messages with no conversations, they see a blank list with no "Start a conversation" CTA or guidance.

**[M-33] MEDIUM: `user-scalable=no` Violates WCAG AA**
File: `client/index.html` (line 6)

The viewport meta tag sets `maximum-scale=1.0, user-scalable=no`, preventing users with low vision from zooming to 200%. This violates WCAG 2.1 Level AA Success Criterion 1.4.4 (Resize Text). Should change to `maximum-scale=2.0, user-scalable=yes` while keeping `viewport-fit=cover` for notch support.

**[M-34] MEDIUM: PWA Update Not Checked on Cold Load**
File: `client/src/main.tsx` (lines 46-98)

Service worker update polling starts after registration (every 15 min + on tab visibility change), but no update check runs on initial app load. If a user opens HOCKIA after a deploy, they use the stale cached version until the first polling interval fires. Should trigger an immediate update check on mount.

### PWA Verdict: 7/10
Good caching strategies and mobile-first design. Accessibility gaps in mobile header and notification drawer need attention. Install prompt positioning conflicts with navigation. Viewport zoom restriction violates WCAG AA.

---

## 12. Consolidated Issue Tracker

### Critical Issues (Fix Before Launch or Week 1)

| ID | Issue | File | Impact |
|------|-------|------|--------|
| C-01 | Rate limit identifier bypassable (session-based, not IP) | `rateLimit.ts:20-29` | Brute-force login/signup flooding |
| C-02 | EditProfileModal excludes Brand role | `EditProfileModal.tsx:22-26` | Brand UX inconsistency, no draft persistence |
| C-03 | Password change doesn't verify current password | `SettingsPage.tsx:229-271` | Session hijack -> full account takeover |
| C-04 | `as any` epidemic (51 casts, 24 files) from stale types | Multiple | Type safety, maintenance hazard |
| C-05 | 4 missing admin pages (404 in production nav) | `AdminLayout.tsx:40-54` | Broken admin navigation |
| C-06 | CompleteProfile mutex never released on error | `CompleteProfile.tsx:41-179` | User stuck, can't complete onboarding |

### Medium Issues (Fix Within First Month)

| ID | Issue | File | Impact |
|------|-------|------|--------|
| M-01 | No draft persistence in CompleteProfile | `CompleteProfile.tsx` | Onboarding data loss on accidental nav |
| M-02 | Placeholder profile creation race window | `auth.ts:122-163` | Edge case broken state |
| M-03 | Brand role feature gap (5/10 maturity) | `BrandDashboard.tsx` | Brand user churn |
| M-04 | 51 `as any` type casts | Multiple files | Type safety erosion |
| M-05 | Duplicate navigation logic | `Header.tsx`, `MobileBottomNav.tsx` | Drift risk |
| M-06 | Cold start: empty feed for new users | `HomePage.tsx` | First-impression failure |
| M-07 | Manual pagination on Community pages | `QuestionsListView.tsx` | UX friction vs infinite scroll elsewhere |
| M-08 | Inconsistent pagination across features | Multiple | UX inconsistency |
| M-09 | Shared notification toggle loading state | `SettingsPage.tsx:51` | Visual glitch on rapid toggling |
| M-10 | No self-service email change | `SettingsPage.tsx:418-419` | Support burden |
| M-11 | Rate limiting fails open | `rateLimit.ts:44-47` | Silent rate limit bypass on RPC failure |
| M-12 | No idempotency on vacancy notification sends | `notify-vacancy/index.ts` | Duplicate emails |
| M-13 | Conversation realtime reorder bug | `MessagesPage.tsx:454-474` | Wrong conversation order |
| M-14 | Read receipt flush race on unmount | `useChat.ts:824-832` | Unread messages after close |
| M-15 | Opportunities missing from global search | `useSearch.ts` | Discovery gap |
| M-16 | Closed opportunities show "Not Found" | `OpportunityDetailPage.tsx:59` | Confusing dead links |
| M-17 | Reference fetch silently fails in ApplicantsList | `ApplicantsList.tsx:135-188` | Trust signals hidden from clubs |
| M-18 | CoachDashboard missing self-message guard | `CoachDashboard.tsx:145-209` | DB error instead of toast |
| M-19 | Club profiles have no references section | `ClubDashboard.tsx` | Trust infrastructure gap |
| M-20 | EditProfileModal validation only checks players | `EditProfileModal.tsx:87-99` | Coach/club can submit empty forms |
| M-21 | No audit trail for admin actions | Multiple admin pages | Cannot trace who did what |
| M-22 | Admin dashboard 15+ COUNT queries, no caching | Admin RPCs | Slow at scale |
| M-23 | Admin search capped at 20 results | `AdminDirectory.tsx:40` | Can't find all matching users |
| M-24 | Admin deletion irreversible, no batch ops | `AdminDataIssues.tsx` | Risky at scale |
| M-25 | CompleteProfile prefill race condition | `CompleteProfile.tsx:225-280` | Empty form, possible data overwrite |
| M-26 | Email leaked in browser history on signup redirect | `SignUp.tsx:94-96` | Privacy leak |
| M-27 | Mobile header buttons missing aria-labels + small targets | `Header.tsx:103-130` | Accessibility, WCAG violation |
| M-28 | Install prompt covers bottom navigation | `InstallPrompt.tsx:168` | Can't navigate while prompt shown |
| M-29 | NotificationsDrawer missing aria-labelledby + safe area | `NotificationsDrawer.tsx:357` | Accessibility, notch overlap |
| M-30 | File upload validation is client-side only | `imageOptimization.ts`, storage RLS | Malicious file upload possible |
| M-31 | ILIKE wildcard injection in brand search RPCs | `202601291003_brands_rpc_functions.sql` | Data enumeration via `%` search |
| M-32 | admin-send-campaign has no rate limiting | `admin-send-campaign/index.ts` | Unlimited email sends on admin compromise |
| M-33 | `user-scalable=no` violates WCAG AA | `index.html:6` | Low-vision users can't zoom to 200% |
| M-34 | PWA update not checked on cold load | `main.tsx:46-98` | Stale version served until first poll |
| M-35 | Expired opportunities still visible if status not updated | `OpportunityDetailPage.tsx:59` | Users apply to past-deadline opportunities |

### Minor Improvements (Backlog)

| ID | Issue | Impact |
|------|-------|--------|
| I-01 | Auth callback 30s timeout (acceptable) | N/A - working well |
| I-02 | PUBLIC_ROUTES startsWith matching | Future route collision risk |
| I-03 | Profile strength weights vary by role | Not comparable across roles |
| I-04 | Header ResizeObserver fallback | Older browser edge case |
| I-05 | Keyboard detection 150px threshold | Small/split keyboard edge case |
| I-06 | Dead ChatWindow.tsx code | Codebase cleanliness |
| I-07 | Search tab filters don't persist on reload | Minor UX |
| I-08 | No search autocomplete | Polish |
| I-09 | No in-app notification preferences | Feature gap |
| I-10 | Inconsistent empty states | Polish |
| I-11 | Minimal password validation rules | Security hygiene |
| I-12 | Single dangerouslySetInnerHTML (safe) | N/A - correct usage |
| I-13 | Low test coverage thresholds (27-28%) | Regression risk |
| I-14 | security_invoker view maintenance risk | Process discipline |
| I-15 | Admin access correctly server-enforced | N/A - working well |
| I-16 | No dedicated offline page for first-time | PWA edge case |
| I-17 | InstallPrompt `as any` for browser event | TypeScript limitation |
| I-18 | Profile strength toast inconsistency across roles | UX polish |
| I-19 | No "unsaved changes" warning in EditProfileModal | UX polish (drafts mitigate) |
| I-20 | Admin force-claim UUID not validated against real profiles | Edge case |
| I-21 | iOS install prompt shows Android icon | Visual inconsistency |
| I-22 | No empty state for zero conversations in Messages | New user confusion |
| I-23 | AdminDataIssues delete buttons lack type-to-confirm | Accidental deletion risk |
| I-24 | Coach/player strength refreshes only on profile tab switch | Stale % after journey/gallery edits |
| I-25 | Profile strength "Get a reference" action links to Friends tab | Confusing — no reference request form there |
| I-26 | Notification type enum not fully inventoried in frontend | Possible unhandled notification kinds |
| I-27 | Actor profile cache in notifications.ts grows unbounded | Memory leak over very long sessions |

---

## 13. Recommended Fix Order

### Pre-Launch (Before Inviting First 1,000 Users)

1. **C-03: Fix password change** -- Add current password verification or remove the misleading field. Quick fix: use Supabase's `reauthenticate()` or `signInWithPassword()` to verify before `updateUser()`. (Est: 1-2 hours)

2. **C-01: Fix rate limiting** -- Move identifier generation server-side. Options: (a) Use Supabase Edge Function as proxy that extracts real IP from request headers, (b) Use Cloudflare/CDN headers, (c) At minimum, use the authenticated `user.id` instead of random UUID for authenticated rate limits. (Est: 4-8 hours)

3. **C-04: Regenerate database types** -- Run `supabase gen types typescript` to eliminate `as any` casts. (Est: 2-4 hours including type fixes)

4. **M-09: Fix notification toggle loading** -- Replace single `notificationLoading` with per-toggle loading state (e.g., `loadingToggles: Set<string>`). (Est: 30 minutes)

5. **C-06: Fix CompleteProfile mutex release** -- Reset `profileCreationMutexRef.current = false` in the catch/finally block. Without this, any user who hits a network error during onboarding is permanently stuck. (Est: 15 minutes)

6. **C-05: Fix or remove broken admin nav links** -- Either create stub pages for `/admin/opportunities`, `/admin/feature-usage`, `/admin/outreach`, `/admin/investors`, `/admin/settings`, or remove them from the nav to prevent 404s. (Est: 1-2 hours for stubs, or 15 min to remove links)

7. **M-06: Add cold start guidance** -- When home feed returns 0 items, show suggested follows, trending content, or a "Get started" checklist. (Est: 4-8 hours)

### Week 1-2 After Launch

8. **M-17: Fix ApplicantsList silent reference failure** -- Show error state or skeleton when reference fetch fails. References are the core trust signal; hiding them silently from clubs undermines the platform. (Est: 2-3 hours)
9. **M-16: Handle closed opportunities gracefully** -- Query without status filter, show "This opportunity has closed" message. (Est: 1-2 hours)
10. **M-13: Fix conversation realtime reorder** -- Ensure timestamps are populated in realtime payload before re-sorting. (Est: 2-4 hours)
11. **M-27: Add aria-labels and fix touch targets on mobile header** -- Add `aria-label` to icon-only buttons, increase touch target to 44x44px. (Est: 1-2 hours)
12. **M-15: Add opportunities to global search** -- Extend `search_content` RPC. (Est: 4-8 hours)
13. **M-01: Add draft persistence to CompleteProfile** -- Reuse the existing `profileDrafts.ts` pattern.
14. **M-28: Fix install prompt positioning** -- Raise above bottom nav or move to top. (Est: 1 hour)
15. **M-12: Add idempotency to vacancy notifications** -- Dedup key on `(vacancy_id, user_id)`.
16. **M-10: Implement self-service email change** -- Use Supabase `updateUser({ email })`.
17. **M-07/M-08: Standardize infinite scroll** -- Apply to Community pages.

### Month 1-2 After Launch

18. **C-02/M-03: Invest in Brand role** -- Unified edit modal, messaging, reviews.
19. **M-05: Consolidate navigation** -- Extract shared nav config.
20. **I-13: Increase test coverage** -- Target 50%+ on critical paths.

---

## 14. Product Readiness Evaluation

### Is HOCKIA ready to confidently launch and acquire its first 1,000 users?

**Answer: Yes, conditionally.**

HOCKIA is ready to launch with 6 targeted fixes applied first (estimated 2-3 days of work):

1. Fix the password change security gap (C-03)
2. Fix the CompleteProfile mutex release (C-06) -- 15 min fix, blocks onboarding
3. Fix the rate limiting bypass (C-01)
4. Regenerate database types (C-04)
5. Fix the notification toggle bug (M-09)
6. Fix or remove broken admin nav links (C-05)

**Why YES:**
- The core value proposition works: users can create profiles, find opportunities, message contacts, and participate in community
- Auth is robust with 3-tier recovery and session management
- Error handling is comprehensive (every route has ErrorBoundary + Sentry)
- The backend is production-ready (connection pooling, rate limiting at DB level, 18 edge functions, realtime)
- PWA is properly configured for mobile-first experience
- The feature set is deep enough to retain early users (messaging, opportunities, references, feed, Q&A, AI search)

**Why CONDITIONALLY:**
- The password verification gap is a real security risk
- The rate limiting bypass could be exploited by bad actors
- Brand users will have a noticeably thinner experience
- New users will hit a cold start on their home feed
- The 51 `as any` casts indicate tech debt that will slow future development

**Risk Assessment for 1,000 Users:**
- **Auth/Security:** Medium risk (fix C-01 and C-03 first)
- **Performance:** Low risk (architecture handles scale well)
- **UX:** Low-medium risk (cold start is the main gap)
- **Stability:** Low risk (error boundaries, Sentry, rate limiting)
- **Data Integrity:** Low risk (RLS, triggers, RPCs are solid)

### Overall Score: 7.5/10

With the 6 pre-launch fixes applied, this rises to **8.5/10** -- confidently launch-ready for 1,000 users.
