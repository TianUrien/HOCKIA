import { GOAL_OPTIONS, isGoalRole, type MyGoal } from '@/lib/memberGoals'
import { tHockiaAi } from '@/i18n/ns/hockiaAi'

/**
 * The Hockia AI sheet's context chip (rebrand page 17, store screenshot 10;
 * docs/design-handoff/hockia-ai-one-sheet.md): one removable pill saying
 * what the AI is looking at, "<Topic> · <fact>".
 *
 * Counts come only from real reads; a count that is unknown or 0 is left
 * out ("Opportunities", never "Opportunities · 0 open").
 */

export interface AiContextChip {
  /** 'goal' = the member's private goal, which Hockia AI reads server-side. */
  kind: 'goal' | 'screen'
  topic: string
  fact: string | null
}

export interface AiChipInput {
  role: string | null | undefined
  /** Clubs and coaches who recruit for a team. */
  recruiter: boolean
  /** Where the sheet was opened from (hockiaAiSheetStore entry). */
  entry: string
  goalLabel: string | null
  openOpportunities?: number | null
  myOpenRoles?: number | null
  liveOffers?: number | null
  matchesOfficiated?: number | null
}

type CountKey = 'context.openCount' | 'context.liveCount' | 'context.officiatedCount'
const counted = (n: number | null | undefined, key: CountKey): string | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? tHockiaAi(key, { count: n }) : null

export function aiContextChip(i: AiChipInput): AiContextChip | null {
  if (!i.role) return null
  if (i.recruiter) return { kind: 'screen', topic: tHockiaAi('context.yourOpportunities'), fact: counted(i.myOpenRoles, 'context.openCount') }
  if (i.role === 'brand') return { kind: 'screen', topic: tHockiaAi('context.yourOffers'), fact: counted(i.liveOffers, 'context.liveCount') }
  // Umpires: "Matches officiated", never "appointments" (founder 2026-10-03).
  if (i.role === 'umpire') {
    return { kind: 'screen', topic: tHockiaAi('context.yourRecord'), fact: counted(i.matchesOfficiated, 'context.officiatedCount') }
  }
  if (i.entry === 'opportunities') {
    return { kind: 'screen', topic: i.role === 'coach' ? tHockiaAi('context.coachingOpportunities') : tHockiaAi('context.opportunities'), fact: counted(i.openOpportunities, 'context.openCount') }
  }
  if (i.goalLabel) return { kind: 'goal', topic: tHockiaAi('context.yourGoal'), fact: i.goalLabel }
  return null
}

export function aiContextChipLabel(c: AiContextChip): string {
  return c.fact ? tHockiaAi('context.chipLabel', { topic: c.topic, fact: c.fact }) : c.topic
}

/** The chip shows the first pick ("Play abroad"), or the member's own words. */
export function goalChipLabel(role: string | null | undefined, goal: Pick<MyGoal, 'options' | 'other_text'> | null | undefined): string | null {
  if (!goal || !isGoalRole(role)) return null
  const first = GOAL_OPTIONS[role].find((o) => goal.options.includes(o.key))
  return first?.label ?? (goal.other_text?.trim() || null)
}

/** Greeting while the goal chip is on; ✕ drops "and your goal". */
export function goalIntro(goalOn: boolean): string {
  return goalOn ? tHockiaAi('intro.goalOn') : tHockiaAi('intro.goalOff')
}
