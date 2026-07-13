import { useState } from 'react'
import { useAuthStore } from '@/lib/auth'
import { trackModuleClick } from '@/lib/homeInstrumentation'

/**
 * Coach Pulse dual-mode state (Home V2 Phase 3, §2.3): 'find' (get hired) vs
 * 'recruit' (my recruiting). Defaults from coach_recruits_for_team (a coach
 * who recruits lands on their recruiting week), persisted per-user so the
 * choice sticks across sessions (house localStorage pattern, user-suffixed
 * key like TermsGate's).
 */
export type CoachPulseMode = 'find' | 'recruit'

function storageKey(userId: string): string {
  return `hockia-coach-pulse-mode-${userId}`
}

export function useCoachPulseMode(): [CoachPulseMode, (m: CoachPulseMode) => void] {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon')
  const recruits = useAuthStore((s) => Boolean((s.profile as { coach_recruits_for_team?: boolean } | null)?.coach_recruits_for_team))

  const [mode, setModeState] = useState<CoachPulseMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey(userId))
      if (stored === 'find' || stored === 'recruit') return stored
    } catch { /* storage unavailable — fall through to the default */ }
    return recruits ? 'recruit' : 'find'
  })

  // Latent cross-tab session-replacement guard (audit): if the signed-in
  // coach changes while this stays mounted, re-derive from the NEW user's
  // storage/default instead of inheriting the previous user's mode.
  const [modeUserId, setModeUserId] = useState(userId)
  if (modeUserId !== userId) {
    setModeUserId(userId)
    let next: CoachPulseMode = recruits ? 'recruit' : 'find'
    try {
      const stored = localStorage.getItem(storageKey(userId))
      if (stored === 'find' || stored === 'recruit') next = stored
    } catch { /* default stands */ }
    setModeState(next)
  }

  const setMode = (m: CoachPulseMode) => {
    setModeState(m)
    try {
      localStorage.setItem(storageKey(userId), m)
    } catch { /* best-effort */ }
    trackModuleClick(m === 'find' ? 'coach_mode_find' : 'coach_mode_recruit', 0)
  }

  return [mode, setMode]
}
