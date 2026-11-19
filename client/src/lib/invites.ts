import { positionLabel } from '@/lib/identity'
import { formatList, isEnglish } from '@/i18n/format'
import { tInbox } from '@/i18n/ns/inbox'

/**
 * D3 · Invite to apply (Figma page 400:4; brief 402:83; DEV NOTES 394:98,
 * 394:102, 394:107, 394:111). Pure rules and copy shared by the club screens
 * (Shortlist / Find players / club view of a profile), the invite sheet and
 * the invite card in the chat.
 *
 * The server (send_invite / respond_invite) is the authority for every rule
 * below; the client mirrors them only to decide what to render.
 */

export type InviteStatus = 'sent' | 'applied' | 'declined' | 'expired'

/** What the club sees in place of Invite for one player (brief: "otherwise their status pill"). */
/** passed = the player passed on every open role of this club (founder ruling 2026-10-01). */
export type InvitePill = 'applied' | 'invited' | 'passed'

/** Application statuses that keep a player "in the club's pipeline" (same list as send_invite). */
export const OPEN_APPLICATION_STATUSES = ['pending', 'shortlisted', 'maybe', 'offered', 'accepted', 'signed_pending_confirmation'] as const

export const INVITE_NOTE_MAX = 500

/** Founder ruling 2026-09-26: 20 invites a day, 5 a day in the club's first week. */
export function inviteDailyLimit(publisherCreatedAt: string | null | undefined, now = new Date()): number {
  if (!publisherCreatedAt) return 20
  const t = new Date(publisherCreatedAt).getTime()
  if (Number.isNaN(t)) return 20
  return now.getTime() - t < 7 * 24 * 60 * 60 * 1000 ? 5 : 20
}

/**
 * Who can be invited (DEV NOTE 394:102 + founder ruling 2026-09-27): a player
 * who is open to play and 18+ by a KNOWN date of birth. Anyone else → the
 * button doesn't render.
 */
export function isInvitablePlayer(p: { role?: string | null; open_to_play?: boolean | null; age?: number | null }): boolean {
  return p.role === 'player' && p.open_to_play === true && typeof p.age === 'number' && p.age >= 18
}

/** "Daily limit reached → button disabled with the reason" (brief). */
export function inviteLimitReason(limit: number): string {
  return tInbox('invites.limitReason', { count: limit })
}

/** The sheet footer (D3.2): what the player sees and what happens if they apply. Gender-neutral. */
export function inviteSheetFooter(firstName: string): string {
  return tInbox('invites.sheetFooter', { name: firstName })
}

export function firstNameOf(fullName: string | null | undefined, fallback: string = tInbox('invites.thisPlayer')): string {
  return fullName?.trim().split(/\s+/)[0] || fallback
}

// ── The note (D3.2): drafted from the role fields and the club name only ──

const BENEFIT_ORDER = ['housing', 'flights', 'insurance', 'job', 'bonuses', 'visa', 'car', 'equipment', 'meals', 'education'] as const
type Benefit = (typeof BENEFIT_ORDER)[number]
const isBenefit = (b: string): b is Benefit => (BENEFIT_ORDER as readonly string[]).includes(b)

/** A benefit inside the drafted note ("a job", "visa support"). */
function benefitWord(b: Benefit): string {
  switch (b) {
    case 'housing': return tInbox('invites.note.benefits.housing')
    case 'flights': return tInbox('invites.note.benefits.flights')
    case 'insurance': return tInbox('invites.note.benefits.insurance')
    case 'job': return tInbox('invites.note.benefits.job')
    case 'bonuses': return tInbox('invites.note.benefits.bonuses')
    case 'visa': return tInbox('invites.note.benefits.visa')
    case 'car': return tInbox('invites.note.benefits.car')
    case 'equipment': return tInbox('invites.note.benefits.equipment')
    case 'meals': return tInbox('invites.note.benefits.meals')
    case 'education': return tInbox('invites.note.benefits.education')
  }
}

/** A benefit on the role card ("Housing", "Visa"). */
function benefitTile(b: Benefit): string {
  switch (b) {
    case 'housing': return tInbox('invites.offerLine.housing')
    case 'flights': return tInbox('invites.offerLine.flights')
    case 'insurance': return tInbox('invites.offerLine.insurance')
    case 'job': return tInbox('invites.offerLine.job')
    case 'bonuses': return tInbox('invites.offerLine.bonuses')
    case 'visa': return tInbox('invites.offerLine.visa')
    case 'car': return tInbox('invites.offerLine.car')
    case 'equipment': return tInbox('invites.offerLine.equipment')
    case 'meals': return tInbox('invites.offerLine.meals')
    case 'education': return tInbox('invites.offerLine.education')
  }
}

/** A known benefit token as a card label ("Housing"); null for free text. */
export function benefitLabel(token: string): string | null {
  const b = token.trim().toLowerCase()
  return isBenefit(b) ? benefitTile(b) : null
}

function teamWord(gender: string | null | undefined): string | null {
  switch (gender?.trim().toLowerCase()) {
    case 'men': return tInbox('invites.note.team.men')
    case 'women': return tInbox('invites.note.team.women')
    case 'mixed': return tInbox('invites.note.team.mixed')
    case 'boys': return tInbox('invites.note.team.boys')
    case 'girls': return tInbox('invites.note.team.girls')
    default: return null
  }
}

/** "a, b and c" in English (no serial comma, as before); Intl elsewhere. */
function listWords(words: string[]): string {
  if (!isEnglish()) return formatList(words)
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export interface InviteRole {
  id: string
  title: string
  position: string | null
  gender: string | null
  compensation: string | null
  benefits: string[] | null
  opportunity_type?: string | null
  /** Who the role is for when a coach posted it (the invite note names it). */
  world_club_id?: string | null
  organization_name?: string | null
}

/** "Paid · Housing · Flights · Insurance · Job" — the role's offer, for the sheet's role card. */
export function roleOfferLine(r: Pick<InviteRole, 'compensation' | 'benefits'>): string | null {
  const c = (r.compensation ?? '').toLowerCase()
  const paid = c === 'paid' || c === 'either'
  const benefits = (r.benefits ?? []).map((b) => b.toLowerCase()).filter((b, i, a): b is Benefit => isBenefit(b) && a.indexOf(b) === i)
    .sort((a, b) => BENEFIT_ORDER.indexOf(a) - BENEFIT_ORDER.indexOf(b))
    .map(benefitTile)
  const parts = [paid ? tInbox('invites.offerLine.paid') : null, ...benefits].filter(Boolean) as string[]
  return parts.length ? parts.join(', ') : null
}

/** "Midfielder · Men’s 1st player" — position first, then the club's title (D3.2 role card). */
export function inviteRoleLabel(r: Pick<InviteRole, 'title' | 'position' | 'opportunity_type'>): string {
  const pos = r.opportunity_type !== 'coach' && r.position ? positionLabel(r.position) : null
  const title = r.title?.trim() || null
  if (pos && title && title.toLowerCase() !== pos.toLowerCase()) return `${pos}, ${title}`
  return title || pos || tInbox('invites.roleFallback')
}

/**
 * The note Hockia drafts (DEV NOTE 394:102: "uses only role fields and the
 * club name"): position, team, pay and package from the role; the club's
 * name. Nothing about the player beyond the first name the club already sees.
 */
export function draftInviteNote(opts: { firstName: string; clubName: string | null | undefined; role: InviteRole }): string {
  const { role } = opts
  const club = opts.clubName?.trim() || tInbox('invites.note.clubFallback')
  const pos = role.opportunity_type !== 'coach' && role.position ? positionLabel(role.position)?.toLowerCase() ?? null : null
  const team = teamWord(role.gender)
  const where = team ? tInbox('invites.note.clubTeam', { club, team }) : club
  const firstName = opts.firstName
  const greeting = pos
    ? (/^[aeiou]/i.test(pos)
      ? tInbox('invites.note.greetingPositionAn', { firstName, position: pos, where })
      : tInbox('invites.note.greetingPositionA', { firstName, position: pos, where }))
    : tInbox('invites.note.greetingRole', { firstName, where, title: role.title.trim() || tInbox('invites.note.titleFallback') })
  const c = (role.compensation ?? '').toLowerCase()
  const offer = [
    c === 'paid' || c === 'either' ? tInbox('invites.note.benefits.pay') : null,
    ...(role.benefits ?? []).map((b) => b.toLowerCase()).filter((b, i, a): b is Benefit => isBenefit(b) && a.indexOf(b) === i)
      .sort((a, b) => BENEFIT_ORDER.indexOf(a) - BENEFIT_ORDER.indexOf(b))
      .map(benefitWord),
  ].filter(Boolean) as string[]
  const lines = [
    greeting,
    offer.length ? tInbox('invites.note.includes', { list: listWords(offer) }) : null,
    tInbox('invites.note.question'),
  ].filter(Boolean)
  return lines.join(' ').slice(0, INVITE_NOTE_MAX)
}

// ── Server errors → what the club reads ──

/** The server's refusals (English, matched by prefix) and what the club reads.
 *  The server still says "role"; members read "opportunity" (rebrand 2026-10-25). */
const PASS_THROUGH = [
  ['This player passed on this role', 'invites.errors.passed'],
  ['This person can’t be invited to this role', 'invites.errors.cannotInvite'],
  ['This person can\'t be invited to this role', 'invites.errors.cannotInvite'],
  ['This player has already applied to one of your roles', 'invites.errors.alreadyApplied'],
  ['This player already has an open invite from you', 'invites.errors.alreadyInvited'],
  ['This role is not open', 'invites.errors.roleNotOpen'],
  ['The note can be up to 500 characters', 'invites.errors.noteTooLong'],
  ['You can only invite players to your own roles', 'invites.errors.ownRolesOnly'],
] as const

/** The fallback copy, in English — the only invite refusal that is worth reporting to Sentry. */
export const INVITE_GENERIC_ERROR = 'Couldn’t send the invite. Please try again.'

/** The fallback copy in the interface language (what inviteErrorMessage returns). */
export function inviteGenericError(): string {
  return tInbox('invites.errors.generic')
}

export function inviteErrorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  const limit = /Daily invite limit reached \((\d+) per day\)/.exec(msg)
  if (limit) return inviteLimitReason(Number(limit[1]))
  if (msg.startsWith('This person can')) return tInbox('invites.errors.cannotInvite')
  const hit = PASS_THROUGH.find(([prefix]) => msg.startsWith(prefix))
  if (hit) return tInbox(hit[1])
  return inviteGenericError()
}

export function respondErrorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  if (msg.startsWith('This invite has expired')) return tInbox('invites.respondErrors.expired')
  if (msg.startsWith('This invite has already been answered')) return tInbox('invites.respondErrors.answered')
  return tInbox('invites.respondErrors.generic')
}

// ── The card in the chat (D3.3) ──

export interface InviteCardState {
  /** Card greys out (brief: "Role closed → invite card greys out for the player"). */
  muted: boolean
  /** Player: the three actions show only while the invite is open. */
  actionable: boolean
  /** One line under the note when the card is not actionable (or always, for the club). */
  line: string | null
  /**
   * Tone of that line: always grey — every invite status is a closed outcome or
   * a wait for both sides; amber only when the viewer must act (founder rule).
   */
  tone: 'grey'
}

/**
 * What the invite card says, from the invite's status, its expiry and the
 * role's status. Player viewer = the invited player; club viewer = the
 * publisher. Colour depends on the viewer (founder ruling 2026-09-26): the
 * club's "Invitation pending" is grey; the player's card is never amber.
 */
export function inviteCardState(opts: {
  viewer: 'player' | 'club'
  status: InviteStatus
  expiresAt: string | null
  roleOpen: boolean
  playerFirstName?: string
  now?: Date
}): InviteCardState {
  const now = opts.now ?? new Date()
  const lapsed = opts.status === 'sent' && ((opts.expiresAt && new Date(opts.expiresAt).getTime() <= now.getTime()) || !opts.roleOpen)
  const status: InviteStatus = lapsed ? 'expired' : opts.status
  const who = opts.playerFirstName || tInbox('invites.card.playerFallback')
  if (status === 'applied') {
    return { muted: false, actionable: false, line: opts.viewer === 'player' ? tInbox('invites.card.appliedPlayer') : tInbox('invites.card.appliedClub', { name: who }), tone: 'grey' }
  }
  if (status === 'declined') {
    return { muted: true, actionable: false, line: opts.viewer === 'player' ? tInbox('invites.card.passedPlayer') : tInbox('invites.card.passedClub', { name: who }), tone: 'grey' }
  }
  if (status === 'expired') {
    const line = !opts.roleOpen ? tInbox('invites.card.closed') : tInbox('invites.card.expired')
    return { muted: true, actionable: false, line, tone: 'grey' }
  }
  return opts.viewer === 'player'
    ? { muted: false, actionable: true, line: null, tone: 'grey' }
    : { muted: false, actionable: false, line: tInbox('invites.card.pending'), tone: 'grey' }
}
