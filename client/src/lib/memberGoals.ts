import { supabase } from '@/lib/supabase'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { countryInSentence } from '@/lib/brandOffers'
import { withLazyText } from '@/lib/opportunityLazyText'
import { tHome } from '@/i18n/ns/home'
import type enHome from '@/locales/en/home.json'

/**
 * "What's your goal?" v1 on today's Home (founder 2026-10-25; Figma page 02,
 * section YG: G1–G5). A member's goal is private: never on the profile, in
 * search, or per person to clubs or brands. Stored in member_goals through
 * RPCs only (20261025150000).
 */

export type GoalRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'
export const GOAL_MAX = 3
export const GOAL_TEXT_MAX = 120

/** A goal option whose label is read in the interface language on every access. */
type GoalOptionKey = keyof typeof enHome.goalOptions
const option = (key: GoalOptionKey): { key: string; label: string } => withLazyText({ key: key as string }, { label: () => tHome(`goalOptions.${key}`) })

/** Options by role (design defaults; keys mirror goal_option_keys on the server). Labels: home catalog `goalOptions.<key>`. */
export const GOAL_OPTIONS: Record<GoalRole, { key: string; label: string }[]> = {
  player: (['play_abroad', 'move_up', 'club_near_me', 'get_sponsor', 'keep_playing'] as const).map(option),
  coach: (['coach_abroad', 'coach_higher', 'club_near_me', 'recruit_players', 'grow_coach'] as const).map(option),
  club: (['fill_role', 'sign_abroad', 'find_coach', 'find_sponsors', 'grow_club'] as const).map(option),
  brand: (['find_ambassadors', 'reach_new_countries', 'reach_clubs'] as const).map(option),
  umpire: (['umpire_higher', 'umpire_abroad', 'build_record'] as const).map(option),
}

export function isGoalRole(role: string | null | undefined): role is GoalRole {
  return role === 'player' || role === 'coach' || role === 'club' || role === 'brand' || role === 'umpire'
}

export interface MyGoal {
  options: string[]
  other_text: string | null
  set_at: string | null
  later_count: number
  should_ask: boolean
}

/** The set card title: picks in option order, then the member's own words. */
export function goalTitle(role: GoalRole, goal: Pick<MyGoal, 'options' | 'other_text'>): string {
  const labels = GOAL_OPTIONS[role].filter((o) => goal.options.includes(o.key)).map((o) => o.label)
  if (goal.other_text) labels.push(goal.other_text)
  return labels.join(' · ')
}

// ── Server calls ────────────────────────────────────────────────────────────

export async function fetchMyGoal(): Promise<MyGoal | null> {
  const { data, error } = await supabase.rpc('get_my_goal')
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as MyGoal | undefined
  return row ?? null
}

export async function saveMyGoal(options: string[], otherText: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_goal', { p_options: options, p_other_text: (otherText ?? '').trim() || (null as unknown as string) })
  if (error) throw error
}

export async function goalLater(): Promise<number> {
  const { data, error } = await supabase.rpc('goal_later')
  if (error) throw error
  return (data as number) ?? 1
}

export interface GoalActionData {
  roles_abroad?: number
  roles_home?: number
  position?: string | null
  open_roles?: number
  applicants_waiting?: number
}

export async function fetchGoalActions(): Promise<GoalActionData> {
  const { data, error } = await supabase.rpc('get_my_goal_actions')
  if (error) throw error
  return (data ?? {}) as GoalActionData
}

// ── Set-card rows: real data only; a row without data is hidden ─────────────

export interface GoalRow {
  key: string
  goal: string
  text: string
  action: string
  to: string
}

/** Positions with their own "abroad" line (home catalog `goalRows.abroadFor.<position>`). */
const POSITIONS_WITH_LINE = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
type LinePosition = (typeof POSITIONS_WITH_LINE)[number]
const hasLine = (position: string | null | undefined): position is LinePosition => (POSITIONS_WITH_LINE as readonly (string | null | undefined)[]).includes(position)

/**
 * Up to two rows (Figma G3 / G5). "Get a sponsor" and "Find ambassadors"
 * depend on Phase 4 (open to brand partnerships) and stay hidden until then.
 */
export function goalRows(role: GoalRole, goal: Pick<MyGoal, 'options'>, data: GoalActionData, countryName: string | null): GoalRow[] {
  const rows: GoalRow[] = []
  const has = (k: string) => goal.options.includes(k)
  const abroad = data.roles_abroad ?? 0
  const home = data.roles_home ?? 0

  if ((has('play_abroad') || has('coach_abroad')) && abroad > 0) {
    const position = role === 'player' && hasLine(data.position) ? data.position : null
    const text = position
      ? tHome(`goalRows.abroadFor.${position}`, { count: abroad })
      : tHome('goalRows.abroad', { count: abroad })
    rows.push({ key: 'abroad', goal: has('play_abroad') ? 'play_abroad' : 'coach_abroad', text, action: tHome('goalRows.see'), to: '/opportunities' })
  }
  if (has('club_near_me') && home > 0 && countryName) {
    rows.push({ key: 'home', goal: 'club_near_me', text: tHome('goalRows.inCountry', { count: home, country: countryInSentence(countryName) }), action: tHome('goalRows.see'), to: '/opportunities' })
  }
  if (role === 'club' && has('fill_role')) {
    const open = data.open_roles ?? 0
    const waiting = data.applicants_waiting ?? 0
    if (open > 0) {
      // Two separate facts on one row, separated by the interface's middle dot.
      const parts = [tHome('goalRows.openRoles', { count: open })]
      if (waiting > 0) parts.push(tHome('goalRows.applicantsWaiting', { count: waiting }))
      rows.push({ key: 'review', goal: 'fill_role', text: parts.join(' · '), action: tHome('goalRows.review'), to: '/opportunities' })
      rows.push({ key: 'post', goal: 'fill_role', text: tHome('goalRows.postAnother'), action: tHome('goalRows.postAction'), to: '/dashboard/opportunities/new' })
    } else {
      rows.push({ key: 'post', goal: 'fill_role', text: tHome('goalRows.postFirst'), action: tHome('goalRows.postAction'), to: '/dashboard/opportunities/new' })
    }
  }
  return rows.slice(0, 2)
}

// ── Events ──────────────────────────────────────────────────────────────────

export function trackGoal(event: 'goal_prompt_view' | 'goal_set' | 'goal_change' | 'goal_later' | 'goal_action', props: Record<string, unknown>): void {
  trackDbEvent(event, 'member_goal', undefined, { surface: 'home', ...props })
}
