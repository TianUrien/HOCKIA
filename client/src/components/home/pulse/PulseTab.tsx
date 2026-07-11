import { useAuthStore } from '@/lib/auth'
import { PlayerHero } from './PlayerHero'
import { PulseRoleFallback } from './PulseRoleFallback'
import { YourApplications } from './YourApplications'
import { OpportunitiesForYou } from './OpportunitiesForYou'
import { HappeningNow } from './HappeningNow'
import { PulseSection } from '../PulseSection'
import ProfileCompletionCard from '../ProfileCompletionCard'

/**
 * PulseTab — the default Home tab (Home redesign V2): a role-personalized
 * "state of your week". Phase 1 ships the PLAYER surface; other roles get a
 * holding hero (PulseRoleFallback) so the tab is NEVER blank, plus the folded
 * pulse cards + completion, until their real heroes land (Phase 2 club,
 * Phase 3 coach, Phase 4 brand).
 *
 * The existing user_pulse_items "Since you last visited" cards (PulseSection)
 * are FOLDED IN here, per Tian's Q2 — same product, one surface, no rename.
 */
export function PulseTab() {
  const role = useAuthStore((s) => s.profile?.role)
  const isPlayer = role === 'player'

  return (
    <div className="px-4 md:px-6">
      {isPlayer ? (
        <>
          <PlayerHero />
          <YourApplications enabled />
          <OpportunitiesForYou enabled />
          <HappeningNow position={3} />
        </>
      ) : (
        <>
          <PulseRoleFallback role={role ?? 'coach'} />
          {/* Market moves are role-agnostic content — they keep the holding
              Pulse alive for club/coach/brand until their real heroes land. */}
          <HappeningNow position={1} />
        </>
      )}

      {/* Movement layer — folded in from the old feed-top position. */}
      <PulseSection />

      {/* Compact profile completion (demoted from the feed). */}
      <ProfileCompletionCard />
    </div>
  )
}
