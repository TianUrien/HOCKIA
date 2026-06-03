/**
 * Specialist role/skill tags (Matching Increment #3). Curated field-hockey
 * specialisms that coaches actually recruit for — layered on top of
 * position. Stored as text[] of these `value` keys on profiles
 * (specialist_skills) and opportunities (specialist_skills_wanted).
 *
 * Single source of truth for the picker, the opportunity form, and the
 * read-only display. Add/rename here only — the DB stores the raw value,
 * so renaming a label is safe; renaming a value needs a data backfill.
 */

export interface SpecialistSkill {
  value: string
  label: string
  /** When true, only relevant to goalkeepers — the chip is hidden for
   *  non-GK players / non-GK opportunities. */
  gkOnly?: boolean
}

// v1 vocabulary — terms real coaches/recruiters/players recognise across
// international hockey. Deliberately short (≤8); expand only on demand.
export const SPECIALIST_SKILLS: readonly SpecialistSkill[] = [
  { value: 'drag_flicker', label: 'Drag Flicker' },
  { value: 'penalty_corner', label: 'Penalty Corner Specialist' },
  { value: 'playmaker', label: 'Playmaker' },
  { value: 'target_forward', label: 'Target Forward' },
  { value: 'defensive_leader', label: 'Defensive Leader' },
  { value: 'sweeper_keeper', label: 'Sweeper Keeper', gkOnly: true },
  { value: 'pressing', label: 'Pressing Specialist' },
  { value: 'indoor', label: 'Indoor Hockey Specialist' },
] as const

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  SPECIALIST_SKILLS.map((s) => [s.value, s.label]),
)

/** Human label for a stored specialist value; falls back to a title-cased
 *  version so an unknown/retired value still reads cleanly. */
export function specialistSkillLabel(value: string): string {
  return (
    LABEL_BY_VALUE[value] ??
    value
      .split(/[\s_-]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ')
  )
}

/** Map a list of stored values to display labels (drops empties). */
export function specialistSkillLabels(values: string[] | null | undefined): string[] {
  return (values ?? []).map(specialistSkillLabel).filter(Boolean)
}
