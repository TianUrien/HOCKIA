/**
 * useFeedback — single client surface for filing user_feedback.
 *
 * Wraps the submit_user_feedback RPC + the context-capture utility
 * so consumers only need to pass category + body + optional
 * is_urgent. Returns a status state so the modal can render
 * idle/submitting/success/error without owning its own state
 * machine.
 *
 * Submitting is rate-limited server-side to 5/hour per user; if the
 * RPC raises 'rate_limited' the hook returns a friendly error state
 * the modal can surface as a toast.
 */

import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { captureFeedbackContext } from '@/lib/feedbackContext'
import { trackFeedbackSubmitted } from '@/lib/analytics'

export type FeedbackCategory =
  | 'bug'
  | 'confusing'
  | 'idea'
  | 'praise'
  | 'other'

export type FeedbackStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; id: string }
  | { kind: 'error'; message: string; reason: 'rate_limited' | 'unknown' }

export interface SubmitFeedbackInput {
  category: FeedbackCategory
  body: string
  isUrgent?: boolean
}

export function useFeedback(): {
  status: FeedbackStatus
  submitFeedback: (input: SubmitFeedbackInput) => Promise<void>
  reset: () => void
} {
  const [status, setStatus] = useState<FeedbackStatus>({ kind: 'idle' })

  const submitFeedback = useCallback(async (input: SubmitFeedbackInput) => {
    setStatus({ kind: 'submitting' })

    const context = captureFeedbackContext()

    try {
      // Generated RPC param types are `string | undefined` so coerce
      // any null context fields to undefined.
      const { data, error } = await supabase.rpc('submit_user_feedback', {
        p_category: input.category,
        p_body: input.body,
        p_is_urgent: input.isUrgent ?? false,
        p_route: context.route,
        p_route_raw: context.route_raw,
        p_user_agent: context.user_agent,
        p_viewport: context.viewport,
        p_environment: context.environment,
        p_app_version: context.app_version ?? undefined,
        p_sentry_replay_url: context.sentry_replay_url ?? undefined,
      })

      if (error) {
        // PostgREST surfaces our `RAISE EXCEPTION 'rate_limited'` as
        // error.message === 'rate_limited' (code P0001). Anything
        // else is treated as a generic failure.
        const isRateLimited =
          (error.message ?? '').toLowerCase().includes('rate_limited') ||
          (error.code ?? '') === 'P0001' &&
            (error.message ?? '').toLowerCase().includes('rate_limited')
        logger.error('[useFeedback] submit failed', { error })
        setStatus({
          kind: 'error',
          message: isRateLimited
            ? 'You’ve submitted a lot recently. Try again in an hour.'
            : 'Couldn’t send feedback. Please try again.',
          reason: isRateLimited ? 'rate_limited' : 'unknown',
        })
        return
      }

      const id = typeof data === 'string' ? data : ''
      setStatus({ kind: 'success', id })
      trackFeedbackSubmitted(input.category, input.isUrgent ?? false)
    } catch (err) {
      logger.error('[useFeedback] unexpected error', err)
      setStatus({
        kind: 'error',
        message: 'Couldn’t send feedback. Please try again.',
        reason: 'unknown',
      })
    }
  }, [])

  const reset = useCallback(() => {
    setStatus({ kind: 'idle' })
  }, [])

  return { status, submitFeedback, reset }
}
