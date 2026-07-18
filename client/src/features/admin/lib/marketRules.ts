/**
 * Next-best-actions rules engine (Market Intelligence Phase 1).
 *
 * Pure functions over the admin_market_intelligence payload — deliberately
 * deterministic and explainable, not ML: every recommendation can show its
 * arithmetic, thresholds live here in one place, and adding a rule is one
 * function + one sentence template. The dashboard's job is the decision;
 * these rules ARE the "what should I do next to grow HOCKIA" answer, with
 * the panels below them as evidence.
 *
 * Threshold philosophy at current marketplace scale (~tens of vacancies):
 * absolute counts, not percentages of tiny denominators; rules stay silent
 * when the sample is too small to mean anything (each rule names its own
 * minimum), so an empty panel reads "no fires this week", not "no data".
 */

import type { MarketIntelligence, MarketMatrixCell } from '../types'

export interface MarketRecommendation {
  id: string
  /** 1 = do this first. Used for ordering + the priority chip. */
  priority: 1 | 2 | 3
  title: string
  detail: string
  owner: 'Acquisition' | 'Ops' | 'Product' | 'Growth'
}

const POSITION_LABEL: Record<string, string> = {
  goalkeeper: 'Goalkeepers',
  defender: 'Defenders',
  midfielder: 'Midfielders',
  forward: 'Forwards',
}

/** R1 — supply gap: real demand, thin supply, weak application flow. */
function gapRules(mi: MarketIntelligence): MarketRecommendation[] {
  const isGap = (c: MarketMatrixCell) =>
    c.demand_window >= 2 &&
    c.apps_window < c.demand_window &&
    c.supply_active < c.demand_window * 2

  return mi.matrix
    .filter(isGap)
    .sort((a, b) => (b.demand_window - b.supply_active) - (a.demand_window - a.supply_active))
    .slice(0, 2)
    .map((c) => ({
      id: `gap:${c.gender}:${c.position}`,
      priority: 1 as const,
      title: `Recruit ${c.gender}'s ${POSITION_LABEL[c.position]}`,
      detail:
        `${c.demand_window} vacanc${c.demand_window === 1 ? 'y' : 'ies'} in the last ` +
        `${mi.meta.demand_window_days}d, only ${c.supply_active} active open-to-play ` +
        `player${c.supply_active === 1 ? '' : 's'} and ${c.apps_window} application${c.apps_window === 1 ? '' : 's'}. ` +
        `This segment is your clearest acquisition target.`,
      owner: 'Acquisition' as const,
    }))
}

/** R2 — club backlog: applications sitting unanswered kill applicant retention. */
function clubBacklogRules(mi: MarketIntelligence): MarketRecommendation[] {
  return mi.clubs
    .filter((c) => c.pending_backlog >= 3 && (c.oldest_pending_days ?? 0) >= 7)
    .sort((a, b) => b.pending_backlog - a.pending_backlog)
    .slice(0, 2)
    .map((c) => ({
      id: `backlog:${c.club_profile_id}`,
      priority: 1 as const,
      title: `Nudge ${c.club_name ?? 'a club'} — ${c.pending_backlog} players waiting`,
      detail:
        `${c.pending_backlog} application${c.pending_backlog === 1 ? '' : 's'} pending, the oldest for ` +
        `${c.oldest_pending_days} days. Applicants who hear nothing stop applying — a personal ` +
        `nudge here protects the whole marketplace.`,
      owner: 'Ops' as const,
    }))
}

/** R3 — cold vacancies: open >14d with zero applications. */
function coldVacancyRule(mi: MarketIntelligence): MarketRecommendation[] {
  const n = mi.health.cold_vacancies
  if (n < 1) return []
  return [{
    id: 'cold-vacancies',
    priority: 2,
    title: `${n} vacanc${n === 1 ? 'y has' : 'ies have'} zero applications after 14+ days`,
    detail:
      `Check them in the Operations tab: is the posting missing housing/salary/description, ` +
      `or is there simply no supply in that segment (see the matrix)? ` +
      `Fix the posting or recruit the segment.`,
    owner: 'Product',
  }]
}

/** R4 — stale supply: open-to-play inventory that has gone quiet. */
function staleSupplyRule(mi: MarketIntelligence): MarketRecommendation[] {
  const { stale_supply, active_supply } = mi.health
  if (stale_supply < 5 || stale_supply < active_supply * 0.5) return []
  return [{
    id: 'stale-supply',
    priority: 2,
    title: `Re-engage ${stale_supply} stale open-to-play players`,
    detail:
      `${stale_supply} players say they're open to play but haven't touched their profile in 60+ days ` +
      `(vs ${active_supply} active). A re-engagement email pointing at current open vacancies turns ` +
      `dead inventory back into supply.`,
    owner: 'Growth',
  }]
}

/** R5 — funnel diagnosis: is the leak traffic→application or application→response? */
function funnelRule(mi: MarketIntelligence): MarketRecommendation[] {
  const vf = mi.vacancy_funnel
  if (vf.published < 3) return [] // too small to diagnose
  const recs: MarketRecommendation[] = []
  if (vf.viewed >= 3 && vf.applied / vf.viewed < 0.5) {
    recs.push({
      id: 'funnel-view-to-apply',
      priority: 2,
      title: 'Vacancies get viewed but not applied to',
      detail:
        `${vf.viewed} of ${vf.published} vacancies were viewed but only ${vf.applied} received an ` +
        `application — a conversion problem, not a traffic problem. Look at posting quality and ` +
        `apply-flow friction before spending on acquisition.`,
      owner: 'Product',
    })
  }
  return recs
}

/** R6 — marketplace response health: the club side of the contract. */
function responseRateRule(mi: MarketIntelligence): MarketRecommendation[] {
  const { total_apps, responded_apps } = mi.health
  if (total_apps < 5) return []
  const rate = responded_apps / total_apps
  if (rate >= 0.5) return []
  return [{
    id: 'response-rate',
    priority: 1,
    title: `Only ${Math.round(rate * 100)}% of applications ever get a response`,
    detail:
      `${total_apps - responded_apps} of ${total_apps} applications are still unanswered. ` +
      `This is the biggest silent killer of a talent marketplace — players who apply into silence ` +
      `don't apply twice. Work the club backlog list below, and consider automated reminders.`,
    owner: 'Ops',
  }]
}

/**
 * Evaluate all rules, order by priority, cap at 5 so the panel stays a
 * to-do list rather than a report.
 */

/** R7 — burned applicants: applied, never received ANY response, gone quiet.
 *  The single highest-risk churn cohort a marketplace has; at current scale
 *  this is a personal-outreach list, not a segment. */
function burnedCohortRule(mi: MarketIntelligence): MarketRecommendation[] {
  const b = mi.player_behavior?.burned
  if (!b || b.count < 3) return []
  const names = b.players.slice(0, 3).map((p) => p.name ?? 'a player').join(', ')
  return [{
    id: 'burned-cohort',
    priority: 1,
    title: `${b.count} players applied and never heard anything back`,
    detail:
      `Every one of their applications is still unanswered, the most recent from ` +
      `${b.players[0]?.days_since_last_app ?? '?'}+ days ago (${names}${b.count > 3 ? ', …' : ''}). ` +
      `They are the likeliest churners on the platform — a personal message beats any campaign here.`,
    owner: 'Ops',
  }]
}

/** R8 — posting quality: several open vacancies are badly under-specified.
 *  Checklist-based (see open_vacancy_quality) — honest at small N. */
function postingQualityRule(mi: MarketIntelligence): MarketRecommendation[] {
  const weak = (mi.open_vacancy_quality ?? []).filter((q) => q.score < 50)
  if (weak.length < 2) return []
  const missingCounts = new Map<string, number>()
  for (const q of weak) for (const m of q.missing) {
    missingCounts.set(m, (missingCounts.get(m) ?? 0) + 1)
  }
  const topMissing = [...missingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([attr]) => attr.replace('_', ' '))
    .join(', ')
  return [{
    id: 'posting-quality',
    priority: 2,
    title: `${weak.length} open vacancies are under-specified (quality below 50)`,
    detail:
      `Most commonly missing: ${topMissing}. Complete postings attract more applicants — ` +
      `help these clubs fill the gaps (see the quality list below), and consider making ` +
      `the posting flow nudge for these fields.`,
    owner: 'Product',
  }]
}

/** R9 — corridor: name the strongest supply→demand country pair, so
 *  acquisition targets pairs of markets rather than countries in isolation. */
function corridorRule(mi: MarketIntelligence): MarketRecommendation[] {
  const top = mi.corridors?.flows?.[0]
  if (!top || top.applications < 5) return []
  return [{
    id: `corridor:${top.from_country}:${top.to_country}`,
    priority: 3,
    title: `Your strongest corridor: ${top.from_country} → ${top.to_country}`,
    detail:
      `${top.applications} applications flow from ${top.from_country} players to ` +
      `${top.to_country} vacancies. Marketplace liquidity is corridor-shaped — recruiting ` +
      `more ${top.from_country} players and more ${top.to_country} clubs compounds; ` +
      `treat them as one market in campaigns.`,
    owner: 'Growth',
  }]
}

export function evaluateMarketRules(mi: MarketIntelligence): MarketRecommendation[] {
  return [
    ...gapRules(mi),
    ...clubBacklogRules(mi),
    ...responseRateRule(mi),
    ...burnedCohortRule(mi),
    ...coldVacancyRule(mi),
    ...postingQualityRule(mi),
    ...staleSupplyRule(mi),
    ...funnelRule(mi),
    ...corridorRule(mi),
  ]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5)
}