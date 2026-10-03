import { useState } from 'react'
import { Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useOpenToPlay } from '@/hooks/useOpenToPlay'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { checkInCopy, confirmedAgoLine } from '@/lib/pulseWeek'

/**
 * Check-in (Your week v2, Figma 42:276): "Are you still open to play?" with
 * one Primary and one Secondary button.
 *
 *  - "Yes, I'm open" → confirm_availability() (20260506200000), the ONE
 *    writer of profiles.availability_confirmed_at, then the local profile is
 *    stamped so "You confirmed today" shows at once.
 *  - "Not right now" → the same path as the Open to play switch
 *    (set_open_to_play via useOpenToPlay.save, which turns open_to_play off),
 *    behind a purple confirm sheet: a player's no is a normal choice, never
 *    Danger (founder ruling 2026-10-02/03). Coaches have no server switch,
 *    so their no writes open_to_coach = false the way Edit profile does.
 *
 * Shown only while the person is open (player: open_to_play; coach looking
 * for a role: open_to_coach); recruiting coaches and other roles see nothing.
 */
export function CheckInCard() {
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)
  const addToast = useToastStore((s) => s.addToast)
  const otp = useOpenToPlay()
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [askOff, setAskOff] = useState(false)

  if (!profile) return null
  const copy = checkInCopy(profile.role, {
    openToPlay: profile.open_to_play === true,
    openToCoach: profile.open_to_coach === true,
    recruitsForTeam: profile.coach_recruits_for_team === true,
  })
  if (!copy) return null

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('confirm_availability')
      if (error) throw error
      const now = new Date().toISOString()
      const current = useAuthStore.getState().profile
      if (current) setProfile({ ...current, availability_confirmed_at: now, last_meaningful_update_at: now })
      setConfirmed(true)
    } catch (err) {
      logger.error('[CheckInCard] confirm_availability failed', err)
      addToast('Could not save that. Please try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    if (profile.role === 'player') {
      const result = await otp.save({ open: false, availableFrom: profile.available_from ?? null, duration: null })
      if (!result.ok) {
        addToast('Could not save that. Please try again.', 'error')
        throw new Error(result.outcome)
      }
      addToast('Open to play is off', 'success')
      return
    }
    const { error } = await supabase.from('profiles').update({ open_to_coach: false }).eq('id', profile.id)
    if (error) {
      addToast('Could not save that. Please try again.', 'error')
      throw error
    }
    const current = useAuthStore.getState().profile
    if (current) setProfile({ ...current, open_to_coach: false })
    addToast('Open to coaching is off', 'success')
  }

  if (confirmed) {
    return (
      <div className="flex items-center gap-3 rounded-card bg-surface-grouped p-4" data-testid="check-in-confirmed">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-positive text-white">
          <Check className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-row font-semibold text-ink-1">Thanks, you’re confirmed.</span>
          <span className="block text-secondary text-ink-2">Clubs see you as open for the next while. {confirmedAgoLine(new Date().toISOString())}</span>
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-card bg-surface-grouped p-4" data-testid="check-in-card">
      <p className="text-body font-semibold text-ink-1">{copy.question}</p>
      <p className="mt-1 text-secondary text-ink-2">
        {copy.rationale} {confirmedAgoLine(profile.availability_confirmed_at)}
      </p>
      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="flex h-12 flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-60"
          data-testid="check-in-yes"
        >
          {busy ? 'Saving…' : 'Yes, I’m open'}
        </button>
        <button
          type="button"
          onClick={() => setAskOff(true)}
          disabled={busy}
          className="flex h-12 flex-1 items-center justify-center rounded-full bg-white text-[16px] font-semibold text-ink-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] disabled:opacity-60"
          data-testid="check-in-not-now"
        >
          Not right now
        </button>
      </div>
      <ConfirmSheet
        open={askOff}
        onClose={() => setAskOff(false)}
        onConfirm={turnOff}
        tone="primary"
        title={profile.role === 'coach' ? 'Turn off Open to coaching?' : 'Turn off Open to play?'}
        message="Clubs stop seeing you as available. You can turn it back on any time from your profile."
        confirmLabel="Turn off"
        busyLabel="Saving…"
        testId="check-in-off"
      />
    </div>
  )
}
