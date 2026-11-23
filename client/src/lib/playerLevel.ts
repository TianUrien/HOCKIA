import { tRecruiting } from '@/i18n/ns/recruiting'

/**
 * "Level played" (recruiter surfaces only): the facts a club reads to judge
 * how high a player has played. Founder ruling 2026-11-23 after a recruiter
 * wrote that it was "not clear" whether an applicant had played at a high
 * level: recruiters judge level by the highest league and division played
 * and by the national team, so those two facts go at the top, in plain words.
 *
 * Facts only. The curated band (world_leagues.level_band_global, 1 = the
 * strongest) decides WHICH league is shown; it is never displayed, and no
 * adjective is added. A league the player only typed is shown as written
 * and labelled, never ranked. CLUB surfaces only: players never see levels.
 */

export interface LeagueCandidate {
  /** League name as curated in world_leagues. */
  name: string
  /** Division inside its country: 1 is the top division. */
  tier: number | null
  /** Curated global band, 1 = strongest. Picks the league; never shown. */
  band: number | null
  countryName: string | null
  flag: string | null
  clubName: string | null
  /** The player's club today. */
  current: boolean
  /** ISO start date of the spell, when known (the newest wins a tie). */
  startDate: string | null
}

export interface NationalCandidate {
  countryName: string | null
  flag: string | null
  /** career_history.represented_level: 'senior' | 'junior' | 'masters' | free text | null. */
  level: string | null
  caps: number | null
}

export interface SelfReportedLeague {
  name: string
  clubName: string | null
}

export interface PlayerLevel {
  league: LeagueCandidate | null
  national: NationalCandidate | null
  /** Only when there is no linked league: the league the player typed. */
  selfReported: SelfReportedLeague | null
}

const big = Number.MAX_SAFE_INTEGER

/** The strongest linked league: lowest band, then top division, then current, then newest. */
export function pickHighestLeague(candidates: LeagueCandidate[]): LeagueCandidate | null {
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) =>
    (a.band ?? big) - (b.band ?? big)
    || (a.tier ?? big) - (b.tier ?? big)
    || Number(b.current) - Number(a.current)
    || (b.startDate ?? '').localeCompare(a.startDate ?? ''),
  )[0]
}

const NATIONAL_ORDER: Record<string, number> = { senior: 0, junior: 1, masters: 2 }

/** Senior first, then junior, then masters, then unspecified; more caps wins a tie. */
export function pickNationalTeam(candidates: NationalCandidate[]): NationalCandidate | null {
  if (candidates.length === 0) return null
  const rank = (c: NationalCandidate) => NATIONAL_ORDER[(c.level ?? '').toLowerCase()] ?? 3
  return [...candidates].sort((a, b) => rank(a) - rank(b) || (b.caps ?? -1) - (a.caps ?? -1))[0]
}

export function buildPlayerLevel(input: { leagues: LeagueCandidate[]; nationals: NationalCandidate[]; selfReported: SelfReportedLeague[] }): PlayerLevel {
  const league = pickHighestLeague(input.leagues)
  return {
    league,
    national: pickNationalTeam(input.nationals),
    selfReported: league ? null : input.selfReported[0] ?? null,
  }
}

export function hasLevelFacts(level: PlayerLevel | null | undefined): boolean {
  return Boolean(level && (level.league || level.national || level.selfReported))
}

// Copy follows the active language (the card re-renders through useRecruitingT).
const t = tRecruiting

/** "top division" | "2nd division" | "3rd division" | null. */
export function divisionLabel(tier: number | null): string | null {
  if (tier === 1) return t('levelCard.division.top')
  if (tier === 2) return t('levelCard.division.second')
  if (tier === 3) return t('levelCard.division.third')
  return null
}

export function nationalLevelLabel(level: string | null): string | null {
  const key = (level ?? '').toLowerCase()
  if (key === 'senior') return t('levelCard.national.senior')
  if (key === 'junior') return t('levelCard.national.junior')
  if (key === 'masters') return t('levelCard.national.masters')
  return level?.trim() || null
}

const withFlag = (flag: string | null, name: string | null) => [flag, name].filter(Boolean).join(' ') || null
const list = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(', ')

export interface LevelRow {
  key: 'league' | 'national' | 'selfReported'
  label: string
  value: string
  detail: string | null
}

/** The rows of the Level card, in reading order. */
export function levelRows(level: PlayerLevel): LevelRow[] {
  const rows: LevelRow[] = []
  if (level.league) {
    const l = level.league
    rows.push({
      key: 'league',
      label: t('levelCard.league'),
      value: l.name,
      detail: list([withFlag(l.flag, l.countryName), divisionLabel(l.tier), l.clubName ? (l.current ? t('levelCard.withClubNow', { club: l.clubName }) : t('levelCard.withClub', { club: l.clubName })) : null]) || null,
    })
  } else if (level.selfReported) {
    rows.push({
      key: 'selfReported',
      label: t('levelCard.leagueTyped'),
      value: level.selfReported.name,
      detail: list([level.selfReported.clubName ? t('levelCard.withClub', { club: level.selfReported.clubName }) : null, t('levelCard.typedNote')]),
    })
  }
  if (level.national) {
    const n = level.national
    rows.push({
      key: 'national',
      label: t('levelCard.nationalTeam'),
      value: list([withFlag(n.flag, n.countryName) ?? t('levelCard.national.unnamed'), nationalLevelLabel(n.level)]),
      detail: n.caps && n.caps > 0 ? t('levelCard.caps', { count: n.caps }) : null,
    })
  }
  return rows
}

/** One line for lists: "Hoofdklasse Heren, top division, Netherlands senior". */
export function levelLine(level: PlayerLevel | null | undefined): string | null {
  if (!level) return null
  const parts: (string | null)[] = []
  if (level.league) parts.push(list([level.league.name, divisionLabel(level.league.tier)]))
  else if (level.selfReported) parts.push(level.selfReported.name)
  if (level.national) parts.push(list([level.national.countryName, nationalLevelLabel(level.national.level)]).replace(', ', ' ') || t('levelCard.nationalTeam'))
  return list(parts) || null
}
