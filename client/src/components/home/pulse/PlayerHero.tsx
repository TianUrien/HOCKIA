import { useNavigate } from 'react-router-dom'
import { Eye, Flame, ChevronRight } from 'lucide-react'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useAuthStore } from '@/lib/auth'
import { AuroraHero, HeroLabel, HeroChip } from './AuroraHero'
import { StatTile, StatTileRow } from './StatTile'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'
import { useHomeT } from '@/i18n/ns/home'

/**
 * Player Pulse hero (Home redesign V2): the weekly visibility recap — the #1
 * proven hook ("someone viewed your profile"). Headline = the strongest real
 * signal; stat tiles = views / previews / unique viewers with week-over-week
 * deltas; streak chip; CTA to the dashboard viewers section.
 *
 * Empty-state rule (§C): below 1 view this week the stats block is replaced by
 * a "get seen" prompt — never "0 clubs viewed you".
 */
const POSITION = 0

/** Per-voice bits — the hero mechanics (visibility recap, streak, tiles) are
 *  identical for players and coaches; only identity copy + targets differ.
 *  No invented stats in either voice (every number must be real). */
const VOICE = {
  // The copy fields are catalog keys, translated where the hero renders.
  player: {
    moduleId: 'player_hero',
    emptyHeadline: 'playerHero.player.emptyHeadline',
    emptySub: 'playerHero.player.emptySub',
    /** Already open to play: no nudge to do what's done. */
    emptySubWhenOpen: 'playerHero.player.emptySubWhenOpen',
    viewersTarget: '/dashboard/profile?tab=profile&section=viewers',
  },
  coach: {
    moduleId: 'coach_hero',
    emptyHeadline: 'playerHero.coach.emptyHeadline',
    emptySub: 'playerHero.coach.emptySub',
    emptySubWhenOpen: 'playerHero.coach.emptySubWhenOpen',
    viewersTarget: '/dashboard/profile?section=viewers',
  },
} as const

function clubOrCoachViewers(byRole: Record<string, number>): number {
  return (byRole.club ?? 0) + (byRole.coach ?? 0)
}

export function PlayerHero({ voice = 'player' }: { voice?: 'player' | 'coach' }) {
  const t = useHomeT()
  const navigate = useNavigate()
  const v = VOICE[voice]
  const { loading, visibility, streakDays } = useWeeklyVisibility(true)
  const isOpen = useAuthStore((s) => (voice === 'coach' ? s.profile?.open_to_coach : s.profile?.open_to_play) === true)
  const ref = useImpressionOnce(() => recordModuleImpression(v.moduleId, POSITION))

  if (loading || !visibility) {
    return <div className="mb-6 h-44 animate-pulse rounded-[28px] bg-gray-200" />
  }

  const views = visibility.views_7d
  const viewDelta = views - visibility.views_prior_7d
  const recruiters = clubOrCoachViewers(visibility.viewers_by_role)
  const hasSignal = views >= 1

  const goToViewers = () => {
    trackModuleClick(v.moduleId, POSITION)
    navigate(v.viewersTarget)
  }

  return (
    <div ref={ref} className="mb-6">
      <AuroraHero accent="#c026d3">
        <div className="flex items-start justify-between gap-3">
          <HeroLabel>{t('playerHero.label')}</HeroLabel>
          {streakDays >= 2 && (
            <HeroChip>
              <Flame className="h-3 w-3 text-emerald-600" />
              {t('playerHero.streak', { days: streakDays })}
            </HeroChip>
          )}
        </div>

        {hasSignal ? (
          <>
            <h1 className="mt-2 text-2xl font-black leading-tight">
              {recruiters > 0
                ? t('playerHero.recruiters', { count: recruiters })
                : t('playerHero.views', { count: views })}
            </h1>
            {viewDelta > 0 && (
              <p className="mt-1 text-sm font-semibold text-emerald-600">
                {t('playerHero.delta', { delta: viewDelta })}
              </p>
            )}
            {/* "Never show 0" (§C): the views tile is always kept (hasSignal
                guarantees ≥1), secondary tiles only when their value is real.
                unique_viewers ≥1 is guaranteed when views ≥1; previews can
                legitimately be 0 and is dropped rather than shown as "0". */}
            <StatTileRow>
              <StatTile value={views} label={t('playerHero.tiles.views')} delta={viewDelta} accent />
              {visibility.unique_viewers_7d > 0 && (
                <StatTile value={visibility.unique_viewers_7d} label={t('playerHero.tiles.uniqueViewers')} />
              )}
              {visibility.previews_7d > 0 && (
                <StatTile value={visibility.previews_7d} label={t('playerHero.tiles.previews')} delta={visibility.previews_7d - visibility.previews_prior_7d} />
              )}
            </StatTileRow>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-black leading-tight">{t(v.emptyHeadline)}</h1>
            <p className="mt-1 text-sm text-gray-600" data-testid="player-hero-empty-sub">{t(isOpen ? v.emptySubWhenOpen : v.emptySub)}</p>
          </>
        )}

        <button
          type="button"
          onClick={goToViewers}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-hockia-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Eye className="h-4 w-4" />
          {hasSignal ? t('playerHero.ctaViewers') : t('playerHero.ctaBoost')}
          <ChevronRight className="h-4 w-4" />
        </button>
      </AuroraHero>
    </div>
  )
}
