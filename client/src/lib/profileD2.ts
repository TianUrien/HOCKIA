/**
 * Small pure helpers behind the D2 · 30-second profile screens (key-fact Add
 * labels, the club's "Applied to …" line, which league column a player's own
 * league lives in). Kept out of the component files for fast refresh + tests.
 */
import type { KeyFact, KeyFactAction } from '@/lib/keyFacts'
import { daysLeftLabel, daysLeftToReply } from '@/lib/clubRecruiting'
import { shortDayOf } from '@/lib/signing'

const ACTION_LABEL: Record<KeyFactAction, string> = {
  add_position: 'Add position',
  add_club: 'Add club',
  add_league: 'Add league',
  add_availability: 'Add availability',
  add_date: 'Add date',
  add_passport: 'Add passport',
  add_video: 'Add video',
  add_specialization: 'Add specialization',
  add_categories: 'Add categories',
}

export function keyFactActionLabel(fact: KeyFact): string | null {
  if (!fact.action) return null
  // A passport is on file and the second field is free → "Add another".
  if (fact.action === 'add_passport' && !fact.missing) return 'Add another'
  return ACTION_LABEL[fact.action]
}

/** What appliedLine needs from an application (see useClubViewOfPlayer). */
export interface AppliedLineInput {
  status: string
  appliedAt: string | null
  expiryDays: number
}

// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null) => shortDayOf(iso)

const STATUS_LINE: Record<string, string> = {
  shortlisted: 'Shortlisted',
  maybe: 'Marked maybe',
  rejected: 'Declined',
  no_response: 'Closed without a reply',
}

export function appliedLine(application: AppliedLineInput, now = new Date()): string {
  const day = monthDay(application.appliedAt)
  let tail: string | null
  if (application.status === 'pending') {
    const days = daysLeftToReply(application.appliedAt, application.expiryDays, now)
    tail = days === null ? null : days === 0 ? 'closes today' : `${daysLeftLabel(days)} to reply`
  } else {
    tail = STATUS_LINE[application.status] ?? null
  }
  return [day, tail].filter(Boolean).join(' · ')
}

export type LeagueSide = 'mens_league_id' | 'womens_league_id'

export function leagueSideFor(playingCategory: string | null | undefined): LeagueSide {
  return playingCategory === 'adult_women' || playingCategory === 'girls' ? 'womens_league_id' : 'mens_league_id'
}

