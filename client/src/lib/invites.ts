import { positionLabel } from '@/lib/identity'

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
  return `You’ve sent ${limit} invites today, the daily limit. You can invite again tomorrow.`
}

/** The sheet footer (D3.2): what the player sees and what happens if they apply. Gender-neutral. */
export function inviteSheetFooter(firstName: string): string {
  return `${firstName} sees the role and your note in Inbox. If they apply, they go straight to To review, marked Invited.`
}

export function firstNameOf(fullName: string | null | undefined, fallback = 'this player'): string {
  return fullName?.trim().split(/\s+/)[0] || fallback
}

// ── The note (D3.2): drafted from the role fields and the club name only ──

const BENEFIT_WORDS: Record<string, string> = {
  housing: 'housing',
  flights: 'flights',
  insurance: 'insurance',
  job: 'a job',
  bonuses: 'bonuses',
  visa: 'visa support',
  car: 'a car',
  equipment: 'equipment',
  meals: 'meals',
  education: 'education',
}
const BENEFIT_ORDER = ['housing', 'flights', 'insurance', 'job', 'bonuses', 'visa', 'car', 'equipment', 'meals', 'education']

function teamWord(gender: string | null | undefined): string | null {
  switch (gender?.trim().toLowerCase()) {
    case 'men': return 'Men’s'
    case 'women': return 'Women’s'
    case 'mixed': return 'Mixed'
    case 'boys': return 'Boys'
    case 'girls': return 'Girls'
    default: return null
  }
}

function listWords(words: string[]): string {
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
}

/** "Paid · Housing · Flights · Insurance · Job" — the role's offer, for the sheet's role card. */
export function roleOfferLine(r: Pick<InviteRole, 'compensation' | 'benefits'>): string | null {
  const c = (r.compensation ?? '').toLowerCase()
  const paid = c === 'paid' || c === 'either'
  const benefits = (r.benefits ?? []).map((b) => b.toLowerCase()).filter((b, i, a) => BENEFIT_WORDS[b] && a.indexOf(b) === i)
    .sort((a, b) => BENEFIT_ORDER.indexOf(a) - BENEFIT_ORDER.indexOf(b))
    .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
  const parts = [paid ? 'Paid' : null, ...benefits].filter(Boolean) as string[]
  return parts.length ? parts.join(' · ') : null
}

/** "Midfielder · Men’s 1st player" — position first, then the club's title (D3.2 role card). */
export function inviteRoleLabel(r: Pick<InviteRole, 'title' | 'position' | 'opportunity_type'>): string {
  const pos = r.opportunity_type !== 'coach' && r.position ? positionLabel(r.position) : null
  const title = r.title?.trim() || null
  if (pos && title && title.toLowerCase() !== pos.toLowerCase()) return `${pos} · ${title}`
  return title || pos || 'Role'
}

/**
 * The note Hockia drafts (DEV NOTE 394:102: "uses only role fields and the
 * club name"): position, team, pay and package from the role; the club's
 * name. Nothing about the player beyond the first name the club already sees.
 */
export function draftInviteNote(opts: { firstName: string; clubName: string | null | undefined; role: InviteRole }): string {
  const { role } = opts
  const club = opts.clubName?.trim() || 'our club'
  const pos = role.opportunity_type !== 'coach' && role.position ? positionLabel(role.position)?.toLowerCase() ?? null : null
  const what = pos ? `${/^[aeiou]/i.test(pos) ? 'an' : 'a'} ${pos}` : `for ${role.title.trim() || 'a role'}`
  const team = teamWord(role.gender)
  const where = team ? `${club}’s ${team} team` : club
  const recruiting = pos ? `we’re recruiting ${what} for ${where}` : `${where} is recruiting ${what}`
  const c = (role.compensation ?? '').toLowerCase()
  const offer = [
    c === 'paid' || c === 'either' ? 'pay' : null,
    ...(role.benefits ?? []).map((b) => b.toLowerCase()).filter((b, i, a) => BENEFIT_WORDS[b] && a.indexOf(b) === i)
      .sort((a, b) => BENEFIT_ORDER.indexOf(a) - BENEFIT_ORDER.indexOf(b))
      .map((b) => BENEFIT_WORDS[b]),
  ].filter(Boolean) as string[]
  const lines = [
    `Hi ${opts.firstName}, ${recruiting}, and your profile stood out.`,
    offer.length ? `The role includes ${listWords(offer)}.` : null,
    'Would you like to apply?',
  ].filter(Boolean)
  return lines.join(' ').slice(0, INVITE_NOTE_MAX)
}

// ── Server errors → what the club reads ──

const PASS_THROUGH = [
  'This player passed on this role',
  'This person can’t be invited to this role',
  'This person can\'t be invited to this role',
  'This player has already applied to one of your roles',
  'This player already has an open invite from you',
  'This role is not open',
  'The note can be up to 500 characters',
  'You can only invite players to your own roles',
]

export function inviteErrorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  const limit = /Daily invite limit reached \((\d+) per day\)/.exec(msg)
  if (limit) return inviteLimitReason(Number(limit[1]))
  if (msg.startsWith('This person can')) return 'This player can’t be invited to this role.'
  const hit = PASS_THROUGH.find((p) => msg.startsWith(p))
  if (hit) return `${hit.replace('\'', '’')}.`
  return 'Couldn’t send the invite. Please try again.'
}

export function respondErrorMessage(err: unknown): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  if (msg.startsWith('This invite has expired')) return 'This invitation has expired.'
  if (msg.startsWith('This invite has already been answered')) return 'You’ve already answered this invitation.'
  return 'Couldn’t update the invitation. Please try again.'
}

// ── The card in the chat (D3.3) ──

export interface InviteCardState {
  /** Card greys out (brief: "Role closed → invite card greys out for the player"). */
  muted: boolean
  /** Player: the three actions show only while the invite is open. */
  actionable: boolean
  /** One line under the note when the card is not actionable (or always, for the club). */
  line: string | null
  /** Tone of that line: grey for everything except "Applied", which is the positive tint. */
  tone: 'grey' | 'positive'
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
  const who = opts.playerFirstName || 'The player'
  if (status === 'applied') {
    return { muted: false, actionable: false, line: opts.viewer === 'player' ? 'Applied' : `${who} applied`, tone: 'positive' }
  }
  if (status === 'declined') {
    return { muted: true, actionable: false, line: opts.viewer === 'player' ? 'You passed on this role' : `${who} passed on this role`, tone: 'grey' }
  }
  if (status === 'expired') {
    const line = !opts.roleOpen ? 'This role is closed' : 'This invitation has expired'
    return { muted: true, actionable: false, line, tone: 'grey' }
  }
  return opts.viewer === 'player'
    ? { muted: false, actionable: true, line: null, tone: 'grey' }
    : { muted: false, actionable: false, line: 'Invitation pending', tone: 'grey' }
}
