import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import RecruiterCandidateCard, { type RecruiterCardMember } from '../recruiting/RecruiterCandidateCard'
import { computeClubFit } from '@/lib/clubFit'
import { computeCoachFit } from '@/lib/coachFit'
import { computeEvidence } from '@/lib/evidence'
import { computeInterest } from '@/lib/interestFit'
import { computeRecruiterVerdict, type RecruiterVerdict } from '@/lib/recruiterVerdict'
import {
  useActiveRecruitingTarget, useActiveRecruitingTargetRole, useActiveRecruitingTargetPosition,
  useActiveRecruitingTargetSpecialists, useActiveRecruitingTargetLocation, useActiveRecruitingTargetStartDate,
  useActiveRecruitingTargetLevel, useActiveRecruitingTargetCompensation,
  useHasActiveRecruitingScope, useActiveRecruitingTargetProblem,
} from '@/hooks/useRecruitingContext'
import { categoryToBandTarget } from '@/hooks/useInterest'
import { getClubLevelBand } from '@/hooks/useWorldClubLogo'
import { useCountries } from '@/hooks/useCountries'
import { MemberPreviewModal } from './MemberPreviewModal'
import { CandidatePreviewSheet } from '../recruiting/CandidatePreviewSheet'
import type { Profile } from './PeopleListView'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import { isAuthExpiredError } from '@/lib/sentryHelpers'
import { useAuthStore } from '@/lib/auth'

/**
 * TopCommunityMembersCarousel
 *
 * Surfaces N onboarded members per role lane via the
 * get_top_community_members(p_role, p_limit, p_sort) RPC. Sort
 * criterion is role-aware:
 *
 *   - 'availability_activity' for the players lane — open-to-play +
 *     recently active first; profile completeness becomes a
 *     tiebreaker. Avoids the "humans publicly ranked by data-entry"
 *     reading.
 *   - 'completeness' (default) for clubs / coaches / umpires /
 *     brands — those are organizations or service profiles where
 *     "more complete = more useful" is a fair public signal.
 *
 * Phase 1 Carousel Slices A + B (2026-05-27):
 *   - Renamed user-facing copy from "Top community members" → role-
 *     aware defaults ("Featured players", "Featured clubs",
 *     "Featured coaches") with a criterion-aware helper line under
 *     each ("Open to opportunities and recently active." vs "Most
 *     complete profiles on HOCKIA.").
 *   - CommunityPage renders three stacked lanes on the "all" tab
 *     instead of one mixed-role carousel.
 *   - The % Complete number under each avatar is kept (it doubles
 *     as a self-improvement signal for the profile owner and a
 *     trust signal for visitors); the ranking story behind it is
 *     now per-role honest.
 *
 * Design notes:
 *   - No star icon. The QA reference image used stars; the product
 *     decision is explicitly to avoid them because they read as ratings
 *     or favorites and these are neither.
 *   - Horizontal scroll with snap on mobile.
 */

interface TopMemberRow {
  id: string
  role: 'player' | 'coach' | 'club' | 'umpire' | 'brand'
  full_name: string | null
  username: string | null
  avatar_url: string | null
  nationality: string | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  base_location: string | null
  position: string | null
  current_club: string | null
  current_world_club_id: string | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
  /** Phase 2 (2b') — dedicated umpire availability flag (RPC-projected). */
  available_for_appointments: boolean | null
  is_verified: boolean | null
  accepted_reference_count: number | null
  /** Denormalized count of career_history (Journey) entries. Drives the
   *  evidence checklist's "Journey" row in the carousel-sourced Preview.
   *  RPC now projects this (20260611100000); previously dropped → the
   *  Preview always showed Journey as MISSING for carousel candidates. */
  career_entry_count: number | null
  last_active_at: string | null
  profile_completeness_pct: number
  /** Phase 3e — drives Club Fit gender_match + filtering. RPC now
   *  returns this in get_top_community_members. */
  playing_category: string | null
  /** Legacy gender, kept as fallback for un-migrated rows. */
  gender: string | null
  /** P1.2 — curated 1..10 level band derived server-side from the
   *  player's current_world_club → gender-appropriate league →
   *  world_leagues.level_band_global. Drives Club Fit's
   *  competition_proximity component. Null when the player has no
   *  club linked or the club's league hasn't been seeded. */
  competition_level_band: number | null
  /** P1.4 — display name of the same gender-appropriate league.
   *  Drives HockeyContextLine's middle segment. Server-side join
   *  saves a per-card client lookup. */
  current_competition_name: string | null
  /** Phase 2C — coach specialization + coaching categories, drive the
   *  Coach Fit chip on coach cards (null for non-coach rows). */
  coach_specialization: string | null
  coaching_categories: string[] | null
  /** Increment #1 — Proven lens video evidence (refs/verified/level
   *  already present above). */
  highlight_video_url: string | null
  full_game_video_count: number | null
  /** Increment #2.2 — Interested lens candidate intent. */
  relocation_willingness: string | null
  relocation_countries_open: number[] | null
  relocation_countries_excluded: number[] | null
  available_from: string | null
  base_country_id: number | null
  // Self-declared intent (#2.1) — Interested-lens level + compensation (#4b).
  level_target: string | null
  opportunity_preference: string | null
  // QA-fix — unified-card parity in the rail: the card's umpire/club substance
  // lines + the scoped preview's bio need these. Previously dropped by the RPC
  // → umpire showed "No details yet" + the preview had no bio. RPC now projects
  // them (20260613130000).
  bio: string | null
  umpire_level: string | null
  federation: string | null
  year_founded: number | null
}

interface TopCommunityMembersCarouselProps {
  /** Optional role filter. When set, the carousel returns only that
   *  role's top members. When undefined, returns top members across
   *  all member-discovery roles (excludes brand — pass 'brand'
   *  explicitly to get the brand leaderboard). */
  roleFilter?: 'player' | 'coach' | 'club' | 'umpire' | 'brand'
  /** Ranking criterion. Defaults to 'completeness' (existing behavior
   *  for clubs/coaches/umpires/brands). Pass 'availability_activity'
   *  for the players lane so humans aren't ranked by data-entry; pass
   *  'recently_joined' for the "New on HOCKIA" weekly theme. */
  sortCriterion?: 'completeness' | 'availability_activity' | 'recently_joined'
  /** When true, the carousel only includes profiles with at least one
   *  open-to-X flag set. Used by the "Open to opportunities" weekly
   *  theme to filter the cross-role pool down to actively available
   *  profiles. Defaults to false. */
  onlyOpen?: boolean
  /** Override the section header. When omitted, the carousel infers
   *  a role-appropriate default ("Featured players", "Featured clubs"
   *  etc.) from roleFilter. */
  title?: string
  /** Override the helper line under the title. When omitted, the
   *  carousel infers a criterion-appropriate default. */
  subtitle?: string
  /** Page-level cap. Defaults to 20 (cross-role view); per-role lanes
   *  on the All tab use a lower limit (10) to keep the stacked layout
   *  compact. */
  limit?: number
  /** Optional whitelist of playing_category values to keep in the
   *  result set. Used by the Featured Players lane on the Community
   *  page to scope to the viewer-club's team category (e.g.,
   *  ['adult_women','girls','mixed'] for a women's club). Applied
   *  client-side after fetch; we over-fetch by 2x to cover the case
   *  where the filter drops half the rows. */
  filterPlayingCategories?: readonly string[]
  /** Optional "View all" handler. The page wires this to scroll to
   *  the All members section. Omit to hide the CTA. */
  onViewAll?: () => void
  /** When true, render the recruiter "Proven" evidence pill on cards.
   *  Reserved for the recruitment-context ("Top … for your search")
   *  instance shown while a scope is active. Defaults false so discovery
   *  rails — New on HOCKIA, themed/role-tab lanes — stay free of
   *  recruitment signals (onboarding/profile-building intent). */
  showEvidence?: boolean
  /** The role the active recruiting scope seeks ('player' | 'coach' | null).
   *  When a card's role matches it, the rich scoped recruiter evaluation
   *  sheet (CandidatePreviewSheet) opens instead of the general
   *  MemberPreviewModal — matching the All-Members grid under that scope.
   *  Set by CommunityPage on the "Top … for your search" instance. */
  scopedRecruiterRole?: 'player' | 'coach' | null
}

/** Map a carousel row onto the Profile shape the Preview components read.
 *  TopMemberRow is a near-superset already; the handful of fields the RPC
 *  doesn't return (secondary_position, umpiring_categories, bio…) are
 *  absent from the preview and fall back to null/undefined — the full
 *  profile still has them when the recruiter opens it. */
function topRowToProfile(m: TopMemberRow): Profile {
  return {
    id: m.id,
    avatar_url: m.avatar_url,
    full_name: m.full_name?.trim() || m.username?.trim() || 'HOCKIA Member',
    role: m.role,
    nationality: m.nationality,
    nationality_country_id: m.nationality_country_id,
    nationality2_country_id: m.nationality2_country_id,
    base_location: m.base_location,
    position: m.position,
    secondary_position: null,
    current_club: m.current_club,
    current_world_club_id: m.current_world_club_id,
    gender: m.gender,
    playing_category: m.playing_category,
    coaching_categories: m.coaching_categories,
    umpiring_categories: null,
    created_at: '',
    open_to_play: m.open_to_play ?? undefined,
    open_to_coach: m.open_to_coach ?? undefined,
    open_to_opportunities: m.open_to_opportunities ?? undefined,
    available_for_appointments: m.available_for_appointments,
    last_active_at: m.last_active_at,
    accepted_reference_count: m.accepted_reference_count ?? undefined,
    career_entry_count: m.career_entry_count,
    coach_specialization: m.coach_specialization,
    base_country_id: m.base_country_id,
    relocation_willingness: m.relocation_willingness,
    relocation_countries_open: m.relocation_countries_open,
    relocation_countries_excluded: m.relocation_countries_excluded,
    available_from: m.available_from,
    level_target: m.level_target,
    opportunity_preference: m.opportunity_preference,
    highlight_video_url: m.highlight_video_url,
    full_game_video_count: m.full_game_video_count,
    is_verified: m.is_verified,
    profile_completeness_pct: m.profile_completeness_pct,
    // QA-fix — the scoped preview (CandidatePreviewSheet) reads member.bio.
    bio: m.bio,
    umpire_level: m.umpire_level,
    federation: m.federation,
    year_founded: m.year_founded,
  }
}

const DEFAULT_LIMIT = 20

// Scoped "Top … for your search": fetch a WIDE pool so the client-side
// Recruiter-Match ranking sees ~all candidates in the role (not just the most-
// available 20 the RPC returns), rank by match, then show the strongest N. At
// current scale the pool cap ≈ the whole role, so the rail matches the
// All-Members grid's match ranking. See the recommended Option-A follow-up
// (share the grid's ranked list) if a role ever exceeds the pool cap.
const SCOPED_POOL_LIMIT = 100
const SCOPED_DISPLAY_LIMIT = 12

const ROLE_TITLE_DEFAULT: Record<string, string> = {
  player: 'Featured players',
  coach: 'Featured coaches',
  club: 'Featured clubs',
  umpire: 'Featured umpires',
  brand: 'Featured brands',
}

const CRITERION_SUBTITLE_DEFAULT: Record<string, string> = {
  availability_activity: 'Open to opportunities and recently active.',
  completeness: 'Most complete profiles on HOCKIA.',
  recently_joined: 'Recently joined HOCKIA.',
}

export function TopCommunityMembersCarousel({
  roleFilter,
  sortCriterion = 'completeness',
  onlyOpen = false,
  title,
  subtitle,
  limit = DEFAULT_LIMIT,
  filterPlayingCategories,
  onViewAll,
  showEvidence = false,
  scopedRecruiterRole = null,
}: TopCommunityMembersCarouselProps) {
  const { profile: viewerProfile, loading: authLoading } = useAuthStore()
  // QA F5: get_top_community_members RPC requires auth; firing it as
  // anon returns 401 + logs "[TopCommunityMembersCarousel] fetch
  // failed" to Sentry. Carousel is a discovery surface — meaningless
  // without a viewer context — so render nothing for anon viewers
  // instead of triggering the failed fetch.
  const isAnon = !authLoading && !viewerProfile
  const [members, setMembers] = useState<TopMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Tapping a card opens the Preview (NOT the full profile) so the carousel
  // behaves exactly like the All-Members grid: peek first, then the recruiter
  // chooses to open the full profile (which is the notifying step). Opening a
  // modal preserves scroll — no route change.
  const [previewRow, setPreviewRow] = useState<TopMemberRow | null>(null)
  // Memoize the mapped Profile by row identity so the preview's open-analytics
  // effect (keyed on the member object) fires once per open, not per render.
  const previewProfile = useMemo<Profile | null>(
    () => (previewRow ? topRowToProfile(previewRow) : null),
    [previewRow],
  )
  // Scoped candidate whose role matches the sought role (player under a player
  // scope, coach under a coach scope) → rich recruiter evaluation sheet;
  // everyone else → the general modal. Mirrors PeopleListView's split exactly.
  const useScopedSheet = scopedRecruiterRole != null && previewRow?.role === scopedRecruiterRole

  // ── Recruiter-Match ranking (SCOPED "Top … for your search" only) ──────
  // The RPC orders by availability/activity and has no scope input, so for a
  // rail subtitled "Ranked for your active recruiting scope" we re-rank the
  // fetched pool by the SAME Recruiter Verdict the All-Members grid + profile
  // use (so all three agree), then demote/hide out-of-scope. Discovery rails
  // (no showEvidence) keep the RPC order untouched.
  const contextTarget = useActiveRecruitingTarget()
  const contextTargetRole = useActiveRecruitingTargetRole()
  const contextTargetPosition = useActiveRecruitingTargetPosition()
  const contextTargetSpecialists = useActiveRecruitingTargetSpecialists()
  const contextTargetLocation = useActiveRecruitingTargetLocation()
  const contextTargetStartDate = useActiveRecruitingTargetStartDate()
  const contextTargetLevel = useActiveRecruitingTargetLevel()
  const contextTargetCompensation = useActiveRecruitingTargetCompensation()
  const hasOpeningScope = useHasActiveRecruitingScope()
  const contextProblem = useActiveRecruitingTargetProblem()
  const { getCountryById } = useCountries()

  const verdictById = useMemo(() => {
    const map = new Map<string, RecruiterVerdict>()
    if (!showEvidence || !viewerProfile || !contextTarget) return map
    const viewerCtx = {
      role: viewerProfile.role,
      womens_league_division: (viewerProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
      mens_league_division: (viewerProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
      current_world_club_id: viewerProfile.current_world_club_id ?? null,
    }
    const interestScopeOptions = {
      targetRole: contextTargetRole,
      targetLocationCountry: contextTargetLocation,
      targetStartDate: contextTargetStartDate,
      targetLevel: contextTargetLevel,
      targetCompensation: contextTargetCompensation,
      countryName: (id: number) => getCountryById(id)?.name,
    }
    members.forEach((m) => {
      const fit =
        m.role === 'coach'
          ? computeCoachFit(
              viewerCtx,
              { id: m.id, role: m.role, coach_specialization: m.coach_specialization, coaching_categories: m.coaching_categories },
              { overrideTarget: contextTarget, targetRole: contextTargetRole, targetSpecialization: contextTargetPosition },
            )
          : computeClubFit(
              viewerCtx,
              {
                id: m.id,
                role: m.role,
                playing_category: m.playing_category,
                current_world_club_id: m.current_world_club_id,
                competition_level_band: getClubLevelBand(m.current_world_club_id, categoryToBandTarget(m.playing_category)) ?? m.competition_level_band,
                open_to_play: m.open_to_play,
                open_to_coach: m.open_to_coach,
                open_to_opportunities: m.open_to_opportunities,
                last_active_at: m.last_active_at,
                position: m.position,
                secondary_position: null,
                specialist_skills: null,
              },
              { overrideTarget: contextTarget, targetRole: contextTargetRole, targetPosition: contextTargetPosition, targetSpecialists: contextTargetSpecialists },
            )
      if (!fit.isApplicable) return
      const evidence = computeEvidence({
        role: m.role,
        highlight_video_url: m.highlight_video_url,
        full_game_video_count: m.full_game_video_count,
        accepted_reference_count: m.accepted_reference_count,
        is_verified: m.is_verified,
        current_world_club_id: m.current_world_club_id,
      })
      const interest = computeInterest(
        {
          role: m.role,
          relocation_willingness: m.relocation_willingness,
          relocation_countries_open: m.relocation_countries_open,
          relocation_countries_excluded: m.relocation_countries_excluded,
          available_from: m.available_from,
          home_country_id: m.base_country_id ?? m.nationality_country_id,
          proven_level_band: getClubLevelBand(m.current_world_club_id, categoryToBandTarget(m.playing_category)) ?? m.competition_level_band,
          level_target: m.level_target,
          opportunity_preference: m.opportunity_preference,
        },
        interestScopeOptions,
      )
      const verdict = computeRecruiterVerdict({ fit, evidence, interest, hasOpeningScope, problem: contextProblem, candidateRole: m.role })
      if (verdict.isApplicable) map.set(m.id, verdict)
    })
    return map
  }, [showEvidence, viewerProfile, contextTarget, contextTargetRole, contextTargetPosition, contextTargetSpecialists, contextTargetLocation, contextTargetStartDate, contextTargetLevel, contextTargetCompensation, hasOpeningScope, contextProblem, getCountryById, members])

  // Scoped order: in-scope (Pursue/Consider) first, then by match % (strength)
  // desc, completeness, id — out-of-scope (Longshot/Pass) is demoted to the
  // tail and only fills slots when there aren't enough in-scope candidates, and
  // the rail is capped at SCOPED_DISPLAY_LIMIT. Non-scoped rails are untouched.
  const displayMembers = useMemo(() => {
    if (!showEvidence || verdictById.size === 0) return members
    const inScope = (v: RecruiterVerdict | undefined) => Boolean(v && (v.tier === 'pursue' || v.tier === 'consider'))
    return [...members]
      .sort((a, b) => {
        const va = verdictById.get(a.id)
        const vb = verdictById.get(b.id)
        const sa = inScope(va) ? 1 : 0
        const sb = inScope(vb) ? 1 : 0
        if (sa !== sb) return sb - sa
        const ra = va?.strength ?? 0
        const rb = vb?.strength ?? 0
        if (rb !== ra) return rb - ra
        const pa = a.profile_completeness_pct ?? 0
        const pb = b.profile_completeness_pct ?? 0
        if (pb !== pa) return pb - pa
        return a.id.localeCompare(b.id)
      })
      .slice(0, SCOPED_DISPLAY_LIMIT)
  }, [showEvidence, members, verdictById])

  // Resolve header copy: explicit overrides win; otherwise default to
  // role-aware ("Featured players") + criterion-aware helper.
  const resolvedTitle = title ?? (roleFilter ? ROLE_TITLE_DEFAULT[roleFilter] : 'Featured this week')
  const resolvedSubtitle = subtitle ?? CRITERION_SUBTITLE_DEFAULT[sortCriterion]

  // Stable scalar derived from the category-whitelist array so the
  // effect dep-array doesn't change identity per parent render. Belt-
  // and-braces against unstable-prop bugs from any future caller — the
  // primary fix is the useMemo on the CommunityPage side.
  const filterCategoryKey = filterPlayingCategories?.join('|') ?? ''

  useEffect(() => {
    // Skip the fetch entirely while auth is settling, or when there's
    // no viewer (anon). The RPC requires auth; running it as anon just
    // produces a 401 + Sentry noise.
    if (authLoading || isAnon) {
      setLoading(false)
      return
    }
    let cancelled = false
    const fetchTop = async () => {
      // peek module-level cache first: when StrictMode dev-double-
      // invokes the effect or a Suspense boundary above us replays
      // it, we hand back cached rows synchronously and never flip
      // `loading` to true (which is what the user previously saw as
      // a second skeleton flash).
      const cacheKey = `top-community-${roleFilter ?? 'any'}-${sortCriterion}-${limit}-${onlyOpen ? 'open' : 'all'}-${filterCategoryKey}-${showEvidence ? 'ev' : 'noev'}`
      const cached = requestCache.peek<TopMemberRow[]>(cacheKey)
      if (cached) {
        setMembers(cached)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        // Scoped rail: fetch the wide pool to rank by match. Otherwise
        // over-fetch only when a category filter is active so the filtered
        // result still fills the carousel (2x is conservative).
        const fetchLimit = showEvidence
          ? SCOPED_POOL_LIMIT
          : filterPlayingCategories && filterPlayingCategories.length > 0
            ? Math.min(100, limit * 2)
            : limit

        const rows = await requestCache.dedupe<TopMemberRow[]>(
          cacheKey,
          async () => {
            const { data, error: rpcError } = await supabase.rpc('get_top_community_members', {
              p_role: roleFilter ?? undefined,
              p_limit: fetchLimit,
              p_sort: sortCriterion,
              p_only_open: onlyOpen,
            })
            if (rpcError) throw rpcError
            let result = (data ?? []) as TopMemberRow[]
            if (filterPlayingCategories && filterPlayingCategories.length > 0) {
              const allowed = new Set(filterPlayingCategories)
              result = result.filter((r) => r.playing_category && allowed.has(r.playing_category))
            }
            // Scoped: keep the wide pool (ranking + display cap applied
            // client-side via displayMembers). Discovery: cap at `limit`.
            return result.slice(0, showEvidence ? SCOPED_POOL_LIMIT : limit)
          },
          30000, // 30s cache — survives StrictMode double-invoke + replay
        )
        if (cancelled) return
        setMembers(rows)
      } catch (err) {
        if (isAuthExpiredError(err)) {
          // Session expired mid-fetch (sign-out race). Don't alarm
          // the console or Sentry; the auth flow will redirect the
          // user. Suppress the error banner too since the page is
          // about to navigate.
          logger.debug('[TopCommunityMembersCarousel] session expired mid-fetch (ignored)')
        } else {
          logger.error('[TopCommunityMembersCarousel] fetch failed', err)
          if (!cancelled) setError('Unable to load top members right now.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchTop()
    return () => {
      cancelled = true
    }
    // filterCategoryKey (scalar) replaces filterPlayingCategories
    // (array) as the dep so a parent render that produces the same
    // categories doesn't re-fire the effect.
  }, [roleFilter, sortCriterion, limit, onlyOpen, filterCategoryKey, filterPlayingCategories, showEvidence, authLoading, isAnon])

  // Hide section entirely when nothing to show + not loading + no
  // error. Avoids a stray section header floating over empty space.
  if (!loading && !error && members.length === 0) return null

  return (
    <section
      data-testid="top-community-members"
      className="mb-6"
      aria-labelledby="top-members-heading"
    >
      <header className="mb-3 px-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="top-members-heading"
            className="text-lg font-bold text-gray-900"
          >
            {resolvedTitle}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {resolvedSubtitle}
          </p>
        </div>
        {onViewAll && !loading && !error && members.length > 0 && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-0.5 text-sm font-semibold text-[#8026FA] hover:text-[#6B20D4] flex-shrink-0"
          >
            View all
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>

      {loading ? (
        <CarouselSkeleton />
      ) : error ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      ) : (
        <div
          role="region"
          aria-label="Top community members carousel"
          className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide [scrollbar-width:none] md:mx-0 md:px-0"
        >
          {displayMembers.map((m) => (
            <MemberCard key={m.id} member={m} onClick={() => setPreviewRow(m)} showEvidence={showEvidence} verdict={verdictById.get(m.id)} />
          ))}
        </div>
      )}

      {/* Preview layer — same components the All-Members grid uses. Scoped
          player → CandidatePreviewSheet (rich recruiter eval); everyone else
          → MemberPreviewModal. Both are modals, so closing preserves scroll. */}
      <MemberPreviewModal
        member={useScopedSheet ? null : previewProfile}
        onClose={() => setPreviewRow(null)}
      />
      <CandidatePreviewSheet
        member={useScopedSheet ? previewProfile : null}
        onClose={() => setPreviewRow(null)}
      />
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────
// MemberCard
// ──────────────────────────────────────────────────────────────────────

interface MemberCardProps {
  member: TopMemberRow
  onClick: () => void
  /** Recruitment-context ("Top … for your search") instance — drives the
   *  scoped match card variant. Discovery rails leave this false. */
  showEvidence?: boolean
  /** Precomputed Recruiter Verdict for this row (parent computes it once for
   *  the whole pool so the rail can RANK by match). Undefined / not-applicable
   *  on the signal-free discovery rails. */
  verdict?: RecruiterVerdict
}

function MemberCard({ member, onClick, showEvidence = false, verdict }: MemberCardProps) {
  // .trim() guards legacy rows with trailing whitespace in full_name.
  const fullName = member.full_name?.trim() || member.username?.trim() || 'HOCKIA Member'

  // ONE unified card for both rails — identical to the All-Members grid card so
  // the verdict chip / match bar / % (scoped) and the identity + availability +
  // proof (discovery) read identically across the grid, the carousel, and the
  // profile. The verdict is precomputed by the parent (which also ranks the
  // scoped rail by it); discovery rails pass none → the card's NEUTRAL mode.
  // The RPC server-joins the league name, so we pass it as `competition_name`
  // (the grid derives it from its prefetch cache instead).
  const cardMember: RecruiterCardMember = {
    id: member.id,
    avatar_url: member.avatar_url,
    full_name: fullName,
    role: member.role,
    position: member.position,
    nationality: member.nationality,
    nationality_country_id: member.nationality_country_id,
    nationality2_country_id: member.nationality2_country_id,
    current_club: member.current_club,
    current_world_club_id: member.current_world_club_id,
    base_location: member.base_location,
    playing_category: member.playing_category,
    competition_name: member.current_competition_name,
    open_to_play: member.open_to_play,
    open_to_coach: member.open_to_coach,
    open_to_opportunities: member.open_to_opportunities,
    available_for_appointments: member.available_for_appointments,
    coach_specialization: member.coach_specialization,
    last_active_at: member.last_active_at,
    is_verified: member.is_verified,
    profile_completeness_pct: member.profile_completeness_pct,
    highlight_video_url: member.highlight_video_url,
    full_game_video_count: member.full_game_video_count,
    accepted_reference_count: member.accepted_reference_count,
    career_entry_count: member.career_entry_count,
    // QA-fix — umpire substance line (level) + location (federation), club
    // substance ("Established YYYY"). Were blank in the rail before.
    umpire_level: member.umpire_level,
    federation: member.federation,
    year_founded: member.year_founded,
  }

  return (
    <div className="snap-center flex-shrink-0 w-52" data-testid={`top-member-card-${member.id}`}>
      <RecruiterCandidateCard
        member={cardMember}
        verdict={showEvidence && verdict?.isApplicable ? verdict : undefined}
        onPreview={onClick}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────

function CarouselSkeleton() {
  return (
    <div className="-mx-4 flex gap-3 overflow-x-hidden px-4 pb-2 md:mx-0 md:px-0">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex-shrink-0 w-52 rounded-2xl border border-gray-200/80 bg-white shadow-sm p-4 animate-pulse flex flex-col items-center"
        >
          <div className="h-16 w-16 rounded-full bg-gray-200" />
          <div className="mt-2 h-3 w-20 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-28 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-16 rounded bg-gray-100" />
          <div className="mt-2 h-3 w-24 rounded bg-gray-100" />
          <div className="mt-1.5 border-t border-gray-100 w-full" />
          <div className="mt-1.5 h-3 w-20 rounded bg-gray-100" />
          <div className="mt-2 h-6 w-28 rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  )
}
