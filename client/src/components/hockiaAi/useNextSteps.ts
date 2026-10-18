import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { loadProfileFacts, nextStepsFrom, type NextStep, type ProfileFacts } from '@/lib/nextSteps'

/** What the member's profile is missing, kept fresh after any profile save. Players and coaches only. */
export function useNextSteps(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [facts, setFacts] = useState<ProfileFacts | null>(null)
  const [steps, setSteps] = useState<NextStep[] | null>(null)

  const reload = useCallback(async () => {
    if (!enabled || !userId) return
    try {
      const f = await loadProfileFacts(userId)
      setFacts(f)
      setSteps(nextStepsFrom(f))
    } catch (err) {
      logger.warn('[useNextSteps] load failed', err)
      setSteps([])
    }
  }, [enabled, userId])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    const on = () => { void reload() }
    window.addEventListener('hockia:profile-updated', on)
    return () => window.removeEventListener('hockia:profile-updated', on)
  }, [reload])

  return { facts, steps, reload }
}
