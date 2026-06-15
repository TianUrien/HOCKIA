/**
 * OpportunityDetailOverlay
 *
 * Opens an opportunity as a MODAL OVERLAY (not a route) so the page that
 * launched it — e.g. the Home feed — stays mounted underneath and its scroll
 * position is preserved. Closing simply reveals the feed exactly where it was,
 * with no unmount / remount, no scroll restoration, and no jump. Mirrors the
 * Opportunities-list preview (OpportunityPreviewModal); the difference is this
 * one is opened by id and fetches the data (the feed card only has the id).
 *
 * Rendered through a portal to document.body so its `fixed inset-0` layer
 * anchors to the viewport even when a transformed feed ancestor would
 * otherwise capture it.
 *
 * Deep-link / shared URLs still go to OpportunityDetailPage (the route).
 */

import { createPortal } from 'react-dom'
import { useOpportunityDetail } from '@/hooks/useOpportunityDetail'
import OpportunityPreviewModal from './OpportunityPreviewModal'

interface OpportunityDetailOverlayProps {
  opportunityId: string
  onClose: () => void
  /** Bubbled up when the user applies, so a host can update its own state. */
  onApplied?: (opportunityId: string) => void
}

export default function OpportunityDetailOverlay({
  opportunityId,
  onClose,
  onApplied,
}: OpportunityDetailOverlayProps) {
  const { opportunity, club, worldClub, hasApplied, isLoading, notFound, setHasApplied } =
    useOpportunityDetail(opportunityId)

  let content: React.ReactNode

  if (isLoading) {
    // Backdrop-LESS spinner: instant feedback on tap, but no dark dim — so it
    // hands off seamlessly to OpportunityDetailView's own fade-in backdrop
    // (which animates from transparent). A dark dim here would flash
    // dim→transparent→dim when the modal mounts.
    content = (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="status"
        aria-label="Loading opportunity"
      >
        <div className="w-12 h-12 rounded-full bg-white shadow-lg flex items-center justify-center">
          <div className="w-6 h-6 border-[3px] border-[#8026FA] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  } else if (notFound || !opportunity || !club) {
    content = (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Opportunity unavailable"
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6"
        onClick={onClose}
      >
        <div className="bg-white rounded-2xl p-6 text-center max-w-sm" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Opportunity unavailable</h2>
          <p className="text-sm text-gray-600 mb-4">This opportunity may have been removed.</p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Close
          </button>
        </div>
      </div>
    )
  } else {
    content = (
      <OpportunityPreviewModal
        vacancy={opportunity}
        clubInfo={club}
        worldClub={worldClub}
        hasApplied={hasApplied}
        onClose={onClose}
        onApplicationSuccess={(id) => {
          setHasApplied(true)
          onApplied?.(id)
        }}
      />
    )
  }

  return createPortal(content, document.body)
}
