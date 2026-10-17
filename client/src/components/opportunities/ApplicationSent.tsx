import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Sparkles } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { CrestTile } from '@/components/opportunities/RoleCover'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { showFullMatchNudge } from '@/lib/opportunityCopy'
import { sentLine, type RoleIdentity } from '@/lib/opportunityIdentity'

interface ApplicationSentProps {
  clubName: string
  clubLogo: string | null
  publisherRole: string | null | undefined
  /** Who reviews it (coach-aware copy) and the role summary card. */
  identity?: RoleIdentity
  roleLine?: string | null
  onClose: () => void
}

/**
 * Application sent (Figma O3b 153:422, Opportunities v2): sheet content
 * after the send morph — a green check, "Application sent", who reviews it
 * and where to follow it, the role card, Done, "View in Applied". Uses the
 * moment for the one action that raises reply rate — a full match video —
 * shown only to a player who has none yet. The tip speaks about clubs in
 * general and never about what other applicants were asked (privacy).
 */
export const FULL_MATCH_TIP = 'Add a full match video now — it’s what clubs ask for most after an application.'

export function ApplicationSent({ clubName, clubLogo, publisherRole, identity, roleLine, onClose }: ApplicationSentProps) {
  const navigate = useNavigate()
  const location = useLocation()
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
  const line = identity ? sentLine(identity) : `${clubName} has your profile, career and highlights. Their answer arrives in your Inbox.`
  const subline = identity ? (identity.hiringClub ? (identity.postedBy ? `${identity.hiringClub.name} · posted by ${identity.postedBy.name}` : identity.hiringClub.name) : identity.displayName) : clubName

  return (
    <div className="flex flex-col items-center px-5 pb-2 pt-3 text-center" role="status" aria-label="Application sent" data-testid="application-sent">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-positive-soft text-positive">
        <Check className="h-8 w-8" strokeWidth={2.5} />
      </span>
      <h2 className="mt-4 text-title text-ink-1">Application sent</h2>
      <p className="mt-2 text-[14px] leading-[19px] text-ink-2">{line}</p>
      <div className="mt-5 flex w-full items-center gap-3 rounded-[16px] bg-surface-subtle p-3 text-left">
        {identity?.hiringClub
          ? <CrestTile src={identity.hiringClub.logo} name={identity.hiringClub.name} size={40} radius={12} />
          : <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={40} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{roleLine || clubName}</p>
          <p className="truncate text-secondary text-ink-2">{subline}</p>
        </div>
      </div>
      {nudge && (
        <button
          type="button"
          onClick={() => { onClose(); navigate('/dashboard/profile/media') }}
          className="mt-3 flex w-full items-center gap-2.5 rounded-card bg-surface-muted px-3.5 py-3 text-left active:bg-surface-muted-pressed"
          data-testid="full-match-nudge"
        >
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-hockia-primary" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-secondary text-ink-2">{FULL_MATCH_TIP}</span>
        </button>
      )}
      <button type="button" onClick={onClose} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-5' })} data-testid="application-sent-done">
        Done
      </button>
      <button
        type="button"
        onClick={() => { onClose(); navigate('/opportunities/applications', { state: { from: location.pathname } }) }}
        className="mt-3 h-11 text-[16px] font-semibold leading-[21px] text-brand-primary"
      >
        View in Applied
      </button>
    </div>
  )
}
