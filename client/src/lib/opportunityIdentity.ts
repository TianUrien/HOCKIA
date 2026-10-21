/**
 * Who is behind a role (Opportunities v2 ruling 2, 2026-10-16): a coach
 * posting for a club must be identifiable. The HIRING CLUB is who the player
 * would join; POSTED BY is the person who wrote the role. Today's data:
 *   - publisher profile (role 'club' or 'coach') = the account that posted
 *   - world club (directory) or organization_name = the club a coach posts for
 * No new columns: this is a pure reading of what exists, so old roles work.
 */

import { humanizeToken } from '@/lib/identity'

export type PublisherKind = 'club' | 'coach-for-club' | 'independent-coach'

export interface PublisherInput {
  /** The publishing profile's role ('club' | 'coach' | …). */
  publisherRole: string | null | undefined
  /** The publishing profile's display name and avatar. */
  publisherName: string | null | undefined
  publisherAvatar?: string | null
  /** Club typed on the role by a coach, if any. */
  organizationName?: string | null
  /** The coach's current club on their profile, if any. */
  publisherCurrentClub?: string | null
  /** The coach's current role on their profile ("head_coach"), if any. */
  publisherCoachRole?: string | null
  /** Linked directory club, if any. */
  worldClub?: { name: string; avatarUrl: string | null } | null
}

export interface RoleIdentity {
  kind: PublisherKind
  /** The club the player would join. Null only for an independent coach with no club named. */
  hiringClub: { name: string; logo: string | null } | null
  /** The person who posted (coaches only); null when the club itself posted. */
  postedBy: { name: string; firstName: string; avatar: string | null; roleLabel: string | null } | null
  /** What the card shows as its title line (hiring club, else the coach). */
  displayName: string
  displayLogo: string | null
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

export function roleIdentity(input: PublisherInput): RoleIdentity {
  const publisherName = input.publisherName?.trim() || ''
  const clubFromRole = input.worldClub?.name || input.organizationName?.trim() || null
  if (input.publisherRole !== 'coach') {
    const name = clubFromRole || publisherName || 'Club'
    const logo = input.worldClub?.avatarUrl || input.publisherAvatar || null
    return { kind: 'club', hiringClub: { name, logo }, postedBy: null, displayName: name, displayLogo: logo }
  }
  const roleLabel = humanizeToken(input.publisherCoachRole) ?? null
  const coach = publisherName ? { name: publisherName, firstName: firstName(publisherName), avatar: input.publisherAvatar ?? null, roleLabel } : null
  const clubName = clubFromRole || input.publisherCurrentClub?.trim() || null
  if (clubName) {
    const logo = input.worldClub?.avatarUrl || null
    return { kind: 'coach-for-club', hiringClub: { name: clubName, logo }, postedBy: coach, displayName: clubName, displayLogo: logo }
  }
  return { kind: 'independent-coach', hiringClub: null, postedBy: coach, displayName: publisherName || 'Coach', displayLogo: input.publisherAvatar ?? null }
}

/** The hiring club's short name for headings ("What Lazio offers"): first word(s) before " Hockey"/" HC"/" Club" when long. */
export function clubShortName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length <= 14) return trimmed
  const cut = trimmed.replace(/\s+(hockey club|hockey|hc|club|h\.c\.)$/i, '').trim()
  return cut || trimmed
}

/** Coach-aware copy for the detail sections (Figma O2 148:231 + handoff ruling 2). */
export function offersHeading(id: RoleIdentity): string {
  if (id.hiringClub) return `What ${clubShortName(id.hiringClub.name)} offers`
  return id.postedBy ? `What ${id.postedBy.firstName} offers` : 'What the club offers'
}
export function asksHeading(id: RoleIdentity): string {
  return id.kind === 'club' ? 'What they’re looking for' : 'What they’re looking for'
}
export function wordsHeading(id: RoleIdentity): string {
  return id.postedBy ? `In ${id.postedBy.firstName}’s words` : 'In the club’s words'
}
export function noteHeading(id: RoleIdentity): string {
  return id.postedBy ? `A note to ${id.postedBy.firstName}` : 'A note to the club'
}
export function messageLabel(id: RoleIdentity): string {
  return id.postedBy ? `Message ${id.postedBy.firstName}` : 'Message the club'
}
export function askWhenApplying(id: RoleIdentity): string {
  return id.postedBy ? `Ask ${id.postedBy.firstName} when you apply` : 'Ask the club when you apply'
}
/** "How applying works", step 2. */
export function reviewsLine(id: RoleIdentity): string {
  return id.postedBy ? `${id.postedBy.firstName} reviews it and replies here` : 'The club reviews it and replies here'
}
/** Under the identity card when a coach posted for a club. */
export function onBehalfNote(id: RoleIdentity): string | null {
  return id.kind === 'coach-for-club' && id.postedBy && id.hiringClub
    ? `${id.postedBy.firstName} posted this role on behalf of ${id.hiringClub.name}. Messages go to the coach.`
    : null
}
/** "Posted by Ana García" for cards; null when the club itself posted or the coach is the title. */
export function postedByLine(id: RoleIdentity): string | null {
  return id.kind === 'coach-for-club' && id.postedBy ? `Posted by ${id.postedBy.name}` : null
}
/** Apply sheet subtitle: "Lazio Hockey · posted by Nicolás Paz" / "Lazio Hockey" / "Coach Luis Pérez". */
export function applySubline(id: RoleIdentity): string {
  if (id.hiringClub) return id.postedBy ? `${id.hiringClub.name} · posted by ${id.postedBy.name}` : id.hiringClub.name
  return id.postedBy ? `Coach ${id.postedBy.name}` : 'Club'
}
/** Application sent: who reviews. */
export function sentLine(id: RoleIdentity): string {
  const who = id.postedBy ? id.postedBy.firstName : id.hiringClub?.name ?? 'The club'
  return `${who} will review your profile. We’ll let you know when they reply. You can follow it in Applied.`
}
