/**
 * Google Analytics 4 (GA4) integration for HOCKIA
 *
 * This module provides utilities for tracking page views, events, and user properties.
 *
 * Note: GA4 is loaded dynamically after cookie consent via CookieConsent.tsx.
 * GA4 is fully disabled on native iOS/Android apps (Apple Guideline 5.1.2).
 * This module handles SPA navigation and custom events.
 */

import { Capacitor } from '@capacitor/core'
import { sanitizePath, pathToSafeTitle, hashId } from './analyticsSanitizers'

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-NE620GQKTX'

/** GA4 is disabled on native apps — no cookies, no tracking (Apple Guideline 5.1.2) */
const isNative = Capacitor.isNativePlatform()

// Type declaration for window.gtag
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

/**
 * Initialize GA4 - currently a no-op since gtag config is loaded in
 * lib/cookieConsent.ts after the user grants analytics consent.
 * Kept for parity with the trackPageView/setUserProperties API.
 */
export function initGA(): void {
  // No-op. cookieConsent.enableAnalytics() loads gtag.js and runs the
  // initial gtag('config', ...). trackPageView fires the first
  // sanitized page_view from App.tsx's route useEffect.
}

/**
 * Track page views on route changes (SPA navigation).
 *
 * PII scrub: strips UUID segments from the path, overrides the title
 * for identifying routes (profile pages, opportunity details, etc.),
 * and builds a sanitized page_location from the origin + sanitized
 * path — never sends window.location.href directly. The sanitized
 * page_location + page_title are also `set()` so they stick across
 * subsequent auto-captured events (event-time gtag would otherwise
 * re-read window.location at fire time).
 */
export function trackPageView(path: string, title?: string): void {
  if (typeof window === 'undefined' || isNative) return

  const sanitizedPath = sanitizePath(path)
  const fallbackTitle = title ?? document.title
  const sanitizedTitle = pathToSafeTitle(sanitizedPath, fallbackTitle)
  const origin = typeof window.location !== 'undefined' ? window.location.origin : ''
  const sanitizedLocation = `${origin}${sanitizedPath}`

  window.gtag?.('event', 'page_view', {
    page_path: sanitizedPath,
    page_title: sanitizedTitle,
    page_location: sanitizedLocation,
  })

  // Make these sticky so trackEvent calls between page changes don't
  // accidentally pick up the raw window.location/document.title at
  // event-fire time. gtag('set', { page_location, page_title })
  // overrides the auto-captured values for all subsequent hits.
  window.gtag?.('set', {
    page_path: sanitizedPath,
    page_title: sanitizedTitle,
    page_location: sanitizedLocation,
  })
}

interface TrackEventParams {
  action: string
  category: string
  label?: string
  value?: number
  [key: string]: unknown
}

/**
 * Track custom events
 * @example trackEvent({ action: 'sign_up', category: 'authentication', label: 'player' })
 */
export function trackEvent({ action, category, label, value, ...params }: TrackEventParams): void {
  if (typeof window === 'undefined' || isNative) return

  window.gtag?.('event', action, {
    event_category: category,
    event_label: label,
    value,
    ...params,
  })
}

/**
 * Set user properties after login.
 *
 * PII scrub: the raw Supabase profile UUID is one-way hashed before
 * leaving the device so GA's `uid` param can't be correlated to a
 * real database identifier (same input → same hash preserves the
 * cross-device tracking signal). `user_role` (player/coach/club)
 * stays unhashed since it's deliberately the only profile attribute
 * we want GA to break events down by.
 *
 * Async because Web Crypto's SHA-256 is async. Callers can await or
 * fire-and-forget — login flow doesn't depend on the GA write
 * completing, so awaiting just for ordering is fine to skip.
 */
export async function setUserProperties(userId: string, role: string): Promise<void> {
  if (typeof window === 'undefined' || isNative) return

  const hashedId = await hashId(userId)

  window.gtag?.('set', 'user_properties', {
    user_id: hashedId,
    user_role: role, // 'player', 'coach', 'club'
    logged_in: 'true',
  })

  window.gtag?.('config', GA_MEASUREMENT_ID, {
    user_id: hashedId,
  })
}

/**
 * Clear user properties on logout
 */
export function clearUserProperties(): void {
  if (typeof window === 'undefined' || isNative) return

  window.gtag?.('set', 'user_properties', {
    user_id: null,
    user_role: null,
    logged_in: 'false',
  })
}

// ============================================
// Pre-defined events for HOCKIA
// ============================================

/** Track sign up initiation */
export function trackSignUpStart(source: string): void {
  trackEvent({
    action: 'sign_up_start',
    category: 'authentication',
    label: source,
  })
}

/** Track successful sign up */
export function trackSignUp(role: string): void {
  trackEvent({
    action: 'sign_up',
    category: 'authentication',
    label: role,
  })
}

/** Track the moment a user picks their role (onboarding role picker) — the step
 *  before the wizard. Pairs with onboarding_start/complete to see role drop-off. */
export function trackRoleSelected(role: string): void {
  trackEvent({
    action: 'role_selected',
    category: 'onboarding',
    label: role,
  })
}

/** Track login */
export function trackLogin(method: string): void {
  trackEvent({
    action: 'login',
    category: 'authentication',
    label: method,
  })
}

/** Track a FAILED login attempt — the half the funnel was missing. `reason` is a
 *  coarse, non-PII bucket (bad_credentials / unverified / no_user / exception). */
export function trackLoginFailed(method: string, reason: string): void {
  trackEvent({
    action: 'login_failed',
    category: 'authentication',
    label: method,
    reason,
  })
}

/** Track onboarding flow start (the profile wizard opens). Pairs with
 *  onboarding_complete to measure the onboarding funnel's drop-off. */
export function trackOnboardingStart(role: string): void {
  trackEvent({
    action: 'onboarding_start',
    category: 'onboarding',
    label: role,
  })
}

/** Track onboarding completion */
export function trackOnboardingComplete(role: string): void {
  trackEvent({
    action: 'onboarding_complete',
    category: 'onboarding',
    label: role,
  })
}

/** Track profile updates */
export function trackProfileUpdate(field: string): void {
  trackEvent({
    action: 'profile_update',
    category: 'profile',
    label: field,
  })
}

/** Track profile strength milestone */
export function trackProfileStrengthMilestone(milestone: string, percentage: number): void {
  trackEvent({
    action: 'profile_strength_milestone',
    category: 'profile',
    label: milestone,
    value: percentage,
  })
}

/** Track vacancy view. vacancyId is hashed before reaching GA — see
 *  hashId. Preserves "unique vacancies viewed" grouping signal in
 *  GA reports without leaking raw Supabase UUIDs. Returns the
 *  underlying hash promise so callers can await it (in practice
 *  production callers fire-and-forget via `void`; tests await). */
export async function trackVacancyView(
  vacancyId: string,
  position?: string,
  location?: string,
): Promise<void> {
  const hashedVacancyId = await hashId(vacancyId)
  trackEvent({
    action: 'vacancy_view',
    category: 'vacancies',
    label: hashedVacancyId,
    vacancy_position: position,
    vacancy_location: location,
  })
}

/** Track application submission. vacancyId is hashed before reaching
 *  GA — see hashId. Async for the same reason as trackVacancyView. */
export async function trackApplicationSubmit(
  vacancyId: string,
  position?: string,
): Promise<void> {
  const hashedVacancyId = await hashId(vacancyId)
  trackEvent({
    action: 'application_submit',
    category: 'applications',
    label: hashedVacancyId,
    vacancy_position: position,
  })
}

/** Track vacancy creation (clubs) */
export function trackVacancyCreate(position: string): void {
  trackEvent({
    action: 'vacancy_create',
    category: 'vacancies',
    label: position,
  })
}

/** Track conversation start */
export function trackConversationStart(context: string): void {
  trackEvent({
    action: 'conversation_start',
    category: 'messaging',
    label: context,
  })
}

/** Track message sent */
export function trackMessageSend(): void {
  trackEvent({
    action: 'message_send',
    category: 'messaging',
  })
}

/** Track profile view (viewing another user's profile). profileId
 *  is hashed before reaching GA — see hashId. Preserves "unique
 *  profiles viewed" grouping signal in GA reports without leaking
 *  raw Supabase profile UUIDs. (QA agent flagged the prior raw-UUID
 *  emission as critical.) Async for the same reason as the other
 *  ID-hashing trackers — see trackVacancyView. */
export async function trackProfileView(profileRole: string, profileId: string): Promise<void> {
  const hashedProfileId = await hashId(profileId)
  trackEvent({
    action: 'profile_view',
    category: 'discovery',
    label: profileRole,
    profile_id: hashedProfileId,
  })
}

/** Track search */
export function trackSearch(searchType: string, searchTerm?: string): void {
  trackEvent({
    action: 'search',
    category: 'discovery',
    label: searchType,
    search_term: searchTerm,
  })
}

/** Track CTA button clicks */
export function trackCtaClick(buttonName: string, page: string): void {
  trackEvent({
    action: 'cta_click',
    category: 'engagement',
    label: buttonName,
    page,
  })
}

/**
 * Track a logged-out user hitting a gated action — the high-intent moment the
 * sign-in prompt appears (View Profile, Message, Apply, Ask a question). This is
 * the funnel signal the GA audit flagged as missing: it reveals where logged-out
 * interest peaks and where the sign-up conversion opportunity actually is.
 * `from_page` is the SANITIZED current path (no UUIDs leak to GA).
 */
export function trackProtectedActionBlocked(action: string): void {
  if (typeof window === 'undefined' || isNative) return
  trackEvent({
    action: 'protected_action_blocked',
    category: 'conversion',
    label: action,
    from_page: sanitizePath(window.location.pathname),
  })
}

/**
 * Track external profile-share intent (user opened the share modal).
 * Role only — no profile_id / username / email goes to GA.
 */
export function trackProfileShareInitiated(role: string): void {
  trackEvent({
    action: 'profile_share_initiated',
    category: 'sharing',
    label: role,
  })
}

/**
 * Track that a specific share channel was used.
 * Channel + role only — no identifiers.
 */
export function trackProfileShareCompleted(
  role: string,
  channel: 'copy_link' | 'native_share' | 'whatsapp' | 'email'
): void {
  trackEvent({
    action: 'profile_share_completed',
    category: 'sharing',
    label: role,
    channel,
  })
}

/**
 * Track a logged-out viewer landing on a public profile.
 * Role only — never profile_id / username (would let GA join sessions
 * to identities, which we explicitly don't want).
 */
export function trackPublicProfileViewed(role: string): void {
  trackEvent({
    action: 'public_profile_viewed',
    category: 'sharing',
    label: role,
  })
}

/** Track gallery/media upload */
export function trackMediaUpload(mediaType: 'photo' | 'video'): void {
  trackEvent({
    action: mediaType === 'video' ? 'highlight_video_added' : 'gallery_upload',
    category: 'profile',
    label: mediaType,
  })
}

/** Track push notification subscription */
export function trackPushSubscribe(source: 'settings' | 'prompt'): void {
  trackEvent({
    action: 'push_subscribe',
    category: 'notifications',
    label: source,
  })
}

/** Track push notification unsubscribe */
export function trackPushUnsubscribe(): void {
  trackEvent({
    action: 'push_unsubscribe',
    category: 'notifications',
  })
}

/** Track PWA install */
export function trackPwaInstall(platform: 'ios' | 'android' | 'desktop'): void {
  trackEvent({
    action: 'pwa_install',
    category: 'engagement',
    label: platform,
  })
}

/** Track PWA install prompt dismissed */
export function trackPwaInstallDismiss(): void {
  trackEvent({
    action: 'pwa_install_dismiss',
    category: 'engagement',
  })
}

/** Track push prompt shown */
export function trackPushPromptShown(): void {
  trackEvent({
    action: 'push_prompt_shown',
    category: 'notifications',
  })
}

/** Track push prompt dismissed */
export function trackPushPromptDismiss(): void {
  trackEvent({
    action: 'push_prompt_dismiss',
    category: 'notifications',
  })
}

// ============================================
// References funnel
// ============================================
// Phase 4 References UX Plan — analytics so we can measure whether the
// visibility/education pushes actually moved the funnel:
//   badge_click → modal_open → request_sent → request_responded
// Categorised under 'references' with a `source` label on the modal-open
// event so we can attribute opens to the surface they came from.

export type ReferenceModalSource =
  | 'header_cta'
  | 'friend_row'
  | 'recently_connected'
  | 'empty_state'
  // Sources added with the May 2026 Community redesign.
  | 'credibility_card'
  | 'list_cta'

/** TrustBadge clicked (header pill on dashboards). */
export function trackReferenceBadgeClick(role: string, count: number): void {
  trackEvent({
    action: 'reference_badge_click',
    category: 'references',
    label: role,
    value: count,
  })
}

/** Add-reference modal opened. `source` distinguishes which CTA triggered it. */
export function trackReferenceModalOpen(source: ReferenceModalSource): void {
  trackEvent({
    action: 'reference_modal_open',
    category: 'references',
    label: source,
  })
}

/** Reference request successfully submitted (server returned ok). */
export function trackReferenceRequestSent(requesterRole: string, relationshipType: string): void {
  trackEvent({
    action: 'reference_request_sent',
    category: 'references',
    label: requesterRole,
    relationship_type: relationshipType,
  })
}

/** Reference request responded — accept or decline. */
export function trackReferenceRequestResponded(action: 'accept' | 'decline'): void {
  trackEvent({
    action: 'reference_request_responded',
    category: 'references',
    label: action,
  })
}

/** Recently-connected nudge dismissed via the X button. */
export function trackReferenceNudgeDismiss(): void {
  trackEvent({
    action: 'reference_nudge_dismiss',
    category: 'references',
  })
}

// ============================================
// AI Opinion Engine (Section F)
// ============================================
// Adoption + cost + feedback signal for the recruiter-facing LLM
// verdict panel. viewer_role is already attached via setUserProperties
// at login, so we don't repeat it per event. We never log opinion_id,
// player_id, or the verdict/reason text (recruiter-private + PII).

/** Fires once per (component instance, opinion_id) — distinguishes
 *  cache hits from fresh LLM calls. value = quotaRemaining on fresh
 *  responses (helps watch cost shape over time); omitted on cached. */
export function trackAIOpinionViewed(cached: boolean, quotaRemaining: number | null): void {
  trackEvent({
    action: 'ai_opinion_viewed',
    category: 'ai_opinion',
    label: cached ? 'cached' : 'fresh',
    value: !cached && typeof quotaRemaining === 'number' ? quotaRemaining : undefined,
  })
}

/** User clicked Regenerate. Always implies a fresh LLM call on the
 *  next response cycle (force: true bypasses both client + server cache). */
export function trackAIOpinionRegenerated(): void {
  trackEvent({
    action: 'ai_opinion_regenerated',
    category: 'ai_opinion',
  })
}

/** Recruiter rated an opinion via thumbs up/down. `has_reason` lets
 *  us compute "% of down-votes that explained why" funnel without
 *  needing the reason text itself in analytics. */
export function trackAIOpinionFeedbackSubmitted(rating: 'up' | 'down', hasReason: boolean): void {
  trackEvent({
    action: 'ai_opinion_feedback_submitted',
    category: 'ai_opinion',
    label: rating,
    has_reason: hasReason ? 1 : 0,
  })
}

/** Daily quota gate hit (50/day Phase 1 ceiling). Spike in this event
 *  is the signal to raise the cap or change the pricing slice. */
export function trackAIOpinionQuotaExceeded(): void {
  trackEvent({
    action: 'ai_opinion_quota_exceeded',
    category: 'ai_opinion',
  })
}

/** Edge function returned an error (network, LLM upstream, content
 *  filter rejection). Spike here = check Supabase function logs. */
export function trackAIOpinionError(): void {
  trackEvent({
    action: 'ai_opinion_error',
    category: 'ai_opinion',
  })
}

// ============================================
// User Feedback
// ============================================
// Lets us watch adoption + category mix in GA4 without going
// into the admin dashboard. Body / route / device aren't sent to
// GA — those live in user_feedback (with sanitized route per the
// PII discipline).

/** Recorded when a feedback submit succeeds. Body / route never
 *  reach GA — only the shape (category + urgency flag). */
export function trackFeedbackSubmitted(
  category: 'bug' | 'confusing' | 'idea' | 'praise' | 'other',
  isUrgent: boolean,
): void {
  trackEvent({
    action: 'feedback_submitted',
    category: 'feedback',
    label: category,
    is_urgent: isUrgent ? 1 : 0,
  })
}
