import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import DashboardCard from './DashboardCard'

/**
 * ClubMembersCard — Club-only Bento card. Surfaces the club's roster:
 * the players and coaches who have assigned this club in their own
 * profile (linked via current_world_club_id). Membership is
 * attribute-based — there is no accept/reject flow — so the card is a
 * read-only summary with a CTA into the full Members surface.
 *
 * The roster count comes from the same `get_club_members` RPC the
 * Members tab uses; each returned row carries `total_count`, so a
 * single-row probe (limit 1) is enough to read the total cheaply.
 */
interface ClubMembersCardProps {
  /** Club's profile id — passed to get_club_members as p_profile_id. */
  ownerProfileId: string
  /** CTA — routes to the full Members section. */
  onViewMembers: () => void
}

export default function ClubMembersCard({ ownerProfileId, onViewMembers }: ClubMembersCardProps) {
  const [memberCount, setMemberCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchCount = async () => {
      try {
        // limit 1 — we only need total_count off the first row, not the
        // roster itself. The RPC returns total_count on every row.
        const { data, error } = await supabase.rpc('get_club_members', {
          p_profile_id: ownerProfileId,
          p_limit: 1,
          p_offset: 0,
        })
        if (cancelled) return
        if (error) throw error
        setMemberCount(data && data.length > 0 ? data[0].total_count : 0)
      } catch (err) {
        logger.error('[ClubMembersCard] fetch member count failed', err)
        if (!cancelled) setMemberCount(0)
      }
    }
    void fetchCount()
    return () => {
      cancelled = true
    }
  }, [ownerProfileId])

  const hasMembers = memberCount !== null && memberCount > 0
  const countLabel =
    memberCount === null
      ? '—'
      : memberCount === 1
        ? '1 member'
        : `${memberCount} members`

  return (
    <DashboardCard
      icon={Users}
      title="Club Members"
      subtitle="Players and coaches on your roster"
      ctaLabel={hasMembers ? 'View members' : undefined}
      onCtaClick={hasMembers ? onViewMembers : undefined}
      testId="club-members-card"
    >
      <div className="space-y-3.5">
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Users className="h-3.5 w-3.5 text-[#8026FA]" />
            <span>Roster</span>
          </div>
          <p
            className={`text-base font-bold tabular-nums leading-none ${
              hasMembers ? 'text-gray-900' : 'text-gray-500'
            }`}
          >
            {countLabel}
          </p>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">
          {hasMembers
            ? 'Players and coaches who list your club on their profile appear on your roster.'
            : 'Players and coaches who assign your club in their profile will appear here automatically.'}
        </p>
      </div>
    </DashboardCard>
  )
}
