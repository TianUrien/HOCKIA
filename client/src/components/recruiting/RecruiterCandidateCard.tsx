/**
 * RecruiterCandidateCard — the ONE unified Community member card. Identical
 * zones for every role (Player / Coach / Club / Brand / Umpire) so a grid of
 * mixed roles lines up perfectly, with two middle-zone modes:
 *
 *   NEUTRAL  (no active recruiting scope) → photo + identity lines only
 *   CONTEXT  (a club/coach has an active scope) → the one Fit badge (audit B3:
 *            Strong / Possible with a bar meter, never a percentage)
 *
 * Fixed-height zones top-to-bottom so every card is equal-height regardless of
 * how much data a member has (placeholders never collapse a zone):
 *   role pill · avatar (+online dot, persons only) · name · detail line ·
 *   nationality · location/club · MIDDLE (neutral|context) · TRUST · ACTION
 *
 * UI ONLY — the verdict/fit data is computed upstream and passed through
 * unchanged. No chips over faces (founder ruling 2026-10-11).
 */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { DualNationalityDisplay } from '@/components'
import { getImageUrl, getImageSrcSet } from '@/lib/imageUrl'
import { SmoothImage } from '@/components/ui/SmoothImage'
import { getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import { fitStateFromVerdict, type RecruiterVerdict } from '@/lib/recruiterVerdict'
import { FitBadge } from '@/components/ui/FitBadge'
import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { useAuthStore } from '@/lib/auth'

/** Fields the card reads — a structural subset of the Community member row, so
 *  PeopleListView can pass `member` straight through. Most are optional so a
 *  thin row still renders (the zone shows a muted placeholder). */
export interface RecruiterCardMember {
  id: string
  /** Open opportunities this member has published — outranks the generic pill. */
  open_role_count?: number | null
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
  /** The tap opens the full profile (recruiters on phone Community), not the
   *  preview — the screen-reader label says "Opens profile." then. */
  opensProfile?: boolean
  /** Club view (Figma D1.17): the server fit for the active context — green
   *  "Strong fit", yellow "Possible fit", grey or null renders nothing. Only
   *  ever passed for clubs and coaches who recruit. */
  fitState?: FitState | null
  /** Eager-load + high fetch-priority the avatar. Set true ONLY for the
   *  first row of the Community grid / carousel (the most-viewed image
   *  surface) so it paints instantly; everyone else stays lazy. */
  priority?: boolean
}

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

/** Soft, deterministic, non-purple initials tint (purple is reserved for the
 *  match zone). */
const AVATAR_TINTS = [
  'bg-sky-50 text-sky-600',
  'bg-rose-50 text-rose-500',
  'bg-teal-50 text-teal-600',
  'bg-hockia-soft text-hockia-primary',
  'bg-emerald-50 text-emerald-600',
  'bg-blue-50 text-blue-500',
]
function tintFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

/** Role noun for the tile's second line: "Player", "Coach", "Club"… */
function roleNoun(member: RecruiterCardMember): string {
  switch (member.role) {
    case 'coach': return 'Coach'
    case 'umpire': return 'Umpire'
    case 'club': return 'Club'
    case 'brand': return 'Brand'
    default: return 'Player'
  }
}

/** The tile's second line — "Player · Midfielder", "Club · Serie A Elite",
 *  "Coach · Goalkeeping Coach", "Brand · Equipment". */
function tileDetail(member: RecruiterCardMember): string {
  const noun = roleNoun(member)
  let fact: string | null = null
  switch (member.role) {
    case 'player': {
      const raw = member.position?.trim()
      fact = raw ? (POSITION_LABEL[raw.toLowerCase()] ?? titleCase(raw)) : null
      break
    }
    case 'coach':
      fact = coachSpecLabel(member)
      break
    case 'umpire':
      fact = umpireLevelLabel(member)
      break
    case 'club':
      // The club's league on Hockia (its linked club's league), else where it is.
      fact = member.competition_name?.trim() || getPlayerLeagueName(member.current_world_club_id, null) || locationLine(member)
      break
    case 'brand':
      fact = member.brand_category ? BRAND_CATEGORY_LABELS[member.brand_category] ?? null : null
      break
  }
  return fact && fact !== noun ? `${noun} · ${fact}` : noun
}

/**
 * The member tile (UI redesign 2026-09-19, "Community v2"): photo-first.
 *   [ photo — status pill top-left ]
 *   Name
 *   Player · Midfielder
 *   🇦🇷 Argentina
 * In CONTEXT mode (a recruiter with an active scope) the Fit badge joins the
 * text block. Tap → preview.
 */
export default function RecruiterCandidateCard({ member, verdict: verdictProp, fitState: fitStateProp = null, onPreview, opensProfile = false, priority = false }: RecruiterCandidateCardProps) {
  // Fit is club-only: a player viewer never gets a verdict, % or fit chip,
  // whatever the caller passes (Figma Card / Member, "Show fit" off).
  const viewerIsPlayer = useAuthStore((s) => s.profile?.role === 'player')
  const verdict = viewerIsPlayer ? null : verdictProp
  const fitState = viewerIsPlayer ? null : fitStateProp
  const name = member.full_name?.trim() || 'Unknown'
  const initials = name.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || '?'

  const isBrand = member.role === 'brand'

  // Brand hero prefers the brand logo (contained, never cropped); everyone else
  // uses their avatar (cover-cropped).
  const rawHero = isBrand ? member.brand_logo_url ?? member.avatar_url : member.avatar_url
  // A URL that 404s (e.g. a profile row still pointing at a replaced file)
  // used to render the browser's broken-image glyph here, while a NULL url
  // fell back to initials — so a broken avatar looked worse than no avatar.
  // Treat a failed load as "no image" and take the same initials path.
  const [heroFailed, setHeroFailed] = useState(false)
  const heroImageUrl = rawHero && !heroFailed ? getImageUrl(rawHero, 'avatar-md') : null

  const hasNationality = Boolean(member.nationality_country_id || member.nationality)

  // ── CONTEXT mode (verdict present): the one Fit badge, never a % (audit B3).
  const inContext = Boolean(verdict)
  const badgeState: FitState | null = inContext ? fitStateFromVerdict(verdict) : fitState
  const badgeLabel = fitChipLabel(badgeState)

  // Round 6: say where the tap goes — the full profile or the preview.
  const tapHint = opensProfile ? 'Opens profile.' : 'Tap to preview.'
  const ariaLabel = badgeLabel
    ? `${name} · ${detailLine(member)}, ${badgeLabel}. ${tapHint}`
    : `${name} · ${detailLine(member)}. ${tapHint}`

  return (
    <button
      type="button"
      onClick={onPreview}
      className="flex h-full w-full flex-col rounded-2xl bg-surface-grouped p-2 pb-3 text-left transition-transform duration-100 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary"
      aria-label={ariaLabel}
      data-testid="member-tile"
    >
      {/* ── Photo + status pill ── */}
      <div className={`relative aspect-square w-full overflow-hidden rounded-xl ${isBrand || member.role === 'club' ? 'border border-line bg-white' : 'bg-gray-100'}`}>
        {heroImageUrl ? (
          <SmoothImage
            src={heroImageUrl}
            srcSet={getImageSrcSet(rawHero, 'avatar-md') ?? undefined}
            sizes="(max-width: 640px) 45vw, 200px"
            alt=""
            wrapperClassName={isBrand || member.role === 'club' ? 'bg-white' : undefined}
            className={isBrand || member.role === 'club' ? 'bg-white object-contain p-5' : 'object-cover'}
            priority={priority}
            onError={() => setHeroFailed(true)}
          />
        ) : (
          <div className={`flex h-full w-full items-center justify-center text-3xl font-semibold ${tintFor(name)}`}>
            {initials}
          </div>
        )}
      </div>

      {/* ── Text block ── */}
      <div className="min-w-0 px-1 pt-2">
        <h3 className="flex items-center gap-1 text-row font-semibold text-ink-1">
          <span className="truncate" title={name}>{name}</span>
          {member.is_verified && <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-[#1D9E75]" aria-label="Verified" />}
        </h3>
        <p className="mt-px truncate text-secondary text-ink-2" title={tileDetail(member)}>
          {tileDetail(member)}
        </p>
        <div className="mt-px flex h-[18px] items-center overflow-hidden text-secondary text-ink-3">
          {hasNationality ? (
            <DualNationalityDisplay
              primaryCountryId={member.nationality_country_id}
              secondaryCountryId={member.role === 'club' ? null : member.nationality2_country_id}
              fallbackText={member.nationality}
              mode="line"
            />
          ) : null}
        </div>
        {badgeLabel && (
          <div className="mt-1.5">
            <FitBadge state={badgeState} />
          </div>
        )}
      </div>
    </button>
  )
}
