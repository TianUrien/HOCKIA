import { BENEFIT_TILES } from '@/lib/opportunityCopy'
import { compensationLabel } from '@/lib/opportunityIntent'
import { PACKAGE_KEYS } from '@/lib/postRole'

/**
 * D4 · From yes to signed (Figma page 400:5; brief 401:2; DEV NOTES 391:23,
 * 391:28, 391:32, 391:36, 391:40, 391:44). Pure rules and copy shared by the
 * club's road to signing (D4.1), the offer sheet (D4.2), the offer card in
 * the chat (D4.3), the mark-as-signed sheet (D4.4) and the player's confirm /
 * signed screens (D4.5 / D4.6).
 *
 * The server (make_offer, withdraw_offer, respond_offer, mark_signed,
 * undo_mark_signed, confirm_signing, set_trial, withdraw_application) is the
 * authority for every rule below; the client mirrors them only to decide
 * what to render. Copy is gender-neutral: the player's first name, or they.
 */

export type OfferStatus = 'live' | 'superseded' | 'withdrawn' | 'accepted' | 'declined' | 'expired' | 'cancelled'

/** Statuses on the road after Shortlist (brief: shortlisted → offer → signed). */
export const ROAD_STATUSES = ['shortlisted', 'offered', 'accepted', 'signed_pending_confirmation', 'signed'] as const

export function isOnRoad(status: string | null | undefined): boolean {
  return !!status && (ROAD_STATUSES as readonly string[]).includes(status)
}

/** withdraw_application accepts these; signed is final, everything else is closed. */
export const WITHDRAWABLE_STATUSES = ['pending', 'shortlisted', 'maybe', 'offered', 'accepted', 'signed_pending_confirmation'] as const

export function canWithdraw(status: string | null | undefined): boolean {
  return !!status && (WITHDRAWABLE_STATUSES as readonly string[]).includes(status)
}

/** "Open until" turns amber in its last 5 days (brief), for the viewer who must answer. */
export const OFFER_AMBER_DAYS = 5
/** make_offer: open until must be from today up to 90 days ahead. */
export const OFFER_MAX_DAYS = 90
export const OFFER_NOTE_MAX = 1000
export const DECLINE_REASON_MAX = 500
/** confirm_signing refuses after 14 days; the cron puts the application back. */
export const SIGNING_CONFIRM_DAYS = 14

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A YYYY-MM-DD date as a local calendar day (no timezone shift). */
function parseDay(d: string | null | undefined): Date | null {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function toDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(d: Date, n: number): Date {
  const x = startOfDay(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Whole days from today to the date (0 = today, negative = past). */
export function daysUntil(day: string | null | undefined, now = new Date()): number | null {
  const d = parseDay(day)
  if (!d) return null
  return Math.round((d.getTime() - startOfDay(now).getTime()) / 86_400_000)
}

/** "10 Oct" (Figma), with the year only when it isn't this year. */
export function shortDay(day: string | null | undefined, now = new Date()): string | null {
  const d = parseDay(day)
  if (!d) return null
  return d.getFullYear() === now.getFullYear() ? `${d.getDate()} ${MONTH[d.getMonth()]}` : `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`
}

/** "1 Oct 2026" — the start date always carries its year. */
export function longDay(day: string | null | undefined): string | null {
  const d = parseDay(day)
  return d ? `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}` : null
}

/**
 * "2 Oct" — a timestamp as a local calendar day, day first: the ONE date
 * format on the road and the offer card ("accepted · 2 Oct", "open until
 * 9 Oct", "applied 17 Sep"), same shape as shortDay.
 */
export function shortDayOf(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getFullYear() === now.getFullYear() ? `${d.getDate()} ${MONTH[d.getMonth()]}` : `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * "1 Oct 2026 · 7 months" (Start row / card). No start date means the role
 * starts straight away — the Post a role convention ("Starts immediately"),
 * so the offer reads "Immediately · 7 months", never "Not set".
 */
export function offerStartLine(startDate: string | null | undefined, length: string | null | undefined): string {
  return [longDay(startDate) ?? 'Immediately', length?.trim() || null].filter(Boolean).join(' · ')
}

/**
 * "a" or "an" for the word that follows ("an E2E Test FC player", "a Hockey
 * Club coach"). Short all-caps initialisms are read letter by letter.
 */
export function indefiniteArticle(word: string): 'a' | 'an' {
  const w = word.trim()
  if (!w) return 'a'
  if (/^[A-Z0-9][A-Z0-9.]{0,2}(\s|$)/.test(w)) return /^[AEFHILMNORSX8]/.test(w) ? 'an' : 'a'
  if (/^(uni|use|usu|eu|one|ou)/i.test(w)) return 'a'
  if (/^(hon|heir|hour)/i.test(w)) return 'an'
  return /^[aeiou]/i.test(w) ? 'an' : 'a'
}

/** "Housing · Flights · Insurance · Job" in the role form's order; free text kept as written. */
export function offerPackageLine(pkg: string[] | null | undefined): string | null {
  const seen = new Set<string>()
  const keys = (pkg ?? []).map((p) => p.trim()).filter((p) => {
    const k = p.toLowerCase()
    if (!p || seen.has(k)) return false
    seen.add(k)
    return true
  })
  const order = PACKAGE_KEYS as readonly string[]
  keys.sort((a, b) => {
    const ia = order.indexOf(a.toLowerCase())
    const ib = order.indexOf(b.toLowerCase())
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  const labels = keys.map((k) => BENEFIT_TILES[k.toLowerCase()]?.label ?? k.charAt(0).toUpperCase() + k.slice(1))
  return labels.length ? labels.join(' · ') : null
}

/** Pay reads like the role's (same field as Post a role). */
export function offerPayLine(pay: string | null | undefined): string | null {
  return compensationLabel(pay?.trim() || null)
}

export interface OfferRole {
  start_date: string | null
  duration_text: string | null
  compensation: string | null
  benefits: string[] | null
  custom_benefits?: string[] | null
}

export interface OfferDraft {
  startDate: string | null
  length: string | null
  pay: string | null
  package: string[]
  openUntil: string
  note: string
}

/** Defaults copied from the role (DEV NOTE 391:28); open until a week from today. */
export function offerDraftFromRole(role: OfferRole, now = new Date()): OfferDraft {
  const pkg = [...(role.benefits ?? []), ...(role.custom_benefits ?? [])].map((b) => b.trim()).filter(Boolean)
  return {
    startDate: role.start_date ?? null,
    length: role.duration_text?.trim() || null,
    pay: role.compensation ?? null,
    package: [...new Set(pkg.map((p) => p.toLowerCase()))],
    openUntil: toDayString(addDays(now, 7)),
    note: '',
  }
}

export interface OfferRow {
  id: string
  application_id: string
  opportunity_id: string
  club_id: string
  player_id: string
  version: number
  start_date: string | null
  length: string | null
  pay: string | null
  package: string[] | null
  open_until: string
  note: string | null
  status: OfferStatus
  sent_at: string
  responded_at: string | null
  /** respond_offer(accept = false, reason): the player's optional words, for the club. */
  decline_reason: string | null
}

/** Editing a live offer starts from what was sent (editing sends a new version). */
export function offerDraftFromOffer(o: OfferRow): OfferDraft {
  return {
    startDate: o.start_date,
    length: o.length,
    pay: o.pay,
    package: [...(o.package ?? [])],
    openUntil: o.open_until,
    note: o.note ?? '',
  }
}

/** Open until must be a date from today up to 90 days ahead (make_offer). */
export function openUntilError(day: string | null | undefined, now = new Date()): string | null {
  const n = daysUntil(day, now)
  if (n === null) return 'Choose until when the offer is open.'
  if (n < 0) return 'Open until can’t be in the past.'
  if (n > OFFER_MAX_DAYS) return `Open until can be at most ${OFFER_MAX_DAYS} days ahead.`
  return null
}

// ── The offer card (D4.3) ──

export interface OfferCardState {
  /** Card greys out (expired, superseded, withdrawn, declined, closed). */
  muted: boolean
  /** Player: Accept / Decline show only while the offer is live and open. */
  actionable: boolean
  /** The one line that replaces the actions (always grey). */
  line: string | null
  /** "Open until 10 Oct" pill; null once the offer is answered or closed. */
  deadline: string | null
  /** Amber only for the player (who must answer) in the last 5 days; grey otherwise. */
  deadlineTone: 'amber' | 'grey'
}

/**
 * What the offer card says. Player viewer = the player the offer is for;
 * club viewer = the publisher who sent it. Colour depends on the viewer
 * (founder ruling 2026-09-26): the club waiting on an answer is grey; the
 * player's deadline turns amber in its last 5 days (brief).
 */
export function offerCardState(opts: {
  viewer: 'player' | 'club'
  status: OfferStatus
  openUntil: string | null
  playerFirstName?: string
  /** The player's reason for declining (club viewer only; the player's own card never repeats it). */
  declineReason?: string | null
  now?: Date
}): OfferCardState {
  const now = opts.now ?? new Date()
  const left = daysUntil(opts.openUntil, now)
  const lapsed = opts.status === 'live' && left !== null && left < 0
  const status: OfferStatus = lapsed ? 'expired' : opts.status
  const who = opts.playerFirstName || 'The player'
  const player = opts.viewer === 'player'
  const closed = (line: string): OfferCardState => ({ muted: true, actionable: false, line, deadline: null, deadlineTone: 'grey' })
  switch (status) {
    case 'live': {
      const deadline = `Open until ${shortDay(opts.openUntil, now) ?? ''}`.trim()
      const amber = player && left !== null && left <= OFFER_AMBER_DAYS
      return player
        ? { muted: false, actionable: true, line: null, deadline, deadlineTone: amber ? 'amber' : 'grey' }
        : { muted: false, actionable: false, line: `Waiting for ${who}’s answer`, deadline, deadlineTone: 'grey' }
    }
    case 'accepted':
      return { muted: false, actionable: false, line: player ? 'You accepted this offer' : `${who} accepted`, deadline: null, deadlineTone: 'grey' }
    case 'declined':
      return closed(player ? 'You declined this offer' : offerDeclinedLine(who, opts.declineReason))
    case 'superseded':
      return closed('Updated — see the newer offer below')
    case 'withdrawn':
      return closed(player ? 'The club withdrew this offer' : 'You withdrew this offer')
    case 'expired':
      return closed('This offer has expired')
    case 'cancelled':
    default:
      return closed('This offer is closed')
  }
}

/** "Sam declined — Moving abroad next season" (club-facing; grey). */
export function offerDeclinedLine(firstName: string, reason: string | null | undefined): string {
  const r = reason?.trim()
  return r ? `${firstName} declined — ${r}` : `${firstName} declined`
}

/**
 * The grey note under the club's road after the player declined the newest
 * offer (the application is back on Shortlisted, so the road alone wouldn't
 * say why). Null while an offer is live or none was declined last.
 */
export function offerDeclinedNote(firstName: string, offer: Pick<OfferRow, 'status' | 'decline_reason'> | null | undefined): string | null {
  if (offer?.status !== 'declined') return null
  const r = offer.decline_reason?.trim()
  return r ? `${firstName} declined your offer — “${r}”` : `${firstName} declined your offer.`
}

// ── Road to signing (D4.1) ──

export type RoadStepKey = 'shortlisted' | 'talked' | 'trial' | 'offer' | 'signed'

export interface RoadStep {
  key: RoadStepKey
  label: string
  detail: string
  done: boolean
  /** The next step (purple ring, bold label). Trial is optional, so never the current step. */
  current: boolean
  /** Offer only: the signing went ahead without one (grey dash, never a tick — mirrors the player's road). */
  skipped?: boolean
}

export interface RoadInput {
  status: string
  talked: boolean
  trial: boolean
  firstName: string
  shortlistedAt?: string | null
  offer?: Pick<OfferRow, 'status' | 'open_until' | 'responded_at' | 'sent_at'> | null
  signedAt?: string | null
  now?: Date
}

function dayWord(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const diff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return shortDayOf(iso, now)
}

/**
 * The five steps on the applicant (DEV NOTE 391:23): Shortlisted, Talked
 * (ticks itself when both have written), Trial or video call (optional, the
 * club ticks it), Offer, Signed (the player confirms it too).
 */
export function roadSteps(i: RoadInput): RoadStep[] {
  const now = i.now ?? new Date()
  const s = i.status
  const pastOffer = s === 'accepted' || s === 'signed_pending_confirmation' || s === 'signed'
  // Marked as signed straight from Shortlisted (DEV NOTE 391:36): no accepted offer → skipped, not done.
  const offerSkipped = pastOffer && i.offer?.status !== 'accepted'
  const offerDone = pastOffer && !offerSkipped
  const offerSent = s === 'offered'
  const signedDone = s === 'signed'
  const offerDetail = pastOffer
    ? (i.offer?.status === 'accepted' ? `${i.firstName} accepted${i.offer.responded_at ? ` · ${shortDayOf(i.offer.responded_at, now)}` : ''}` : 'Skipped')
    : offerSent && i.offer
      ? `Sent · open until ${shortDay(i.offer.open_until, now)}`
      : 'Terms you’re offering'
  const signedDetail = signedDone
    ? `Signed through Hockia${i.signedAt ? ` · ${shortDayOf(i.signedAt, now)}` : ''}`
    : s === 'signed_pending_confirmation'
      ? `Waiting for ${i.firstName} to confirm`
      : `${i.firstName} confirms it too`
  const steps: RoadStep[] = [
    { key: 'shortlisted', label: 'Shortlisted', detail: dayWord(i.shortlistedAt, now) ?? 'Done', done: true, current: false },
    { key: 'talked', label: 'Talked', detail: 'When you’ve both written', done: i.talked, current: false },
    { key: 'trial', label: 'Trial or video call', detail: 'Optional', done: i.trial, current: false },
    { key: 'offer', label: 'Offer', detail: offerDetail, done: offerDone, current: false, skipped: offerSkipped },
    { key: 'signed', label: 'Signed', detail: signedDetail, done: signedDone, current: false },
  ]
  const next = steps.find((st) => !st.done && !st.skipped && st.key !== 'trial' && st.key !== 'shortlisted')
  if (next) next.current = true
  return steps
}

/** "Shortlisted today · applied 17 Sep" — the line under the name on the road (Figma 390:3). */
export function roadHeaderLine(shortlistedAt: string | null | undefined, appliedAt: string | null | undefined, now = new Date()): string {
  const when = dayWord(shortlistedAt, now)
  const applied = shortDayOf(appliedAt, now)
  return [when ? `Shortlisted ${when === 'Today' || when === 'Yesterday' ? when.toLowerCase() : when}` : 'Shortlisted', applied ? `applied ${applied}` : null].filter(Boolean).join(' · ')
}

export type RoadAction ='make_offer' | 'edit_offer' | 'mark_signed' | null

/** The main button is always the next step (caption 391:11). */
export function roadMainAction(status: string): RoadAction {
  switch (status) {
    case 'shortlisted': return 'make_offer'
    case 'offered': return 'edit_offer'
    case 'accepted': return 'mark_signed'
    default: return null
  }
}

export type RoadMenuItem = 'mark_signed' | 'decline' | 'withdraw_offer' | 'undo_signing'

/**
 * The "…" next to Message (DEV NOTE 391:23: Not moving forward → the Decline
 * sheet). Mark as signed without an offer is allowed straight after
 * shortlist (DEV NOTE 391:36). Withdraw offer while it waits for an answer;
 * undo while the player hasn't confirmed.
 */
export function roadMenu(status: string): RoadMenuItem[] {
  switch (status) {
    case 'shortlisted': return ['mark_signed', 'decline']
    case 'offered': return ['withdraw_offer']
    case 'signed_pending_confirmation': return ['undo_signing']
    default: return []
  }
}

/** Grey line that replaces the main button when the club can only wait (or it's done). */
export function roadWaitingLine(status: string, firstName: string): string | null {
  if (status === 'signed_pending_confirmation') return `Waiting for ${firstName} to confirm`
  if (status === 'signed') return 'Signed through Hockia'
  return null
}

/** The club's status note above the fit card for the road statuses. */
export function clubRoadNote(status: string, firstName: string): string | null {
  switch (status) {
    case 'offered': return `You sent ${firstName} an offer.`
    case 'accepted': return `${firstName} accepted your offer.`
    case 'signed_pending_confirmation': return `Waiting for ${firstName} to confirm the signing.`
    case 'signed': return `${firstName} confirmed the signing. Signed through Hockia.`
    default: return null
  }
}

/** Talked = both sides have a message of their own in the conversation (DEV NOTE 391:23). */
export function hasTalked(messages: { sender_id: string; metadata?: unknown }[], clubId: string, playerId: string): boolean {
  let club = false
  let player = false
  for (const m of messages) {
    const t = m.metadata && typeof m.metadata === 'object' ? (m.metadata as { type?: unknown }).type : null
    // Server-posted recruiting cards and steps aren't conversation.
    if (t === 'opportunity_invite' || t === 'opportunity_offer' || t === 'application_event') continue
    if (m.sender_id === clubId) club = true
    else if (m.sender_id === playerId) player = true
    if (club && player) return true
  }
  return false
}

// ── Mark as signed (D4.4) ──

/** Sheet body; gender-neutral (Figma: "He’ll be asked to confirm…"). */
export function markSignedBody(firstName: string, publisherIsClub: boolean): string {
  return publisherIsClub
    ? `${firstName} will be asked to confirm. Then they join your squad on Hockia and the signing goes on their career.`
    : `${firstName} will be asked to confirm. Then the signing goes on their career.`
}

/** The close-the-role toggle's line: the others still waiting get the kind note. */
export function closeRoleNote(waiting: number): string {
  if (waiting <= 0) return 'No one else is waiting on this role.'
  if (waiting === 1) return 'The 1 player still waiting gets a kind note that the role is filled.'
  return `The ${waiting} players still waiting get a kind note that the role is filled.`
}

// ── Player: confirm (D4.5) and signed (D4.6) ──

export function confirmSigningTitle(clubName: string): string {
  return `${clubName} marked you as signed`
}

export function hideFromClubsCopy(role: string | null | undefined): { title: string; detail: string } {
  const flag = role === 'coach' ? 'Open to coach' : 'Open to play'
  return { title: 'Stop showing me to other clubs', detail: `Turns off ${flag}. You can switch it back any time.` }
}

export function signedTitle(clubName: string, role: string | null | undefined): string {
  return `You’re ${indefiniteArticle(clubName)} ${clubName} ${role === 'coach' ? 'coach' : 'player'}`
}

/** "2026/27" — the season the signing starts in. */
export function seasonLabel(startDate: string | null | undefined, now = new Date()): string {
  const d = parseDay(startDate) ?? now
  const y = d.getFullYear()
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`
}

/** What the player shares from D4.6. */
export function signingShareText(clubName: string): string {
  return `I signed with ${clubName} through Hockia.`
}

// ── Player statuses (My applications: Shortlisted → Offer → Signed) ──

export interface PlayerStep { label: string; done: boolean; current?: boolean; /** No offer was part of this signing (mirrors the club's "Skipped"). */ skipped?: boolean }

/**
 * Players see the same steps on My applications, their own status only (DEV
 * NOTE 391:23). `offerMade` = whether an accepted offer exists for a signing
 * (useOwnOfferMade); false → Offer reads skipped, not done. null = unknown
 * (still loading): Offer keeps its usual state so nothing flickers.
 */
export function playerRoadSteps(status: string, offerMade: boolean | null = null): PlayerStep[] | null {
  if (!isOnRoad(status)) return null
  const signing = status === 'signed_pending_confirmation' || status === 'signed'
  const skipped = signing && offerMade === false
  // Offer ticks once the player ACCEPTS; while it waits it's the current step.
  const offer = !skipped && (status === 'accepted' || signing)
  return [
    { label: 'Shortlisted', done: true },
    { label: 'Offer', done: offer, current: status === 'offered', skipped },
    { label: 'Signed', done: status === 'signed' },
  ]
}

// ── Server-posted step lines, read by the right viewer ──

/** The server's signing_marked line: "<club> marked you as signed for <role>. Confirm it on Hockia…". */
const SIGNING_MARKED_LINE = /^(.+?) marked you as signed for (.+?)\. Confirm it on Hockia/

/**
 * The server writes each step line once, for the player ("<club> marked you
 * as signed for <role>. Confirm it on Hockia…"). The club reads its own step
 * in club-facing words, naming the role the server line carries; every
 * other line is already neutral.
 */
export function recruitingEventLine(event: string, content: string, viewer: { isMine: boolean; otherFirstName?: string | null }): string {
  if (event === 'signing_marked' && viewer.isMine) {
    const role = SIGNING_MARKED_LINE.exec(content)?.[2]?.trim()
    return `You marked ${viewer.otherFirstName?.trim() || 'the player'} as signed${role ? ` for ${role}` : ''}. Waiting for them to confirm.`
  }
  return content
}

/** The server's offer card fallback: "<club> sent you an offer|updated its offer for <role>, open until <day>. Open Hockia…". */
const OFFER_LINE = /^(.+?) (sent you an offer|updated its offer) for (.+?), open until (.+?)\. Open Hockia/
/** The server's invite card fallback: "<club> invited you to apply for <role>." (+ note, + how to answer). */
const INVITE_LINE = /^(.+?) invited you to apply for (.+?)\.(?:\n|$)/

/**
 * Every line the recruiting server functions post into a thread
 * (migration 20260928120000 + 20261003100000), by shape: the inbox list
 * carries only the last message's text, no metadata.
 */
const RECRUITING_SYSTEM_LINES: RegExp[] = [
  SIGNING_MARKED_LINE,
  OFFER_LINE,
  INVITE_LINE,
  /^.+? applied for .+\.$/,
  /^.+? passed on .+\.$/,
  /^.+? withdrew (?:its offer|their application) for .+\.$/,
  /^.+? (?:accepted|declined) the offer for .+\.$/,
  /^.+? undid the signing for .+\.$/,
  /^.+? confirmed the signing for .+\. Signed through Hockia\.$/,
]

export interface RecruitingPreview {
  /** What the row shows. */
  text: string
  /** A server-posted recruiting line: shown without the "You:" / "<name>:" sender prefix. */
  system: boolean
}

/**
 * The inbox preview line under a chat (phone InboxMessages and desktop
 * ConversationList). The server writes each recruiting line once, for the
 * player, and posts it AS the club (sender = club), so a plain "You: <line>"
 * preview reads to the club as if it had written a line addressed to itself
 * (QA round 7: "You: E2E Test FC marked you as signed for … Confirm it on
 * Hockia…"). The player-worded lines are recognised by their shape and
 * reworded for the club (the viewer the line is "mine" for); every recruiting
 * line is flagged `system` so the row drops the sender prefix. Everything
 * else is shown as is.
 */
export function recruitingPreview(content: string, viewer: { isMine: boolean; otherFirstName?: string | null }): RecruitingPreview {
  const system = RECRUITING_SYSTEM_LINES.some((re) => re.test(content))
  if (!viewer.isMine) return { text: content, system }
  if (SIGNING_MARKED_LINE.test(content)) return { text: recruitingEventLine('signing_marked', content, viewer), system: true }
  const offer = OFFER_LINE.exec(content)
  if (offer) {
    const verb = offer[2] === 'updated its offer' ? 'updated your offer' : 'sent an offer'
    return { text: `You ${verb} for ${offer[3].trim()}, open until ${offer[4].trim()}.`, system: true }
  }
  const invite = INVITE_LINE.exec(content)
  if (invite) return { text: `You invited ${viewer.otherFirstName?.trim() || 'the player'} to apply for ${invite[2].trim()}.`, system: true }
  return { text: content, system }
}

/** recruitingPreview's text only (round 7 callers). */
export function recruitingPreviewLine(content: string, viewer: { isMine: boolean; otherFirstName?: string | null }): string {
  return recruitingPreview(content, viewer).text
}

// ── Server errors → what people read ──

const PASS_THROUGH = [
  'This role is not open',
  'Offers can be made to shortlisted applicants only',
  'This player can’t receive an offer',
  'This player can\'t receive an offer',
  'Open until must be a date from today up to 90 days ahead',
  'Offer fields are too long',
  'This offer is no longer open',
  'This offer has expired',
  'The reason can be up to 500 characters',
  'Only an offer still waiting for an answer can be withdrawn',
  'Only a shortlisted applicant or an accepted offer can be marked as signed',
  'Only a signing still waiting for the player can be undone',
  'There is no signing waiting for your confirmation',
  'This signing request has expired',
  'A confirmed signing can’t be withdrawn',
  'A confirmed signing can\'t be withdrawn',
  'This application is already closed',
  'A trial can be recorded for shortlisted applicants only',
  'A withdrawn application cannot be changed',
]

export function signingErrorMessage(err: unknown, fallback: string): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  const hit = PASS_THROUGH.find((p) => msg.startsWith(p))
  return hit ? `${hit.replace('\'', '’')}.` : fallback
}

// ── Club lists: where road applicants sit, and the grey tag on the row ──

/**
 * The club's Applicants chips predate D4: an applicant past Shortlist
 * (offered / accepted / waiting to confirm / signed) stays under Shortlisted
 * with a grey tag naming the step; a role filled by someone else and an
 * application the player withdrew land in Closed (re-check 2026-10-02:
 * clubs can read withdrawn applications to their own roles). offer_declined
 * is only ever a history row (the server puts the application straight back
 * to shortlisted).
 */
export function applicantChipFor(status: string): string {
  if (isOnRoad(status) || status === 'offer_declined') return 'shortlisted'
  if (status === 'filled' || status === 'withdrawn') return 'no_response'
  return status
}

/** Grey tag on a club's applicant row (the club waits, so never amber). */
export function clubRoadTag(status: string): string | null {
  switch (status) {
    case 'offered': return 'Offer sent'
    case 'accepted': return 'Offer accepted'
    case 'signed_pending_confirmation': return 'Waiting to confirm'
    case 'signed': return 'Signed'
    default: return null
  }
}

/** The grey tag on a row under Closed that says why it closed (no tag = no reply). */
export function closedApplicantTag(status: string): string | null {
  if (status === 'withdrawn') return 'Withdrawn'
  if (status === 'filled') return 'Role filled'
  return null
}

// ── Player: withdraw an application ──

export const WITHDRAW_TITLE = 'Withdraw your application?'

/** The confirm step's body: final, and the club sees it as withdrawn. */
export function withdrawBody(status: string | null | undefined): string {
  const base = 'The club will see it as withdrawn. This can’t be undone.'
  if (status === 'offered') return `Any offer waiting for you is cancelled. ${base}`
  if (status === 'accepted' || status === 'signed_pending_confirmation') return `The signing won’t go ahead. ${base}`
  return base
}

/** What the player reads next to the road steps (their own status only). */
export function playerRoadHint(status: string): string | null {
  switch (status) {
    case 'offered': return 'The club sent you an offer. Answer it in your chat with the club.'
    case 'accepted': return 'You accepted the offer. The club will mark the signing next.'
    case 'signed_pending_confirmation': return 'The club marked you as signed. Confirm it to add it to your career.'
    case 'signed': return 'Signed through Hockia. It’s on your career.'
    default: return null
  }
}
