import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components'
import { useHappeningNow } from '@/hooks/useHappeningNow'
import { getTimeAgo } from '@/lib/utils'
import { SectionHeader } from './SectionHeader'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Happening now" (Home redesign V2, Pulse): the LIVE market-moves digest —
 * roles opened/filled, transfers, signings, open-to-play, new evidence — as
 * one-line rows. Data via useHappeningNow (a dedicated deeper feed sample:
 * the feed's first page alone routinely has zero movement items).
 * "See all" deep-links to the Feed tab.
 *
 * Collapses while loading or when the sample has no movement items (§C).
 */
const MODULE_ID = 'happening_now'

export function HappeningNow({ position }: { position: number }) {
  const navigate = useNavigate()
  const { moves, isLoading } = useHappeningNow()
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, position))

  if (isLoading || moves.length === 0) return null

  return (
    <section ref={ref} className="mb-6">
      <SectionHeader
        title="Happening now"
        chip={{ label: 'LIVE', tone: 'live' }}
        action={
          <button
            type="button"
            onClick={() => {
              trackModuleClick(MODULE_ID, position)
              navigate('/home?tab=feed')
            }}
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-hockia-primary"
          >
            See all
            <ChevronRight className="h-4 w-4" />
          </button>
        }
      />
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {moves.map((move, i) => (
          <button
            key={move.id}
            type="button"
            onClick={() => {
              trackModuleClick(MODULE_ID, position)
              navigate(move.path)
            }}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
              i > 0 ? 'border-t border-gray-50' : ''
            }`}
          >
            <Avatar
              src={move.avatarUrl}
              initials={move.actor.slice(0, 2)}
              size="sm"
              className="flex-shrink-0"
              role={move.actorRole ?? undefined}
            />
            <p className="min-w-0 flex-1 truncate text-sm text-gray-600">
              <span className="font-semibold text-[#14141c]">{move.actor}</span>{' '}
              {move.action}
            </p>
            <span className="flex-shrink-0 text-xs text-gray-400">
              {getTimeAgo(move.createdAt, true)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
