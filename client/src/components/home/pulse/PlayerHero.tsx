import { useNavigate } from 'react-router-dom'
import { Eye, Flame, ChevronRight } from 'lucide-react'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { AuroraHero, HeroLabel, HeroChip } from './AuroraHero'
import { StatTile, StatTileRow } from './StatTile'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * Player Pulse hero (Home redesign V2): the weekly visibility recap — the #1
 * proven hook ("someone viewed your profile"). Headline = the strongest real
 * signal; stat tiles = views / previews / unique viewers with week-over-week
 * deltas; streak chip; CTA to the dashboard viewers section.
 *
 * Empty-state rule (§C): below 1 view this week the stats block is replaced by
 * a "get seen" prompt — never "0 clubs viewed you".
 */
const MODULE_ID = 'player_hero'
const POSITION = 0

function clubOrCoachViewers(byRole: Record<string, number>): number {
  return (byRole.club ?? 0) + (byRole.coach ?? 0)
}

export function PlayerHero() {
  const navigate = useNavigate()
  const { loading, visibility, streakDays } = useWeeklyVisibility(true)
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  if (loading || !visibility) {
    return <div className="mb-6 h-44 animate-pulse rounded-[28px] bg-gray-200" />
  }

  const views = visibility.views_7d
  const viewDelta = views - visibility.views_prior_7d
  const recruiters = clubOrCoachViewers(visibility.viewers_by_role)
  const hasSignal = views >= 1

  const goToViewers = () => {
    trackModuleClick(MODULE_ID, POSITION)
    navigate('/dashboard/profile?tab=profile&section=viewers')
  }

  return (
    <div ref={ref} className="mb-6">
      <AuroraHero accent="#c026d3">
        <div className="flex items-start justify-between gap-3">
          <HeroLabel>Your week on HOCKIA</HeroLabel>
          {streakDays >= 2 && (
            <HeroChip>
              <Flame className="h-3 w-3 text-[#c6ff6b]" />
              {streakDays}-day streak
            </HeroChip>
          )}
        </div>

        {hasSignal ? (
          <>
            <h1 className="mt-2 text-2xl font-black leading-tight">
              {recruiters > 0
                ? `${recruiters} ${recruiters === 1 ? 'recruiter' : 'recruiters'} viewed your profile this week.`
                : `${views} profile ${views === 1 ? 'view' : 'views'} this week.`}
            </h1>
            {viewDelta > 0 && (
              <p className="mt-1 text-sm font-semibold text-[#c6ff6b]">
                ▲ {viewDelta} more than last week
              </p>
            )}
            {/* "Never show 0" (§C): the views tile is always kept (hasSignal
                guarantees ≥1), secondary tiles only when their value is real.
                unique_viewers ≥1 is guaranteed when views ≥1; previews can
                legitimately be 0 and is dropped rather than shown as "0". */}
            <StatTileRow>
              <StatTile value={views} label="Profile views" delta={viewDelta} accent />
              {visibility.unique_viewers_7d > 0 && (
                <StatTile value={visibility.unique_viewers_7d} label="Unique viewers" />
              )}
              {visibility.previews_7d > 0 && (
                <StatTile value={visibility.previews_7d} label="Previews" delta={visibility.previews_7d - visibility.previews_prior_7d} />
              )}
            </StatTileRow>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-black leading-tight">
              Let clubs find you this week.
            </h1>
            <p className="mt-1 text-sm text-white/70">
              Clubs are most active on Mondays. Mark yourself open to play and keep your profile sharp — active players get seen far more.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={goToViewers}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-white/[0.14] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
        >
          <Eye className="h-4 w-4" />
          {hasSignal ? 'See who viewed you' : 'Boost your visibility'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </AuroraHero>
    </div>
  )
}
