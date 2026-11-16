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

/** Spanish labels (Stage 3): client/src/locales/es/home.json goalOptions. Same keys as GOAL_LABELS. */
const GOAL_LABELS_ES: Record<string, string> = {
  play_abroad: 'Jugar en el exterior',
  move_up: 'Subir de categoría',
  club_near_me: 'Encontrar un club donde vivo',
  get_sponsor: 'Conseguir un sponsor',
  keep_playing: 'Seguir jugando bien',
  coach_abroad: 'Entrenar en el exterior',
  coach_higher: 'Entrenar en un nivel más alto',
  recruit_players: 'Sumar jugadoras y jugadores a mi equipo',
  grow_coach: 'Crecer como entrenador/a',
  fill_role: 'Cubrir un lugar esta temporada',
  sign_abroad: 'Incorporar deportistas del exterior',
  find_coach: 'Encontrar entrenador/a',
  find_sponsors: 'Encontrar sponsors',
  grow_club: 'Hacer crecer nuestro club',
  find_ambassadors: 'Encontrar embajadoras y embajadores',
  reach_new_countries: 'Llegar a deportistas de otros países',
  reach_clubs: 'Llegar a clubes',
  umpire_higher: 'Arbitrar en un nivel más alto',
  umpire_abroad: 'Arbitrar en el exterior',
  build_record: 'Sumar antecedentes',
}

/** "Play abroad · Get a sponsor · <own words>"; null when nothing is set.
 *  The member's own words are flattened to one line, quotes softened and
 *  capped, like the bio, so they read as data in the prompt. */
export function goalSummary(options: string[] | null | undefined, otherText: string | null | undefined, lang: 'en' | 'es' = 'en'): string | null {
  const labels = lang === 'es' ? GOAL_LABELS_ES : GOAL_LABELS
  const parts = (options ?? []).map((k) => labels[k]).filter((l): l is string => !!l)
  const own = (otherText ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 120)
  if (own) parts.push(own)
  return parts.length > 0 ? parts.join(' · ') : null
}
