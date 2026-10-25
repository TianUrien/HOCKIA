import { supabase } from '@/lib/supabase'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { countryInSentence } from '@/lib/brandOffers'

/**
 * "What's your goal?" v1 on today's Home (founder 2026-10-25; Figma page 02,
 * section YG: G1–G5). A member's goal is private: never on the profile, in
 * search, or per person to clubs or brands. Stored in member_goals through
 * RPCs only (20261025150000).
 */

export type GoalRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'
export const GOAL_MAX = 3
export const GOAL_TEXT_MAX = 120

/** Options by role (design defaults; keys mirror goal_option_keys on the server). */
export const GOAL_OPTIONS: Record<GoalRole, { key: string; label: string }[]> = {
  player: [
    { key: 'play_abroad', label: 'Play abroad' },
    { key: 'move_up', label: 'Move up a division' },
    { key: 'club_near_me', label: 'Find a club where I live' },
    { key: 'get_sponsor', label: 'Get a sponsor' },
    { key: 'keep_playing', label: 'Keep playing well' },
  ],
  coach: [
    { key: 'coach_abroad', label: 'Coach abroad' },
    { key: 'coach_higher', label: 'Coach at a higher level' },
    { key: 'club_near_me', label: 'Find a club where I live' },
    { key: 'recruit_players', label: 'Recruit players for my team' },
    { key: 'grow_coach', label: 'Grow as a coach' },
  ],
  club: [
    { key: 'fill_role', label: 'Fill a spot this season' },
    { key: 'sign_abroad', label: 'Sign players from abroad' },
    { key: 'find_coach', label: 'Find a coach' },
    { key: 'find_sponsors', label: 'Find sponsors' },
    { key: 'grow_club', label: 'Grow our club' },
  ],
  brand: [
    { key: 'find_ambassadors', label: 'Find ambassadors' },
    { key: 'reach_new_countries', label: 'Reach players in new countries' },
    { key: 'reach_clubs', label: 'Reach clubs' },
  ],
  umpire: [
    { key: 'umpire_higher', label: 'Umpire at a higher level' },
    { key: 'umpire_abroad', label: 'Umpire abroad' },
    { key: 'build_record', label: 'Build my record' },
  ],
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

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const POSITION_PLURAL: Record<string, string> = { goalkeeper: 'goalkeepers', defender: 'defenders', midfielder: 'midfielders', forward: 'forwards' }

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
    const who = role === 'player' && data.position && POSITION_PLURAL[data.position] ? ` for ${POSITION_PLURAL[data.position]}` : ''
    rows.push({ key: 'abroad', goal: has('play_abroad') ? 'play_abroad' : 'coach_abroad', text: `${abroad} open ${plural(abroad, 'opportunity', 'opportunities')} abroad${who}`, action: 'See', to: '/opportunities' })
  }
  if (has('club_near_me') && home > 0 && countryName) {
    rows.push({ key: 'home', goal: 'club_near_me', text: `${home} open ${plural(home, 'opportunity', 'opportunities')} in ${countryInSentence(countryName)}`, action: 'See', to: '/opportunities' })
  }
  if (role === 'club' && has('fill_role')) {
    const open = data.open_roles ?? 0
    const waiting = data.applicants_waiting ?? 0
    if (open > 0) {
      const parts = [`${open} open ${plural(open, 'opportunity', 'opportunities')}`]
      if (waiting > 0) parts.push(`${waiting} ${plural(waiting, 'applicant', 'applicants')} waiting`)
      rows.push({ key: 'review', goal: 'fill_role', text: parts.join(' · '), action: 'Review', to: '/opportunities' })
      rows.push({ key: 'post', goal: 'fill_role', text: 'Post another opportunity in under a minute', action: 'Post an opportunity', to: '/dashboard/opportunities/new' })
    } else {
      rows.push({ key: 'post', goal: 'fill_role', text: 'Post an opportunity in under a minute', action: 'Post an opportunity', to: '/dashboard/opportunities/new' })
    }
  }
  return rows.slice(0, 2)
}

// ── Events ──────────────────────────────────────────────────────────────────

export function trackGoal(event: 'goal_prompt_view' | 'goal_set' | 'goal_change' | 'goal_later' | 'goal_action', props: Record<string, unknown>): void {
  trackDbEvent(event, 'member_goal', undefined, { surface: 'home', ...props })
}
