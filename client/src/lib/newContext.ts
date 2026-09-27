import type { CreateContextInput, UpdateContextInput } from '@/hooks/useRecruitingContext'
import { recruitingTarget, type RoleGender, type RoleLevel, type RolePosition } from '@/lib/postRole'

/**
 * "New context" (Figma D1.23 355:528, DEV NOTE 355:931): a saved search
 * without a posting, built from the Post a role step-1 criteria. It is a
 * `custom` recruiting_context row: create_active_recruiting_context makes it
 * the active one (team → target_category, region, label), then the step-1
 * criteria are written onto the same row (target_role / target_position /
 * target_level / target_specialists and the must-have flags) — the columns
 * the opportunity RPC copies from a role, read by Find players and Community.
 */
export type ContextKind = 'player' | 'coach'

export interface NewContextDraft {
  position: RolePosition | null
  positionRequired: boolean
  gender: RoleGender | null
  label: string
  level: RoleLevel | null
  levelRequired: boolean
  skills: string[]
  skillsRequired: boolean
  region: string
}

export const LABEL_MAX = 60

export function emptyContextDraft(): NewContextDraft {
  return { position: null, positionRequired: false, gender: null, label: '', level: null, levelRequired: false, skills: [], skillsRequired: false, region: '' }
}

/** What stops Save: fit is measured against a team, so the team is required. */
export function newContextProblem(d: NewContextDraft, kind: ContextKind): string | null {
  if (!d.position) return kind === 'player' ? 'Pick a position.' : 'Pick a role.'
  if (!d.gender) return 'Pick a team.'
  return null
}

export function newContextPayload(d: NewContextDraft, kind: ContextKind): { create: CreateContextInput; update: UpdateContextInput } {
  const player = kind === 'player'
  const label = d.label.trim().slice(0, LABEL_MAX) || null
  const region = d.region.trim() || null
  const skills = player ? d.skills : []
  return {
    create: { type: 'custom', target_category: recruitingTarget(d.gender), region, label },
    update: {
      target_role: kind,
      target_position: d.position,
      target_level: d.level,
      target_specialists: skills,
      position_required: player && d.positionRequired && !!d.position,
      level_required: player && d.levelRequired && !!d.level,
      specialists_required: player && d.skillsRequired && skills.length > 0,
    },
  }
}
