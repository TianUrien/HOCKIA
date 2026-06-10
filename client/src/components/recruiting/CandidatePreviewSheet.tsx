/**
 * CandidatePreviewSheet — lightweight "peek" at a player candidate in the context
 * of recruiter evaluation. Shows match, fit, and evidence in a minimal sheet so
 * recruiters can quickly scan without opening the full profile (and without losing
 * their place on the Community list).
 *
 * Distinct from MemberPreviewModal:
 *   - Recruiter-only (assumes active context + player being evaluated)
 *   - Minimal: match slider, profile completeness, evidence, quick actions only
 *   - Sheet on mobile (bottom), side peek on tablet/desktop (right edge)
 *   - Clear "View Full Profile" CTA to escalate to the dashboard
 *   - Escape key and background click close without navigation
 *
 * Used by RecruiterCandidateCard.onPreview; does NOT replace the card's preview
 * affordance (the entire card is tappable). Complements QuickActionsRow for
 * players who want to evaluate without leaving the grid.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import QuickActionsRow from './QuickActionsRow'
import { getImageUrl } from '@/lib/imageUrl'
import RolePlaceholder from '@/components/RolePlaceholder'
import { RoleBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import { computeEvidence, evidenceChecklist } from '@/lib/evidence'
import EvidenceSignal from './EvidenceSignal'
import type { Profile } from '@/components/community/PeopleListView'

interface CandidatePreviewSheetProps {
  member: Profile | null
  /** Match score 0..1 (precomputed by the list). */
  matchScore?: number
  onClose: () => void
}

export function CandidatePreviewSheet({
  member,
  matchScore = 0,
  onClose,
}: CandidatePreviewSheetProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const contentRef = useRef<HTMLDivElement>(null)
  const [isViewing, setIsViewing] = useState(false)

  useBodyScrollLock(member !== null)
  useFocusTrap({ containerRef: contentRef, isActive: member !== null })

  // Escape to close
  useEffect(() => {
    if (!member) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [member, onClose])

  const handleViewFullProfile = useCallback(() => {
    if (!user) {
      addToast('Sign in to view full profile', 'error')
      return
    }
    const profileRoute = `/players/id/${member?.id}?ref=community_preview`
    const returnTo = location.pathname + location.search
    setIsViewing(true)
    onClose()
    navigate(profileRoute, { state: { returnTo } })
  }, [user, member?.id, location, navigate, onClose, addToast])

  if (!member) return null

  const heroImageUrl = member.avatar_url
    ? getImageUrl(member.avatar_url, 'avatar-lg')
    : null

  const completeness = member.profile_completeness_pct ?? 0
  const evidence = computeEvidence({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
  })
  const checklist = evidenceChecklist({
    role: member.role,
    highlight_video_url: member.highlight_video_url ?? null,
    full_game_video_count: member.full_game_video_count ?? null,
    accepted_reference_count: member.accepted_reference_count ?? null,
    is_verified: member.is_verified ?? null,
    current_world_club_id: member.current_world_club_id ?? null,
    current_club: member.current_club ?? null,
    career_entry_count: member.career_entry_count ?? null,
    open_to_play: member.open_to_play ?? null,
    competition_level_band: (member as unknown as { competition_level_band?: number }).competition_level_band ?? null,
  })

  const pct = Math.round(Math.max(0, Math.min(1, matchScore)) * 100)
  const matchColor =
    pct >= 80 ? 'text-[#6d28d9]' : pct >= 66 ? 'text-[#8026FA]' : pct >= 40 ? 'text-blue-600' : 'text-gray-500'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet container */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-end md:items-center md:justify-end md:p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-preview-name"
      >
        <div
          ref={contentRef}
          tabIndex={-1}
          className="pointer-events-auto w-full md:max-w-sm bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto animate-slide-in-up"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-2">
            <h2 id="candidate-preview-name" className="text-sm font-semibold text-gray-900 truncate">
              Preview
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Hero */}
            <div className="flex items-start gap-3">
              <div className="relative h-16 w-16 flex-shrink-0">
                <div className="absolute inset-0 overflow-hidden rounded-full bg-gray-100">
                  {heroImageUrl ? (
                    <img
                      src={heroImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="absolute inset-0">
                      <RolePlaceholder role={member.role} label="" />
                    </div>
                  )}
                </div>
                {member.open_to_play && (
                  <span
                    className="absolute right-0 top-0 h-3 w-3 rounded-full bg-emerald-500 ring-1.5 ring-white"
                    title="Open to opportunities"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <h3 className="text-sm font-semibold text-gray-900 truncate" title={member.full_name}>
                    {member.full_name}
                  </h3>
                  <VerifiedBadge verified={member.is_verified ?? false} verifiedAt={member.verified_at ?? null} size="sm" />
                </div>
                <div className="mt-1">
                  <RoleBadge role={member.role} />
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
                  <DualNationalityDisplay
                    primaryCountryId={member.nationality_country_id}
                    secondaryCountryId={member.nationality2_country_id}
                    fallbackText={member.nationality}
                    mode="code"
                  />
                </div>
              </div>
            </div>

            {/* Match score */}
            {matchScore > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                    Recruiter match
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${matchColor}`}>
                    {pct}%
                  </span>
                </div>
                <div className="relative mt-2 h-1 rounded-full bg-gray-300">
                  <div
                    className={`h-1 rounded-full ${
                      pct >= 80
                        ? 'bg-gradient-to-r from-[#8026FA] to-[#6d28d9]'
                        : pct >= 66
                          ? 'bg-gradient-to-r from-[#8026FA] to-[#924CEC]'
                          : pct >= 40
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600'
                            : 'bg-gray-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Profile completeness */}
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-3">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[#8026FA]/10 text-[#8026FA] text-xs font-semibold">
                {Math.round(completeness / 10) * 10}%
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {completeness >= 80 ? 'Strong' : completeness >= 50 ? 'Good' : 'Incomplete'} profile
                </p>
                <p className="text-xs text-gray-500">
                  {completeness}% complete
                </p>
              </div>
            </div>

            {/* Evidence */}
            {evidence.isApplicable && (
              <div className="rounded-lg border border-gray-200 p-3">
                <EvidenceSignal
                  result={evidence}
                  checklist={checklist}
                />
              </div>
            )}

            {/* Quick actions */}
            <div className="border-t border-gray-200 pt-3">
              <QuickActionsRow
                playerId={member.id}
                playerName={member.full_name}
                compact
                showAddFriend
                className="flex-wrap justify-center"
              />
            </div>

            {/* View full profile CTA */}
            <button
              type="button"
              onClick={handleViewFullProfile}
              disabled={isViewing}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-semibold text-sm hover:opacity-90 active:opacity-85 transition-opacity disabled:opacity-50"
            >
              View full profile
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
