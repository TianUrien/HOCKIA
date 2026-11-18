import { differenceInCalendarDays } from 'date-fns'
import { positionLabel } from '@/lib/identity'
import { profilePath } from '@/lib/profileNavigation'
import type { NotificationRecord } from '@/lib/api/notifications'
import { tCommunity } from '@/i18n/ns/community'
import { tEnums } from '@/i18n/ns/enums'
import { intlLocale, isEnglish } from '@/i18n/format'

/**
 * "Your week" (Pulse v2, Figma New-Hockia 42:276; founder rulings 2026-10-03).
 * Pure copy and date rules for the player Pulse screen, so the screen only
 * lays things out. Every number here is the player's OWN (views of their
 * profile, their applications, roles for their position) — never a fit
 * score, a level, an applicant count or another player's number
 * (lib/opportunityCopy header rule). Copy is gender-neutral throughout.
 *
 * Amber rule (lib/statusTone): a player waiting on a club cannot act, so every
 * line in "What happened" is neutral grey — an expired application included.
 */

/** "September" / "septiembre": the long month name in the interface language. */
function monthLong(d: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(d)
}

/** Monday 00:00 (local) of the week that contains `now`. */
export function weekStart(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = d.getDay() // 0 = Sunday
  const back = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - back)
  return d
}

/** "13–19 September" for the current Monday–Sunday week; "29 September – 5 October"
 *  when it crosses a month (day first, like every date in the app). */
export function weekRangeLabel(now: Date = new Date()): string {
  const start = weekStart(now)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  if (start.getMonth() === end.getMonth()) {
    return tCommunity('pulse.weekRange.sameMonth', { startDay: start.getDate(), endDay: end.getDate(), month: monthLong(start) })
  }
  return tCommunity('pulse.weekRange.crossMonth', { startDay: start.getDate(), startMonth: monthLong(start), endDay: end.getDate(), endMonth: monthLong(end) })
}

export interface WeekViewCounts {
  /** Profile views in the last 7 days (every role). */
  views: number
  /** Distinct viewers, every role. */
  uniqueViewers: number
  clubs: number
  coaches: number
}

/**
 * The header line. Clubs and coaches are named; anyone else is "people" —
 * players are counted, never listed (founder ruling 2026-10-03).
 *   "3 clubs and 1 coach looked at your profile this week"
 *   "2 people looked at your profile this week"
 *   "No profile views yet this week"
 */
export function viewersHeadline(c: WeekViewCounts): string {
  if (c.views <= 0) return tCommunity('pulse.headline.none')
  if (c.clubs > 0 && c.coaches > 0) {
    return tCommunity('pulse.headline.clubsAndCoaches', {
      clubs: tCommunity('pulse.counts.clubs', { count: c.clubs }),
      coaches: tCommunity('pulse.counts.coaches', { count: c.coaches }),
    })
  }
  if (c.clubs > 0) return tCommunity('pulse.headline.clubs', { count: c.clubs })
  if (c.coaches > 0) return tCommunity('pulse.headline.coaches', { count: c.coaches })
  return tCommunity('pulse.headline.people', { count: Math.max(1, c.uniqueViewers) })
}

/** "4 more vs last week" · "2 fewer vs last week" · "Same as last week". */
export function viewsDeltaLine(views: number, priorViews: number): string {
  const delta = views - priorViews
  if (delta > 0) return tCommunity('pulse.delta.more', { delta })
  if (delta < 0) return tCommunity('pulse.delta.fewer', { delta: Math.abs(delta) })
  return tCommunity('pulse.delta.same')
}

/** "3 clubs · 1 coach" · "2 clubs" · "None yet". */
export function recruitersLine(clubs: number, coaches: number): string {
  const clubsText = tCommunity('pulse.counts.clubs', { count: clubs })
  const coachesText = tCommunity('pulse.counts.coaches', { count: coaches })
  if (clubs > 0 && coaches > 0) return tCommunity('pulse.recruiters.both', { clubs: clubsText, coaches: coachesText })
  if (clubs > 0) return clubsText
  if (coaches > 0) return coachesText
  return tCommunity('pulse.recruiters.none')
}

/** "midfielder" → "midfielders" (lower case, for "2 for midfielders"). */
export function positionPlural(position: string | null | undefined): string | null {
  const label = positionLabel(position)
  if (!label) return null
  const lower = label.toLowerCase()
  return lower.endsWith('s') ? lower : `${lower}s`
}

/** "2 for midfielders" · "None for midfielders" · "Open this week" (no position). */
export function newRolesLine(forPosition: number, position: string | null | undefined): string {
  const plural = positionPlural(position)
  if (!plural) return tCommunity('pulse.newRoles.noPosition')
  // English pluralises the position ("midfielders"); other languages name the
  // position itself inside their own sentence ("el puesto de volante").
  const group = isEnglish() ? plural : (positionLabel(position) ?? plural).toLowerCase()
  return forPosition > 0 ? tCommunity('pulse.newRoles.some', { count: forPosition, group }) : tCommunity('pulse.newRoles.none', { group })
}

/** The club that answered: one name, "A and 2 more", or "No replies yet". */
export function clubReplyLine(clubNames: Array<string | null | undefined>): string {
  const names = clubNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
  if (names.length === 0) return clubNames.length > 0 ? tCommunity('pulse.clubReply.unnamed') : tCommunity('pulse.clubReply.none')
  if (names.length === 1) return names[0]
  return tCommunity('pulse.clubReply.andMore', { name: names[0], count: names.length - 1 })
}

/**
 * "You last confirmed 3 weeks ago" from profiles.availability_confirmed_at.
 * Never been confirmed → the honest line, no date.
 */
export function confirmedAgoLine(confirmedAt: string | null | undefined, now: Date = new Date()): string {
  if (!confirmedAt) return tCommunity('pulse.confirmed.never')
  const d = new Date(confirmedAt)
  if (Number.isNaN(d.getTime())) return tCommunity('pulse.confirmed.never')
  const days = Math.max(0, differenceInCalendarDays(now, d))
  if (days === 0) return tCommunity('pulse.confirmed.today')
  if (days === 1) return tCommunity('pulse.confirmed.yesterday')
  if (days < 7) return tCommunity('pulse.confirmed.days', { count: days })
  const weeks = Math.round(days / 7)
  if (days < 60) return tCommunity('pulse.confirmed.weeks', { count: weeks })
  const months = Math.round(days / 30)
  return tCommunity('pulse.confirmed.months', { count: months })
}

export interface CheckInCopy {
  question: string
  rationale: string
}

/**
 * The check-in question per role. Coaches get the wording the weekly
 * check-in card already uses (AvailabilityCheckInCard); recruiting coaches
 * and every other role see no check-in. `null` = hide the card.
 */
export function checkInCopy(role: string | null | undefined, opts: { openToPlay: boolean; openToCoach: boolean; recruitsForTeam: boolean }): CheckInCopy | null {
  if (role === 'player') {
    if (!opts.openToPlay) return null
    return { question: tCommunity('pulse.checkIn.playerQuestion'), rationale: tCommunity('pulse.checkIn.rationale') }
  }
  if (role === 'coach') {
    if (opts.recruitsForTeam || !opts.openToCoach) return null
    return { question: tCommunity('pulse.checkIn.coachQuestion'), rationale: tCommunity('pulse.checkIn.rationale') }
  }
  return null
}

// ── Who looked at you ─────────────────────────────────────────────────────

export interface WeekViewerRow {
  viewer_id: string | null
  full_name: string | null
  role: string | null
  username: string | null
  avatar_url: string | null
  country_id: number | null
  is_hidden: boolean
  viewed_at: string
}

export interface ViewerLine {
  key: string
  /** "Serie A1 Club" or "Private". */
  name: string
  /** "Club" / "Coach" or "Browsing hidden". */
  meta: string
  role: 'club' | 'coach' | null
  avatarUrl: string | null
  countryId: number | null
  hidden: boolean
  viewedAt: string
  /** Where the row opens; null for a masked viewer. */
  path: string | null
}

/** "Private" / "Browsing hidden": the masked viewer's name and caption. */
export function hiddenViewerName(): string {
  return tCommunity('pulse.viewers.hiddenName')
}
export function hiddenViewerMeta(): string {
  return tCommunity('pulse.viewers.hiddenMeta')
}

/**
 * Rows for the list. Only club and coach rows are kept even if the server
 * ever returned more (the ruling is mirrored here, server stays the
 * authority); a masked row never carries an identity.
 */
export function viewerLines(rows: readonly WeekViewerRow[]): ViewerLine[] {
  const out: ViewerLine[] = []
  rows.forEach((r, i) => {
    if (r.is_hidden) {
      out.push({ key: `hidden-${i}`, name: hiddenViewerName(), meta: hiddenViewerMeta(), role: null, avatarUrl: null, countryId: null, hidden: true, viewedAt: r.viewed_at, path: null })
      return
    }
    if (r.role !== 'club' && r.role !== 'coach') return
    if (!r.viewer_id) return
    const roleName = tEnums(r.role === 'club' ? 'role.club' : 'role.coach')
    out.push({
      key: r.viewer_id,
      name: r.full_name?.trim() || roleName,
      meta: roleName,
      role: r.role,
      avatarUrl: r.avatar_url,
      countryId: r.country_id,
      hidden: false,
      viewedAt: r.viewed_at,
      path: r.role === 'club' ? `/clubs/id/${r.viewer_id}` : `/coaches/id/${r.viewer_id}`,
    })
  })
  return out
}

// ── What happened ─────────────────────────────────────────────────────────

/** Who the line is about: the notification's actor (a club or a person). */
export interface HappenedActor {
  id: string | null
  name: string
  role: string | null
  avatarUrl: string | null
}

/** Icon for a system line with no actor (Figma List item / Activity 531:469). */
export type HappenedIcon = 'briefcase' | 'heart' | 'bell'

export interface HappenedLine {
  key: string
  text: string
  at: string
  /** Always 'grey' for a player: nothing here needs the player to act (amber rule). */
  tone: 'grey'
  /**
   * Where the row opens, or null. A null path renders a plain row: no
   * chevron and not tappable (design ruling 2026-10-03). Only destinations
   * the notification's own data can reach are wired here.
   */
  path: string | null
  /** The club or person the line is about; null for a system event. */
  actor: HappenedActor | null
  /** Drawn instead of an avatar when `actor` is null. */
  icon: HappenedIcon
}

/** Opportunity titles by id, for "Your application to X expired". */
export type OpportunityTitles = ReadonlyMap<string, string>

function metaString(n: NotificationRecord, key: string): string | null {
  const v = n.metadata?.[key]
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

function actorName(n: NotificationRecord): string | null {
  return n.actor?.fullName?.trim() || n.actor?.username?.trim() || null
}

function actorOf(n: NotificationRecord): HappenedActor | null {
  const name = actorName(n)
  if (!name && !n.actor?.id) return null
  return { id: n.actor?.id ?? null, name: name ?? '', role: n.actor?.role ?? null, avatarUrl: n.actor?.avatarUrl ?? null }
}

/** The club's own profile when the notification names it, else null. */
function clubPath(n: NotificationRecord): string | null {
  return n.actor?.id ? `/clubs/id/${n.actor.id}` : null
}

const MY_APPLICATIONS = '/opportunities/applications'
/** The Closed segment of My applications (MyApplicationsPage reads `segment`). */
export const MY_APPLICATIONS_CLOSED = `${MY_APPLICATIONS}?segment=closed`

/** The Inbox thread with a club: MessagesPage resolves `?new=<id>` to the existing conversation or opens one. */
export function clubThreadPath(clubId: string | null | undefined): string | null {
  return clubId ? `/messages?new=${clubId}` : null
}

/**
 * One neutral line per notification the player would care about this week.
 * Returns [] for kinds that are not a "what happened" fact (friend requests
 * received, comments, likes, messages — those live in Inbox). Expired
 * applications are grey, never amber: the player cannot act on a club that
 * went quiet.
 *
 * Destinations (design ruling 2026-10-03), each only when the row's data
 * can reach it: a club's reply → that Inbox thread; an expired application →
 * My applications, Closed; an accepted friend request → their profile; a
 * club's invitation / squad → the club; a posted role → the role.
 */
export function happenedLinesFromNotification(n: NotificationRecord, titles: OpportunityTitles = new Map()): HappenedLine[] {
  const actor = actorOf(n)
  const base = { at: n.createdAt, tone: 'grey' as const, actor, icon: 'bell' as HappenedIcon }
  switch (n.kind) {
    case 'applications_expired': {
      const ids = Array.isArray(n.metadata?.opportunity_ids) ? (n.metadata.opportunity_ids as unknown[]).filter((x): x is string => typeof x === 'string') : []
      const named = ids.map((id) => titles.get(id)).filter((t): t is string => Boolean(t))
      const system = { ...base, actor: null, icon: 'briefcase' as const, path: MY_APPLICATIONS_CLOSED }
      if (named.length > 0) {
        return named.map((title, i) => ({ ...system, key: `${n.id}-${i}`, text: tCommunity('pulse.happened.applicationExpired', { title }) }))
      }
      const c = typeof n.metadata?.count === 'number' ? n.metadata.count : 1
      return [{ ...system, key: n.id, text: tCommunity('pulse.happened.expiredCount', { count: c }) }]
    }
    case 'vacancy_application_status': {
      // The trigger writes `vacancy_title` (20260626150000); older rows may carry `opportunity_title`.
      const title = metaString(n, 'vacancy_title') ?? metaString(n, 'opportunity_title')
      const club = metaString(n, 'club_name') ?? actorName(n)
      const who = club ?? tCommunity('pulse.happened.aClub')
      const line = actor ?? (club ? { id: null, name: club, role: 'club', avatarUrl: null } : null)
      return [{ ...base, actor: line, key: n.id, text: title ? tCommunity('pulse.happened.repliedOn', { club: who, title }) : tCommunity('pulse.happened.repliedToApplication', { club: who }), path: clubThreadPath(n.actor?.id) ?? MY_APPLICATIONS }]
    }
    case 'recruiting_update': {
      const title = metaString(n, 'title')
      return title ? [{ ...base, icon: 'briefcase', key: n.id, text: title, path: n.targetUrl ?? null }] : []
    }
    case 'reference_request_accepted': {
      const who = actorName(n) ?? tCommunity('pulse.happened.someone')
      return [{ ...base, key: n.id, text: tCommunity('pulse.happened.wroteReference', { name: who }), path: '/dashboard/profile?tab=references' }]
    }
    case 'friend_request_accepted': {
      const who = actorName(n)
      if (!who) return []
      return [{ ...base, key: n.id, text: tCommunity('pulse.happened.acceptedFriend', { name: who }), path: profilePath(n.actor?.role, n.actor?.username, n.actor?.id) }]
    }
    case 'club_invitation_received': {
      const who = actorName(n) ?? tCommunity('pulse.happened.aClub')
      return [{ ...base, key: n.id, text: tCommunity('pulse.happened.invitedToSquad', { club: who }), path: clubPath(n) }]
    }
    case 'club_invitation_accepted': {
      const who = actorName(n) ?? tCommunity('pulse.happened.aClub')
      return [{ ...base, key: n.id, text: tCommunity('pulse.happened.joinedClub', { club: who }), path: clubPath(n) }]
    }
    case 'opportunity_published': {
      const title = metaString(n, 'opportunity_title')
      const club = metaString(n, 'club_name') ?? actorName(n) ?? tCommunity('pulse.happened.aClub')
      const line = actor ?? (metaString(n, 'club_name') ? { id: null, name: club, role: 'club', avatarUrl: null } : null)
      return title ? [{ ...base, actor: line, icon: 'briefcase', key: n.id, text: tCommunity('pulse.happened.postedRole', { club, title }), path: n.targetUrl ?? '/opportunities' }] : []
    }
    default:
      return []
  }
}

/**
 * Newest first, only the last `days` days, at most `limit` lines. The same
 * sentence is shown once (its newest occurrence): a person who accepts,
 * un-friends and re-accepts eight times is one fact, and must not push the
 * week's club facts out of the list.
 */
export function happenedTimeline(
  notifications: readonly NotificationRecord[],
  titles: OpportunityTitles,
  opts: { now?: Date; days?: number; limit?: number } = {},
): HappenedLine[] {
  const now = opts.now ?? new Date()
  const days = opts.days ?? 7
  const since = now.getTime() - days * 86_400_000
  const seen = new Set<string>()
  return notifications
    .filter((n) => !n.clearedAt && new Date(n.createdAt).getTime() >= since)
    .flatMap((n) => happenedLinesFromNotification(n, titles))
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((l) => (seen.has(l.text) ? false : (seen.add(l.text), true)))
    .slice(0, opts.limit ?? 8)
}

/** A reference that arrived in the last `days` days, newest first. */
export function referenceArrivedThisWeek<T extends { acceptedAt: string | null }>(refs: readonly T[], now: Date = new Date(), days = 7): T | null {
  const since = now.getTime() - days * 86_400_000
  const recent = refs
    .filter((r) => r.acceptedAt && new Date(r.acceptedAt).getTime() >= since)
    .sort((a, b) => (b.acceptedAt ?? '').localeCompare(a.acceptedAt ?? ''))
  return recent[0] ?? null
}
