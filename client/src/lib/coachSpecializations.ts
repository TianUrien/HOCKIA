/** Coach specialization types and display helpers. */

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

/** Labels in sentence case (design audit A6, 2026-10-21). */
export const COACH_SPECIALIZATIONS: CoachSpecializationOption[] = [
  { value: 'head_coach', label: 'Head coach', description: 'Lead coach, tactical & team management' },
  { value: 'assistant_coach', label: 'Assistant coach', description: 'Supports head coach, session delivery' },
  { value: 'goalkeeper_coach', label: 'Goalkeeper coach', description: 'Specialist GK training & development' },
  { value: 'youth_coach', label: 'Youth / development coach', description: 'Age-group coaching, talent pathway' },
  { value: 'strength_conditioning', label: 'Strength & conditioning coach', description: 'Physical preparation, injury prevention' },
  { value: 'performance_analyst', label: 'Performance analyst', description: 'Video analysis, data & match statistics' },
  { value: 'sports_scientist', label: 'Sports scientist', description: 'Physiology, load monitoring, recovery' },
  { value: 'other', label: 'Other', description: 'A different coaching or staff role' },
]

/** Returns the display label for a specialization key, or the custom title for 'other'. */
export function getSpecializationLabel(
  specialization: string | null | undefined,
  customTitle?: string | null
): string {
  if (!specialization) return 'Coach'
  if (specialization === 'other' && customTitle) return customTitle
  const option = COACH_SPECIALIZATIONS.find(s => s.value === specialization)
  return option?.label ?? 'Coach'
}
