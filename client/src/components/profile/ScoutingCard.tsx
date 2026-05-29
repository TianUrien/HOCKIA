/**
 * ScoutingCard — recruitment decision surface on the public profile.
 *
 * Replaces the earlier CareerSnapshot panel, which duplicated 6 of 7
 * facts already shown by HeroIdentityCard. This redesign answers the
 * recruiter's question — "can I act on this player?" — in three zones:
 *
 *   ZONE 1: AVAILABILITY HEADLINE (the one-line status)
 *     - "AVAILABLE NOW" when open + active today
 *     - "OPEN TO OPPORTUNITIES" when open but less recently active
 *     - "NOT CURRENTLY OPEN" otherwise
 *
 *   ZONE 2: CAREER EVIDENCE (recruitment-only, never duplicate the Hero)
 *     - Current club, past clubs count, selections, references, media
 *     - Empty rows are omitted entirely (no "Not added yet" noise here;
 *       that pattern belongs on the owner's own dashboard, not on a
 *       recruiter's view)
 *
 *   ZONE 3: PINNED RECRUITMENT ACTIONS
 *     - Save (Shortlist), Message, See full Journey
 *     - Invite-to-apply is intentionally deferred to a follow-up slice
 *       (needs an opportunity picker UI + invitations table)
 *
 * Principle preserved from the third-revision spec: HOCKIA surfaces
 * facts, never judgments. No tier labels, fit scores, or quality
 * assessments anywhere in this card.
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Star, Bookmark, BookmarkCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import ClubFitChip from '@/components/recruiting/ClubFitChip'
import AIOpinionPanel from '@/components/recruiting/AIOpinionPanel'
import MoreActionsMenu from '@/components/recruiting/MoreActionsMenu'

interface ScoutingCardProfile {
  id: string
  role: string | null
  full_name: string | null
  current_club: string | null
  current_world_club_id: string | null
  /** Phase 3e — drives the Club Fit chip's gender_match component. */
  playing_category: string | null
  highlight_video_url: string | null
  /** Denormalized count of full-game video entries on the profile row.
   *  No separate join — same value MediaCard uses. */
  full_game_video_count: number | null
  accepted_reference_count: number | null
  last_active_at: string | null
  show_last_active: boolean | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
}

interface ScoutingCardProps {
  profile: ScoutingCardProfile
  /** Section navigation — jumps to the Journey deep-dive. */
  onViewJourney?: () => void
}

interface EvidenceCounts {
  pastClubs: number
  recentPastClub: string | null
  selections: number
  recentSelection: string | null
  galleryPhotos: number
}

const EMPTY_COUNTS: EvidenceCounts = {
  pastClubs: 0,
  recentPastClub: null,
  selections: 0,
  recentSelection: null,
  galleryPhotos: 0,
}

const DAY_MS = 24 * 60 * 60 * 1000

export default function ScoutingCard({ profile, onViewJourney }: ScoutingCardProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [counts, setCounts] = useState<EvidenceCounts | null>(null)
  const savedState = useIsProfileSaved(profile.id)

  // Two parallel fetches — career_history (counts + most-recent per
  // type) and the gallery count. The full-game-video count is
  // denormalized on the profile row (full_game_video_count) so no
  // separate query is needed for it.
  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      try {
        const [historyRes, galleryRes] = await Promise.all([
          supabase
            .from('career_history')
            .select('entry_type, club_name, created_at')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('gallery_photos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id),
        ])

        if (cancelled) return

        const result: EvidenceCounts = { ...EMPTY_COUNTS }

        if (historyRes.error) {
          logger.warn('[ScoutingCard] career_history fetch failed', historyRes.error)
        } else {
          for (const row of historyRes.data ?? []) {
            const type = (row.entry_type ?? 'other') as string
            const label = row.club_name?.trim() || null
            if (type === 'club') {
              result.pastClubs += 1
              if (!result.recentPastClub && label) result.recentPastClub = label
            } else if (type === 'national_team') {
              result.selections += 1
              if (!result.recentSelection && label) result.recentSelection = label
            }
          }
        }

        // gallery count is non-fatal — surface 0 on error so the row
        // simply doesn't render.
        if (!galleryRes.error) result.galleryPhotos = galleryRes.count ?? 0

        setCounts(result)
      } catch (err) {
        logger.error('[ScoutingCard] fetch failed', err)
        if (!cancelled) setCounts(EMPTY_COUNTS)
      }
    }

    void fetchAll()
    return () => {
      cancelled = true
    }
  }, [profile.id])

  // ── ZONE 1: AVAILABILITY HEADLINE ─────────────────────────────────
  // Three states. Active-today bucket is the only one that ever
  // claims "Available now" — anything older drops to "Open to
  // opportunities" or "Not currently open". This is the single most
  // important recruitment signal on the page.
  const isOpen = Boolean(
    profile.open_to_play || profile.open_to_coach || profile.open_to_opportunities,
  )
  const lastActiveMs = profile.last_active_at
    ? Date.now() - new Date(profile.last_active_at).getTime()
    : null
  const showActivity = profile.show_last_active !== false && lastActiveMs !== null
  const isActiveToday = showActivity && lastActiveMs! < DAY_MS

  const status = (() => {
    if (isOpen && isActiveToday) {
      return {
        label: 'AVAILABLE NOW',
        sub: 'Open to opportunities · Active today',
        dotClass: 'bg-emerald-500',
        wrapperClass: 'bg-emerald-50 border-emerald-100',
        labelClass: 'text-emerald-800',
      }
    }
    if (isOpen) {
      return {
        label: 'OPEN TO OPPORTUNITIES',
        sub: showActivity ? activityBucketSub(lastActiveMs!) : 'Availability set',
        dotClass: 'bg-amber-500',
        wrapperClass: 'bg-amber-50 border-amber-100',
        labelClass: 'text-amber-800',
      }
    }
    return {
      label: 'NOT CURRENTLY OPEN',
      sub: showActivity ? activityBucketSub(lastActiveMs!) : 'Availability not set',
      dotClass: 'bg-gray-400',
      wrapperClass: 'bg-gray-50 border-gray-100',
      labelClass: 'text-gray-700',
    }
  })()

  // ── ZONE 3 HANDLERS ────────────────────────────────────────────────
  // handleMessage was removed 2026-05-29 alongside the Message button —
  // the universal Message action lives in HeroIdentityCard's CTA row
  // now (recruiter + non-recruiter visitors all use the same surface).

  const handleViewJourney = useCallback(() => {
    if (onViewJourney) return onViewJourney()
    const role = profile.role ?? 'player'
    const path = role === 'coach' ? `/coaches/id/${profile.id}/journey` : `/players/id/${profile.id}/journey`
    navigate(path)
  }, [onViewJourney, profile.id, profile.role, navigate])

  // ── ZONE 2: CAREER EVIDENCE ────────────────────────────────────────
  // Each row is rendered only when it has content. The "Label · Value"
  // two-column rhythm is the layout that scans fastest on mobile.
  const rows: Array<{ label: string; value: React.ReactNode }> = []

  if (profile.current_club) {
    rows.push({
      label: 'Current club',
      value: <span className="font-semibold text-gray-900">{profile.current_club}</span>,
    })
  }

  if (counts && counts.pastClubs > 0) {
    rows.push({
      label: 'Past clubs',
      value: (
        <span className="text-gray-900">
          {counts.recentPastClub ?? `${counts.pastClubs} listed`}
          {counts.pastClubs > 1 && counts.recentPastClub && (
            <span className="text-gray-500"> · +{counts.pastClubs - 1} more</span>
          )}
        </span>
      ),
    })
  }

  if (counts && counts.selections > 0) {
    rows.push({
      label: 'Selections',
      value: (
        <span className="text-gray-900">
          {counts.recentSelection ?? `${counts.selections} listed`}
          {counts.selections > 1 && counts.recentSelection && (
            <span className="text-gray-500"> · +{counts.selections - 1} more</span>
          )}
        </span>
      ),
    })
  }

  const refCount = profile.accepted_reference_count ?? 0
  if (refCount > 0) {
    rows.push({
      label: 'References',
      value: (
        <span className="text-gray-900">
          {refCount === 1 ? '1 accepted' : `${refCount} accepted`}
        </span>
      ),
    })
  }

  const hasHighlight = Boolean(profile.highlight_video_url)
  const galleryCount = counts?.galleryPhotos ?? 0
  const fullGameCount = profile.full_game_video_count ?? 0
  if (hasHighlight || galleryCount > 0 || fullGameCount > 0) {
    const mediaParts: string[] = []
    if (hasHighlight) mediaParts.push('1 highlight')
    if (fullGameCount > 0) mediaParts.push(`${fullGameCount} match${fullGameCount === 1 ? '' : 'es'}`)
    if (galleryCount > 0) mediaParts.push(`${galleryCount} photo${galleryCount === 1 ? '' : 's'}`)
    rows.push({
      label: 'Media',
      value: <span className="text-gray-900">{mediaParts.join(' · ')}</span>,
    })
  }

  const hasAnyEvidence = rows.length > 0
  const showJourneyLink = counts !== null && (counts.pastClubs > 0 || counts.selections > 0)

  // ── RENDER ─────────────────────────────────────────────────────────
  return (
    <section className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6">
      {/* Zone 1 — Availability status, the headline. The Club Fit chip
          sits to the right (recruiter-only — hidden for non-club viewers
          and for clubs without a declared team category). */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${status.wrapperClass}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${status.dotClass}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-bold tracking-wide ${status.labelClass}`}>{status.label}</p>
          <p className="text-xs text-gray-600 mt-0.5 truncate">{status.sub}</p>
        </div>
        <ClubFitChip
          candidate={{
            id: profile.id,
            role: profile.role,
            playing_category: profile.playing_category,
            current_world_club_id: profile.current_world_club_id,
            open_to_play: profile.open_to_play,
            open_to_coach: profile.open_to_coach,
            open_to_opportunities: profile.open_to_opportunities,
            last_active_at: profile.last_active_at,
          }}
        />
      </div>

      {/* Section F (G.7) — HOCKIA AI fit opinion. Recruiter-only,
          flag-gated, and hidden when Fit isn't applicable (no scope,
          self-view, missing inputs). Same candidate shape as the chip
          above so the gating stays in sync. */}
      <div className="mt-3">
        <AIOpinionPanel
          candidate={{
            id: profile.id,
            role: profile.role,
            playing_category: profile.playing_category,
            current_world_club_id: profile.current_world_club_id,
            open_to_play: profile.open_to_play,
            open_to_coach: profile.open_to_coach,
            open_to_opportunities: profile.open_to_opportunities,
            last_active_at: profile.last_active_at,
          }}
        />
      </div>

      {/* Zone 2 — Career evidence. Only non-empty rows render. */}
      {hasAnyEvidence && (
        <dl className="mt-5 space-y-2.5">
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-[88px_1fr] gap-3 text-sm leading-snug items-baseline"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 pt-0.5">
                {row.label}
              </dt>
              <dd className="text-gray-700 min-w-0">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Zone 3 — Pinned recruitment actions. */}
      {user && user.id !== profile.id && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void savedState.toggle()}
              disabled={savedState.mutating}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                savedState.isSaved
                  ? 'bg-[#8026FA]/10 text-[#8026FA] hover:bg-[#8026FA]/15'
                  : 'bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white hover:opacity-95'
              }`}
            >
              {savedState.isSaved ? (
                <>
                  <BookmarkCheck className="h-4 w-4" />
                  Saved
                </>
              ) : (
                <>
                  <Bookmark className="h-4 w-4" />
                  Shortlist
                </>
              )}
            </button>
            {/* Message moved to HeroIdentityCard's CTA row (2026-05-29) —
                it's a universal visitor action and belongs in the hero,
                not in the recruiter-specific ScoutingCard zone. Two
                identical Message buttons with equal prominence created
                visual noise for recruiters. ScoutingCard keeps the
                recruiter-specific actions: Shortlist + ⋯ menu (move
                between lists, add note). */}
            {/* ⋯ — Move to list / Add note. Same menu used by
                QuickActionsRow on tile surfaces, so behavior +
                telemetry stay consistent. */}
            <MoreActionsMenu
              playerId={profile.id}
              playerName={profile.full_name ?? 'this player'}
            />
            {showJourneyLink && (
              <button
                type="button"
                onClick={handleViewJourney}
                className="ml-auto inline-flex items-center text-sm font-medium text-[#8026FA] hover:text-[#6B20D4]"
              >
                See full Journey →
              </button>
            )}
          </div>
          {/* Invite-to-apply is intentionally NOT rendered yet — needs
              an opportunity picker + invitations table. Tracked as a
              follow-up slice. */}
        </div>
      )}

      {/* When viewer is the profile owner or anon, hide actions but
          still show status + evidence (it's just informational then).
          Anonymous visitors at least see "open to opportunities" if
          set, which is the public discovery signal. */}
      {!user && hasAnyEvidence && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            <button
              type="button"
              onClick={() => navigate('/signin')}
              className="font-medium text-[#8026FA] hover:underline"
            >
              Sign in
            </button>
            {' '}to shortlist or message {profile.full_name?.split(' ')[0] ?? 'this player'}.
          </p>
        </div>
      )}

      {showJourneyLink && !user && (
        <div className="mt-3 text-right">
          <button
            type="button"
            onClick={handleViewJourney}
            className="text-sm font-medium text-[#8026FA] hover:text-[#6B20D4]"
          >
            See full Journey →
          </button>
        </div>
      )}

      <Star className="hidden" aria-hidden="true" />
    </section>
  )
}

/** Bucket a last_active_at age into a recruiter-friendly sub-line. */
function activityBucketSub(ms: number): string {
  if (ms < 7 * DAY_MS) return 'Active this week'
  if (ms < 30 * DAY_MS) return 'Active this month'
  // Match LastActivePill's silence threshold — past 30 days we don't
  // claim activity. Keep the sub-line neutral.
  return 'Activity quiet — last sign-in over a month ago'
}
