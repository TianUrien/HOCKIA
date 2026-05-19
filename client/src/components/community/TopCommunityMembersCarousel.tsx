import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, ShieldCheck } from 'lucide-react'
import Avatar from '../Avatar'
import RoleBadge from '../RoleBadge'
import DualNationalityDisplay from '../DualNationalityDisplay'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * TopCommunityMembersCarousel
 *
 * Surfaces the top N onboarded members ranked by profile_completeness_pct
 * (computed server-side via a BEFORE-trigger on profiles — see migration
 * 20260519100000_top_community_members_score.sql). Uses the SQL RPC
 * get_top_community_members(p_role, p_limit) so role-scoped queries are
 * fast and sortable on an indexed column.
 *
 * Design notes:
 *   - No star icon. The QA reference image used stars; the product
 *     decision is explicitly to avoid them because they read as ratings
 *     or favorites and these are neither — they're completeness ranks.
 *   - The completeness % is the visual hero of the card (ring around
 *     the avatar + numeric label). That's the ranking logic; the rest
 *     of the card is supportive identity context.
 *   - Horizontal scroll with snap on mobile, no role mixing — the
 *     parent controls role via the chip subnav.
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
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
  is_verified: boolean | null
  profile_completeness_pct: number
}

interface TopCommunityMembersCarouselProps {
  /** Optional role filter. When set, the carousel returns only that
   *  role's top members. When undefined, returns top members across
   *  all member-discovery roles (excludes brand — pass 'brand'
   *  explicitly to get the brand leaderboard). */
  roleFilter?: 'player' | 'coach' | 'club' | 'umpire' | 'brand'
  /** Optional "View all" handler. The page wires this to scroll to
   *  the All members section. Omit to hide the CTA. */
  onViewAll?: () => void
}

const LIMIT = 20

export function TopCommunityMembersCarousel({
  roleFilter,
  onViewAll,
}: TopCommunityMembersCarouselProps) {
  const navigate = useNavigate()
  const [members, setMembers] = useState<TopMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchTop = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('get_top_community_members', {
          p_role: roleFilter ?? undefined,
          p_limit: LIMIT,
        })
        if (cancelled) return
        if (rpcError) throw rpcError
        setMembers((data ?? []) as TopMemberRow[])
      } catch (err) {
        logger.error('[TopCommunityMembersCarousel] fetch failed', err)
        if (!cancelled) setError('Unable to load top members right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchTop()
    return () => {
      cancelled = true
    }
  }, [roleFilter])

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
            Top community members
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Most complete profiles on HOCKIA
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

      {/* Role badge */}
      <div className="mt-1 flex justify-center min-h-[22px]">
        <RoleBadge role={member.role} />
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

      {/* Club — 1 line with ellipsis, slot reserved when empty */}
      <div className="text-[11px] text-gray-600 min-h-[1.25em] inline-flex items-center justify-center gap-1 truncate">
        {currentClub && (
          <>
            <Building2 className="h-3 w-3 text-gray-400 flex-shrink-0" aria-hidden="true" />
            <span className="truncate" title={currentClub}>{currentClub}</span>
          </>
        )}
      </div>

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
