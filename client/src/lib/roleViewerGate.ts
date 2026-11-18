import { tClub } from '@/i18n/ns/club'

/**
 * Who can act on a role page (design audit 2026-10-21, A7). The role page
 * was player-first: a coach on a player role hit a dead end with no reason,
 * and brands and umpires read apply copy ("Ask the club when you apply")
 * they can never act on. Non-applicants now get one plain note at the end of
 * the page and keep Message; apply copy is for applicants only.
 */
export type RoleViewerKind = 'applicant' | 'wrong_type' | 'browse_only' | 'publisher' | 'guest' | 'other'

export interface RoleViewerGate {
  kind: RoleViewerKind
  /** The end note shown instead of Apply, or null. */
  note: string | null
  /** Whether apply copy ("Ask the club when you apply", How applying works) is shown. */
  applyCopy: boolean
  /** Whether a Message action is offered without Apply. */
  messageOnly: boolean
}

// Functions, not constants: the text follows the interface language.
export const coachOnPlayerRoleNote = (): string => tClub('roleViewerGate.coachOnPlayerRole')
export const playerOnCoachRoleNote = (): string => tClub('roleViewerGate.playerOnCoachRole')
export const umpireBrowseNote = (): string => tClub('roleViewerGate.umpireBrowse')
export const brandBrowseNote = (): string => tClub('roleViewerGate.brandBrowse')

export function roleViewerGate(o: {
  viewerRole: string | null | undefined
  roleType: string | null | undefined
  isPublisher: boolean
  signedIn: boolean
}): RoleViewerGate {
  if (o.isPublisher) return { kind: 'publisher', note: null, applyCopy: false, messageOnly: false }
  // Guests see the role as a player would; Apply leads to the join sheet.
  if (!o.signedIn) return { kind: 'guest', note: null, applyCopy: true, messageOnly: false }
  const type = o.roleType ?? 'player'
  switch (o.viewerRole) {
    case 'player':
      return type === 'player'
        ? { kind: 'applicant', note: null, applyCopy: true, messageOnly: false }
        : { kind: 'wrong_type', note: playerOnCoachRoleNote(), applyCopy: false, messageOnly: true }
    case 'coach':
      return type === 'coach'
        ? { kind: 'applicant', note: null, applyCopy: true, messageOnly: false }
        : { kind: 'wrong_type', note: coachOnPlayerRoleNote(), applyCopy: false, messageOnly: true }
    case 'umpire':
      return { kind: 'browse_only', note: umpireBrowseNote(), applyCopy: false, messageOnly: true }
    case 'brand':
      return { kind: 'browse_only', note: brandBrowseNote(), applyCopy: false, messageOnly: true }
    default:
      // Clubs and anything else: no apply copy, no note (unchanged).
      return { kind: 'other', note: null, applyCopy: false, messageOnly: false }
  }
}
