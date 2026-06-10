/**
 * RecruiterCandidateCard — the premium "recruiting evaluation card" shown
 * in Community when a club/coach has an active player-scope (the "ranked by
 * recruiter match" view). Distinct from the compact, social MemberTile:
 * calm, spacious, one clear section per question a recruiter asks —
 *
 *   WHO    avatar · name · role · nationality · club
 *   MATCH  RECRUITER MATCH — label + % + slider (0%→100%)
 *   PROFILE  completeness % + recruiter-facing read
 *   FACTS  league · open-to-play · interest · evidence (expandable)
 *   ACT    Save · Message · Add friend · ⋯
 *
 * Rendered only in scoped recruiter mode (PeopleListView) — MemberTile is
 * untouched for every other surface. Score + state arrive precomputed from
 * the list (same numbers it ranks on); this component never re-scores.
 */
import { Trophy, CheckCircle2, FileText, Sparkles } from 'lucide-react'
import { RoleBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import { getImageUrl } from '@/lib/imageUrl'
import RolePlaceholder from '@/components/RolePlaceholder'
import EvidenceSignal from './EvidenceSignal'
import InterestSignal from './InterestSignal'
import RecruiterCardActions from './RecruiterCardActions'
import { useEvidence } from '@/hooks/useEvidence'
import { useInterest } from '@/hooks/useInterest'
import { getClubLevelBand, getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import { categoryToBandTarget } from '@/hooks/useInterest'
import { evidenceChecklist } from '@/lib/evidence'
import type { ClubFitState } from '@/lib/clubFit'

/** Fields the card reads — a structural subset of the Community member row,
 *  so PeopleListView can pass `member` straight through. */
export interface RecruiterCardMember {
  id: string
  avatar_url: string | null
  full_name: string
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  nationality: string | null
  nationality_country_id?: number | null
  nationality2_country_id?: number | null
  current_club: string | null
  current_world_club_id?: string | null
  playing_category?: string | null
  position?: string | null
  open_to_play?: boolean | null
  open_to_coach?: boolean | null
  open_to_opportunities?: boolean | null
  is_verified?: boolean | null
  verified_at?: string | null
  last_active_at?: string | null
  profile_completeness_pct?: number | null
  created_at?: string | null
  highlight_video_url?: string | null
  full_game_video_count?: number | null
  accepted_reference_count?: number | null
  career_entry_count?: number | null
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  available_from?: string | null
  base_country_id?: number | null
  level_target?: string | null
  opportunity_preference?: string | null
}

interface RecruiterCandidateCardProps {
  member: RecruiterCardMember
  /** Real Club Fit score (0..1) + state, precomputed by the list. */
  matchScore: number
  matchState: ClubFitState
  onPreview: () => void
}

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/** Match tier for display — adds an "Excellent" band above Strong, and a
 *  blue "Good" band, matching the reference. Purely presentational; the
 *  ranking thresholds in clubFit.ts are unchanged. */
function matchTier(score: number): { label: string; text: string; fill: string; thumb: string } {
  const pct = score * 100
  if (pct >= 80) return { label: 'Excellent match', text: 'text-[#6d28d9]', fill: 'bg-gradient-to-r from-[#8026FA] to-[#6d28d9]', thumb: 'bg-[#6d28d9]' }
  if (pct >= 66) return { label: 'Strong match', text: 'text-[#8026FA]', fill: 'bg-gradient-to-r from-[#8026FA] to-[#924CEC]', thumb: 'bg-[#8026FA]' }
  if (pct >= 40) return { label: 'Good match', text: 'text-blue-600', fill: 'bg-gradient-to-r from-blue-500 to-blue-600', thumb: 'bg-blue-600' }
  return { label: 'Limited match', text: 'text-gray-500', fill: 'bg-gray-400', thumb: 'bg-gray-400' }
}

/** Recruiter-facing completeness read — describes the profile for the
 *  recruiter's decision, never the player ("improve your visibility"). */
function profileBand(pct: number): { label: string; sub: string } {
  if (pct >= 80) return { label: 'Very complete', sub: 'Strong profile.' }
  if (pct >= 65) return { label: 'Good information', sub: 'Profile looks solid.' }
  if (pct >= 45) return { label: 'Some key info missing', sub: 'May want more details.' }
  return { label: 'Limited information', sub: 'Hard to assess yet.' }
}

export default function RecruiterCandidateCard({ member, matchScore, matchState, onPreview }: RecruiterCandidateCardProps) {
  void matchState // state is implied by the score-based tier; kept for parity with the list

  const evidence = useEvidence({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
  })
  const interest = useInterest({
    role: member.role,
    relocation_willingness: member.relocation_willingness ?? null,
    relocation_countries_open: member.relocation_countries_open ?? null,
    relocation_countries_excluded: member.relocation_countries_excluded ?? null,
    available_from: member.available_from ?? null,
    home_country_id: member.base_country_id ?? member.nationality_country_id ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
    playing_category: member.playing_category ?? null,
    level_target: member.level_target ?? null,
    opportunity_preference: member.opportunity_preference ?? null,
  })

  const tier = matchTier(matchScore)
  const pct = Math.round(Math.max(0, Math.min(1, matchScore)) * 100)
  const completeness = member.profile_completeness_pct ?? 0
  const band = completeness > 0 ? profileBand(completeness) : null

  const leagueName = getPlayerLeagueName(member.current_world_club_id ?? null, member.playing_category ?? null)
  const levelBand =
    getClubLevelBand(member.current_world_club_id ?? null, categoryToBandTarget(member.playing_category ?? null))

  const isNew = (() => {
    if (!member.created_at) return false
    const t = new Date(member.created_at).getTime()
    return Number.isFinite(t) && Date.now() - t < NEW_WINDOW_MS
  })()

  const heroImageUrl = member.avatar_url ? getImageUrl(member.avatar_url, 'avatar-md') : null
  const isOpen = Boolean(member.open_to_play)

  const evidenceRows = evidenceChecklist({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
    current_club: member.current_club ?? null,
    career_entry_count: member.career_entry_count ?? null,
    open_to_play: member.open_to_play ?? null,
    open_to_coach: member.open_to_coach ?? null,
    competition_level_band: levelBand,
  })

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onPreview}
        className="group block w-full flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA]"
        aria-label={`${member.full_name?.trim()} — ${tier.label}, ${pct}% recruiter match. Tap to open profile.`}
      >
        {/* ── WHO ── */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="relative h-16 w-16 flex-shrink-0">
              <div className="absolute inset-0 overflow-hidden rounded-full bg-gray-100">
                {heroImageUrl ? (
                  <img
                    src={heroImageUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="absolute inset-0"><RolePlaceholder role={member.role} label="" /></div>
                )}
              </div>
              {isOpen && (
                <span
                  className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white"
                  aria-label="Open to opportunities"
                  title="Open to opportunities"
                />
              )}
            </div>
            {isNew && (
              <span className="inline-flex items-center rounded-full bg-[#8026FA]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8026FA]">
                New
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-1">
            <h3 className="truncate text-base font-semibold leading-tight text-gray-900" title={member.full_name?.trim()}>
              {member.full_name?.trim()}
            </h3>
            <VerifiedBadge verified={member.is_verified ?? false} verifiedAt={member.verified_at ?? null} size="sm" />
          </div>

          <div className="mt-1.5">
            <RoleBadge role={member.role} />
          </div>

          {(member.nationality_country_id || member.nationality || member.current_club) && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
              <DualNationalityDisplay
                primaryCountryId={member.nationality_country_id}
                secondaryCountryId={member.nationality2_country_id}
                fallbackText={member.nationality}
                mode="tile"
                className="text-gray-600"
              />
              {member.current_club && (
                <span className="truncate text-gray-500">· {member.current_club}</span>
              )}
            </div>
          )}
        </div>

        {/* ── MATCH ── */}
        <div className="border-t border-gray-100 px-4 py-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-wide text-gray-400"
            title="How well this player fits your active recruiting scope — league level, position, category and availability."
          >
            Recruiter match
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className={`inline-flex items-center gap-1 text-sm font-semibold ${tier.text}`}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {tier.label}
            </span>
            <span className={`text-sm font-bold tabular-nums ${tier.text}`}>{pct}%</span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-gray-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Recruiter match ${pct}%`}>
            <div className={`h-2 rounded-full ${tier.fill}`} style={{ width: `${pct}%` }} />
            <span
              className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${tier.thumb}`}
              style={{ left: `clamp(7px, ${pct}%, calc(100% - 7px))` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-medium text-gray-400">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        {/* ── PROFILE ── */}
        {band && (
          <div className="border-t border-gray-100 px-4 py-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-wide text-gray-400"
              title="How much of this player's profile is filled in. More detail means a more reliable evaluation."
            >
              Profile
            </div>
            <div className="mt-1 flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#8026FA]/10 text-[#8026FA]">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm leading-tight text-gray-800">
                  <span className="font-semibold text-[#8026FA] tabular-nums">{completeness}% complete</span>
                  <span className="text-gray-500"> · {band.label}</span>
                </div>
                <div className="text-xs leading-tight text-gray-500">{band.sub}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── FACTS ── */}
        <div className="space-y-1.5 border-t border-gray-100 px-4 py-3">
          {leagueName && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Trophy className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <span className="truncate">{leagueName}</span>
            </div>
          )}
          {isOpen && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
              <span>Open to play</span>
            </div>
          )}
          <InterestSignal result={interest} variant="compact" />
          <EvidenceSignal result={evidence} checklist={evidenceRows} />
        </div>
      </button>

      {/* ── ACT (sibling of the clickable area — no nested buttons) ── */}
      <RecruiterCardActions playerId={member.id} playerName={member.full_name} />
    </div>
  )
}
