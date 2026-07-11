import { useNavigate } from 'react-router-dom'
import { Hourglass, ChevronRight } from 'lucide-react'
import { Avatar } from '@/components'
import { useOpportunitiesForYou, daysUntilDeadline, type OpportunityForYou } from '@/hooks/useOpportunitiesForYou'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import { getTimeAgo } from '@/lib/utils'
import { SectionHeader } from './SectionHeader'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Opportunities for you" (Home redesign V2, player Pulse): a horizontal rail
 * of open roles ranked by the transparent rule-based match % (Q4). In
 * 'matched' mode each card carries its %; in 'newest' fallback mode the same
 * cards show recency instead — never a lonely low %(§C). Urgency chip when a
 * deadline is ≤ 7 days out.
 *
 * Collapses entirely when nothing survives the apply-gates (§C: no empty rail).
 */
const MODULE_ID = 'opportunities_for_you'
const POSITION = 2

function urgencyLabel(deadline: string | null): string | null {
  const days = daysUntilDeadline(deadline)
  if (days == null || days > 7) return null
  if (days <= 0) return 'Closes today'
  if (days === 1) return 'Closes tomorrow'
  return `Closes in ${days}d`
}

function OpportunityRailCard({ item, mode, onOpen }: {
  item: OpportunityForYou
  mode: 'matched' | 'newest'
  onOpen: (id: string) => void
}) {
  const urgency = urgencyLabel(item.application_deadline)
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="w-[230px] flex-shrink-0 snap-start rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <Avatar
          src={item.club_avatar_url}
          initials={item.club_name?.slice(0, 2) || '?'}
          size="sm"
          className="flex-shrink-0"
          role="club"
        />
        <span className="min-w-0 truncate text-xs text-gray-500">{item.club_name}</span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-tight text-[#14141c]">
        {item.title}
      </p>

      <div className="mt-2 flex min-h-[1.5rem] flex-wrap items-center gap-1.5">
        {item.position && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium capitalize text-blue-700">
            {item.position.replace(/_/g, ' ')}
          </span>
        )}
        {item.gender && (
          <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-medium text-pink-700">
            {opportunityGenderToTeamLabel(item.gender)}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {mode === 'matched' && item.score != null ? (
          <span className="text-sm font-black text-hockia-primary">{item.score}% match</span>
        ) : (
          <span className="text-xs font-medium text-gray-400">{getTimeAgo(item.created_at, true)}</span>
        )}
        {urgency && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#b45309]">
            <Hourglass className="h-2.5 w-2.5" />
            {urgency}
          </span>
        )}
      </div>
    </button>
  )
}

export function OpportunitiesForYou({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate()
  const { loading, mode, items } = useOpportunitiesForYou(enabled)
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  if (!enabled || loading || items.length === 0) return null

  const openOpportunity = (id: string) => {
    trackModuleClick(MODULE_ID, POSITION)
    navigate(`/opportunities/${id}`)
  }

  return (
    <section ref={ref} className="mb-6">
      <SectionHeader
        title="Opportunities for you"
        chip={mode === 'matched' ? { label: 'Matched', tone: 'new' } : undefined}
        action={
          <button
            type="button"
            onClick={() => {
              trackModuleClick(MODULE_ID, POSITION)
              navigate('/opportunities')
            }}
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-hockia-primary"
          >
            See all
            <ChevronRight className="h-4 w-4" />
          </button>
        }
      />
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <OpportunityRailCard key={item.id} item={item} mode={mode} onOpen={openOpportunity} />
        ))}
      </div>
    </section>
  )
}
