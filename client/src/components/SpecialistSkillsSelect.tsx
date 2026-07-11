/**
 * SpecialistSkillsSelect — toggle-chip multi-select over the curated
 * specialist vocabulary (Matching Increment #3). Shared by the player
 * profile editor (their skills) and the opportunity form (skills wanted).
 * Stores/returns the raw `value` keys.
 */

import { SPECIALIST_SKILLS } from '@/lib/specialistSkills'

interface SpecialistSkillsSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  label?: string
  hint?: string
  /** Player/opportunity position — gates GK-only tags (e.g. Sweeper
   *  Keeper) to goalkeepers. Omit to show all tags. */
  position?: string | null
}

export default function SpecialistSkillsSelect({ value, onChange, label, hint, position }: SpecialistSkillsSelectProps) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  const isGk = (position ?? '').toLowerCase() === 'goalkeeper'
  const skills = SPECIALIST_SKILLS.filter((s) => !s.gkOnly || isGk)

  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>}
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {skills.map((s) => {
          const active = value.includes(s.value)
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => toggle(s.value)}
              aria-pressed={active}
              className={[
                'px-3 py-1.5 rounded-full text-sm border transition-colors',
                active
                  ? 'border-hockia-primary bg-hockia-primary/10 text-[#5b16b8] font-medium'
                  : 'border-gray-300 text-gray-600 hover:border-gray-400',
              ].join(' ')}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
