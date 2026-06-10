/**
 * RecruiterCandidateCard — the premium "recruiting evaluation card" shown
 * in Community when a club/coach has an active player-scope.
 *
 * Deliberately MINIMAL — a two-second scan, not the full profile. One
 * stripped-back stack:
 *
 *   WHO      avatar (+ open dot) · NEW · name · role
 *   IDENTITY compact nationality (flag + ISO3 + EU) · club (own line)
 *   MATCH    RECRUITER MATCH — label + % + slider
 *   PROFILE  NN% complete · short status
 *   ACT      Save · Message · Add friend
 *
 * Everything else (league, open-to-play, interest, evidence) lives on the
 * full profile — surfaced when the recruiter opens it, kept off the scan
 * card so it stays calm. Score + state arrive precomputed from the list.
 */
import { Shield, ShieldCheck, FileText, Sparkles } from 'lucide-react'
import { RoleBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import { getImageUrl } from '@/lib/imageUrl'
import RolePlaceholder from '@/components/RolePlaceholder'
import RecruiterCardActions from './RecruiterCardActions'
import { computeEvidence, evidenceLevelLabel } from '@/lib/evidence'
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
  open_to_play?: boolean | null
  is_verified?: boolean | null
  verified_at?: string | null
  profile_completeness_pct?: number | null
  created_at?: string | null
  /** Evidence-level signal (compact). The full breakdown lives in Preview. */
  highlight_video_url?: string | null
  full_game_video_count?: number | null
  accepted_reference_count?: number | null
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

/** One short, recruiter-facing word on profile depth — no long sentence. */
function profileStatus(pct: number): string {
  if (pct >= 80) return 'Strong profile'
  if (pct >= 50) return 'Good profile'
  return 'Needs more info'
}

export default function RecruiterCandidateCard({ member, matchScore, matchState, onPreview }: RecruiterCandidateCardProps) {
  void matchState // tier is derived from the score; kept for parity with the list

  const tier = matchTier(matchScore)
  const pct = Math.round(Math.max(0, Math.min(1, matchScore)) * 100)
  const completeness = member.profile_completeness_pct ?? 0

  const isNew = (() => {
    if (!member.created_at) return false
    const t = new Date(member.created_at).getTime()
    return Number.isFinite(t) && Date.now() - t < NEW_WINDOW_MS
  })()

  const heroImageUrl = member.avatar_url ? getImageUrl(member.avatar_url, 'avatar-md') : null

  // Evidence LEVEL only — a quick signal. The full present/missing
  // breakdown lives in the Preview (card = signal, preview = detail).
  // Computed directly (the card is already recruiter-only by placement),
  // and a candidate with zero signals reads "Missing evidence".
  const evidence = computeEvidence({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
  })
  const evidenceLabel = evidence.isApplicable ? evidenceLevelLabel(evidence.level) : 'Missing evidence'
  const evidenceColor = !evidence.isApplicable
    ? 'text-gray-400'
    : evidence.level === 'strong'
      ? 'text-emerald-600'
      : evidence.level === 'moderate'
        ? 'text-gray-700'
        : 'text-gray-500'

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onPreview}
        className="group block w-full flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA]"
        aria-label={`${member.full_name?.trim()} — ${tier.label}, ${pct}% recruiter match. Tap to open profile.`}
      >
        {/* ── WHO + IDENTITY ── */}
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="relative h-14 w-14 flex-shrink-0">
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
              {member.open_to_play && (
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

          <div className="mt-2.5 flex items-center gap-1">
            <h3 className="truncate text-[15px] font-semibold leading-tight text-gray-900" title={member.full_name?.trim()}>
              {member.full_name?.trim()}
            </h3>
            <VerifiedBadge verified={member.is_verified ?? false} verifiedAt={member.verified_at ?? null} size="sm" />
          </div>

          <div className="mt-1.5">
            <RoleBadge role={member.role} />
          </div>

          {/* Identity — nationality then club, each ALWAYS exactly one
              reserved line (placeholder when absent, truncate when long) so
              a card with less data lines up with a richer neighbour. */}
          <div className="mt-2.5 flex h-[18px] items-center overflow-hidden">
            {member.nationality_country_id || member.nationality ? (
              <DualNationalityDisplay
                primaryCountryId={member.nationality_country_id}
                secondaryCountryId={member.nationality2_country_id}
                fallbackText={member.nationality}
                mode="code"
              />
            ) : (
              <span className="text-xs text-gray-300">Nationality not listed</span>
            )}
          </div>
          <div className="mt-1 flex h-[18px] items-center gap-1.5 text-xs">
            <Shield className="h-3 w-3 flex-shrink-0 text-gray-400" />
            <span className={`truncate ${member.current_club ? 'text-gray-500' : 'text-gray-300'}`}>
              {member.current_club || 'Club not listed'}
            </span>
          </div>
        </div>

        {/* ── MATCH ── */}
        <div className="border-t border-gray-100 px-3.5 py-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-wide text-gray-400"
            title="How well this player fits your active recruiting scope — league level, position, category and availability."
          >
            Recruiter match
          </div>
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className={`inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[13px] font-semibold ${tier.text}`}>
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{tier.label}</span>
            </span>
            <span className={`flex-shrink-0 text-[13px] font-bold tabular-nums ${tier.text}`}>{pct}%</span>
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

        {/* ── PROFILE ── always rendered so the row never collapses and
            knocks the cards out of alignment. ── */}
        <div className="flex items-center gap-2 border-t border-gray-100 px-3.5 py-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#8026FA]/10 text-[#8026FA]">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-[#8026FA] tabular-nums">{completeness}% complete</div>
            <div className="text-[11px] leading-tight text-gray-500">{profileStatus(completeness)}</div>
          </div>
        </div>

        {/* ── EVIDENCE — compact level signal only; tap the card to open
            Preview for the full present/missing breakdown. ── */}
        <div className="flex items-center gap-1.5 border-t border-gray-100 px-3.5 py-2.5 text-[11px] font-medium">
          <ShieldCheck className={`h-3.5 w-3.5 flex-shrink-0 ${evidenceColor}`} aria-hidden="true" />
          <span className={evidenceColor}>{evidenceLabel}</span>
        </div>
      </button>

      {/* ── ACT (sibling of the clickable area — no nested buttons) ── */}
      <RecruiterCardActions playerId={member.id} playerName={member.full_name} />
    </div>
  )
}
