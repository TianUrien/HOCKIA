/**
 * CandidatePreviewSheet — the recruiter's mini-profile EVALUATION peek, shown
 * when a scoped (active recruiting context) player card is tapped.
 *
 * This is the intermediate step between the quick-scan card and the full
 * profile. Because opening the FULL profile can notify the viewed player, the
 * recruiter needs to decide *here* whether a candidate is worth that step — so
 * this sheet is deliberately data-rich and recruiter-focused:
 *
 *   IDENTITY   large avatar · name · verified · role · position · nationality
 *              (+ EU) · location
 *   MATCH      label + % + bar + WHY this player fits the active scope
 *              (positives/caveats straight from computeClubFit)
 *   CONTEXT    current club · league-on-record · category · open-to-play
 *   STRENGTH   Strong/Good/Limited profile + the REASON + completeness %
 *   EVIDENCE   full present/missing breakdown (not just a level badge)
 *   ACTIONS    Save · Message · Add friend
 *   CTA        View full profile →
 *
 * Privacy: opening this sheet fires `profile_preview` (NOT `profile_view`), so
 * it never lands in the player's "who viewed me" list or fires the viewer
 * notification. The full `profile_view` only fires when the recruiter presses
 * "View full profile". Recruiters can evaluate candidates privately here.
 *
 * Used by RecruiterCandidateCard.onPreview (scoped recruiter mode only — the
 * non-scoped directory keeps the general MemberPreviewModal).
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import {
  X, ChevronRight, MapPin, Building2, Shield, Check, ShieldCheck, Sparkles, AlertCircle, Target,
} from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import QuickActionsRow from './QuickActionsRow'
import { getImageUrl } from '@/lib/imageUrl'
import RolePlaceholder from '@/components/RolePlaceholder'
import { RoleBadge, VerifiedBadge, DualNationalityDisplay, AvailabilityPill } from '@/components'
import { computeEvidence, evidenceChecklist, evidenceLevelLabel } from '@/lib/evidence'
import { useClubFit } from '@/hooks/useClubFit'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import { useWorldClubLogo, getClubLevelBand } from '@/hooks/useWorldClubLogo'
import { categoryToBandTarget } from '@/hooks/useInterest'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackEvent } from '@/lib/analytics'
import type { Profile } from '@/components/community/PeopleListView'

interface CandidatePreviewSheetProps {
  member: Profile | null
  /** Match score 0..1 (precomputed by the list — authoritative headline %, so
   *  the preview's number always matches the card the recruiter tapped). */
  matchScore?: number
  onClose: () => void
}

const ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000

/** Display tier for the headline match — mirrors RecruiterCandidateCard so the
 *  card and the preview read identically. */
function matchTier(score: number): { label: string; text: string; fill: string } {
  const pct = score * 100
  if (pct >= 80) return { label: 'Excellent match', text: 'text-[#6d28d9]', fill: 'bg-gradient-to-r from-[#8026FA] to-[#6d28d9]' }
  if (pct >= 66) return { label: 'Strong match', text: 'text-[#8026FA]', fill: 'bg-gradient-to-r from-[#8026FA] to-[#924CEC]' }
  if (pct >= 40) return { label: 'Good match', text: 'text-blue-600', fill: 'bg-gradient-to-r from-blue-500 to-blue-600' }
  return { label: 'Limited match', text: 'text-gray-500', fill: 'bg-gray-400' }
}

/** Short, human summary of the active scope for the "evaluated for" line. */
function contextSummary(active: { label: string | null; target_category: string | null; region: string | null } | null): string {
  if (!active) return ''
  if (active.label?.trim()) return active.label.trim()
  return [active.target_category, active.region].filter(Boolean).join(' · ') || 'your scope'
}

/** Turn the completeness % + evidence checklist into a one-line REASON, so the
 *  strength tier ("Strong profile") is explained, not just asserted. */
function strengthExplanation(
  completeness: number,
  rows: { key: string; label: string; present: boolean }[],
): { tier: string; tone: string; why: string } {
  const missing = rows.filter((r) => !r.present).map((r) => r.label.toLowerCase())
  if (completeness >= 80) {
    return { tier: 'Strong profile', tone: 'text-emerald-700', why: 'Key hockey information is complete.' }
  }
  if (completeness >= 50) {
    const present = rows.filter((r) => r.present).map((r) => r.label.toLowerCase())
    const lead = present.slice(0, 3).join(', ')
    return { tier: 'Good profile', tone: 'text-gray-800', why: lead ? `Core details on record — ${lead}.` : 'Core details on record.' }
  }
  const gap = missing.slice(0, 3).join(', ')
  return { tier: 'Limited profile', tone: 'text-gray-600', why: gap ? `Still missing ${gap}.` : 'Key details still missing.' }
}

export function CandidatePreviewSheet({ member, matchScore = 0, onClose }: CandidatePreviewSheetProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const { active } = useRecruitingContext()
  const contentRef = useRef<HTMLDivElement>(null)
  const [isViewing, setIsViewing] = useState(false)

  // Full Club Fit (reasons/positives/caveats) for the "why this matches"
  // section. Reads the active context from the store, so the reasons are
  // computed against the SAME scope the card ranked by — consistent with the
  // headline % (computed band-less in the list; we surface positives/caveats,
  // never the neutral "league unavailable" lines).
  const fit = useClubFit(
    member && member.role === 'player'
      ? {
          id: member.id,
          role: member.role,
          playing_category: member.playing_category ?? null,
          current_world_club_id: member.current_world_club_id ?? null,
          open_to_play: member.open_to_play ?? null,
          open_to_coach: member.open_to_coach ?? null,
          open_to_opportunities: member.open_to_opportunities ?? null,
          last_active_at: member.last_active_at ?? null,
          position: member.position ?? null,
          secondary_position: member.secondary_position ?? null,
          specialist_skills: member.specialist_skills ?? null,
        }
      : null,
  )

  const clubLogo = useWorldClubLogo(member?.current_world_club_id ?? null)

  useBodyScrollLock(member !== null)
  useFocusTrap({ containerRef: contentRef, isActive: member !== null })

  // Drag-to-dismiss (mobile bottom-sheet). Touch-only, so naturally no-ops on
  // desktop; the width gate guards touch tablets in the centered layout.
  const [translateY, setTranslateY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartYRef = useRef(0)
  useEffect(() => {
    setTranslateY(0)
    setIsDragging(false)
  }, [member?.id])

  const handleDragStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return
    dragStartYRef.current = e.touches[0].clientY
    setIsDragging(true)
  }
  const handleDragMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setTranslateY(Math.max(0, e.touches[0].clientY - dragStartYRef.current))
  }
  const handleDragEnd = () => {
    if (!isDragging) return
    setIsDragging(false)
    if (translateY > 100) onClose()
    else setTranslateY(0)
  }

  // Escape to close
  useEffect(() => {
    if (!member) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [member, onClose])

  // Analytics: fire profile_preview (NON-notifying) on open, never
  // profile_view. Keeps the recruiter's peek private until they escalate.
  useEffect(() => {
    if (!member) return
    trackDbEvent('profile_preview', 'profile', member.id, {
      viewed_role: member.role,
      source: 'community_scoped_preview',
    })
    trackEvent({ action: 'community_scoped_preview_open', category: 'community', label: member.role })
  }, [member])

  const handleViewFullProfile = useCallback(() => {
    if (!user) {
      addToast('Sign in to view full profile', 'error')
      return
    }
    trackEvent({ action: 'community_preview_view_profile', category: 'community', label: member?.role })
    const returnTo = location.pathname + location.search
    setIsViewing(true)
    onClose()
    navigate(`/players/id/${member?.id}?ref=community_preview`, { state: { returnTo } })
  }, [user, member?.id, member?.role, location, navigate, onClose, addToast])

  if (!member) return null

  const heroImageUrl = member.avatar_url ? getImageUrl(member.avatar_url, 'avatar-lg') : null
  const completeness = member.profile_completeness_pct ?? 0
  const tier = matchTier(matchScore)
  const pct = Math.round(Math.max(0, Math.min(1, matchScore)) * 100)

  const positions = [member.position, member.secondary_position]
    .filter((v, i, self): v is string => Boolean(v) && self.findIndex((x) => x === v) === i)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))

  // Evidence — level + full present/missing breakdown (the reason behind the
  // level, which the card only hints at). Recent-activity row is appended
  // locally (it's an activity signal, not a stored artifact).
  const evInput = {
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
  }
  const ev = computeEvidence(evInput)
  const evRows = evidenceChecklist({
    ...evInput,
    current_club: member.current_club ?? null,
    career_entry_count: member.career_entry_count ?? null,
    open_to_play: member.open_to_play ?? null,
    open_to_coach: member.open_to_coach ?? null,
    competition_level_band: getClubLevelBand(
      member.current_world_club_id ?? null,
      categoryToBandTarget(member.playing_category ?? null),
    ),
  })
  const recentlyActive =
    Boolean(member.last_active_at) &&
    Date.now() - new Date(member.last_active_at as string).getTime() <= ACTIVE_WINDOW_MS
  const allEvRows = [...evRows, { key: 'recent', label: 'Recent activity', present: recentlyActive }]
  const hasLeague = evRows.find((r) => r.key === 'league')?.present ?? false

  const evLabel = ev.isApplicable ? evidenceLevelLabel(ev.level) : 'Missing evidence'
  const evColor = !ev.isApplicable
    ? 'text-gray-400'
    : ev.level === 'strong'
      ? 'text-emerald-600'
      : ev.level === 'moderate'
        ? 'text-gray-700'
        : 'text-gray-500'

  const strength = strengthExplanation(completeness, evRows)
  const scope = contextSummary(active)
  const positives = fit.positives.slice(0, 3)
  const caveats = fit.caveats.slice(0, 2)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 animate-fade-in" onClick={onClose} aria-hidden="true" />

      {/* Sheet — bottom on mobile, right-docked panel on desktop */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:justify-end md:p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-preview-name"
      >
        <div
          ref={contentRef}
          tabIndex={-1}
          className="pointer-events-auto relative w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[92vh] md:max-h-[88vh] overflow-y-auto animate-slide-in-up"
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: translateY > 0 ? `translateY(${translateY}px)` : undefined,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          {/* Sticky header: drag handle (mobile) + label + close */}
          <div
            className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 pt-2.5 pb-2"
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
          >
            <div className="md:hidden flex justify-center pb-1.5">
              <span className="inline-block h-1.5 w-10 rounded-full bg-gray-300" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <h2 id="candidate-preview-name" className="text-sm font-semibold text-gray-900">Candidate preview</h2>
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── IDENTITY (purple-tinted hero, big avatar — no flat grey) ── */}
          <div className="bg-gradient-to-b from-[#8026FA]/[0.07] to-transparent px-5 pt-4 pb-3">
            <div className="flex items-start gap-3.5">
              <div className="relative h-20 w-20 flex-shrink-0">
                <div className="absolute inset-0 overflow-hidden rounded-2xl bg-white ring-1 ring-gray-200 shadow-sm">
                  {heroImageUrl ? (
                    <img src={heroImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="absolute inset-0"><RolePlaceholder role={member.role} label="" /></div>
                  )}
                </div>
                {(member.open_to_play || member.open_to_opportunities) && (
                  <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full bg-emerald-500 ring-2 ring-white" title="Open to opportunities" />
                )}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-1">
                  <h3 className="truncate text-lg font-bold leading-tight text-gray-900" title={member.full_name}>
                    {member.full_name}
                  </h3>
                  <VerifiedBadge verified={member.is_verified ?? false} verifiedAt={member.verified_at ?? null} size="sm" />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <RoleBadge role={member.role} />
                  {positions.length > 0 && (
                    <span className="text-xs font-medium text-gray-600">{positions.join(' · ')}</span>
                  )}
                  {member.open_to_play && <AvailabilityPill variant="play" size="sm" />}
                </div>
                <div className="mt-2 space-y-1">
                  {(member.nationality_country_id || member.nationality) && (
                    <DualNationalityDisplay
                      primaryCountryId={member.nationality_country_id}
                      secondaryCountryId={member.nationality2_country_id}
                      fallbackText={member.nationality}
                      mode="compact"
                      className="text-xs text-gray-600"
                    />
                  )}
                  {member.base_location && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                      <span className="truncate">{member.base_location}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            {/* ── RECRUITER MATCH + WHY ── */}
            <div className="rounded-xl border border-[#8026FA]/15 bg-[#8026FA]/[0.03] p-3.5">
              {scope && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-gray-500">
                  <Target className="h-3 w-3 flex-shrink-0 text-[#8026FA]" />
                  <span className="truncate">Evaluated for <span className="font-medium text-gray-700">{scope}</span></span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${tier.text}`}>
                  <Sparkles className="h-4 w-4 flex-shrink-0" />
                  {tier.label}
                </span>
                <span className={`text-base font-bold tabular-nums ${tier.text}`}>{pct}%</span>
              </div>
              <div className="relative mt-2 h-1.5 rounded-full bg-gray-200">
                <div className={`h-1.5 rounded-full ${tier.fill}`} style={{ width: `${pct}%` }} />
              </div>
              {(positives.length > 0 || caveats.length > 0) && (
                <ul className="mt-3 space-y-1.5">
                  {positives.map((p) => (
                    <li key={p} className="flex items-start gap-1.5 text-xs text-gray-700">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                      <span>{p}</span>
                    </li>
                  ))}
                  {caveats.map((c) => (
                    <li key={c} className="flex items-start gap-1.5 text-xs text-gray-500">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── CURRENT HOCKEY CONTEXT ── */}
            <div className="rounded-xl border border-gray-200 p-3.5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Current context</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  {clubLogo ? (
                    <img src={clubLogo} alt="" className="h-4 w-4 flex-shrink-0 rounded-sm object-cover" />
                  ) : (
                    <Building2 className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  )}
                  <span className={member.current_club ? 'text-gray-800' : 'text-gray-400'}>
                    {member.current_club || 'Club not listed'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className={hasLeague ? 'text-gray-800' : 'text-gray-400'}>
                    {hasLeague ? 'League on record' : 'League not on record'}
                  </span>
                </div>
                {member.playing_category && (
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="capitalize text-gray-800">{member.playing_category.replace(/_/g, ' ')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── PROFILE STRENGTH (explained, not just asserted) ── */}
            <div className="rounded-xl border border-gray-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${strength.tone}`}>{strength.tier}</span>
                <span className="text-sm font-bold tabular-nums text-[#8026FA]">{completeness}%</span>
              </div>
              <div className="relative mt-2 h-1.5 rounded-full bg-gray-200">
                <div className="h-1.5 rounded-full bg-gradient-to-r from-[#8026FA] to-[#924CEC]" style={{ width: `${completeness}%` }} />
              </div>
              <p className="mt-2 text-xs leading-snug text-gray-600">{strength.why}</p>
            </div>

            {/* ── EVIDENCE BREAKDOWN (the reason behind the level) ── */}
            <div className="rounded-xl border border-gray-200 p-3.5">
              <div className="mb-2.5 flex items-center gap-1.5">
                <ShieldCheck className={`h-4 w-4 ${evColor}`} />
                <span className={`text-sm font-semibold ${evColor}`}>{evLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {allEvRows.map((r) => (
                  <div key={r.key} className="flex items-center gap-1.5 text-xs">
                    {r.present ? (
                      <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                    ) : (
                      <X className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                    )}
                    <span className={r.present ? 'text-gray-700' : 'text-gray-400'}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── ACTIONS ── */}
            <div className="border-t border-gray-100 pt-3">
              <QuickActionsRow
                playerId={member.id}
                playerName={member.full_name}
                compact
                showAddFriend
                className="w-full flex-wrap justify-center"
              />
            </div>

            {/* ── CTA ── */}
            <button
              type="button"
              onClick={handleViewFullProfile}
              disabled={isViewing}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-85 disabled:opacity-50"
            >
              View full profile
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
