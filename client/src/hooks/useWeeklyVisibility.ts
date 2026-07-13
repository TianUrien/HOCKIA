import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Player/Coach Pulse hero data (Home redesign V2): the weekly visibility recap
 * + engagement streak, both from Phase-0 RPCs that already fence hidden/test
 * viewers. Two cheap parallel RPCs; refetched on mount (Home is check-and-leave,
 * ~5.5min sessions — no need for realtime).
 */
export interface WeeklyVisibility {
  views_7d: number
  views_prior_7d: number
  unique_viewers_7d: number
  previews_7d: number
  previews_prior_7d: number
  viewers_by_role: Record<string, number>
}

export interface VisibilityState {
  loading: boolean
  visibility: WeeklyVisibility | null
  streakDays: number
}

const EMPTY: WeeklyVisibility = {
  views_7d: 0, views_prior_7d: 0, unique_viewers_7d: 0,
  previews_7d: 0, previews_prior_7d: 0, viewers_by_role: {},
}

/** `includeStreak: false` skips the streak RPC — the club hero shows no
 *  streak chip, so it shouldn't pay for one (audit L2). */
export function useWeeklyVisibility(enabled: boolean, includeStreak = true): VisibilityState {
  const [state, setState] = useState<VisibilityState>({ loading: enabled, visibility: null, streakDays: 0 })

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, visibility: null, streakDays: 0 })
      return
    }
    let cancelled = false
    void (async () => {
      const [vis, streak] = await Promise.all([
        supabase.rpc('get_my_weekly_visibility'),
        includeStreak ? supabase.rpc('get_my_streak') : Promise.resolve({ data: null, error: null }),
      ])
      if (cancelled) return
      if (vis.error) logger.debug('[weekly-visibility] failed', vis.error.message)
      const v = (vis.data as Partial<WeeklyVisibility> & { error?: string } | null)
      setState({
        loading: false,
        visibility: v && !v.error ? { ...EMPTY, ...v } : EMPTY,
        streakDays: (streak.data as { current_streak_days?: number } | null)?.current_streak_days ?? 0,
      })
    })()
    return () => { cancelled = true }
  }, [enabled, includeStreak])

  return state
}
