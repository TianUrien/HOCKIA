/**
 * Small pure helpers behind the D2 · 30-second profile screens (key-fact Add
 * labels, the club's "Applied to …" line, which league column a player's own
 * league lives in). Kept out of the component files for fast refresh + tests.
 */
import type { KeyFact, KeyFactAction } from '@/lib/keyFacts'
import { daysLeftToReply } from '@/lib/clubRecruiting'
import { shortDayOf } from '@/lib/signing'
import { tProfile } from '@/i18n/ns/profile'

const ACTION_LABEL: Record<KeyFactAction, () => string> = {
  add_position: () => tProfile('profileD2.action.addPosition'),
  add_club: () => tProfile('profileD2.action.addClub'),
  add_league: () => tProfile('profileD2.action.addLeague'),
  add_availability: () => tProfile('profileD2.action.addAvailability'),
  add_date: () => tProfile('profileD2.action.addDate'),
  add_passport: () => tProfile('profileD2.action.addPassport'),
  add_video: () => tProfile('profileD2.action.addVideo'),
  add_specialization: () => tProfile('profileD2.action.addSpecialization'),
  add_categories: () => tProfile('profileD2.action.addCategories'),
}

export function keyFactActionLabel(fact: KeyFact): string | null {
  if (!fact.action) return null
  // A passport is on file and the second field is free → "Add another".
  if (fact.action === 'add_passport' && !fact.missing) return tProfile('profileD2.action.addAnother')
  return ACTION_LABEL[fact.action]()
}

/** What appliedLine needs from an application (see useClubViewOfPlayer). */
export interface AppliedLineInput {
  status: string
  appliedAt: string | null
  expiryDays: number
}

// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null) => shortDayOf(iso)

const STATUS_LINE: Record<string, () => string> = {
  shortlisted: () => tProfile('profileD2.status.shortlisted'),
  maybe: () => tProfile('profileD2.status.maybe'),
  rejected: () => tProfile('profileD2.status.rejected'),
  no_response: () => tProfile('profileD2.status.noResponse'),
}

export function appliedLine(application: AppliedLineInput, now = new Date()): string {
  const day = monthDay(application.appliedAt)
  let tail: string | null
  if (application.status === 'pending') {
    const days = daysLeftToReply(application.appliedAt, application.expiryDays, now)
    tail = days === null ? null : days === 0 ? tProfile('profileD2.closesToday') : tProfile('profileD2.daysLeftToReply', { count: days })
  } else {
    tail = STATUS_LINE[application.status]?.() ?? null
  }
  return [day, tail].filter(Boolean).join(', ')
}

export type LeagueSide = 'mens_league_id' | 'womens_league_id'

export function leagueSideFor(playingCategory: string | null | undefined): LeagueSide {
  return playingCategory === 'adult_women' || playingCategory === 'girls' ? 'womens_league_id' : 'mens_league_id'
}

