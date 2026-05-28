import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, ShieldCheck } from 'lucide-react'
import Avatar from '../Avatar'
import RoleBadge from '../RoleBadge'
import DualNationalityDisplay from '../DualNationalityDisplay'
import ClubFitChip from '../recruiting/ClubFitChip'
import HockeyContextLine from '../recruiting/HockeyContextLine'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import { isAuthExpiredError } from '@/lib/sentryHelpers'

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
  is_verified: boolean | null
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
}

const DEFAULT_LIMIT = 20

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
}: TopCommunityMembersCarouselProps) {
  const navigate = useNavigate()
  const [members, setMembers] = useState<TopMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    let cancelled = false
    const fetchTop = async () => {
      // peek module-level cache first: when StrictMode dev-double-
      // invokes the effect or a Suspense boundary above us replays
      // it, we hand back cached rows synchronously and never flip
      // `loading` to true (which is what the user previously saw as
      // a second skeleton flash).
      const cacheKey = `top-community-${roleFilter ?? 'any'}-${sortCriterion}-${limit}-${onlyOpen ? 'open' : 'all'}-${filterCategoryKey}`
      const cached = requestCache.peek<TopMemberRow[]>(cacheKey)
      if (cached) {
        setMembers(cached)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        // Over-fetch when a category filter is active so the filtered
        // result still fills the carousel. 2x is conservative; usually
        // the filter drops <40% of rows.
        const fetchLimit = filterPlayingCategories && filterPlayingCategories.length > 0
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
            return result.slice(0, limit)
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
  }, [roleFilter, sortCriterion, limit, onlyOpen, filterCategoryKey, filterPlayingCategories])

  const openMember = (m: TopMemberRow) => {
    const base =
      m.role === 'club'
        ? '/clubs'
        : m.role === 'umpire'
          ? '/umpires'
          : m.role === 'coach'
            ? '/coaches'
            : m.role === 'brand'
              ? '/brands'
              : '/players'
    const slug = m.username ? m.username : `id/${m.id}`
    navigate(`${base}/${slug}?ref=community-top`)
  }

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
          {members.map((m) => (
            <MemberCard key={m.id} member={m} onClick={() => openMember(m)} />
          ))}
        </div>
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────
// MemberCard
// ──────────────────────────────────────────────────────────────────────

interface MemberCardProps {
  member: TopMemberRow
  onClick: () => void
}

function MemberCard({ member, onClick }: MemberCardProps) {
  // .trim() guards against legacy rows with trailing whitespace in
  // full_name — the value leaks into both the visible label and the
  // aria-label (which then produces "Open Maria 's profile" with an
  // ugly stray space). Display-time fix only; not a data migration.
  const fullName = (member.full_name?.trim() || member.username?.trim() || 'HOCKIA Member')
  const initials = useMemo(
    () =>
      fullName
        .split(' ')
        .map((s) => s[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase(),
    [fullName],
  )

  const isOpen =
    Boolean(member.open_to_play) ||
    Boolean(member.open_to_coach) ||
    Boolean(member.open_to_opportunities)

  const hasNationality = Boolean(member.nationality_country_id || member.nationality)
  const currentClub = member.current_club?.trim()

  // Fixed-structure card with NO hardcoded card height — every slot
  // has a min-height so the card sizes naturally to the same content
  // shape across members, and no excess empty space appears under the
  // shorter cards. (Previously had h-[360px] + mt-auto which produced
  // ~70px of dead space when a member had fewer fields. QA-flagged.)
  //
  // Slot reservations:
  //   - Avatar:  72px (the ring + Avatar size="lg")
  //   - % line:  1 line
  //   - Name:    2 lines (line-clamp-2)
  //   - Role:    badge height
  //   - Nat'ty:  2 lines so dual-nationality + EU pill fits without
  //              shifting the divider up
  //   - Divider: 1px line
  //   - Club:    1 line (always reserved, even empty)
  //   - Pill:    min-h matches pill itself; reserved even when the
  //              member isn't open so all cards still end at the
  //              same Y
  //
  // Total natural height settles around ~290px — same for every
  // member; no fixed `h-[…]` needed.
  return (
    <button
      type="button"
      onClick={onClick}
      className="snap-center flex-shrink-0 w-52 rounded-2xl border border-gray-200/80 bg-white shadow-sm p-4 hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40 flex flex-col text-center"
      data-testid={`top-member-card-${member.id}`}
      aria-label={`${fullName}, ${member.profile_completeness_pct}% profile complete. Tap to open profile.`}
    >
      {/* Avatar slot — fixed centered */}
      <div className="flex justify-center">
        <CompletenessRing pct={member.profile_completeness_pct}>
          <Avatar
            src={member.avatar_url}
            initials={initials || '?'}
            alt={fullName}
            size="lg"
            role={member.role}
          />
        </CompletenessRing>
      </div>

      {/* % complete */}
      <p className="mt-1 text-xs font-semibold text-[#8026FA] tabular-nums">
        {member.profile_completeness_pct}% Complete
      </p>

      {/* Name — up to 2 lines */}
      <p
        className="mt-1 text-sm font-semibold text-gray-900 line-clamp-2 leading-tight min-h-[2.5em]"
        title={fullName}
      >
        {fullName}
      </p>

      {/* Role badge + Club Fit chip (recruiter-only; hidden when not
          applicable). Stacks below role on the same row when narrow. */}
      <div className="mt-1 flex flex-wrap justify-center items-center gap-1.5 min-h-[22px]">
        <RoleBadge role={member.role} />
        <ClubFitChip
          candidate={{
            id: member.id,
            role: member.role,
            playing_category: member.playing_category,
            current_world_club_id: member.current_world_club_id,
            competition_level_band: member.competition_level_band,
            open_to_play: member.open_to_play,
            open_to_coach: member.open_to_coach,
            open_to_opportunities: member.open_to_opportunities,
            last_active_at: member.last_active_at,
          }}
          variant="badge"
        />
      </div>

      {/* Nationality slot — reserves 2 lines so single + dual
          nationality cards align identically. Subtle blank line for
          single-nationality members. */}
      <div className="mt-1.5 text-[11px] text-gray-700 min-h-[2.5em] flex flex-col items-center justify-start">
        {hasNationality && (
          <DualNationalityDisplay
            primaryCountryId={member.nationality_country_id}
            secondaryCountryId={member.role === 'club' ? null : member.nationality2_country_id}
            fallbackText={member.nationality}
            mode="tile"
            className="justify-center"
          />
        )}
      </div>

      {/* Divider */}
      <div className="my-1.5 border-t border-gray-100" />

      {/* P1.4 Hockey context line for players (club · competition ·
          position with per-segment "Not added yet" fallbacks). For
          non-player roles, keep the legacy single-club line — they
          don't carry a meaningful position/competition concept. */}
      {member.role === 'player' ? (
        <HockeyContextLine
          clubName={currentClub}
          competitionName={member.current_competition_name}
          position={member.position}
          className="min-h-[1.25em] text-center"
        />
      ) : (
        <div className="text-[11px] text-gray-600 min-h-[1.25em] inline-flex items-center justify-center gap-1 truncate">
          {currentClub && (
            <>
              <Building2 className="h-3 w-3 text-gray-400 flex-shrink-0" aria-hidden="true" />
              <span className="truncate" title={currentClub}>{currentClub}</span>
            </>
          )}
        </div>
      )}

      {/* Open to opportunities pill. Reserved slot height ensures
          cards without the pill still align at the same Y. */}
      <div className="mt-2 min-h-[28px] flex items-end justify-center">
        {isOpen && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <ShieldCheck className="h-3 w-3" />
            Open to opportunities
          </span>
        )}
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────
// CompletenessRing — SVG progress arc around the avatar
// ──────────────────────────────────────────────────────────────────────

interface CompletenessRingProps {
  pct: number
  children: React.ReactNode
}

function CompletenessRing({ pct, children }: CompletenessRingProps) {
  // Ring sized to wrap the lg Avatar (3.5rem / 56px) with a 4px gap.
  const size = 72
  const stroke = 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const safePct = Math.max(0, Math.min(100, pct))
  const dash = (safePct / 100) * circumference

  return (
    <div className="relative flex items-center justify-center h-[72px] w-[72px]">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#8026FA"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="relative">{children}</div>
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
