/**
 * RecruiterCandidateCard — the ONE unified Community member card. Identical
 * zones for every role (Player / Coach / Club / Brand / Umpire) so a grid of
 * mixed roles lines up perfectly, with two middle-zone modes:
 *
 *   NEUTRAL  (no active recruiting scope) → availability chip + substance line
 *   CONTEXT  (a club/coach has an active scope) → verdict chip + bar + "% match"
 *
 * Fixed-height zones top-to-bottom so every card is equal-height regardless of
 * how much data a member has (placeholders never collapse a zone):
 *   role pill · avatar (+online dot, persons only) · name · detail line ·
 *   nationality · location/club · MIDDLE (neutral|context) · TRUST · ACTION
 *
 * UI ONLY — the verdict/evidence/score data is computed upstream and passed
 * through unchanged. Purple is reserved for the match zone (chip, bar fill, %)
 * and the connected Friends state; nowhere else. The CONTEXT chip's four tiers
 * (Excellent/Good/Possible/Out of scope) derive from the verdict strength
 * bands so chip + bar + % can never disagree, with a hard `pass → Out of
 * scope` cap for wrong-fit candidates.
 */
import { Check, Minus, AlertCircle, ShieldCheck } from 'lucide-react'
import { DualNationalityDisplay, RoleBadge } from '@/components'
import { getImageUrl } from '@/lib/imageUrl'
import RecruiterCardActions from './RecruiterCardActions'
import { computeEvidence } from '@/lib/evidence'
import { getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import { recruiterDisplayTier, type RecruiterVerdict, type VerdictDisplayTier } from '@/lib/recruiterVerdict'
import { availabilityLabel } from '@/lib/availabilityLabel'

/** Fields the card reads — a structural subset of the Community member row, so
 *  PeopleListView can pass `member` straight through. Most are optional so a
 *  thin row still renders (the zone shows a muted placeholder). */
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
  base_location?: string | null
  playing_category?: string | null
  /** Pre-resolved current league/competition display name. When present it
   *  wins over the cache-derived league name — the carousel passes the RPC's
   *  server-joined name so it doesn't depend on the grid's prefetch cache. */
  competition_name?: string | null
  // Availability (drives the neutral chip per role)
  open_to_play?: boolean | null
  open_to_coach?: boolean | null
  open_to_opportunities?: boolean | null
  // Coach
  coach_specialization?: string | null
  coach_specialization_custom?: string | null
  // Umpire
  umpire_level?: string | null
  federation?: string | null
  umpire_appointment_count?: number | null
  available_for_appointments?: boolean | null
  // Brand (augmented onto the row from the brands table)
  brand_category?: string | null
  brand_logo_url?: string | null
  brand_follower_count?: number | null
  brand_ambassador_count?: number | null
  // Club
  year_founded?: number | null
  // Trust / evidence
  last_active_at?: string | null
  is_verified?: boolean | null
  verified_at?: string | null
  profile_completeness_pct?: number | null
  highlight_video_url?: string | null
  full_game_video_count?: number | null
  accepted_reference_count?: number | null
  career_entry_count?: number | null
}

interface RecruiterCandidateCardProps {
  member: RecruiterCardMember
  /** The full explanation-led verdict (tier + strength), precomputed by the
   *  list — the SAME synthesis the full profile leads with, so the card's chip
   *  can never disagree with the profile. Present → CONTEXT mode; absent (or
   *  null) → NEUTRAL mode (no active recruiting scope for this member). */
  verdict?: RecruiterVerdict | null
  onPreview: () => void
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000
const COMPLETENESS_WARN_BELOW = 60

const BRAND_CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  apparel: 'Apparel',
  accessories: 'Accessories',
  nutrition: 'Nutrition',
  technology: 'Technology',
  coaching: 'Coaching & Training',
  recruiting: 'Recruiting',
  media: 'Media',
  services: 'Services',
  other: 'Other',
}

/** Spell out the player position — never abbreviated, never omitted. */
const POSITION_LABEL: Record<string, string> = {
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  defence: 'Defender',
  midfield: 'Midfielder',
  midfielder: 'Midfielder',
  forward: 'Forward',
  striker: 'Forward',
}

function titleCase(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function coachSpecLabel(member: RecruiterCardMember): string | null {
  const custom = member.coach_specialization_custom?.trim()
  if (custom) return custom
  const raw = member.coach_specialization?.trim()
  if (!raw) return null
  const human = titleCase(raw)
  return /coach/i.test(human) ? human : `${human} Coach`
}

function umpireLevelLabel(member: RecruiterCardMember): string | null {
  const raw = member.umpire_level?.trim()
  if (!raw) return null
  const human = titleCase(raw)
  return /umpire|official/i.test(human) ? human : `${human} Umpire`
}

/** The role-defining noun under the name (line 4) — always present. */
function detailLine(member: RecruiterCardMember): string {
  switch (member.role) {
    case 'coach':
      return 'Coach'
    case 'umpire':
      return 'Umpire'
    case 'club':
      return 'Club'
    case 'brand':
      return member.brand_category ? BRAND_CATEGORY_LABELS[member.brand_category] ?? 'Brand' : 'Brand'
    default: {
      const raw = member.position?.trim()
      if (!raw) return 'Player'
      return POSITION_LABEL[raw.toLowerCase()] ?? titleCase(raw)
    }
  }
}

/** The "where" line (line 6) — club for persons, location for orgs. */
function locationLine(member: RecruiterCardMember): string | null {
  switch (member.role) {
    case 'player':
    case 'coach':
      return member.current_club?.trim() || null
    case 'umpire':
      return member.federation?.trim() || member.base_location?.trim() || null
    case 'club':
    case 'brand':
      return member.base_location?.trim() || null
    default:
      return null
  }
}

/** The neutral middle-zone substance line — the single most load-bearing fact,
 *  distinct from the location line above so the two never duplicate. */
function substanceLine(member: RecruiterCardMember): string | null {
  switch (member.role) {
    case 'player':
      return member.competition_name?.trim() || getPlayerLeagueName(member.current_world_club_id, member.playing_category)
    case 'coach':
      return coachSpecLabel(member)
    case 'umpire':
      return umpireLevelLabel(member)
    case 'club':
      return member.year_founded ? `Established ${member.year_founded}` : null
    case 'brand': {
      const parts: string[] = []
      if (member.brand_ambassador_count && member.brand_ambassador_count > 0)
        parts.push(`${member.brand_ambassador_count} ambassador${member.brand_ambassador_count === 1 ? '' : 's'}`)
      if (member.brand_follower_count && member.brand_follower_count > 0)
        parts.push(`${member.brand_follower_count} follower${member.brand_follower_count === 1 ? '' : 's'}`)
      return parts.length ? parts.join(' · ') : null
    }
    default:
      return null
  }
}

/** Role-appropriate availability chip for the neutral middle zone. ONLY a
 *  positive, role-specific signal (green) when the member has explicitly opted
 *  in; nothing otherwise — never a "not looking" state. Single source of truth:
 *  availabilityLabel. */
function availabilityChip(member: RecruiterCardMember): { label: string } | null {
  const label = availabilityLabel(member.role, member)
  return label ? { label } : null
}

/** Card-specific Proof checklist (NOT the full evidenceChecklist). Player = 5
 *  items, coach = 4 — matching the screenshots' "Proof 4/5" / "Proof 3/4".
 *  Only players and coaches have a proof shield; orgs/umpires fall back to a
 *  Verified badge in the trust row. */
function proofChecklist(member: RecruiterCardMember): { present: number; total: number } | null {
  if (member.role === 'player') {
    const items = [
      (member.full_game_video_count ?? 0) > 0, // footage
      Boolean(member.highlight_video_url), // highlight
      (member.accepted_reference_count ?? 0) > 0, // references
      Boolean(member.current_world_club_id || member.current_club), // club
      Boolean(member.is_verified), // verified
    ]
    return { present: items.filter(Boolean).length, total: items.length }
  }
  if (member.role === 'coach') {
    const items = [
      (member.accepted_reference_count ?? 0) > 0, // references
      Boolean(member.is_verified), // verified
      Boolean(member.current_world_club_id || member.current_club), // club
      (member.career_entry_count ?? 0) > 0, // career history
    ]
    return { present: items.filter(Boolean).length, total: items.length }
  }
  return null
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

/** CONTEXT chip styles, keyed on the shared display tier (recruiterDisplayTier)
 *  so the chip word ALWAYS matches the preview sheet + full profile for the
 *  same candidate. The bar + % render the independent strength value. */
const CHIP: Record<VerdictDisplayTier, { label: string; chipClass: string; icon: typeof Check; barClass: string; pctClass: string }> = {
  excellent: { label: 'Excellent',    icon: Check, chipClass: 'bg-[#EEEDFE] text-[#3C3489]', barClass: 'bg-[#7F77DD]', pctClass: 'text-[#7F77DD]' },
  good:      { label: 'Good',         icon: Check, chipClass: 'bg-[#F4F2FE] text-[#5B51B0]', barClass: 'bg-[#7F77DD]', pctClass: 'text-[#7F77DD]' },
  possible:  { label: 'Possible',     icon: Check, chipClass: 'bg-[#F7F6FD] text-[#6B62C0]', barClass: 'bg-[#A9A4E6]', pctClass: 'text-[#6B62C0]' },
  out:       { label: 'Out of scope', icon: Minus, chipClass: 'bg-gray-100 text-gray-500',   barClass: 'bg-[#B4B2A9]', pctClass: 'text-gray-500' },
}

/** Proof shield colour = the existing evidence tier. Strong/Enough → green
 *  family, Limited → amber, Missing → grey. */
function shieldColor(level: 'strong' | 'moderate' | 'limited', isApplicable: boolean): string {
  if (!isApplicable) return '#B4B2A9'
  switch (level) {
    case 'strong':
      return '#1D9E75'
    case 'moderate':
      return '#639922'
    case 'limited':
      return '#BA7517'
  }
}

export default function RecruiterCandidateCard({ member, verdict, onPreview }: RecruiterCandidateCardProps) {
  const name = member.full_name?.trim() || 'Unknown'
  const initials = name.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?'

  const isBrand = member.role === 'brand'
  const isOrg = member.role === 'club' || isBrand
  const isPerson = !isOrg // players/coaches/umpires get the online dot

  // Brand hero prefers the brand logo (contained, never cropped); everyone else
  // uses their avatar (cover-cropped).
  const rawHero = isBrand ? member.brand_logo_url ?? member.avatar_url : member.avatar_url
  const heroImageUrl = rawHero ? getImageUrl(rawHero, 'avatar-md') : null

  const isOnline = member.last_active_at
    ? Date.now() - new Date(member.last_active_at).getTime() < ONLINE_WINDOW_MS
    : false

  const completeness = member.profile_completeness_pct ?? 0
  const showIncomplete = completeness > 0 && completeness < COMPLETENESS_WARN_BELOW

  const hasNationality = Boolean(member.nationality_country_id || member.nationality)
  const location = locationLine(member)

  // ── CONTEXT mode (verdict present) ──────────────────────────────────────
  const inContext = Boolean(verdict)
  const pct = Math.round((verdict?.strength ?? 0) * 100)
  const chipState: VerdictDisplayTier = verdict ? recruiterDisplayTier(verdict) : 'out'
  const chip = CHIP[chipState]
  const ChipIcon = chip.icon
  const matchSuffix =
    chipState === 'out' && verdict?.caveats[0] ? `· ${verdict.caveats[0]}` : 'for your search'

  // ── NEUTRAL mode (no verdict) ───────────────────────────────────────────
  const availability = availabilityChip(member)
  const substance = substanceLine(member)

  // ── Trust row (Proof shield for persons-with-evidence, Verified otherwise) ─
  const proof = proofChecklist(member)
  const evidence = computeEvidence({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
  })

  const ariaLabel = inContext
    ? `${name} — ${chip.label} (${pct}% match). Tap to preview.`
    : `${name} — ${detailLine(member)}. Tap to preview.`

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
        aria-label={ariaLabel}
      >
        {/* ── Avatar (+ online dot for persons) ── */}
        <div className="relative h-[52px] w-[52px] flex-shrink-0">
          <div className="h-full w-full overflow-hidden rounded-full bg-gray-100">
            {heroImageUrl ? (
              <img
                src={heroImageUrl}
                alt=""
                className={`h-full w-full ${isBrand ? 'object-contain p-1.5' : 'object-cover'}`}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className={`flex h-full w-full items-center justify-center text-[15px] font-semibold ${tintFor(name)}`}>
                {initials}
              </div>
            )}
          </div>
          {isPerson && (
            <>
              <span
                className={`absolute bottom-0 right-0 h-[11px] w-[11px] rounded-full ring-2 ring-white ${isOnline ? 'bg-[#1D9E75]' : 'bg-[#B4B2A9]'}`}
                aria-hidden="true"
              />
              <span className="sr-only">{isOnline ? 'Online' : 'Offline'}</span>
            </>
          )}
        </div>

        {/* ── Name ── */}
        <h3 className="mt-2 flex h-[18px] w-full items-center justify-center">
          <span className="truncate text-[13.5px] font-semibold leading-tight text-gray-900" title={name}>{name}</span>
        </h3>

        {/* ── Detail line (role noun — always present) ── */}
        <p className="flex h-[16px] items-center text-[11.5px] font-medium text-gray-700">
          {detailLine(member)}
        </p>

        {/* ── Nationality (centered; EU tag never truncates) ── */}
        <div className="mt-0.5 flex h-[17px] w-full items-center justify-center overflow-hidden">
          {hasNationality ? (
            <DualNationalityDisplay
              primaryCountryId={member.nationality_country_id}
              secondaryCountryId={member.role === 'club' ? null : member.nationality2_country_id}
              fallbackText={member.nationality}
              mode="code"
            />
          ) : (
            <span className="text-[11px] text-gray-300">Nationality not listed</span>
          )}
        </div>

        {/* ── Location / club ── */}
        <div className="mt-0.5 flex h-[16px] w-full items-center justify-center">
          <span className={`truncate text-[11px] ${location ? 'text-gray-400' : 'text-gray-300'}`} title={location ?? undefined}>
            {location || (isOrg ? 'Location not listed' : 'Club not listed')}
          </span>
        </div>

        {/* ── MIDDLE ZONE ── */}
        {inContext ? (
          /* CONTEXT — the only purple zone. chip + bar + % all derive from
             the same strength so they can never disagree. */
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
        ) : (
          /* NEUTRAL — availability chip + the single load-bearing fact. */
          <div className="mt-2.5 flex w-full flex-col items-center">
            <div className="flex h-[22px] items-center">
              {availability && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#E7F6EF] px-2.5 py-0.5 text-[11.5px] font-medium text-[#13754F]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1D9E75]" aria-hidden="true" />
                  {availability.label}
                </span>
              )}
            </div>
            <p className="mt-1.5 flex h-[15px] w-full items-center justify-center px-2 text-[11px] leading-none">
              <span className={`truncate ${substance ? 'text-gray-600' : 'text-gray-300'}`} title={substance ?? undefined}>
                {substance || 'No details yet'}
              </span>
            </p>
          </div>
        )}

        {/* ── TRUST ── */}
        <div className="mt-2 flex h-[16px] w-full items-center justify-center gap-2.5 text-[11px]">
          {showIncomplete && (
            <span className="inline-flex items-center gap-1 text-[#854F0B]">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Incomplete
            </span>
          )}
          {proof ? (
            <span className="inline-flex items-center gap-1 text-gray-600">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" style={{ color: shieldColor(evidence.level, evidence.isApplicable) }} aria-hidden="true" />
              Proof {proof.present}/{proof.total}
            </span>
          ) : member.is_verified ? (
            <span className="inline-flex items-center gap-1 text-gray-600">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-[#1D9E75]" aria-hidden="true" />
              Verified
            </span>
          ) : null}
        </div>
      </button>

      {/* ── ACTION (pinned to the bottom; single hairline above) ── */}
      <div className="mt-auto">
        <RecruiterCardActions playerId={member.id} playerName={name} />
      </div>
    </div>
  )
}
