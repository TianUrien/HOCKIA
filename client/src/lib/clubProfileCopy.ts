import { formatDurationText } from '@/lib/opportunityCopy'
import { shortDayOf } from '@/lib/signing'
import type { ClubOpenRole } from '@/hooks/useClubProfileScrollData'
import { tWorld } from '@/i18n/ns/world'
import { formatList, isEnglish } from '@/i18n/format'

/**
 * Copy rules for the phone Club profile (Figma 04 Club › Club profile —
 * own / public): the league fact row and the open-role card's second line.
 */
// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null | undefined) => shortDayOf(iso)

/** "Leinster Division 1A · men & women" / "Premier Division · men, Serie A1 · women". */
export function clubLeagueLine(men: string | null | undefined, women: string | null | undefined): string | null {
  const m = men?.trim() || null
  const w = women?.trim() || null
  if (m && w) return m.toLowerCase() === w.toLowerCase()
    ? tWorld('club.league.menAndWomen', { league: m })
    : tWorld('club.league.menThenWomen', { men: m, women: w })
  if (m) return tWorld('club.league.men', { league: m })
  if (w) return tWorld('club.league.women', { league: w })
  return null
}

/**
 * One league for a club in a tight spot (chat header): the one the club
 * profile lists FIRST (clubLeagueLine: men, then women), so the chat never
 * names a different league than the profile and the club's men's role pages.
 */
export function clubLeadLeague(men: string | null | undefined, women: string | null | undefined): string | null {
  return men?.trim() || women?.trim() || null
}

/** "Open role · from Sep 1 · 7 months" — the public card's second line. */
export function openRoleLine(role: Pick<ClubOpenRole, 'startDate' | 'durationText'>): string {
  const from = monthDay(role.startDate)
  return [tWorld('club.openRole.label'), from ? tWorld('club.openRole.from', { date: from }) : null, formatDurationText(role.durationText)].filter(Boolean).join(' · ')
}


/** "Hockia doesn't have a level for Leinster Division 1A yet. …" — one line per unbanded league. */
export function leagueBandNote(leagues: { name: string; band: number | null }[]): string | null {
  const names = [...new Set(leagues.filter((l) => l.band === null).map((l) => l.name))]
  if (names.length === 0) return null
  // English keeps its own list style ("A, B and C", no serial comma); other languages use Intl.
  const list = names.length === 1 || !isEnglish()
    ? formatList(names)
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return tWorld('club.league.bandNote', { list })
}

