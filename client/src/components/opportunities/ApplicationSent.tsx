import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Sparkles, X } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { IconButton } from '@/components/ui/IconButton'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { showFullMatchNudge } from '@/lib/opportunityCopy'

interface ApplicationSentProps {
  clubName: string
  clubLogo: string | null
  publisherRole: string | null | undefined
  onClose: () => void
}

/**
 * Application sent (Figma 115:865): a confirmation that sets an expectation
 * and uses the moment for the one action that raises reply rate — a full
 * match video — shown only to a player who has none yet. Secondary button
 * goes back to roles; most players apply to more than one.
 *
 * Ghost ✕ top right, crest 56, Primary "View my applications" + Secondary
 * "Back to roles". The tip speaks about clubs in general and never about
 * what other applicants were asked (privacy).
 */
export const FULL_MATCH_TIP = 'Add a full match video now — it’s what clubs ask for most after an application.'

export function ApplicationSent({ clubName, clubLogo, publisherRole, onClose }: ApplicationSentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  useBodyScrollLock(true)
  const profile = useAuthStore((s) => s.profile)
  const userId = profile?.id ?? null
  const isPlayer = profile?.role === 'player'
  const linkCount = profile?.full_game_video_count ?? 0
  // Full matches = uploaded full-match videos + full-game links (the profile
  // row carries the link count; uploads are counted here).
  const [fullMatchCount, setFullMatchCount] = useState<number | null>(null)
  useEffect(() => {
    if (!userId || !isPlayer) return
    let cancelled = false
    void supabase
      .from('player_videos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('kind', 'full_match')
      .then(({ count, error }) => {
        if (cancelled || error) return
        setFullMatchCount((count ?? 0) + linkCount)
      })
    return () => { cancelled = true }
  }, [userId, isPlayer, linkCount])
  const nudge = showFullMatchNudge(profile?.role, fullMatchCount)
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex flex-col bg-white pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label="Application sent">
      <div className="flex h-11 items-center justify-end px-2">
        <IconButton label="Close" onClick={onClose}>
          <X className="h-6 w-6" strokeWidth={1.8} />
        </IconButton>
      </div>
      <div className="flex flex-1 flex-col items-center gap-4 px-8 pt-16 text-center">
        <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-positive-soft text-positive">
          <Check className="h-10 w-10" strokeWidth={2.5} />
        </span>
        <h1 className="text-title-xl text-ink-1">Application sent</h1>
        <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={56} />
        <p className="text-row text-ink-2">
          {clubName} has your profile, career and highlights. Their answer arrives in your Inbox.
        </p>
        {nudge && (
          <button
            type="button"
            onClick={() => { onClose(); navigate('/dashboard/profile/media') }}
            className="flex w-full items-center gap-2.5 rounded-card bg-surface-muted px-3.5 py-3 text-left active:bg-surface-muted-pressed"
            data-testid="full-match-nudge"
          >
            <Sparkles className="h-[18px] w-[18px] shrink-0 text-hockia-primary" strokeWidth={1.8} aria-hidden="true" />
            <span className="text-secondary text-ink-2">{FULL_MATCH_TIP}</span>
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5 px-5 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <button
          type="button"
          onClick={() => { onClose(); navigate('/opportunities/applications', { state: { from: location.pathname } }) }}
          className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}
        >
          View my applications
        </button>
        <button
          type="button"
          onClick={onClose}
          className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}
        >
          Back to roles
        </button>
      </div>
    </div>,
    document.body,
  )
}
