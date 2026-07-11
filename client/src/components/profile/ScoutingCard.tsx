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
import { useCountries } from '@/hooks/useCountries'
import { summarizeCandidateIntent } from '@/lib/candidateIntent'
import { specialistSkillLabels } from '@/lib/specialistSkills'
import { useInterest, categoryToBandTarget } from '@/hooks/useInterest'
import { getClubLevelBand, prefetchWorldClubLogos } from '@/hooks/useWorldClubLogo'
import InterestSignal from '@/components/recruiting/InterestSignal'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import ClubFitChip from '@/components/recruiting/ClubFitChip'
import ProvenSignal from '@/components/recruiting/ProvenSignal'
import { useClubFit } from '@/hooks/useClubFit'
import { useCoachFit } from '@/hooks/useCoachFit'
import { useEvidence } from '@/hooks/useEvidence'
import { computeRecruiterVerdict } from '@/lib/recruiterVerdict'
import { availabilityLabel } from '@/lib/availabilityLabel'
import RecruiterVerdictCard from '@/components/recruiting/RecruiterVerdictCard'
import AIOpinionPanel from '@/components/recruiting/AIOpinionPanel'
import MoreActionsMenu from '@/components/recruiting/MoreActionsMenu'
import {
  useHasActiveRecruitingScope,
  useActiveRecruitingTargetProblem,
} from '@/hooks/useRecruitingContext'

interface ScoutingCardProfile {
  id: string
  role: string | null
  full_name: string | null
  current_club: string | null
  current_world_club_id: string | null
  /** Phase 3e — drives the Club Fit chip's gender_match component. */
  playing_category: string | null
  /** Phase 2 — drives the Club Fit chip's position_match component when
   *  the active scope sought a specific position. Optional; null when the
   *  parent doesn't supply it (chip still works, just no position signal). */
  position?: string | null
  secondary_position?: string | null
  /** Increment #3 — player specialist tags (read-only chips). */
  specialist_skills?: string[] | null
  /** Phase 2C — drive the Coach Fit chip on coach profiles (specialization
   *  match vs the sought coaching role). Optional; null/absent for players. */
  coach_specialization?: string | null
  coaching_categories?: string[] | null
  highlight_video_url: string | null
  /** Denormalized count of full-game video entries on the profile row.
   *  No separate join — same value MediaCard uses. */
  full_game_video_count: number | null
  accepted_reference_count: number | null
  /** Increment #1 (Proven lens) — verified badge feeds the evidence
   *  confidence signal alongside video/references/level. */
  is_verified?: boolean | null
  /** Increment #2 (Interested lens) — candidate recruitment preferences,
   *  shown read-only to recruiter viewers. */
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  level_target?: string | null
  opportunity_preference?: string | null
  available_from?: string | null
  availability_duration?: string | null
  /** Increment #2.2 — home country (base ?? nationality) for the
   *  Interested lens "home only" check. */
  base_country_id?: number | null
  nationality_country_id?: number | null
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
  const { user, profile: viewerProfile } = useAuthStore()
  // Increment #2 — recruitment preferences are recruiter-facing only.
  const isRecruiterViewer = viewerProfile?.role === 'club' || viewerProfile?.role === 'coach'
  const { getCountryById } = useCountries()
  const intent = summarizeCandidateIntent(profile, (id) => getCountryById(id)?.name)
  const showIntent = isRecruiterViewer && intent.hasAny
  // Increment #4b — resolve the candidate's PROVEN level (club league band)
  // for the Interested lens. Unlike the grid, the deep profile doesn't warm
  // the world-club cache, so resolve it here (cache-first, then prefetch)
  // and pass it explicitly into the lens so it's render-safe + identical to
  // the grid/carousel score.
  const [provenBand, setProvenBand] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const clubId = profile.current_world_club_id ?? null
    const target = categoryToBandTarget(profile.playing_category ?? null)
    if (!clubId) {
      setProvenBand(null)
      return
    }
    const cached = getClubLevelBand(clubId, target)
    if (cached != null) {
      setProvenBand(cached)
      return
    }
    void prefetchWorldClubLogos([clubId]).then(() => {
      if (alive) setProvenBand(getClubLevelBand(clubId, target))
    })
    return () => {
      alive = false
    }
  }, [profile.current_world_club_id, profile.playing_category])

  // Increment #2.2 — Interested lens vs the active opportunity scope.
  const interest = useInterest({
    role: profile.role,
    relocation_willingness: profile.relocation_willingness ?? null,
    relocation_countries_open: profile.relocation_countries_open ?? null,
    relocation_countries_excluded: profile.relocation_countries_excluded ?? null,
    available_from: profile.available_from ?? null,
    home_country_id: profile.base_country_id ?? profile.nationality_country_id ?? null,
    // #4b — self-declared intent off the row; proven band resolved above.
    proven_level_band: provenBand,
    current_world_club_id: profile.current_world_club_id ?? null,
    playing_category: profile.playing_category ?? null,
    level_target: profile.level_target ?? null,
    opportunity_preference: profile.opportunity_preference ?? null,
  })
  // Increment #3 — player specialist tags (read-only chips).
  const specialistSkills = specialistSkillLabels(profile.specialist_skills)
  const [counts, setCounts] = useState<EvidenceCounts | null>(null)
  const savedState = useIsProfileSaved(profile.id)
  // Phase 2C — Coach Fit for coach profiles. NOT_APPLICABLE (chip null)
  // for players or when no coach scope is active.
  const coachFit = useCoachFit(
    profile.role === 'coach'
      ? {
          id: profile.id,
          role: profile.role,
          coach_specialization: profile.coach_specialization ?? null,
          coaching_categories: profile.coaching_categories ?? null,
        }
      : null,
  )
  // Increment #1 — Proven lens (recruiter-only evidence confidence).
  const evidence = useEvidence({
    role: profile.role,
    highlight_video_url: profile.highlight_video_url,
    full_game_video_count: profile.full_game_video_count,
    accepted_reference_count: profile.accepted_reference_count,
    is_verified: profile.is_verified ?? null,
    current_world_club_id: profile.current_world_club_id,
  })
  // Player Club Fit at the card level (the chip computes its own copy, but
  // the #5 verdict needs the result here). NOT_APPLICABLE for coaches.
  const clubFit = useClubFit(
    profile.role === 'player'
      ? {
          id: profile.id,
          role: profile.role,
          playing_category: profile.playing_category,
          current_world_club_id: profile.current_world_club_id,
          competition_level_band: provenBand,
          open_to_play: profile.open_to_play,
          open_to_coach: profile.open_to_coach,
          open_to_opportunities: profile.open_to_opportunities,
          last_active_at: profile.last_active_at,
          position: profile.position ?? null,
          secondary_position: profile.secondary_position ?? null,
          specialist_skills: profile.specialist_skills ?? null,
        }
      : null,
  )
  // "For your scope" when the recruiter has an active context (opportunity
  // OR custom) they chose; "general fit" only when there's none (profile-
  // derived defaults). Using the active-context signal — not whether
  // level/compensation/location happen to be set — so a coach opening (or
  // any minimal opening) still reads as scoped.
  const hasOpeningScope = useHasActiveRecruitingScope()
  const scopeProblem = useActiveRecruitingTargetProblem()

  // Increment #5 — the explanation-led synthesis verdict that leads the
  // card. Fuses whichever Fit applies (player Club Fit / coach Coach Fit)
  // with the Proven + Interested lenses into one qualitative read. #6 — the
  // recruitment problem reshapes the cross-lens weighting + lead highlight.
  const verdict = computeRecruiterVerdict({
    fit: profile.role === 'coach' ? coachFit : clubFit,
    evidence,
    interest,
    hasOpeningScope,
    problem: scopeProblem,
    candidateRole: profile.role,
  })

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
  // ONLY a positive signal. The role's OWN flag drives it (player→open_to_play,
  // coach→open_to_coach) via the single-source availabilityLabel; when the
  // person hasn't opted in we show NO headline at all — never a negative
  // "not currently open" state (which reads as discouraging). Active-today
  // upgrades to "Available now"; otherwise the role-specific "Open to play/coach".
  const availLabel = availabilityLabel(profile.role, profile)
  const lastActiveMs = profile.last_active_at
    ? Date.now() - new Date(profile.last_active_at).getTime()
    : null
  const showActivity = profile.show_last_active !== false && lastActiveMs !== null
  const isActiveToday = showActivity && lastActiveMs! < DAY_MS

  const status = (() => {
    if (!availLabel) return null // positive-or-hidden — no negative state
    if (isActiveToday) {
      return {
        label: 'AVAILABLE NOW',
        sub: `${availLabel} · Active today`,
        dotClass: 'bg-emerald-500',
        wrapperClass: 'bg-emerald-50 border-emerald-100',
        labelClass: 'text-emerald-800',
      }
    }
    return {
      label: availLabel.toUpperCase(),
      sub: showActivity ? activityBucketSub(lastActiveMs!) : 'Availability set',
      dotClass: 'bg-emerald-500',
      wrapperClass: 'bg-emerald-50 border-emerald-100',
      labelClass: 'text-emerald-800',
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
      {/* Increment #5 — explanation-led lead. The synthesized verdict
          (qualitative tier + ranked highlights/caveats) tops the card,
          with the HOCKIA AI panel narrating the same read directly beneath.
          Both are recruiter + scope gated (render null otherwise), so for
          non-recruiters the card still opens on the availability headline. */}
      {verdict.isApplicable && (
        <div className="mb-3 space-y-3">
          <RecruiterVerdictCard verdict={verdict} />
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
              // #6b — coach-candidate path: gates the panel on Coach Fit.
              coach_specialization: profile.coach_specialization,
              coaching_categories: profile.coaching_categories,
            }}
          />
        </div>
      )}

      {/* Zone 1 — POSITIVE availability headline (or hidden), plus the
          recruiter Fit chips on the right. We only render the row when there's
          a positive availability signal OR an applicable Fit chip — a not-open
          candidate shows no negative headline, but a recruiter still sees the
          Fit chip. */}
      {(status || clubFit.isApplicable || coachFit.isApplicable) && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${status ? status.wrapperClass : 'bg-gray-50 border-gray-100'}`}>
          {status ? (
            <>
              <span className={`h-2.5 w-2.5 rounded-full ${status.dotClass}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold tracking-wide ${status.labelClass}`}>{status.label}</p>
                <p className="text-xs text-gray-600 mt-0.5 truncate">{status.sub}</p>
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          {/* #5: render the SAME clubFit result the verdict consumes (via
              fitResult) instead of letting the chip recompute its own — keeps
              the chip and the lead verdict from ever disagreeing. */}
          <ClubFitChip className="flex-shrink-0 whitespace-nowrap" fitResult={clubFit} />
          {/* Phase 2C — Coach Fit chip for coach profiles (null otherwise). */}
          <ClubFitChip
            className="flex-shrink-0 whitespace-nowrap"
            kind="coach"
            fitResult={coachFit}
          />
        </div>
      )}

      {/* Proven lens (Increment #1) — recruiter-only evidence confidence
          (tier pill + facts). Renders nothing when no evidence applies. */}
      <ProvenSignal result={evidence} className="mt-3" />

      {/* Interested lens (Increment #2.2) — scored match of intent vs the
          active opportunity scope. Recruiter + active-scope gated. */}
      <InterestSignal result={interest} className="mt-3" />

      {/* Specialist skills (Increment #3) — read-only player tags. */}
      {specialistSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {specialistSkills.map((s) => (
            <span key={s} className="rounded-full bg-hockia-primary/10 text-[#5b16b8] text-xs font-medium px-2 py-0.5">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Recruitment preferences (Increment #2 — Interested lens, read-only).
          Recruiter viewers only; hidden when the candidate set none. */}
      {showIntent && (
        <div className="mt-3 rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">
            Recruitment preferences
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {intent.rows.map((r) => (
              <div key={r.key} className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">{r.label}</span>
                <span className="text-sm text-gray-900 truncate" title={r.value}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* (Increment #5 moved the HOCKIA AI panel up to narrate the verdict
          at the top of the card — see the lead block above.) */}

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
                  ? 'bg-hockia-primary/10 text-hockia-primary hover:bg-hockia-primary/15'
                  : 'bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white hover:opacity-95'
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
                className="ml-auto inline-flex items-center text-sm font-medium text-hockia-primary hover:text-[#6B20D4]"
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
              className="font-medium text-hockia-primary hover:underline"
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
            className="text-sm font-medium text-hockia-primary hover:text-[#6B20D4]"
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
