import { ShieldAlert } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'

interface ClubClaimConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  /** Name of the club the user is about to claim. Surfaced in the body
   *  copy so the user re-reads what they're committing to. */
  clubName: string
  /** True when the user is creating a brand-new club and claiming it
   *  rather than claiming an existing directory entry. The disclaimer
   *  copy adapts so it doesn't talk about "this directory entry". */
  isCreating?: boolean
  /** Whether the underlying RPC call is in flight. Disables the confirm
   *  button so users can't double-submit. */
  loading?: boolean
}

/**
 * ClubClaimConfirmModal — last-mile friction before a user assumes the
 * representation of a club on HOCKIA.
 *
 * Pre-launch the world_clubs claim flow doesn't require admin or peer
 * verification — anyone could in principle claim "Real Madrid Hockey"
 * or any directory entry. This modal puts the user on notice that
 * misrepresentation is a terms violation. It's a deterrent, not a
 * verifier. The visitor-facing PendingVerificationBadge handles the
 * trust signal on the consumption side; this handles the production
 * side.
 *
 * Pairs with admin_set_profile_verified() on the back end — admins
 * grant verification once they've reviewed a claim.
 */
export default function ClubClaimConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  clubName,
  isCreating = false,
  loading = false,
}: ClubClaimConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md" showClose={!loading}>
      <div className="p-6 md:p-7">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <ShieldAlert className="h-6 w-6 text-amber-600" aria-hidden="true" />
        </div>

        <h2 className="text-center text-lg font-semibold text-gray-900">
          {isCreating ? 'Confirm new club claim' : 'Confirm club claim'}
        </h2>

        <p className="mt-3 text-sm text-gray-600">
          You are about to claim{' '}
          <span className="font-semibold text-gray-900">{clubName}</span> as its
          official representative on HOCKIA. This means you’ll be able to post
          opportunities, accept members, and represent the club to the community.
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">Please confirm you have authority.</p>
          <p className="mt-1 leading-relaxed">
            Misrepresenting a club you are not authorised to act for can result in
            account termination and removal of the listing. Your profile will be
            shown as <span className="font-medium">pending verification</span>{' '}
            until our team confirms the claim.
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            type="button"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={loading}
            type="button"
          >
            {loading ? 'Claiming…' : 'Confirm and claim'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
