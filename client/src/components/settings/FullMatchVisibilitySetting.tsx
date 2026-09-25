import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { fullMatchVisibilityOf, type FullMatchVisibility } from '@/lib/recruiter'
import { useFullMatchPrivacyNotice } from '@/hooks/useFullMatchPrivacyNotice'

const OPTIONS: { value: FullMatchVisibility; title: string; subtitle: string }[] = [
  { value: 'recruiters', title: 'Clubs & coaches', subtitle: 'Clubs and coaches who recruit. Highlights and reels stay public.' },
  { value: 'public', title: 'Everyone on Hockia', subtitle: 'Anyone on Hockia can watch them.' },
]

/**
 * Desktop Settings › Privacy: who can watch the player's full matches
 * (profiles.full_match_visibility — the master switch; the database copies
 * it onto every full match). Players only.
 */
export function FullMatchVisibilitySetting() {
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const { resolveNotice } = useFullMatchPrivacyNotice()
  const [pending, setPending] = useState<FullMatchVisibility | null>(null)
  if (profile?.role !== 'player' || !user) return null
  const current = pending ?? fullMatchVisibilityOf(profile)

  const choose = async (value: FullMatchVisibility) => {
    if (value === current || pending) return
    setPending(value)
    try {
      const { error } = await supabase.from('profiles').update({ full_match_visibility: value }).eq('id', user.id)
      if (error) throw error
      await refreshProfile()
      void resolveNotice(value === 'public')
    } catch (err) {
      logger.error('[FullMatchVisibilitySetting] update failed', err)
      addToast('Could not save that. Please try again.', 'error')
    } finally {
      setPending(null)
    }
  }

  return (
    <fieldset className="rounded-lg bg-gray-50 p-4" data-testid="full-match-visibility-setting">
      <legend className="sr-only">Who can watch your full matches</legend>
      <p className="text-sm font-medium text-gray-900">Who can watch your full matches</p>
      <p className="mt-0.5 text-xs text-gray-500">Applies to all your full matches. You can still change a single video from your profile&apos;s media.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-lg border bg-white px-3 py-2 text-sm',
              current === o.value ? 'border-hockia-primary' : 'border-gray-200 hover:border-gray-300',
            )}
          >
            <input
              type="radio"
              name="full-match-visibility"
              value={o.value}
              checked={current === o.value}
              disabled={pending !== null}
              onChange={() => void choose(o.value)}
              className="mt-1 accent-hockia-primary"
            />
            <span>
              <span className="block font-medium text-gray-900">{o.title}</span>
              <span className="block text-xs text-gray-500">{o.subtitle}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
