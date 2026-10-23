import { isRecruiterProfile } from '@/lib/hockiaAi'
import { positionLabel } from '@/lib/identity'

/**
 * The Hockia AI sheet's context chip and first three choices, per role
 * (one-sheet handoff 2026-10-22, docs/design-handoff/hockia-ai-one-sheet.md).
 *
 * Founder calls on 2026-10-23: players have no saved goal yet, so their chip
 * is "Your profile · <position>" until the goal card ships; brands have
 * products and posts, not offers, so their chip and choices use those.
 *
 * Counts come only from real reads (AiContextFacts). An unknown count is
 * left out of the chip, never guessed.
 */

export type AiChoiceEyebrow = 'DO IT FOR ME' | 'ASK' | 'LEARN'

export type AiChoiceAction =
  | { type: 'send'; text: string }
  | { type: 'builder' }
  | { type: 'navigate'; to: string }

export interface AiChoice {
  eyebrow: AiChoiceEyebrow
  label: string
  action: AiChoiceAction
}

export interface AiContext {
  chip: string
  intro: string
  choices: AiChoice[]
}

export interface AiContextViewer {
  role?: string | null
  coach_recruits_for_team?: boolean | null
  position?: string | null
}

/** null = not read (or the read failed): the chip says nothing about it. */
export interface AiContextFacts {
  openRoles?: number | null
  pendingApplicants?: number | null
  coachingRolesOpen?: number | null
  products?: number | null
  appointments?: number | null
}

/** Where "Add my latest appointment" goes: the umpire's officiating tab, editor open. */
export const UMPIRE_ADD_APPOINTMENT_PATH = '/dashboard/profile?tab=officiating&add=appointment'

const known = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const send = (eyebrow: AiChoiceEyebrow, label: string, text = label): AiChoice => ({ eyebrow, label, action: { type: 'send', text } })

export function aiContextFor(viewer: AiContextViewer | null | undefined, facts: AiContextFacts, activeRoleTitle?: string | null): AiContext | null {
  if (!viewer?.role) return null

  if (isRecruiterProfile(viewer)) {
    const role = activeRoleTitle?.trim()
    const pending = facts.pendingApplicants
    return {
      chip: known(facts.openRoles) ? `Your roles · ${facts.openRoles} open` : 'Your roles',
      intro: 'Ask me anything about your roles. I already have them open.',
      choices: [
        send('DO IT FOR ME', role ? `Find available players for ${role}` : 'Find available players for my open role'),
        known(pending) && pending > 0
          ? send('ASK', `Summarise my ${plural(pending, 'applicant', 'applicants')}`, 'Summarise my applicants')
          : send('ASK', 'Summarise my applicants'),
        send('DO IT FOR ME', 'Draft a new role', 'Draft a role'),
      ],
    }
  }

  switch (viewer.role) {
    case 'player': {
      const position = positionLabel(viewer.position)
      return {
        chip: position ? `Your profile · ${position}` : 'Your profile',
        intro: 'Ask me anything about your hockey. I can see your profile.',
        choices: [
          send('DO IT FOR ME', 'Find roles that fit me'),
          send('ASK', 'Check my profile against a role'),
          { eyebrow: 'DO IT FOR ME', label: 'Fill my profile from my files', action: { type: 'builder' } },
        ],
      }
    }
    case 'coach':
      return {
        chip: known(facts.coachingRolesOpen) ? `Coaching roles · ${facts.coachingRolesOpen} open` : 'Coaching roles',
        intro: 'Ask me anything about coaching roles. I already have them open.',
        choices: [
          send('DO IT FOR ME', 'Find coaching roles for me'),
          send('ASK', 'Check my profile against a role'),
          send('DO IT FOR ME', 'Prepare my application', 'Help me prepare an application for a coaching role'),
        ],
      }
    case 'brand':
      return {
        chip: known(facts.products) ? `Your products · ${facts.products}` : 'Your products',
        intro: 'Ask me anything about reaching members. I can see your products.',
        choices: [
          send('DO IT FOR ME', 'Find ambassador candidates in my countries'),
          send('ASK', 'How did my posts do this month?'),
          send('DO IT FOR ME', 'Write a post for members'),
        ],
      }
    case 'umpire':
      return {
        chip: known(facts.appointments) ? `Your record · ${plural(facts.appointments, 'appointment', 'appointments')}` : 'Your record',
        intro: 'Ask me anything about your officiating. I can see your record.',
        choices: [
          { eyebrow: 'DO IT FOR ME', label: 'Add my latest appointment', action: { type: 'navigate', to: UMPIRE_ADD_APPOINTMENT_PATH } },
          send('ASK', 'What is missing from my record?'),
          send('LEARN', 'Who are the umpires based in my country?'),
        ],
      }
    default:
      return null
  }
}
