/**
 * OpportunityPreviewModal
 *
 * Modal/bottom-sheet preview of an opportunity, opened from the
 * /opportunities list without route navigation. Mirrors the Community
 * MemberPreviewModal pattern: list state stays mounted underneath, the
 * modal opens/closes via parent state, scroll/filters/search are
 * preserved automatically.
 *
 * All visible data is passed in via props (vacancy, clubInfo, worldClub,
 * hasApplied) — every value is already in memory on the list page, so
 * opening the modal is instant with no network fetch. ApplyModal and
 * SignInPrompt are nested children, identical to OpportunityDetailPage.
 *
 * Deep-link entry to /opportunities/:id still goes through
 * OpportunityDetailPage (which renders OpportunityDetailView directly
 * with its own fetch); this modal is purely the in-list preview.
 */

import { useState } from 'react'
import OpportunityDetailView from './OpportunityDetailView'
import ApplyToOpportunityModal from './ApplyToOpportunityModal'
import SignInPromptModal from './SignInPromptModal'
import type { Vacancy } from '../lib/supabase'
import type { WorldClubInfo } from './OpportunityCard'
import { useAuthStore } from '@/lib/auth'
import { trackProtectedActionBlocked } from '@/lib/analytics'

export interface OpportunityPreviewClubInfo {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  current_club: string | null
  womens_league_division: string | null
  mens_league_division: string | null
}

interface OpportunityPreviewModalProps {
  vacancy: Vacancy
  clubInfo: OpportunityPreviewClubInfo | undefined
  worldClub: WorldClubInfo | null
  hasApplied: boolean
  onClose: () => void
  /** Called when the user successfully applies — parent should mark the
   *  vacancy as applied in its own state so the Apply CTA hides. */
  onApplicationSuccess?: (vacancyId: string) => void
}

export default function OpportunityPreviewModal({
  vacancy,
  clubInfo,
  worldClub,
  hasApplied,
  onClose,
  onApplicationSuccess,
}: OpportunityPreviewModalProps) {
  const { user, profile } = useAuthStore()
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)

  const canShowApplyButton = !hasApplied && (
    !user ||
    (profile?.role === 'player' && vacancy.opportunity_type === 'player') ||
    (profile?.role === 'coach' && vacancy.opportunity_type === 'coach')
  )

  const handleApplyClick = () => {
    if (!user) {
      setShowSignInPrompt(true)
      trackProtectedActionBlocked('apply_opportunity')
    } else if (canShowApplyButton) {
      setShowApplyModal(true)
    }
  }

  // Phase 3d — Women + Girls families map to women's league;
  // Men + Boys to men's; Mixed defaults to first available.
  const leagueDivision = (() => {
    if (!clubInfo) return null
    const womensFamily = vacancy.gender === 'Women' || vacancy.gender === 'Girls'
    return womensFamily
      ? clubInfo.womens_league_division ?? clubInfo.mens_league_division ?? null
      : clubInfo.mens_league_division ?? clubInfo.womens_league_division ?? null
  })()

  return (
    <>
      <OpportunityDetailView
        vacancy={vacancy}
        clubName={clubInfo?.full_name ?? 'Unknown Club'}
        clubLogo={clubInfo?.avatar_url}
        clubId={vacancy.club_id}
        publisherRole={clubInfo?.role}
        publisherOrganization={vacancy.organization_name || clubInfo?.current_club || null}
        leagueDivision={leagueDivision}
        worldClub={worldClub}
        onClose={onClose}
        onApply={canShowApplyButton ? handleApplyClick : undefined}
        hasApplied={hasApplied}
      />

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to apply"
        message="Sign in or create a free HOCKIA account to apply to this opportunity."
      />

      <ApplyToOpportunityModal
        isOpen={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        vacancy={vacancy}
        onSuccess={(vacancyId) => {
          setShowApplyModal(false)
          onApplicationSuccess?.(vacancyId)
        }}
      />
    </>
  )
}
