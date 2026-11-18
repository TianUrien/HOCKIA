/** Coach specialization types and display helpers. */
import { withLazyText } from '@/lib/opportunityLazyText'
import { tEnums } from '@/i18n/ns/enums'

export type CoachSpecialization =
  | 'head_coach'
  | 'assistant_coach'
  | 'goalkeeper_coach'
  | 'youth_coach'
  | 'strength_conditioning'
  | 'performance_analyst'
  | 'sports_scientist'
  | 'other'

export interface CoachSpecializationOption {
  value: CoachSpecialization
  label: string
  description: string
}

/** Labels in sentence case (design audit A6, 2026-10-21). Text follows the interface language. */
export const COACH_SPECIALIZATIONS: CoachSpecializationOption[] = [
  withLazyText({ value: 'head_coach' as const }, { label: () => tEnums('coachSpecializationOption.head_coach.label'), description: () => tEnums('coachSpecializationOption.head_coach.description') }),
  withLazyText({ value: 'assistant_coach' as const }, { label: () => tEnums('coachSpecializationOption.assistant_coach.label'), description: () => tEnums('coachSpecializationOption.assistant_coach.description') }),
  withLazyText({ value: 'goalkeeper_coach' as const }, { label: () => tEnums('coachSpecializationOption.goalkeeper_coach.label'), description: () => tEnums('coachSpecializationOption.goalkeeper_coach.description') }),
  withLazyText({ value: 'youth_coach' as const }, { label: () => tEnums('coachSpecializationOption.youth_coach.label'), description: () => tEnums('coachSpecializationOption.youth_coach.description') }),
  withLazyText({ value: 'strength_conditioning' as const }, { label: () => tEnums('coachSpecializationOption.strength_conditioning.label'), description: () => tEnums('coachSpecializationOption.strength_conditioning.description') }),
  withLazyText({ value: 'performance_analyst' as const }, { label: () => tEnums('coachSpecializationOption.performance_analyst.label'), description: () => tEnums('coachSpecializationOption.performance_analyst.description') }),
  withLazyText({ value: 'sports_scientist' as const }, { label: () => tEnums('coachSpecializationOption.sports_scientist.label'), description: () => tEnums('coachSpecializationOption.sports_scientist.description') }),
  withLazyText({ value: 'other' as const }, { label: () => tEnums('coachSpecializationOption.other.label'), description: () => tEnums('coachSpecializationOption.other.description') }),
]

/** Returns the display label for a specialization key, or the custom title for 'other'. */
export function getSpecializationLabel(
  specialization: string | null | undefined,
  customTitle?: string | null
): string {
  if (!specialization) return tEnums('coachSpecializationOption.fallback')
  if (specialization === 'other' && customTitle) return customTitle
  const option = COACH_SPECIALIZATIONS.find(s => s.value === specialization)
  return option?.label ?? tEnums('coachSpecializationOption.fallback')
}
