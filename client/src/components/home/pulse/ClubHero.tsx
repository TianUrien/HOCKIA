import { useNavigate } from 'react-router-dom'
import { Search, Target, ChevronRight } from 'lucide-react'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { AuroraHero, HeroLabel } from './AuroraHero'
import { StatTile, StatTileRow } from './StatTile'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * Club Pulse hero (Home V2 Phase 2): MATCH-FIRST, not inbox-first — "N players
 * who fit your team are available", computed by the same Recruiter Verdict the
 * community grid uses (never disagrees with what the club sees there).
 *
 * Variants (§C — never a bare zero):
 *  - matches:   headline count + tiles (fit / applicants / profile views);
 *  - no match:  honest "we'll surface them as they arrive" + search CTA;
 *  - no scope:  onboarding prompt to set the recruiting context (the module
 *    that drives scope adoption).
 */
const MODULE_ID = 'club_hero'
const POSITION = 0

export function ClubHero({ loading, hasScope, fitCount, poolRole, pendingApplicants, voice = 'club' }: {
  loading: boolean
  hasScope: boolean
  fitCount: number
  poolRole: string
  pendingApplicants: number
  /** 'coach' renders the same mechanics in coach-recruiter voice. */
  voice?: 'club' | 'coach'
}) {
  const navigate = useNavigate()
  // No streak chip on the club hero — skip that RPC. Hero waits for the
  // visibility fetch too, so the views tile never pops in post-commit.
  const { visibility, loading: visLoading } = useWeeklyVisibility(true, false)
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  if (loading || visLoading) {
    return <div className="mb-6 h-44 animate-pulse rounded-[28px] bg-gray-200" />
  }

  const noun = poolRole === 'coach' ? 'coach' : 'player'
  const nounPlural = poolRole === 'coach' ? 'coaches' : 'players'
  const views = visibility?.views_7d ?? 0
  const viewDelta = views - (visibility?.views_prior_7d ?? 0)

  const go = (to: string) => {
    trackModuleClick(MODULE_ID, POSITION)
    navigate(to)
  }

  return (
    <div ref={ref} className="mb-6">
      <AuroraHero accent="#0ea5e9">
        <HeroLabel>Your week on HOCKIA</HeroLabel>

        {!hasScope ? (
          <>
            <h1 className="mt-2 text-xl font-black leading-tight">What are you recruiting for?</h1>
            <p className="mt-1 text-sm text-white/70">
              Set your recruiting scope — {voice === 'coach' ? 'who you recruit for' : 'team'}, position, level — and HOCKIA ranks every available {noun} for you.
            </p>
          </>
        ) : fitCount > 0 ? (
          <>
            <h1 className="mt-2 text-2xl font-black leading-tight">
              {fitCount} {fitCount === 1 ? noun : nounPlural} who {fitCount === 1 ? 'fits' : 'fit'} your {voice === 'coach' ? 'search' : 'team'} {fitCount === 1 ? 'is' : 'are'} available.
            </h1>
            <StatTileRow>
              <StatTile value={fitCount} label="Fit your search" accent />
              {pendingApplicants > 0 && <StatTile value={pendingApplicants} label="Pending applicants" />}
              {views > 0 && <StatTile value={views} label="Profile views" delta={viewDelta} />}
            </StatTileRow>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-black leading-tight">
              New {nounPlural} join HOCKIA every week.
            </h1>
            <p className="mt-1 text-sm text-white/70">
              Your scope is set — matches surface here the moment they arrive. Meanwhile, browse who&apos;s open right now.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => go(poolRole === 'coach' ? '/community/coaches' : '/community/players')}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-white/[0.14] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
        >
          {!hasScope ? <Target className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          {!hasScope ? 'Set your scope' : fitCount > 0 ? 'See your matches' : `Search ${nounPlural}`}
          <ChevronRight className="h-4 w-4" />
        </button>
      </AuroraHero>
    </div>
  )
}
