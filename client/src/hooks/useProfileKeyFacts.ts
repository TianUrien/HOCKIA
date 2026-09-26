import { useMemo } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useCountries, isEuCountryCode, type Country } from '@/hooks/useCountries'
import { useWorkPermits, type WorkPermitWithStatus } from '@/hooks/useWorkPermits'
import { usePlayerLeague } from '@/hooks/usePlayerLeague'
import {
  buildCoachKeyFacts,
  buildPlayerKeyFacts,
  type KeyFact,
  type KeyFactsViewer,
  type PassportInput,
  type PermitInput,
} from '@/lib/keyFacts'
import { humanizeToken } from '@/lib/identity'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

/**
 * Everything the six key-fact tiles need, assembled from the profile row, the
 * countries list (flags + EU, derived never typed), the player's league
 * (player_league, verified vs self-reported), visas & permits (owner +
 * recruiters only; RLS returns nothing to anyone else) and the video counts
 * the long scroll already loaded. Pure presentation lives in lib/keyFacts.
 */
export interface VideoCounts {
  fullMatches: number
  highlights: number
}

export interface ProfileKeyFactsResult {
  facts: KeyFact[]
  viewer: KeyFactsViewer
  /** Owner only: permits expiring within 30 days or expired (amber row). */
  attentionPermits: WorkPermitWithStatus[]
  permits: WorkPermitWithStatus[]
  /** Pronoun for club-facing copy ("his club", "her club", "their club"). */
  pronoun: 'his' | 'her' | 'their'
}

export function pronounFor(gender: string | null | undefined, category?: string | null): 'his' | 'her' | 'their' {
  const g = (gender ?? '').toLowerCase()
  if (/^(men|male|man|m)$/.test(g) || category === 'adult_men' || category === 'boys') return 'his'
  if (/^(women|female|woman|f)$/.test(g) || category === 'adult_women' || category === 'girls') return 'her'
  return 'their'
}

export function ageFromDob(dob: string | null | undefined, today: Date = new Date()): number | null {
  const m = dob ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dob) : null
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  const tm = today.getMonth() + 1; const td = today.getDate()
  return today.getFullYear() - y - (tm < mo || (tm === mo && td < d) ? 1 : 0)
}

export function passportInputs(ids: (number | null | undefined)[], countries: Country[]): PassportInput[] {
  return ids
    .filter((id): id is number => typeof id === 'number')
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => countries.find((c) => c.id === id))
    .filter((c): c is Country => Boolean(c))
    .map((c) => ({ name: c.common_name || c.name, flag: c.flag_emoji, isEu: isEuCountryCode(c.code) }))
}

export function permitInputs(permits: WorkPermitWithStatus[], countries: Country[]): PermitInput[] {
  return permits.map((p) => {
    const c = countries.find((x) => x.id === p.country_id)
    return { countryName: c ? c.common_name || c.name : 'Unknown country', flag: c?.flag_emoji ?? null, type: p.type, validFrom: p.valid_from, expiresOn: p.expires_on }
  })
}

const EMPTY_PROFILE = { id: '', role: 'player' } as unknown as PlayerProfileShape

export function useProfileKeyFacts(opts: {
  profile: PlayerProfileShape | null
  /** 'owner' on the own profile; 'recruiter' for clubs / recruiting coaches and "View as club". */
  viewer: KeyFactsViewer
  videoCounts: VideoCounts | null
  enabled?: boolean
}): ProfileKeyFactsResult {
  const { viewer, videoCounts } = opts
  const profile = opts.profile ?? EMPTY_PROFILE
  const enabled = (opts.enabled ?? true) && opts.profile !== null
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const { countries } = useCountries()
  const isCoach = profile.role === 'coach'
  const readsPermits = enabled && !isCoach && viewer !== 'public'
  const { permits } = useWorkPermits(opts.profile ? profile.id : null, { enabled: readsPermits })
  const { league } = usePlayerLeague({
    playerId: enabled && !isCoach ? profile.id : null,
    worldClubId: profile.current_world_club_id ?? null,
    playingCategory: profile.playing_category ?? null,
    signedIn,
  })

  const age = viewer === 'owner' ? ageFromDob(profile.date_of_birth) ?? profile.server_age ?? null : profile.server_age ?? ageFromDob(profile.date_of_birth)

  const facts = useMemo<KeyFact[]>(() => {
    if (!enabled) return []
    const passports = passportInputs([profile.nationality_country_id, profile.nationality2_country_id], countries)
    if (isCoach) {
      return buildCoachKeyFacts({
        specialization: profile.coach_specialization ?? null,
        specializationCustom: profile.coach_specialization_custom ?? null,
        categories: profile.coaching_categories ?? null,
        currentRole: null,
        currentClubName: profile.current_club ?? null,
        openToCoach: profile.open_to_coach ?? null,
        availableFrom: profile.available_from ?? null,
        availabilityDuration: profile.availability_duration ?? null,
        passports,
        age,
      }, { viewer })
    }
    return buildPlayerKeyFacts({
      position: profile.position ? humanizeToken(profile.position) ?? profile.position : null,
      secondaryPosition: profile.secondary_position ? humanizeToken(profile.secondary_position) ?? profile.secondary_position : null,
      currentClubName: profile.current_club ?? null,
      league,
      availableFrom: profile.available_from ?? null,
      availabilityDuration: profile.availability_duration ?? null,
      passports,
      permits: readsPermits ? permitInputs(permits, countries) : undefined,
      // Until the long scroll has counted them, the denormalised counts.
      fullMatchCount: videoCounts?.fullMatches ?? profile.full_game_video_count ?? 0,
      highlightCount: videoCounts?.highlights ?? (profile.highlight_video_url ? 1 : 0),
      age,
    }, { viewer })
  }, [enabled, profile, countries, isCoach, league, permits, readsPermits, videoCounts, viewer, age])

  const attentionPermits = viewer === 'owner' ? permits.filter((p) => p.status === 'expiring_soon' || p.status === 'expired') : []
  return { facts, viewer, attentionPermits, permits, pronoun: pronounFor(profile.gender, profile.playing_category) }
}
