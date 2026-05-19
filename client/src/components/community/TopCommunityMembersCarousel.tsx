import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ShieldCheck } from 'lucide-react'
import Avatar from '../Avatar'
import RoleBadge from '../RoleBadge'
import CountryDisplay from '../CountryDisplay'
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
   *  all roles except brand (per /community IA). */
  roleFilter?: 'player' | 'coach' | 'club' | 'umpire'
  /** Anchor id on the page to scroll to when "View all" is tapped.
   *  Defaults to 'community-all-members'. */
  viewAllAnchorId?: string
}

const LIMIT = 20

export function TopCommunityMembersCarousel({
  roleFilter,
  viewAllAnchorId = 'community-all-members',
}: TopCommunityMembersCarouselProps) {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
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

  const handleViewAll = () => {
    const el = document.getElementById(viewAllAnchorId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openMember = (m: TopMemberRow) => {
    const base =
      m.role === 'club'
        ? '/clubs'
        : m.role === 'umpire'
          ? '/umpires'
          : m.role === 'coach'
            ? '/coaches'
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
      <header className="flex items-end justify-between gap-3 mb-3 px-1">
        <div className="min-w-0">
          <h2
            id="top-members-heading"
            className="text-lg font-bold text-gray-900"
          >
            Top community members
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Discover members with the most complete profiles
          </p>
        </div>
        {!loading && !error && members.length > 0 && (
          <button
            type="button"
            onClick={handleViewAll}
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
          ref={scrollRef}
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
  const fullName = member.full_name || member.username || 'HOCKIA Member'
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

  return (
    <button
      type="button"
      onClick={onClick}
      className="snap-center flex-shrink-0 w-44 rounded-2xl border border-gray-200/80 bg-white shadow-sm p-4 text-left hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40"
      data-testid={`top-member-card-${member.id}`}
      aria-label={`${fullName}, ${member.profile_completeness_pct}% profile complete. Tap to open profile.`}
    >
      <div className="flex flex-col items-center text-center">
        <CompletenessRing pct={member.profile_completeness_pct}>
          <Avatar
            src={member.avatar_url}
            initials={initials || '?'}
            alt={fullName}
            size="lg"
            role={member.role}
          />
        </CompletenessRing>
        <p className="mt-1 text-[10px] font-semibold text-[#8026FA] tabular-nums tracking-wide">
          {member.profile_completeness_pct}% Complete
        </p>

        <p className="mt-2 text-sm font-semibold text-gray-900 line-clamp-1 w-full">
          {fullName}
        </p>
        <div className="mt-1">
          <RoleBadge role={member.role} />
        </div>

        {(member.nationality_country_id || member.nationality) && (
          <div className="mt-1.5 text-[11px] text-gray-600 line-clamp-1">
            <CountryDisplay
              countryId={member.nationality_country_id}
              fallbackText={member.nationality}
              showNationality
            />
          </div>
        )}

        {member.current_club && (
          <p className="mt-0.5 text-[11px] text-gray-500 line-clamp-1 w-full">
            {member.current_club}
          </p>
        )}

        {isOpen && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <ShieldCheck className="h-2.5 w-2.5" />
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
          className="flex-shrink-0 w-44 rounded-2xl border border-gray-200/80 bg-white shadow-sm p-4 animate-pulse"
        >
          <div className="flex flex-col items-center">
            <div className="h-16 w-16 rounded-full bg-gray-200" />
            <div className="mt-2 h-3 w-16 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-24 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-12 rounded bg-gray-100" />
            <div className="mt-2 h-3 w-20 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}
