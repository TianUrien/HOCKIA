/**
 * Copy and checklist for the Open to play screen (Figma D2.4 395:601). Pure —
 * the screen passes live data in.
 *
 * "What clubs check first": passport, match video, league — each with Add.
 * The consent line says what the switch does: while it's on Hockia can
 * suggest the profile to clubs; off stops it (brief 403:2).
 */
import type { LeagueInput, PassportInput } from '@/lib/keyFacts'
import { SELF_REPORTED_LABEL } from '@/lib/keyFacts'

export type ChecklistKey = 'passport' | 'video' | 'league'

export interface ChecklistRow {
  key: ChecklistKey
  label: string
  done: boolean
  detail: string
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function openToPlayChecklist(input: {
  passports: PassportInput[]
  fullMatches: number
  highlights: number
  league: LeagueInput | null
}): ChecklistRow[] {
  const passports = input.passports.filter((p) => p.name.trim())
  const video = [
    input.fullMatches > 0 ? plural(input.fullMatches, 'full match', 'full matches') : null,
    input.highlights > 0 ? plural(input.highlights, 'highlight', 'highlights') : null,
  ].filter(Boolean).join(' · ')
  const leagueName = input.league?.name?.trim() || null
  return [
    {
      key: 'passport',
      label: 'Passport',
      done: passports.length > 0,
      detail: passports.length > 0 ? passports.map((p) => (p.flag ? `${p.flag} ${p.name}` : p.name)).join(' · ') : 'Not set',
    },
    { key: 'video', label: 'Match video', done: video.length > 0, detail: video || 'Not set' },
    {
      key: 'league',
      label: 'League',
      done: leagueName !== null,
      detail: leagueName ? (input.league?.source === 'self_reported' ? `${leagueName} · ${SELF_REPORTED_LABEL}` : leagueName) : 'Not set',
    },
  ]
}

/** "midfielder" from 'midfielder' / 'Midfielder'; "player" when unknown. */
function roleNoun(position: string | null | undefined): string {
  const p = position?.trim().toLowerCase().replace(/_/g, ' ')
  return p || 'player'
}

export function openToPlayConsent(open: boolean, position: string | null | undefined): string {
  const who = roleNoun(position)
  const article = /^[aeiou]/.test(who) ? 'an' : 'a'
  return open
    ? `While you’re open to play, Hockia can suggest your profile to clubs looking for ${article} ${who}. Turn this off and you stop being suggested.`
    : `Turn this on and Hockia can suggest your profile to clubs looking for ${article} ${who}. While it’s off, you aren’t suggested.`
}

export const UNDER_18_COPY = 'Open to play is for players 18 and over. Until then clubs aren’t suggested your profile — you can still keep it up to date.'
export const DOB_REQUIRED_COPY = 'Open to play is for players 18 and over. Add your date of birth to turn it on — it never shows on your profile.'
