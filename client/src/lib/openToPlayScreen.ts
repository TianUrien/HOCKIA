/**
 * Copy and checklist for the Open to play screen (Figma D2.4 395:601). Pure —
 * the screen passes live data in.
 *
 * "What clubs check first": passport, match video, league — each with Add.
 * The consent line says what the switch does: while it's on Hockia can
 * suggest the profile to clubs; off stops it (brief 403:2).
 */
import type { LeagueInput, PassportInput } from '@/lib/keyFacts'
import { tProfileEdit } from '@/i18n/ns/profileEdit'
import { isEnglish } from '@/i18n/format'

export type ChecklistKey = 'passport' | 'video' | 'league'

export interface ChecklistRow {
  key: ChecklistKey
  label: string
  done: boolean
  detail: string
}

export function openToPlayChecklist(input: {
  passports: PassportInput[]
  fullMatches: number
  highlights: number
  league: LeagueInput | null
}): ChecklistRow[] {
  const passports = input.passports.filter((p) => p.name.trim())
  const video = [
    input.fullMatches > 0 ? tProfileEdit('openToPlay.checklist.fullMatches', { count: input.fullMatches }) : null,
    input.highlights > 0 ? tProfileEdit('openToPlay.checklist.highlights', { count: input.highlights }) : null,
  ].filter(Boolean).join(', ')
  const leagueName = input.league?.name?.trim() || null
  const notSet = tProfileEdit('openToPlay.checklist.notSet')
  return [
    {
      key: 'passport',
      label: tProfileEdit('openToPlay.checklist.passport'),
      done: passports.length > 0,
      detail: passports.length > 0 ? passports.map((p) => (p.flag ? `${p.flag} ${p.name}` : p.name)).join(', ') : notSet,
    },
    { key: 'video', label: tProfileEdit('openToPlay.checklist.video'), done: video.length > 0, detail: video || notSet },
    {
      key: 'league',
      label: tProfileEdit('openToPlay.checklist.league'),
      done: leagueName !== null,
      detail: leagueName ? (input.league?.source === 'self_reported' ? tProfileEdit('openToPlay.checklist.leagueSelfReported', { league: leagueName }) : leagueName) : notSet,
    },
  ]
}

const KNOWN_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
type KnownPosition = (typeof KNOWN_POSITIONS)[number]

/** "a midfielder" from 'midfielder' / 'Midfielder'; "a player" when unknown. */
function roleNoun(position: string | null | undefined): string {
  const p = position?.trim().toLowerCase().replace(/_/g, ' ')
  if (!p) return tProfileEdit('openToPlay.consent.player')
  if ((KNOWN_POSITIONS as readonly string[]).includes(p)) return tProfileEdit(`openToPlay.consent.${p as KnownPosition}`)
  // A position outside the four: English names it as stored; other languages say "player".
  if (!isEnglish()) return tProfileEdit('openToPlay.consent.player')
  return `${/^[aeiou]/.test(p) ? 'an' : 'a'} ${p}`
}

export function openToPlayConsent(open: boolean, position: string | null | undefined): string {
  const role = roleNoun(position)
  return open ? tProfileEdit('openToPlay.consent.on', { role }) : tProfileEdit('openToPlay.consent.off', { role })
}

export function getUnder18Copy(): string {
  return tProfileEdit('openToPlay.copy.under18')
}

export function getDobRequiredCopy(): string {
  return tProfileEdit('openToPlay.copy.dobRequired')
}
