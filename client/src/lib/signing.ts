import { BENEFIT_TILES } from '@/lib/opportunityCopy'
import { compensationLabel } from '@/lib/opportunityIntent'
import { PACKAGE_KEYS } from '@/lib/postRole'
import { formatDayMonth, isEnglish } from '@/i18n/format'
import { tInbox } from '@/i18n/ns/inbox'
import { recruitingServerLine } from '@/lib/recruitingTitles'

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
  return dayMonth(d, d.getFullYear() !== now.getFullYear())
}

/** "1 Oct 2026" — the start date always carries its year. */
export function longDay(day: string | null | undefined): string | null {
  const d = parseDay(day)
  return d ? dayMonth(d, true) : null
}

/** "10 Oct" / "10 Oct 2026" in English; the interface language's own day-first form otherwise (i18n/format). */
function dayMonth(d: Date, withYear: boolean): string {
  if (!isEnglish()) return formatDayMonth(d, withYear)
  return withYear ? `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${MONTH[d.getMonth()]}`
}

/**
 * "2 Oct" — a timestamp as a local calendar day, day first: the ONE date
 * format on the road and the offer card ("accepted · 2 Oct", "open until
 * 9 Oct", "applied 17 Sep"), same shape as shortDay.
 */
export function shortDayOf(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null
  // A date-only value ("2026-09-01", a DATE column) is a calendar day, not a
  // timestamp: read as UTC midnight it showed the day before west of UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim()) ? parseDay(iso) : new Date(iso)
  if (!d || Number.isNaN(d.getTime())) return null
  return dayMonth(d, d.getFullYear() !== now.getFullYear())
}

/**
 * "1 Oct 2026 · 7 months" (Start row / card). No start date means the role
 * starts straight away — the Post a role convention ("Starts immediately"),
 * so the offer reads "Immediately · 7 months", never "Not set".
 */
export function offerStartLine(startDate: string | null | undefined, length: string | null | undefined): string {
  return [longDay(startDate) ?? tInbox('signing.offer.immediately'), length?.trim() || null].filter(Boolean).join(', ')
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
  return labels.length ? labels.join(', ') : null
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
  if (n === null) return tInbox('signing.offer.openUntilMissing')
  if (n < 0) return tInbox('signing.offer.openUntilPast')
  if (n > OFFER_MAX_DAYS) return tInbox('signing.offer.openUntilTooFar', { count: OFFER_MAX_DAYS })
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
  const who = opts.playerFirstName || tInbox('signing.card.playerFallback')
  const player = opts.viewer === 'player'
  const closed = (line: string): OfferCardState => ({ muted: true, actionable: false, line, deadline: null, deadlineTone: 'grey' })
  switch (status) {
    case 'live': {
      const day = shortDay(opts.openUntil, now)
      const deadline = day ? tInbox('signing.card.deadline', { day }) : tInbox('signing.card.deadlineNoDay')
      const amber = player && left !== null && left <= OFFER_AMBER_DAYS
      return player
        ? { muted: false, actionable: true, line: null, deadline, deadlineTone: amber ? 'amber' : 'grey' }
        : { muted: false, actionable: false, line: tInbox('signing.card.waitingAnswer', { name: who }), deadline, deadlineTone: 'grey' }
    }
    case 'accepted':
      return { muted: false, actionable: false, line: player ? tInbox('signing.card.acceptedPlayer') : tInbox('signing.card.acceptedClub', { name: who }), deadline: null, deadlineTone: 'grey' }
    case 'declined':
      return closed(player ? tInbox('signing.card.declinedPlayer') : offerDeclinedLine(who, opts.declineReason))
    case 'superseded':
      return closed(tInbox('signing.card.superseded'))
    case 'withdrawn':
      return closed(player ? tInbox('signing.card.withdrawnPlayer') : tInbox('signing.card.withdrawnClub'))
    case 'expired':
      return closed(tInbox('signing.card.expired'))
    case 'cancelled':
    default:
      return closed(tInbox('signing.card.closed'))
  }
}

/** "Sam declined — Moving abroad next season" (club-facing; grey). */
export function offerDeclinedLine(firstName: string, reason: string | null | undefined): string {
  const r = reason?.trim()
  return r ? tInbox('signing.card.declinedClubReason', { name: firstName, reason: r }) : tInbox('signing.card.declinedClub', { name: firstName })
}

/**
 * The grey note under the club's road after the player declined the newest
 * offer (the application is back on Shortlisted, so the road alone wouldn't
 * say why). Null while an offer is live or none was declined last.
 */
export function offerDeclinedNote(firstName: string, offer: Pick<OfferRow, 'status' | 'decline_reason'> | null | undefined): string | null {
  if (offer?.status !== 'declined') return null
  const r = offer.decline_reason?.trim()
  return r ? tInbox('signing.road.declinedNoteReason', { name: firstName, reason: r }) : tInbox('signing.road.declinedNote', { name: firstName })
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

type DayWord = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'day'; day: string }

function dayWordOf(iso: string | null | undefined, now: Date): DayWord | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const diff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (diff === 0) return { kind: 'today' }
  if (diff === 1) return { kind: 'yesterday' }
  const day = shortDayOf(iso, now)
  return day ? { kind: 'day', day } : null
}

/** "Today" / "Yesterday" / "2 Oct" (a step's detail on the road). */
function dayWord(iso: string | null | undefined, now: Date): string | null {
  const w = dayWordOf(iso, now)
  if (!w) return null
  if (w.kind === 'today') return tInbox('signing.road.today')
  if (w.kind === 'yesterday') return tInbox('signing.road.yesterday')
  return w.day
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
    ? (i.offer?.status === 'accepted'
      ? (i.offer.responded_at
        ? tInbox('signing.road.offerAcceptedOn', { name: i.firstName, day: shortDayOf(i.offer.responded_at, now) })
        : tInbox('signing.road.offerAccepted', { name: i.firstName }))
      : tInbox('signing.road.offerSkipped'))
    : offerSent && i.offer
      ? tInbox('signing.road.offerSent', { day: shortDay(i.offer.open_until, now) })
      : tInbox('signing.road.offerTerms')
  const signedDetail = signedDone
    ? (i.signedAt ? tInbox('signing.road.signedOn', { day: shortDayOf(i.signedAt, now) }) : tInbox('signing.road.signedThroughHockia'))
    : s === 'signed_pending_confirmation'
      ? tInbox('signing.road.waitingConfirm', { name: i.firstName })
      : tInbox('signing.road.confirmsToo', { name: i.firstName })
  const steps: RoadStep[] = [
    { key: 'shortlisted', label: tInbox('signing.road.steps.shortlisted'), detail: dayWord(i.shortlistedAt, now) ?? tInbox('signing.road.done'), done: true, current: false },
    { key: 'talked', label: tInbox('signing.road.steps.talked'), detail: tInbox('signing.road.talkedDetail'), done: i.talked, current: false },
    { key: 'trial', label: tInbox('signing.road.steps.trial'), detail: tInbox('signing.road.optional'), done: i.trial, current: false },
    { key: 'offer', label: tInbox('signing.road.steps.offer'), detail: offerDetail, done: offerDone, current: false, skipped: offerSkipped },
    { key: 'signed', label: tInbox('signing.road.steps.signed'), detail: signedDetail, done: signedDone, current: false },
  ]
  const next = steps.find((st) => !st.done && !st.skipped && st.key !== 'trial' && st.key !== 'shortlisted')
  if (next) next.current = true
  return steps
}

/** "Shortlisted today · applied 17 Sep" — the line under the name on the road (Figma 390:3). */
export function roadHeaderLine(shortlistedAt: string | null | undefined, appliedAt: string | null | undefined, now = new Date()): string {
  const when = dayWordOf(shortlistedAt, now)
  const applied = shortDayOf(appliedAt, now)
  const shortlisted = !when ? tInbox('signing.road.header.shortlisted')
    : when.kind === 'today' ? tInbox('signing.road.header.shortlistedToday')
      : when.kind === 'yesterday' ? tInbox('signing.road.header.shortlistedYesterday')
        : tInbox('signing.road.header.shortlistedOn', { day: when.day })
  return [shortlisted, applied ? tInbox('signing.road.header.applied', { day: applied }) : null].filter(Boolean).join(', ')
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
  if (status === 'signed_pending_confirmation') return tInbox('signing.road.waitingLine', { name: firstName })
  if (status === 'signed') return tInbox('signing.road.signedLine')
  return null
}

/** The club's status note above the fit card for the road statuses. */
export function clubRoadNote(status: string, firstName: string): string | null {
  switch (status) {
    case 'offered': return tInbox('signing.clubNote.offered', { name: firstName })
    case 'accepted': return tInbox('signing.clubNote.accepted', { name: firstName })
    case 'signed_pending_confirmation': return tInbox('signing.clubNote.pending', { name: firstName })
    case 'signed': return tInbox('signing.clubNote.signed', { name: firstName })
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
export function markSignedBody(firstName: string, publisherIsClub: boolean, organisation?: string | null): string {
  if (publisherIsClub) return tInbox('signing.markSigned.bodyClub', { name: firstName })
  // A coach who recruits: the signing is with the organisation the role is for.
  const org = organisation?.trim()
  return org
    ? tInbox('signing.markSigned.bodyOrg', { name: firstName, org })
    : tInbox('signing.markSigned.body', { name: firstName })
}

/** The offer sheet's footnote: who the contract is with (a coach's offer names the organisation). */
export function offerContractNote(publisherIsClub: boolean, organisation?: string | null): string {
  const org = organisation?.trim()
  if (publisherIsClub) return tInbox('signing.offer.contractNoteClub')
  return org ? tInbox('signing.offer.contractNoteOrg', { org }) : tInbox('signing.offer.contractNoteFallback')
}

/** The close-the-role toggle's line: the others still waiting get the kind note. */
export function closeRoleNote(waiting: number): string {
  if (waiting <= 0) return tInbox('signing.markSigned.closeRoleNone')
  return tInbox('signing.markSigned.closeRoleWaiting', { count: waiting })
}

// ── Player: confirm (D4.5) and signed (D4.6) ──

export function confirmSigningTitle(clubName: string): string {
  return tInbox('signing.confirm.title', { club: clubName })
}

export function hideFromClubsCopy(role: string | null | undefined): { title: string; detail: string } {
  return {
    title: tInbox('signing.confirm.hideTitle'),
    detail: role === 'coach' ? tInbox('signing.confirm.hideDetailCoach') : tInbox('signing.confirm.hideDetailPlayer'),
  }
}

export function signedTitle(clubName: string, role: string | null | undefined): string {
  const an = indefiniteArticle(clubName) === 'an'
  if (role === 'coach') return an ? tInbox('signing.signed.titleCoachAn', { club: clubName }) : tInbox('signing.signed.titleCoachA', { club: clubName })
  return an ? tInbox('signing.signed.titlePlayerAn', { club: clubName }) : tInbox('signing.signed.titlePlayerA', { club: clubName })
}

/** "2026/27" — the season the signing starts in. */
export function seasonLabel(startDate: string | null | undefined, now = new Date()): string {
  const d = parseDay(startDate) ?? now
  const y = d.getFullYear()
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`
}

/** What the player shares from D4.6. */
export function signingShareText(clubName: string): string {
  return tInbox('signing.signed.shareText', { club: clubName })
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
    { label: tInbox('signing.playerSteps.shortlisted'), done: true },
    { label: tInbox('signing.playerSteps.offer'), done: offer, current: status === 'offered', skipped },
    { label: tInbox('signing.playerSteps.signed'), done: status === 'signed' },
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
    const name = viewer.otherFirstName?.trim() || tInbox('signing.lines.playerFallback')
    return role ? tInbox('signing.lines.markedSignedFor', { name, role }) : tInbox('signing.lines.markedSigned', { name })
  }
  return recruitingServerLine(content)
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
  if (!viewer.isMine) return { text: system ? recruitingServerLine(content) : content, system }
  if (SIGNING_MARKED_LINE.test(content)) return { text: recruitingEventLine('signing_marked', content, viewer), system: true }
  const offer = OFFER_LINE.exec(content)
  if (offer) {
    const vars = { role: offer[3].trim(), day: offer[4].trim() }
    return { text: offer[2] === 'updated its offer' ? tInbox('signing.lines.offerUpdated', vars) : tInbox('signing.lines.offerSent', vars), system: true }
  }
  const invite = INVITE_LINE.exec(content)
  if (invite) return { text: tInbox('signing.lines.invited', { name: viewer.otherFirstName?.trim() || tInbox('signing.lines.playerFallback'), role: invite[2].trim() }), system: true }
  return { text: system ? recruitingServerLine(content) : content, system }
}

/** recruitingPreview's text only (round 7 callers). */
export function recruitingPreviewLine(content: string, viewer: { isMine: boolean; otherFirstName?: string | null }): string {
  return recruitingPreview(content, viewer).text
}

// ── Server errors → what people read ──

/** The server's refusals (English, matched by prefix) and what people read.
 *  The server still says "role"; members read "opportunity" (rebrand 2026-10-25). */
const PASS_THROUGH = [
  ['This role is not open', 'signing.errors.roleNotOpen'],
  ['Offers can be made to shortlisted applicants only', 'signing.errors.shortlistedOnly'],
  ['This player can’t receive an offer', 'signing.errors.cannotReceive'],
  ['This player can\'t receive an offer', 'signing.errors.cannotReceive'],
  ['Open until must be a date from today up to 90 days ahead', 'signing.errors.openUntilRange'],
  ['Offer fields are too long', 'signing.errors.fieldsTooLong'],
  ['This offer is no longer open', 'signing.errors.offerNotOpen'],
  ['This offer has expired', 'signing.errors.offerExpired'],
  ['The reason can be up to 500 characters', 'signing.errors.reasonTooLong'],
  ['Only an offer still waiting for an answer can be withdrawn', 'signing.errors.withdrawOnlyLive'],
  ['Only a shortlisted applicant or an accepted offer can be marked as signed', 'signing.errors.markSignedOnly'],
  ['Only a signing still waiting for the player can be undone', 'signing.errors.undoOnlyPending'],
  ['There is no signing waiting for your confirmation', 'signing.errors.noPendingSigning'],
  ['This signing request has expired', 'signing.errors.signingExpired'],
  ['A confirmed signing can’t be withdrawn', 'signing.errors.confirmedFinal'],
  ['A confirmed signing can\'t be withdrawn', 'signing.errors.confirmedFinal'],
  ['This application is already closed', 'signing.errors.applicationClosed'],
  ['A trial can be recorded for shortlisted applicants only', 'signing.errors.trialShortlistedOnly'],
  ['A withdrawn application cannot be changed', 'signing.errors.withdrawnFinal'],
  // A coach's role with no organisation (role_organisation, 20261004200000).
  ['Add your club to your profile to mark a signing', 'signing.errors.addClub'],
  ['This signing can’t be confirmed yet', 'signing.errors.notConfirmable'],
  ['This signing can\'t be confirmed yet', 'signing.errors.notConfirmable'],
] as const

/** What signingErrorMessage returns (in English) when confirm_signing refuses a role with no club named (club_missing). */
export const SIGNING_CLUB_MISSING_MESSAGE = 'This signing can’t be confirmed yet.'

/** SIGNING_CLUB_MISSING_MESSAGE in the interface language (what signingErrorMessage actually returns). */
export function signingClubMissingMessage(): string {
  return tInbox('signing.errors.notConfirmable')
}

export function signingErrorMessage(err: unknown, fallback: string): string {
  const msg = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : ''
  const hit = PASS_THROUGH.find(([prefix]) => msg.startsWith(prefix))
  return hit ? tInbox(hit[1]) : fallback
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
    case 'offered': return tInbox('signing.tags.offerSent')
    case 'accepted': return tInbox('signing.tags.offerAccepted')
    case 'signed_pending_confirmation': return tInbox('signing.tags.waitingConfirm')
    case 'signed': return tInbox('signing.tags.signed')
    default: return null
  }
}

/** The grey tag on a row under Closed that says why it closed (no tag = no reply). */
export function closedApplicantTag(status: string): string | null {
  if (status === 'withdrawn') return tInbox('signing.tags.withdrawn')
  if (status === 'filled') return tInbox('signing.tags.filled')
  return null
}

// ── Player: withdraw an application ──

/** English title. Screens should prefer withdrawTitle(), which follows the interface language. */
export const WITHDRAW_TITLE = 'Withdraw your application?'

export function withdrawTitle(): string {
  return tInbox('signing.withdraw.title')
}

/** The confirm step's body: final, and the club sees it as withdrawn. */
export function withdrawBody(status: string | null | undefined): string {
  if (status === 'offered') return tInbox('signing.withdraw.bodyOffered')
  if (status === 'accepted' || status === 'signed_pending_confirmation') return tInbox('signing.withdraw.bodySigning')
  return tInbox('signing.withdraw.body')
}

/** What the player reads next to the road steps (their own status only). */
export function playerRoadHint(status: string): string | null {
  switch (status) {
    case 'offered': return tInbox('signing.playerHint.offered')
    case 'accepted': return tInbox('signing.playerHint.accepted')
    case 'signed_pending_confirmation': return tInbox('signing.playerHint.pending')
    case 'signed': return tInbox('signing.playerHint.signed')
    default: return null
  }
}
