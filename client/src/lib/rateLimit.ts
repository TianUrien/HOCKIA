/**
 * Client-side rate limiting utilities
 * Uses Supabase RPC functions for database-backed rate limiting.
 *
 * These are courtesy pre-checks only. They FAIL OPEN: when the RPC errors or the
 * network fails they return null and the caller carries on. The real limits are
 * enforced by the server (database triggers, Supabase Auth), so a flaky network
 * must never show "Too many attempts".
 */

import { supabase } from './supabase'
import { logger } from './logger'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset_at: string
  limit: number
}

/**
 * Check login rate limit (keyed on email, normalized server-side)
 * @param email - The email address being used to log in
 * @returns RateLimitResult (null = check unavailable; fail open)
 */
export const checkLoginRateLimit = async (email: string): Promise<RateLimitResult | null> => {
  try {
    const { data, error } = await supabase.rpc('check_login_rate_limit', {
      p_email: email,
    })

    if (error) {
      logger.error('[RATE_LIMIT] Login rate limit check failed', { error })
      return null
    }

    return data as unknown as RateLimitResult
  } catch (err) {
    logger.error('[RATE_LIMIT] Unexpected error checking login rate limit', { err })
    return null
  }
}

/**
 * Check signup rate limit (keyed on email, normalized server-side)
 * @param email - The email address being used to sign up
 * @returns RateLimitResult (null = check unavailable; fail open)
 */
export const checkSignupRateLimit = async (email: string): Promise<RateLimitResult | null> => {
  try {
    const { data, error } = await supabase.rpc('check_signup_rate_limit', {
      p_email: email,
    })

    if (error) {
      logger.error('[RATE_LIMIT] Signup rate limit check failed', { error })
      return null
    }

    return data as unknown as RateLimitResult
  } catch (err) {
    logger.error('[RATE_LIMIT] Unexpected error checking signup rate limit', { err })
    return null
  }
}

/**
 * Check password reset rate limit
 * @param email - User's email address
 * @returns RateLimitResult (null = check unavailable; fail open)
 */
export const checkPasswordResetRateLimit = async (email: string): Promise<RateLimitResult | null> => {
  try {
    const { data, error } = await supabase.rpc('check_password_reset_rate_limit', {
      p_email: email
    })

    if (error) {
      logger.error('[RATE_LIMIT] Password reset rate limit check failed', { error })
      return null
    }

    return data as unknown as RateLimitResult
  } catch (err) {
    logger.error('[RATE_LIMIT] Unexpected error checking password reset rate limit', { err })
    return null
  }
}

/**
 * Check opportunity application rate limit
 * @param userId - User's ID
 * @returns RateLimitResult (null = check unavailable; fail open)
 */
export const checkApplicationRateLimit = async (userId: string): Promise<RateLimitResult | null> => {
  try {
    const { data, error } = await supabase.rpc('check_application_rate_limit', {
      p_user_id: userId
    })

    if (error) {
      logger.error('[RATE_LIMIT] Application rate limit check failed', { error })
      return null
    }

    return data as unknown as RateLimitResult
  } catch (err) {
    logger.error('[RATE_LIMIT] Unexpected error checking application rate limit', { err })
    return null
  }
}

/**
 * Check message sending rate limit
 * @param userId - User's ID
 * @returns RateLimitResult (null = check unavailable; fail open)
 */
export const checkMessageRateLimit = async (userId: string): Promise<RateLimitResult | null> => {
  try {
    const { data, error } = await supabase.rpc('check_message_rate_limit', {
      p_user_id: userId
    })

    if (error) {
      logger.error('[RATE_LIMIT] Message rate limit check failed', { error })
      return null
    }

    return data as unknown as RateLimitResult
  } catch (err) {
    logger.error('[RATE_LIMIT] Unexpected error checking message rate limit', { err })
    return null
  }
}

/**
 * Format rate limit error message for user display
 */
export const formatRateLimitError = (result: RateLimitResult): string => {
  const resetDate = new Date(result.reset_at)
  const now = new Date()
  const diffMs = resetDate.getTime() - now.getTime()
  const diffMinutes = Math.ceil(diffMs / 60000)

  if (diffMinutes <= 1) {
    return 'Too many attempts. Please try again in a minute.'
  } else if (diffMinutes < 60) {
    return `Too many attempts. Please try again in ${diffMinutes} minutes.`
  } else {
    const diffHours = Math.ceil(diffMinutes / 60)
    return `Too many attempts. Please try again in ${diffHours} hour${diffHours > 1 ? 's' : ''}.`
  }
}
