import { useState } from 'react'
import { Check, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useOpenToPlay } from '@/hooks/useOpenToPlay'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { getImageUrl } from '@/lib/imageUrl'
import { checkInCopy, confirmedAgoLine, type ViewerLine } from '@/lib/pulseWeek'
import { cn } from '@/lib/utils'

/**
 * Check-in (Your week v2, Figma 42:276): the lavender card at the top.
 * Its first row is the week's viewer line — up to three viewer avatars
 * (clubs as rounded squares, a masked viewer as the generic avatar) and
 * "3 clubs and 1 coach looked at your profile this week" in brand purple;
 * zero views reads "No profile views yet this week" in grey, no avatars.
 * That row stays even when there is no question to ask.
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
 * The question shows only while the person is open (player: open_to_play;
 * coach looking for a role: open_to_coach); recruiting coaches and other
 * roles get the viewer row alone.
 */
interface CheckInCardProps {
  /** The viewer sentence (lib/pulseWeek viewersHeadline). */
  headline: string
  /** Any profile view this week? Drives the grey vs purple line. */
  hasViews: boolean
  /** Viewer rows for the avatar stack (first three are drawn). */
  viewers: readonly ViewerLine[]
}

export function CheckInCard({ headline, hasViews, viewers }: CheckInCardProps) {
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

  const stack = hasViews ? viewers.slice(0, 3) : []

  return (
    <div className="rounded-card bg-hockia-soft p-4" data-testid={copy ? 'check-in-card' : 'check-in-viewers-only'}>
      <div className="flex items-center gap-3">
        {stack.length > 0 && (
          <span className="flex shrink-0 items-center" aria-hidden="true" data-testid="viewer-stack">
            {stack.map((v, i) => (
              <span key={v.key} className={cn('rounded-[9px] bg-white p-0.5', i > 0 && '-ml-2')}>
                {v.hidden ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-grouped text-ink-3">
                    <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                ) : (
                  <EntityAvatar src={getImageUrl(v.avatarUrl, 'avatar-sm') ?? v.avatarUrl} name={v.name} role={v.role} size={28} />
                )}
              </span>
            ))}
          </span>
        )}
        <p className={cn('min-w-0 flex-1 text-secondary font-semibold', hasViews ? 'text-hockia-primary' : 'text-ink-2')} data-testid="week-headline">
          {headline}
        </p>
      </div>

      {copy && (confirmed ? (
        <div className="mt-3 flex items-center gap-3" data-testid="check-in-confirmed">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-positive text-white">
            <Check className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-row font-semibold text-ink-1">Thanks, you’re confirmed.</span>
            <span className="block text-secondary text-ink-2">Clubs see you as open for the next while. {confirmedAgoLine(new Date().toISOString())}</span>
          </span>
        </div>
      ) : (
        <>
          {/* Figma Title M: 20/26 semibold (design review 2026-10-03; the shipped
              web-title-3 token is the same 20/26/600 cut). */}
          <p className="mt-3 text-web-title-3 text-ink-1" data-testid="check-in-question">{copy.question}</p>
          <p className="mt-1 text-secondary text-ink-2">
            {copy.rationale} {confirmedAgoLine(profile.availability_confirmed_at)}
          </p>
          <div className="mt-3.5 flex gap-2">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-hockia-primary text-[16px] font-semibold text-white active:opacity-90 disabled:opacity-60"
              data-testid="check-in-yes"
            >
              {!busy && <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />}
              {busy ? 'Saving…' : 'Yes, I’m open'}
            </button>
            <button
              type="button"
              onClick={() => setAskOff(true)}
              disabled={busy}
              className="flex h-12 flex-1 items-center justify-center rounded-full bg-white text-[16px] font-semibold text-ink-1 disabled:opacity-60"
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
        </>
      ))}
    </div>
  )
}
