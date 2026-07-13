import { useRolesHealth } from '@/hooks/useRolesHealth'
import { useScopedMatches } from '@/hooks/useScopedMatches'
import { ClubHero } from './ClubHero'
import { AiScoutBar } from './AiScoutBar'
import { ApplicantsToReview } from './ApplicantsToReview'
import { AvailableNowRail } from './AvailableNowRail'
import { RolesHealth } from './RolesHealth'

/**
 * The club Pulse (Home V2 Phase 2, §2.2 "scout-first"): match-first hero,
 * AI scout bar, applicants triage, the available-now match rail, and per-role
 * health. Data fetched ONCE here (one roles-health RPC + one pool fetch) and
 * fanned to the modules; the market-moves digest is mounted by PulseTab after
 * this container.
 */
export function ClubPulse() {
  const rolesHealth = useRolesHealth(true)
  const scoped = useScopedMatches(true)

  return (
    <>
      <ClubHero
        loading={scoped.loading || rolesHealth.loading}
        hasScope={scoped.hasScope}
        fitCount={scoped.fitCount}
        poolRole={scoped.poolRole}
        pendingApplicants={rolesHealth.totals.pending}
      />
      <AiScoutBar />
      <ApplicantsToReview totals={rolesHealth.totals} loading={rolesHealth.loading || rolesHealth.failed} />
      <AvailableNowRail matches={scoped.matches} loading={scoped.loading} />
      {/* On a failed fetch the module collapses — never the Post-CTA card
          (which would misread as "you have no open roles"). */}
      <RolesHealth roles={rolesHealth.roles} loading={rolesHealth.loading || rolesHealth.failed} />
    </>
  )
}
