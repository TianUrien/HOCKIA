/**
 * App rating prompt (Slice 1) — client helpers for the internal 1-5 star prompt.
 * The decision logic lives server-side (should_show_app_rating_prompt); this just
 * calls the RPCs, stamps platform/version context, and mirrors funnel events into
 * the existing `events` table.
 */
import { supabase } from '@/lib/supabase'
import { getRuntimePlatform, getAppVersion, getEnvironment } from '@/lib/appVersion'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { logger } from '@/lib/logger'

// Never run inside an automated browser (Playwright sets navigator.webdriver) so
// the prompt can't overlap e2e test targets.
const IS_AUTOMATED = typeof navigator !== 'undefined' && (navigator as Navigator).webdriver === true

/**
 * Feature flag. ON in every environment — including production — and on native
 * (iOS/Android) builds, so the rating prompt is available everywhere. The only OFF
 * states: the explicit kill switch VITE_ENABLE_APP_RATING='false' (instant
 * rollback via a redeploy/rebuild), and automated browsers (e2e). Eligibility is
 * still fully gated server-side (onboarding + 7 active days, once/day, etc.).
 */
export const APP_RATING_ENABLED =
  !IS_AUTOMATED && import.meta.env.VITE_ENABLE_APP_RATING !== 'false'

export interface RatingDecision {
  show: boolean
  trigger?: string
}

/** Ask the server whether to show the prompt to the current user right now. */
export async function shouldShowRatingPrompt(): Promise<RatingDecision> {
  try {
    const { data, error } = await supabase.rpc('should_show_app_rating_prompt')
    if (error) {
      logger.warn('should_show_app_rating_prompt failed', error)
      return { show: false }
    }
    const d = data as { show?: boolean; trigger?: string } | null
    return { show: Boolean(d?.show), trigger: d?.trigger }
  } catch (err) {
    logger.warn('should_show_app_rating_prompt error', err)
    return { show: false }
  }
}

/** Record that the prompt was shown (state + funnel event). Fire-and-forget. */
export function recordRatingPromptShown(): void {
  void supabase.rpc('record_app_rating_prompt_shown').then(({ error }) => {
    if (error) logger.warn('record_app_rating_prompt_shown failed', error)
  })
  trackDbEvent('app_rating_prompt_shown')
}

/** Record a dismissal (state + funnel event). Fire-and-forget. */
export function recordRatingPromptDismissed(): void {
  void supabase.rpc('record_app_rating_prompt_dismissed').then(({ error }) => {
    if (error) logger.warn('record_app_rating_prompt_dismissed failed', error)
  })
  trackDbEvent('app_rating_prompt_dismissed')
}

/**
 * Submit a rating. Captures platform + version client-side; role + country are
 * stamped server-side from the profile. Returns true on success.
 */
export async function submitRating(
  ratingValue: number,
  feedbackText: string | null,
  triggerReason: string | undefined,
): Promise<boolean> {
  try {
    const versionInfo = await getAppVersion()
    const appVersion =
      versionInfo?.version ?? (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) ?? null
    const trimmed = feedbackText && feedbackText.trim() ? feedbackText.trim() : null
    const { data, error } = await supabase.rpc('submit_app_rating', {
      p_rating_value: ratingValue,
      p_feedback_text: trimmed ?? undefined,
      p_platform: getRuntimePlatform(),
      p_app_version: appVersion ?? undefined,
      p_build_number: versionInfo?.build ?? undefined,
      p_environment: getEnvironment(),
      p_trigger_reason: triggerReason ?? undefined,
    })
    if (error) {
      logger.warn('submit_app_rating failed', error)
      return false
    }
    // The RPC returns {rating_id, inserted}. Only count a GENUINE new rating in the
    // funnel — an idempotent no-op (user already rated) returns inserted:false.
    const result = data as { rating_id?: string; inserted?: boolean } | null
    if (result?.inserted) {
      trackDbEvent('app_rating_prompt_submitted', undefined, result.rating_id ?? undefined, {
        rating: ratingValue,
      })
    }
    return true
  } catch (err) {
    logger.warn('submit_app_rating error', err)
    return false
  }
}
