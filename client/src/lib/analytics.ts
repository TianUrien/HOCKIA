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
 * Initialize GA4 - currently a no-op since config is in index.html
 * Kept for future enhancements (e.g., consent management)
 */
export function initGA(): void {
  // Config is handled in index.html for immediate activation
  // This function is kept for potential future use (consent, debug mode, etc.)
}

/**
 * Track page views on route changes (SPA navigation)
 * Call this in useEffect when location changes
 */
export function trackPageView(path: string, title?: string): void {
  if (typeof window === 'undefined' || isNative) return

  window.gtag?.('event', 'page_view', {
    page_path: path,
    page_title: title || document.title,
    page_location: window.location.href,
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
 * Set user properties after login
 * This links analytics data to a user ID for cross-device tracking
 */
export function setUserProperties(userId: string, role: string): void {
  if (typeof window === 'undefined' || isNative) return

  window.gtag?.('set', 'user_properties', {
    user_id: userId,
    user_role: role, // 'player', 'coach', 'club'
  })

  window.gtag?.('config', GA_MEASUREMENT_ID, {
    user_id: userId,
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

/** Track login */
export function trackLogin(method: string): void {
  trackEvent({
    action: 'login',
    category: 'authentication',
    label: method,
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

/** Track vacancy view */
export function trackVacancyView(vacancyId: string, position?: string, location?: string): void {
  trackEvent({
    action: 'vacancy_view',
    category: 'vacancies',
    label: vacancyId,
    vacancy_position: position,
    vacancy_location: location,
  })
}

/** Track application submission */
export function trackApplicationSubmit(vacancyId: string, position?: string): void {
  trackEvent({
    action: 'application_submit',
    category: 'applications',
    label: vacancyId,
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

/** Track profile view (viewing another user's profile) */
export function trackProfileView(profileRole: string, profileId: string): void {
  trackEvent({
    action: 'profile_view',
    category: 'discovery',
    label: profileRole,
    profile_id: profileId,
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
