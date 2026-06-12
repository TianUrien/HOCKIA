/**
 * RecruiterCandidateCard — the premium "recruiting evaluation card" shown
 * in Community when a club/coach has an active player-scope.
 *
 * Deliberately MINIMAL — a two-second scan, not the full profile. One
 * stripped-back stack:
 *
 *   WHO      avatar (+ open dot) · NEW · name · role
 *   IDENTITY compact nationality (flag + ISO3 + EU) · club (own line)
 *   VERDICT  RECRUITER VERDICT — tier headline + lead reason (the SAME
 *            computeRecruiterVerdict the full profile leads with, so the grid
 *            never says "Strong match" while the profile says "Longshot")
 *   PROFILE  NN% complete · short status
 *   ACT      Save · Message · Add friend
 *
 * Everything else (league, open-to-play, full highlights/caveats, evidence
 * breakdown) lives on the Preview + full profile. The verdict arrives
 * precomputed from the list (pure, no extra fetch).
 */
import { Shield, ShieldCheck, FileText, CheckCircle2, Eye, CircleDashed, MinusCircle, Check, AlertTriangle } from 'lucide-react'
import { RoleBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import { getImageUrl } from '@/lib/imageUrl'
import RolePlaceholder from '@/components/RolePlaceholder'
import RecruiterCardActions from './RecruiterCardActions'
import { computeEvidence, evidenceLevelLabel } from '@/lib/evidence'
import type { RecruiterVerdict, VerdictTier } from '@/lib/recruiterVerdict'

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
  /** Coaches signal availability via open_to_coach (no open_to_play surface);
   *  either flag — or the generic open_to_opportunities — lights the dot. */
  open_to_coach?: boolean | null
  open_to_opportunities?: boolean | null
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
  /** The full explanation-led verdict (tier + highlights/caveats), precomputed
   *  by the list — the SAME synthesis the full profile leads with. */
  verdict: RecruiterVerdict
  onPreview: () => void
}

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/** Compact verdict styling — mirrors RecruiterVerdictCard (the profile lead)
 *  so the two surfaces read identically. Verb-led tiers, never a "%". */
const VERDICT_STYLE: Record<VerdictTier, { icon: typeof CheckCircle2; iconClass: string; headlineClass: string; barClass: string }> = {
  pursue: { icon: CheckCircle2, iconClass: 'text-[#8026FA]', headlineClass: 'text-[#5b16b8]', barClass: 'bg-[#8026FA]' },
  consider: { icon: Eye, iconClass: 'text-gray-700', headlineClass: 'text-gray-900', barClass: 'bg-[#8026FA]/55' },
  longshot: { icon: CircleDashed, iconClass: 'text-gray-400', headlineClass: 'text-gray-600', barClass: 'bg-gray-400' },
  pass: { icon: MinusCircle, iconClass: 'text-gray-400', headlineClass: 'text-gray-500', barClass: 'bg-gray-300' },
}

/** One short, recruiter-facing word on profile depth — no long sentence. */
function profileStatus(pct: number): string {
  if (pct >= 80) return 'Strong profile'
  if (pct >= 50) return 'Good profile'
  return 'Needs more info'
}

export default function RecruiterCandidateCard({ member, verdict, onPreview }: RecruiterCandidateCardProps) {
  const vStyle = VERDICT_STYLE[verdict.tier]
  const VerdictIcon = vStyle.icon
  const leadHighlight = verdict.highlights[0] ?? null
  const leadCaveat = verdict.caveats[0] ?? null
  const completeness = member.profile_completeness_pct ?? 0
  // Availability dot — role-aware: players use open_to_play, coaches
  // open_to_coach; open_to_opportunities lights it for either.
  const isOpen = Boolean(member.open_to_play || member.open_to_coach || member.open_to_opportunities)

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
        className="group block w-full flex-1 text-left transition-transform duration-100 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA]"
        aria-label={`${member.full_name?.trim()} — ${verdict.headline} (recruiter verdict). Tap to preview.`}
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

          {/* Name row — h-5 reserved + min-w-0 so a long name truncates to a
              single line (instead of pushing the badge or reflowing the row
              height), keeping every card's name band identical. */}
          <div className="mt-2.5 flex h-5 items-center gap-1">
            <h3 className="min-w-0 truncate text-[15px] font-semibold leading-tight text-gray-900" title={member.full_name?.trim()}>
              {member.full_name?.trim()}
            </h3>
            <span className="flex-shrink-0">
              <VerifiedBadge verified={member.is_verified ?? false} verifiedAt={member.verified_at ?? null} size="sm" />
            </span>
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

        {/* ── VERDICT ── the explanation-led lead (same synthesis the full
            profile shows). Tier headline + one reason; the full
            highlights/caveats live in the Preview. Reason rows are reserved
            (h-4, truncate) so every card stays the same height + aligned. ── */}
        <div className="border-t border-gray-100 px-3.5 py-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Recruiter verdict
            </span>
            <span className="text-[9px] font-medium uppercase tracking-wide text-gray-300">
              {verdict.scoped ? 'for your scope' : 'general fit'}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <VerdictIcon className={`h-4 w-4 flex-shrink-0 ${vStyle.iconClass}`} aria-hidden="true" />
            <span className={`truncate text-[14px] font-bold ${vStyle.headlineClass}`}>{verdict.headline}</span>
          </div>
          {/* Verdict-strength bar — fill driven by verdict.strength, colour by
              tier. It's the SAME synthesis the headline reads, normalized, so
              the bar can never disagree with the tier word (and a grey-fit cap
              caps the fill). A qualitative strength, never labelled a "%". */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${vStyle.barClass} transition-[width] duration-300`}
              style={{ width: `${Math.round(verdict.strength * 100)}%` }}
              aria-hidden="true"
            />
          </div>
          {/* Lead highlight (✓) + lead caveat (⚠) — each a reserved single line
              so the section height is constant whether or not reasons exist. */}
          <div className="mt-1.5 flex h-4 items-center gap-1.5 text-[11px] leading-none">
            {leadHighlight ? (
              <>
                <Check className="h-3 w-3 flex-shrink-0 text-[#8026FA]" aria-hidden="true" />
                <span className="truncate text-gray-700">{leadHighlight}</span>
              </>
            ) : (
              <span className="text-gray-300">&nbsp;</span>
            )}
          </div>
          <div className="mt-1 flex h-4 items-center gap-1.5 text-[11px] leading-none">
            {leadCaveat ? (
              <>
                <AlertTriangle className="h-3 w-3 flex-shrink-0 text-amber-500" aria-hidden="true" />
                <span className="truncate text-gray-500">{leadCaveat}</span>
              </>
            ) : (
              <span className="text-gray-300">&nbsp;</span>
            )}
          </div>
        </div>

        {/* ── PROFILE ── always rendered so the row never collapses and
            knocks the cards out of alignment. Deliberately understated —
            smaller icon + lighter type so it SUPPORTS the match section
            rather than competing with it. The two text lines are
            single-line (truncate) so a longer label like "Needs more info"
            can't wrap to a second line at narrow widths and make this card
            taller than its neighbours (the 320px misalignment). ── */}
        <div className="flex items-center gap-2 border-t border-gray-100 px-3.5 py-2.5">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[#8026FA]/10 text-[#8026FA]">
            <FileText className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-tight text-[#8026FA] tabular-nums">{completeness}% complete</div>
            <div className="truncate text-[10px] leading-tight text-gray-500">{profileStatus(completeness)}</div>
          </div>
        </div>

        {/* ── EVIDENCE — compact level signal only; tap the card to open
            Preview for the full present/missing breakdown. Single-line so
            "Limited/Missing evidence" can't wrap at narrow widths. ── */}
        <div className="flex items-center gap-1.5 border-t border-gray-100 px-3.5 py-2.5 text-[11px] font-medium">
          <ShieldCheck className={`h-3.5 w-3.5 flex-shrink-0 ${evidenceColor}`} aria-hidden="true" />
          <span className={`truncate ${evidenceColor}`}>{evidenceLabel}</span>
        </div>
      </button>

      {/* ── ACT (sibling of the clickable area — no nested buttons) ── */}
      <RecruiterCardActions playerId={member.id} playerName={member.full_name} />
    </div>
  )
}
