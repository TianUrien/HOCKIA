/**
 * The member's private goal for Hockia AI (founder 2026-10-30): the AI may
 * read it to tailor the member's own answers, never to show anyone else.
 * Labels mirror client/src/lib/memberGoals.ts GOAL_OPTIONS (keys are the
 * server's goal_option_keys).
 */

const GOAL_LABELS: Record<string, string> = {
  play_abroad: 'Play abroad',
  move_up: 'Move up a division',
  club_near_me: 'Find a club where I live',
  get_sponsor: 'Get a sponsor',
  keep_playing: 'Keep playing well',
  coach_abroad: 'Coach abroad',
  coach_higher: 'Coach at a higher level',
  recruit_players: 'Recruit players for my team',
  grow_coach: 'Grow as a coach',
  fill_role: 'Fill a spot this season',
  sign_abroad: 'Sign players from abroad',
  find_coach: 'Find a coach',
  find_sponsors: 'Find sponsors',
  grow_club: 'Grow our club',
  find_ambassadors: 'Find ambassadors',
  reach_new_countries: 'Reach players in new countries',
  reach_clubs: 'Reach clubs',
  umpire_higher: 'Umpire at a higher level',
  umpire_abroad: 'Umpire abroad',
  build_record: 'Build my record',
}

/** "Play abroad · Get a sponsor · <own words>"; null when nothing is set.
 *  The member's own words are flattened to one line, quotes softened and
 *  capped, like the bio, so they read as data in the prompt. */
export function goalSummary(options: string[] | null | undefined, otherText: string | null | undefined): string | null {
  const parts = (options ?? []).map((k) => GOAL_LABELS[k]).filter((l): l is string => !!l)
  const own = (otherText ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 120)
  if (own) parts.push(own)
  return parts.length > 0 ? parts.join(' · ') : null
}
