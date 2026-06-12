/**
 * RecruiterCandidateCard — the Community member card shown when a club/coach
 * has an active Recruiting Context. Centered, equal-height layout with the
 * Recruiter Match as the single focal (purple) zone.
 *
 * Fixed-height zones top-to-bottom so every card lines up regardless of how
 * much data a member has (placeholders never collapse a zone):
 *   avatar (+ online dot) · name · position · nationality · club
 *   MATCH   verdict chip · match bar · "NN% match for your search"
 *   TRUST   [Incomplete] · evidence dot + word
 *   ACTION  Save · Chat · Add friend/Friends   (pinned to the bottom)
 *
 * UI ONLY — the verdict/evidence/score data is computed upstream and passed
 * through unchanged. Purple is reserved for the match zone (chip, bar fill,
 * %) and the connected Friends state; nowhere else.
 */
import { Check, Minus, AlertCircle } from 'lucide-react'
import { DualNationalityDisplay, RoleBadge } from '@/components'
import { getImageUrl } from '@/lib/imageUrl'
import RecruiterCardActions from './RecruiterCardActions'
import { computeEvidence } from '@/lib/evidence'
import type { RecruiterVerdict } from '@/lib/recruiterVerdict'

/** Fields the card reads — a structural subset of the Community member row,
 *  so PeopleListView can pass `member` straight through. */
export interface RecruiterCardMember {
  id: string
  avatar_url: string | null
  full_name: string
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  position?: string | null
  nationality: string | null
  nationality_country_id?: number | null
  nationality2_country_id?: number | null
  current_club: string | null
  current_world_club_id?: string | null
  last_active_at?: string | null
  is_verified?: boolean | null
  verified_at?: string | null
  profile_completeness_pct?: number | null
  highlight_video_url?: string | null
  full_game_video_count?: number | null
  accepted_reference_count?: number | null
}

interface RecruiterCandidateCardProps {
  member: RecruiterCardMember
  /** The full explanation-led verdict (tier + strength), precomputed by the
   *  list — the SAME synthesis the full profile leads with, so the card's
   *  chip can never disagree with the profile. */
  verdict: RecruiterVerdict
  onPreview: () => void
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000
const COMPLETENESS_WARN_BELOW = 60

/** Spell out the position on its own line — never abbreviated, never omitted. */
const POSITION_LABEL: Record<string, string> = {
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  defence: 'Defender',
  midfield: 'Midfielder',
  midfielder: 'Midfielder',
  forward: 'Forward',
  striker: 'Forward',
}
function positionLine(role: string, position: string | null | undefined): string {
  if (role === 'coach') return 'Coach'
  if (role === 'umpire') return 'Umpire'
  const raw = position?.trim()
  if (!raw) return 'Player'
  return POSITION_LABEL[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1)
}

/** Soft, deterministic, non-purple initials tint (purple is reserved for the
 *  match zone). */
const AVATAR_TINTS = [
  'bg-sky-50 text-sky-600',
  'bg-rose-50 text-rose-500',
  'bg-teal-50 text-teal-600',
  'bg-amber-50 text-amber-600',
  'bg-emerald-50 text-emerald-600',
  'bg-blue-50 text-blue-500',
]
function tintFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

/** Three visual verdict states (the four internal tiers map onto them). The
 *  chip derives from verdict.tier so the card always agrees with the profile;
 *  the bar + % derive from verdict.strength so all three agree with each
 *  other. longshot/pass (incl. the grey-fit cap → "wrong fit for this scope")
 *  read as Out of scope. */
type ChipState = 'pursue' | 'consider' | 'out'
const CHIP: Record<ChipState, { label: string; chipClass: string; icon: typeof Check; barClass: string; pctClass: string }> = {
  pursue:   { label: 'Pursue',       icon: Check, chipClass: 'bg-[#EEEDFE] text-[#3C3489]', barClass: 'bg-[#7F77DD]', pctClass: 'text-[#7F77DD]' },
  consider: { label: 'Consider',     icon: Check, chipClass: 'bg-[#F4F2FE] text-[#5B51B0]', barClass: 'bg-[#7F77DD]', pctClass: 'text-[#7F77DD]' },
  out:      { label: 'Out of scope', icon: Minus, chipClass: 'bg-gray-100 text-gray-500',   barClass: 'bg-[#B4B2A9]', pctClass: 'text-gray-500' },
}

/** Evidence dot colour + label per spec. Strong has a long form unless a
 *  completeness warning shares the row (then it shortens to "Strong"). */
function evidenceDisplay(level: 'strong' | 'moderate' | 'limited', isApplicable: boolean, hasWarning: boolean) {
  if (!isApplicable) return { dot: '#B4B2A9', label: 'Missing' }
  switch (level) {
    case 'strong':   return { dot: '#1D9E75', label: hasWarning ? 'Strong' : 'Strong evidence' }
    case 'moderate': return { dot: '#639922', label: 'Enough' }
    case 'limited':  return { dot: '#BA7517', label: 'Limited' }
  }
}

export default function RecruiterCandidateCard({ member, verdict, onPreview }: RecruiterCandidateCardProps) {
  const name = member.full_name?.trim() || 'Unknown'
  const initials = name.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?'
  const heroImageUrl = member.avatar_url ? getImageUrl(member.avatar_url, 'avatar-md') : null

  const isOnline = member.last_active_at
    ? Date.now() - new Date(member.last_active_at).getTime() < ONLINE_WINDOW_MS
    : false

  const chipState: ChipState = verdict.tier === 'pursue' ? 'pursue' : verdict.tier === 'consider' ? 'consider' : 'out'
  const chip = CHIP[chipState]
  const ChipIcon = chip.icon
  const pct = Math.round((verdict.strength ?? 0) * 100)
  const matchSuffix =
    chipState === 'out' && verdict.caveats[0] ? `· ${verdict.caveats[0]}` : 'for your search'

  const completeness = member.profile_completeness_pct ?? 0
  const showIncomplete = completeness > 0 && completeness < COMPLETENESS_WARN_BELOW

  const evidence = computeEvidence({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
  })
  const ev = evidenceDisplay(evidence.level, evidence.isApplicable, showIncomplete)

  const hasNationality = Boolean(member.nationality_country_id || member.nationality)

  return (
    <div className="relative flex h-full flex-col rounded-xl border border-gray-200 bg-white">
      {/* Role pill — top-left tag (role-coloured, never purple). pointer-events-
          none so a tap on the corner still opens the preview. */}
      <div className="pointer-events-none absolute left-2 top-2 z-10">
        <RoleBadge role={member.role} className="px-1.5 py-0.5 text-[10px]" />
      </div>
      <button
        type="button"
        onClick={onPreview}
        className="flex flex-1 flex-col items-center px-2.5 pt-3 pb-2 text-center transition-transform duration-100 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8026FA] rounded-t-xl"
        aria-label={`${name} — ${chip.label} (${pct}% match). Tap to preview.`}
      >
        {/* ── Avatar + online dot ── */}
        <div className="relative h-[52px] w-[52px] flex-shrink-0">
          <div className="h-full w-full overflow-hidden rounded-full bg-gray-100">
            {heroImageUrl ? (
              <img src={heroImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className={`flex h-full w-full items-center justify-center text-[15px] font-semibold ${tintFor(name)}`}>
                {initials}
              </div>
            )}
          </div>
          <span
            className={`absolute bottom-0 right-0 h-[11px] w-[11px] rounded-full ring-2 ring-white ${isOnline ? 'bg-[#1D9E75]' : 'bg-[#B4B2A9]'}`}
            aria-hidden="true"
          />
          <span className="sr-only">{isOnline ? 'Online' : 'Offline'}</span>
        </div>

        {/* ── Name ── */}
        <h3 className="mt-2 flex h-[18px] w-full items-center justify-center">
          <span className="truncate text-[13.5px] font-semibold leading-tight text-gray-900" title={name}>{name}</span>
        </h3>

        {/* ── Position (always present) ── */}
        <p className="flex h-[16px] items-center text-[11.5px] font-medium text-gray-700">
          {positionLine(member.role, member.position)}
        </p>

        {/* ── Nationality (centered; EU tag never truncates) ── */}
        <div className="mt-0.5 flex h-[17px] w-full items-center justify-center overflow-hidden">
          {hasNationality ? (
            <DualNationalityDisplay
              primaryCountryId={member.nationality_country_id}
              secondaryCountryId={member.nationality2_country_id}
              fallbackText={member.nationality}
              mode="code"
            />
          ) : (
            <span className="text-[11px] text-gray-300">Nationality not listed</span>
          )}
        </div>

        {/* ── Club ── */}
        <div className="mt-0.5 flex h-[16px] w-full items-center justify-center">
          <span className={`truncate text-[11px] ${member.current_club ? 'text-gray-400' : 'text-gray-300'}`} title={member.current_club ?? undefined}>
            {member.current_club || 'Club not listed'}
          </span>
        </div>

        {/* ── MATCH (the only purple zone) ── */}
        <div className="mt-2.5 flex w-full flex-col items-center">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${chip.chipClass}`}>
            <ChipIcon className="h-3 w-3" aria-hidden="true" />
            {chip.label}
          </span>
          <div className="mt-2 h-[3px] w-[84%] overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            <div className={`h-full rounded-full ${chip.barClass} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 flex h-[15px] w-full items-center justify-center gap-1 px-1 text-[11px] leading-none">
            <span className={`font-medium ${chip.pctClass}`}>{pct}%</span>
            <span className="truncate text-gray-500">match {matchSuffix}</span>
          </p>
        </div>

        {/* ── TRUST (completeness warning only when low · evidence always) ── */}
        <div className="mt-2 flex h-[16px] w-full items-center justify-center gap-2.5 text-[11px]">
          {showIncomplete && (
            <span className="inline-flex items-center gap-1 text-[#854F0B]">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Incomplete
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-gray-600">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: ev.dot }} aria-hidden="true" />
            {ev.label}
          </span>
        </div>
      </button>

      {/* ── ACTION (pinned to the bottom; single hairline above) ── */}
      <div className="mt-auto">
        <RecruiterCardActions playerId={member.id} playerName={name} />
      </div>
    </div>
  )
}
