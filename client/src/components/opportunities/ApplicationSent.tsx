import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Sparkles } from 'lucide-react'
import { buttonClassName } from '@/components/ui/buttonClasses'
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
 * after the send morph — a green check, "Application sent", who reviews it,
 * What happens next (rebrand page 20), "View my applications" and "Back to
 * opportunities" ("Back to the opportunity" when it opened on the role page). Uses the
 * moment for the one action that raises reply rate — a full match video —
 * shown only to a player who has none yet. The tip speaks about clubs in
 * general and never about what other applicants were asked (privacy).
 */
export const FULL_MATCH_TIP = 'Add a full match video now. It’s what clubs ask for most after an application.'

export function ApplicationSent({ clubName, identity, roleLine, onClose }: ApplicationSentProps) {
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
  const onList = location.pathname === '/opportunities'
  const reviewer = identity?.postedBy ? identity.postedBy.firstName : 'The club'
  const steps = [
    { title: 'Sent', detail: `Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, dot: 'bg-positive' },
    { title: `${reviewer} reviews it`, detail: 'The answer arrives in your Inbox', dot: 'bg-brand-primary' },
    { title: 'You get an answer', detail: 'Shortlisted or not this time', dot: 'bg-ink-4' },
  ]
  const subline = identity ? (identity.hiringClub ? (identity.postedBy ? `${identity.hiringClub.name} · posted by ${identity.postedBy.name}` : identity.hiringClub.name) : identity.displayName) : clubName

  return (
    <div className="flex flex-col items-center px-5 pb-2 pt-3 text-center" role="status" aria-label="Application sent" data-testid="application-sent">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-positive-soft text-positive">
        <Check className="h-8 w-8" strokeWidth={2.5} />
      </span>
      <h2 className="mt-4 text-title text-ink-1">Application sent</h2>
      <p className="mt-2 text-[14px] leading-[19px] text-ink-2">{line}</p>
      {/* What happens next (rebrand page 20): when and what, never how long
          the club takes (players see no reply-time estimates). */}
      <div className="mt-5 w-full rounded-[16px] border border-line bg-white p-4 text-left shadow-card" data-testid="what-happens-next">
        <p className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-3">What happens next</p>
        <ol className="mt-3">
          {steps.map((st, i) => (
            <li key={st.title} className="relative flex gap-3 pb-3 last:pb-0">
              {i < steps.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-4 h-[calc(100%-12px)] w-px bg-line" />}
              <span aria-hidden="true" className={`mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${st.dot}`} />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-5 text-ink-1">{st.title}</span>
                <span className="block text-secondary text-ink-2">{st.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {roleLine && <p className="mt-3 truncate border-t border-line pt-3 text-secondary text-ink-2" data-testid="application-sent-role">{roleLine} · {subline}</p>}
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
      <button
        type="button"
        onClick={() => { onClose(); navigate('/opportunities/applications', { state: { from: location.pathname } }) }}
        className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-5' })}
        data-testid="application-sent-view"
      >
        View my applications
      </button>
      <button
        type="button"
        onClick={onClose}
        className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-2.5' })}
        data-testid="application-sent-done"
      >
        {/* Closing returns to where the member applied: the list, or the opportunity (now showing Applied). */}
        {onList ? 'Back to opportunities' : 'Back to the opportunity'}
      </button>
    </div>
  )
}
