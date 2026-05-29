import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ShieldCheck,
  MessageCircle,
  Trash2,
  Plus,
  Check,
  X,
  Pencil,
} from 'lucide-react'
import Avatar from '../Avatar'
import RoleBadge from '../RoleBadge'
import ConfirmActionModal from '../ConfirmActionModal'
import AddReferenceModal, { type ReferenceFriendOption } from '../AddReferenceModal'
import ReferenceEndorsementModal from '../ReferenceEndorsementModal'
import type { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { formatRelationshipType } from '@/lib/utils'
import { trackReferenceModalOpen } from '@/lib/analytics'
import type { Profile } from '@/lib/supabase'

type TrustedReferencesState = ReturnType<typeof useTrustedReferences>

/**
 * CommunityReferencesSection — the redesigned References surface for the
 * Community hub. Replaces the dense old TrustedReferencesSection on the
 * /community route with three compact, scannable cards stacked vertically:
 *
 *   1. Selected references — accepted refs with new card design
 *      (avatar, name, role badge, relationship, location, preview, Read
 *      full reference / Message / Remove). Mobile-first row layout, not
 *      a horizontal carousel.
 *   2. Reference requests — incoming pending requests with
 *      Accept & endorse / Decline. Compact empty state.
 *   3. References you gave — given refs with Add endorsement +
 *      Withdraw + status pill.
 *
 * The standalone /dashboard/profile/references route still renders the
 * full legacy TrustedReferencesSection (carousel layout + Phase 4 empty
 * states) — the focused-views split set up in PR2 lets both coexist.
 *
 * Consumes useTrustedReferences for data + mutations. Re-uses
 * AddReferenceModal, ReferenceEndorsementModal, ConfirmActionModal so
 * the underlying flows are identical to the focused route.
 */

const ALLOWED_REQUESTER_ROLES: Profile['role'][] = ['player', 'coach', 'umpire']

interface CommunityReferencesSectionProps {
  profileRole: Profile['role'] | null
  friendOptions: ReferenceFriendOption[]
  /** The shared useTrustedReferences instance — owned by the hub so the
   *  header card and this section see the same data + mutations without
   *  a duplicate fetch. Standalone callers can create their own. */
  references: TrustedReferencesState
  /** External trigger — when set, opens AddReferenceModal pre-selected
   *  to this friend. Drives the CredibilityNetworkCard's "Add Reference"
   *  CTA from the parent hub. Parent should clear via the consumed cb. */
  openAddModalForFriendId?: string | null
  /** Parent provides this; when the modal opens we call back so the
   *  parent clears its signal — that's what lets the same friend CTA
   *  re-trigger the modal. Also used for the CTA-fired open. */
  onAddReferenceConsumed?: () => void
  /** Add-reference CTA fired from the parent hub (CredibilityNetworkCard
   *  Add Reference button). Use this so the parent's UI controls the
   *  primary action; we just respond to the signal. */
  addModalOpen?: boolean
  onAddModalClose?: () => void
}

type ConfirmState = {
  mode: 'remove' | 'withdraw'
  referenceId: string
  headline: string
  description: string
}

export default function CommunityReferencesSection({
  profileRole,
  friendOptions,
  references,
  openAddModalForFriendId = null,
  onAddReferenceConsumed,
  addModalOpen: externalAddModalOpen,
  onAddModalClose,
}: CommunityReferencesSectionProps) {
  const {
    loading,
    isOwner,
    acceptedReferences,
    pendingReferences,
    incomingRequests,
    givenReferences,
    acceptedCount,
    maxReferences,
    canAddMore,
    requestReference,
    respondToRequest,
    removeReference,
    withdrawReference,
    editEndorsement,
    refresh,
    isMutating,
  } = references

  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const navigate = useNavigate()
  const location = useLocation()
  const dismissNotification = useNotificationStore((state) => state.dismissBySource)

  const [internalAddOpen, setInternalAddOpen] = useState(false)
  // Combine the two open-signals with OR, not nullish coalescing —
  // the hub passes `addModalOpen={false}` as its initial state, and `??`
  // would return that false and lock out the ask-to-vouch path which only
  // sets `internalAddOpen=true`. Closing clears both so the next open
  // works from either side.
  const addModalOpen = Boolean(externalAddModalOpen) || internalAddOpen
  const closeAddModal = () => {
    setInternalAddOpen(false)
    onAddModalClose?.()
  }

  const [preselectedFriendId, setPreselectedFriendId] = useState<string | null>(null)
  const [endorsementRequest, setEndorsementRequest] = useState<typeof incomingRequests[number] | null>(null)
  const [editingReference, setEditingReference] = useState<typeof givenReferences[number] | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [messageTargetId, setMessageTargetId] = useState<string | null>(null)
  const [expandedRefId, setExpandedRefId] = useState<string | null>(null)

  const canCollectReferences =
    isOwner && !!profileRole && ALLOWED_REQUESTER_ROLES.includes(profileRole)

  // Mirror parent's preselect-friend signal into modal state. Effect (not
  // render-time setState) so we don't loop. The parent clears the signal
  // via onAddReferenceConsumed once we've opened — that's what lets a
  // second tap on the same friend re-trigger this open.
  useEffect(() => {
    if (!openAddModalForFriendId) return
    if (!canCollectReferences) return
    setPreselectedFriendId(openAddModalForFriendId)
    setInternalAddOpen(true)
    onAddReferenceConsumed?.()
  }, [openAddModalForFriendId, canCollectReferences, onAddReferenceConsumed])

  const availableFriends = useMemo(() => {
    if (!canCollectReferences) return []
    const excluded = new Set<string>()
    acceptedReferences.forEach((r) => r.profile?.id && excluded.add(r.profile.id))
    pendingReferences.forEach((r) => r.profile?.id && excluded.add(r.profile.id))
    return friendOptions.filter((f) => !excluded.has(f.id))
  }, [acceptedReferences, pendingReferences, friendOptions, canCollectReferences])

  const handleMessage = async (targetId: string | null) => {
    if (!targetId || !user) {
      if (!user) {
        addToast('Sign in to message references.', 'info')
        navigate('/')
      }
      return
    }
    setMessageTargetId(targetId)
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${targetId}),and(participant_one_id.eq.${targetId},participant_two_id.eq.${user.id})`
        )
        .maybeSingle()
      if (error) throw error
      // returnTo: conversation back button returns to current page
      // (the community references view).
      const returnTo = location.pathname + location.search
      if (data?.id) navigate(`/messages?conversation=${data.id}`, { state: { returnTo } })
      else navigate(`/messages?new=${targetId}`, { state: { returnTo } })
    } catch (error) {
      logger.error('Failed to open messages', error)
      addToast('Unable to start conversation. Please try again.', 'error')
    } finally {
      setMessageTargetId(null)
    }
  }

  const openProfile = (targetId: string | null, role?: string | null) => {
    if (!targetId) return
    const base =
      role === 'club'
        ? '/clubs'
        : role === 'umpire'
          ? '/umpires'
          : role === 'coach'
            ? '/coaches'
            : role === 'brand'
              ? '/brands'
              : '/players'
    navigate(`${base}/id/${targetId}`)
  }

  const handleAcceptRequest = async (endorsement: string | null) => {
    if (!endorsementRequest) return false
    const success = await respondToRequest({
      referenceId: endorsementRequest.id,
      accept: true,
      endorsement,
    })
    if (success) {
      dismissNotification('reference_request_received', endorsementRequest.id)
      setEndorsementRequest(null)
    }
    return success
  }

  const handleDeclineRequest = async (requestId: string) => {
    const success = await respondToRequest({ referenceId: requestId, accept: false })
    if (success) dismissNotification('reference_request_received', requestId)
  }

  const handleEditEndorsement = async (endorsement: string | null) => {
    if (!editingReference) return false
    const success = await editEndorsement(editingReference.id, endorsement)
    if (success) setEditingReference(null)
    return success
  }

  const openRemoveConfirm = (referenceId: string, referenceName: string) => {
    setConfirmState({
      mode: 'remove',
      referenceId,
      headline: 'Remove trusted reference',
      description: `This will remove ${referenceName} from your trusted references. You can always invite them again later.`,
    })
  }

  const openWithdrawConfirm = (referenceId: string, referenceName: string) => {
    setConfirmState({
      mode: 'withdraw',
      referenceId,
      headline: 'Withdraw your endorsement',
      description: `This reference will disappear from ${referenceName}'s profile immediately.`,
    })
  }

  const executeConfirm = async () => {
    if (!confirmState) return
    const { mode, referenceId } = confirmState
    const success =
      mode === 'remove'
        ? await removeReference(referenceId)
        : await withdrawReference(referenceId)
    if (success) {
      setConfirmState(null)
      void refresh()
    }
  }

  const confirmLoading = confirmState
    ? isMutating(confirmState.mode, confirmState.referenceId)
    : false

  if (!isOwner) return null

  return (
    <div className="space-y-4">
      {/* ─── Selected references ─── */}
      <section
        data-testid="community-references-selected"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">References</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Coaches, teammates, and clubs vouching for you.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 flex-shrink-0">
            <ShieldCheck className="h-3 w-3" />
            {acceptedCount}/{maxReferences}
          </span>
        </header>

        {loading ? (
          <SkeletonRows />
        ) : acceptedReferences.length === 0 ? (
          <SelectedEmptyState
            canCollect={canCollectReferences}
            canAddMore={canAddMore}
            onAddReference={() => {
              trackReferenceModalOpen('empty_state')
              setInternalAddOpen(true)
            }}
          />
        ) : (
          <ul className="space-y-2.5">
            {acceptedReferences.map((reference) => {
              const isExpanded = expandedRefId === reference.id
              const profile = reference.profile
              const fullName = profile?.fullName ?? 'HOCKIA Member'
              return (
                <li
                  key={reference.id}
                  className="rounded-xl border border-gray-100 bg-white p-3 md:p-4 hover:bg-gray-50/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => openProfile(profile?.id ?? null, profile?.role)}
                      className="flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/40 rounded-full"
                      aria-label={`Open ${fullName}'s profile`}
                    >
                      <Avatar
                        src={profile?.avatarUrl}
                        initials={fullName.slice(0, 2)}
                        alt={fullName}
                        size="md"
                        role={profile?.role}
                      />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openProfile(profile?.id ?? null, profile?.role)}
                          className="font-semibold text-sm text-gray-900 hover:text-[#8026FA] transition-colors truncate text-left"
                        >
                          {fullName}
                        </button>
                        <ShieldCheck
                          className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0"
                          aria-label="Vouched"
                        />
                        {profile?.role && (
                          <RoleBadge
                            role={profile.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'}
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600 truncate">
                        {formatRelationshipType(reference.relationshipType)}
                        {profile?.baseLocation && (
                          <>
                            <span className="mx-1 text-gray-300">·</span>
                            <span>{profile.baseLocation}</span>
                          </>
                        )}
                      </p>
                      {reference.endorsementText && (
                        <p
                          className={`mt-2 text-xs text-gray-600 ${isExpanded ? '' : 'line-clamp-2'}`}
                        >
                          “{reference.endorsementText}”
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {reference.endorsementText && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRefId(isExpanded ? null : reference.id)
                            }
                            className="text-xs font-medium text-[#8026FA] hover:text-[#6B20D4]"
                          >
                            {isExpanded ? 'Show less' : 'Read full reference'}
                          </button>
                        )}
                        {profile?.id && (
                          <button
                            type="button"
                            onClick={() => handleMessage(profile.id)}
                            disabled={messageTargetId === profile.id}
                            className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
                          >
                            <MessageCircle className="h-3 w-3" />
                            Message
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            openRemoveConfirm(reference.id, fullName)
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}

            {canCollectReferences && canAddMore && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    trackReferenceModalOpen('list_cta')
                    setInternalAddOpen(true)
                  }}
                  className="w-full rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Reference
                  <span className="ml-1 text-xs font-normal text-emerald-600/80">
                    ({maxReferences - acceptedCount} of {maxReferences} spots left)
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* ─── Reference requests ─── */}
      {canCollectReferences && (
        <section
          data-testid="community-references-requests"
          className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
        >
          <header className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Reference requests</h2>
              <p className="mt-0.5 text-xs text-gray-500">People asking you to vouch for them.</p>
            </div>
            {incomingRequests.length > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 flex-shrink-0">
                {incomingRequests.length}
              </span>
            )}
          </header>

          {loading ? (
            <SkeletonRows />
          ) : incomingRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
              <p className="text-sm text-gray-500">No new requests right now.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {incomingRequests.map((request) => {
                const requester = request.requesterProfile
                const fullName = requester?.fullName ?? 'HOCKIA Member'
                return (
                  <li
                    key={request.id}
                    className="rounded-xl border border-amber-100 bg-amber-50/30 p-3 md:p-4"
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => openProfile(requester?.id ?? null, requester?.role)}
                        className="flex-shrink-0"
                        aria-label={`Open ${fullName}'s profile`}
                      >
                        <Avatar
                          src={requester?.avatarUrl}
                          initials={fullName.slice(0, 2)}
                          alt={fullName}
                          size="md"
                          role={requester?.role}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openProfile(requester?.id ?? null, requester?.role)}
                            className="font-semibold text-sm text-gray-900 hover:text-[#8026FA] transition-colors truncate text-left"
                          >
                            {fullName}
                          </button>
                          {requester?.role && (
                            <RoleBadge
                              role={requester.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'}
                            />
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-600 truncate">
                          {formatRelationshipType(request.relationshipType)}
                        </p>
                        {request.requestNote && (
                          <p className="mt-2 text-xs italic text-gray-600 line-clamp-2">
                            “{request.requestNote}”
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEndorsementRequest(request)}
                        disabled={isMutating('respond', request.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Accept & endorse
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeclineRequest(request.id)}
                        disabled={isMutating('respond', request.id)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                        Decline
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {/* ─── References you gave ─── */}
      <section
        data-testid="community-references-given"
        className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div>
            {/* Coach framing — for coaches this section IS the
                "recommended by" social-proof signal that matters for
                recruitment. Players see the generic "References you
                gave" framing. */}
            <h2 className="text-base font-semibold text-gray-900">
              {profileRole === 'coach' ? 'Players you recommend' : 'References you gave'}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {profileRole === 'coach'
                ? `Endorsements you wrote that appear on the players' profiles — your coaching social proof. Not counted toward your ${maxReferences} above.`
                : `Endorsements you wrote that appear on other members' profiles — not counted toward your ${maxReferences} above.`}
            </p>
          </div>
          {givenReferences.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 flex-shrink-0">
              {givenReferences.length}
            </span>
          )}
        </header>

        {loading ? (
          <SkeletonRows />
        ) : givenReferences.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
            <p className="text-sm text-gray-500">You haven't endorsed anyone yet.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {givenReferences.map((reference) => {
              const requester = reference.requesterProfile
              const fullName = requester?.fullName ?? 'HOCKIA Member'
              const hasEndorsement = Boolean(reference.endorsementText)
              return (
                <li
                  key={reference.id}
                  className="rounded-xl border border-gray-100 bg-white p-3 md:p-4 hover:bg-gray-50/40 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => openProfile(requester?.id ?? null, requester?.role)}
                      className="flex-shrink-0"
                      aria-label={`Open ${fullName}'s profile`}
                    >
                      <Avatar
                        src={requester?.avatarUrl}
                        initials={fullName.slice(0, 2)}
                        alt={fullName}
                        size="md"
                        role={requester?.role}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openProfile(requester?.id ?? null, requester?.role)}
                          className="font-semibold text-sm text-gray-900 hover:text-[#8026FA] transition-colors truncate text-left"
                        >
                          {fullName}
                        </button>
                        {requester?.role && (
                          <RoleBadge
                            role={requester.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'}
                          />
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            hasEndorsement
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {hasEndorsement ? 'Endorsed' : 'No endorsement'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600 truncate">
                        {formatRelationshipType(reference.relationshipType)}
                      </p>
                      {hasEndorsement && (
                        <p className="mt-2 text-xs text-gray-600 line-clamp-2">
                          “{reference.endorsementText}”
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          type="button"
                          onClick={() => setEditingReference(reference)}
                          disabled={isMutating('edit', reference.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                        >
                          <Pencil className="h-3 w-3" />
                          {hasEndorsement ? 'Edit endorsement' : 'Add endorsement'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openWithdrawConfirm(reference.id, fullName)}
                          disabled={isMutating('withdraw', reference.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Withdraw
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Modals */}
      {canCollectReferences && (
        <AddReferenceModal
          isOpen={addModalOpen}
          onClose={() => {
            closeAddModal()
            setPreselectedFriendId(null)
          }}
          friends={availableFriends}
          onSubmit={requestReference}
          isSubmitting={isMutating('request')}
          remainingSlots={maxReferences - acceptedCount}
          requesterRole={profileRole}
          preselectedFriendId={preselectedFriendId}
        />
      )}

      <ReferenceEndorsementModal
        isOpen={Boolean(endorsementRequest)}
        onClose={() => setEndorsementRequest(null)}
        onSubmit={handleAcceptRequest}
        loading={endorsementRequest ? isMutating('respond', endorsementRequest.id) : false}
        requesterName={endorsementRequest?.requesterProfile?.fullName ?? 'this member'}
        relationshipType={endorsementRequest?.relationshipType ?? ''}
        requestNote={endorsementRequest?.requestNote}
      />

      <ReferenceEndorsementModal
        isOpen={Boolean(editingReference)}
        onClose={() => setEditingReference(null)}
        onSubmit={handleEditEndorsement}
        loading={editingReference ? isMutating('edit', editingReference.id) : false}
        requesterName={editingReference?.requesterProfile?.fullName ?? 'this member'}
        relationshipType={editingReference?.relationshipType ?? ''}
        existingEndorsement={editingReference?.endorsementText}
        mode="edit"
      />

      <ConfirmActionModal
        isOpen={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={executeConfirm}
        title={confirmState?.headline ?? ''}
        description={confirmState?.description}
        confirmLabel={confirmState?.mode === 'remove' ? 'Remove reference' : 'Withdraw endorsement'}
        confirmTone={confirmState?.mode === 'remove' ? 'danger' : 'primary'}
        confirmLoading={confirmLoading}
        loadingLabel="Working..."
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="space-y-2.5">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/60 animate-pulse"
        >
          <div className="h-10 w-10 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 bg-gray-200 rounded" />
            <div className="h-3 w-24 bg-gray-100 rounded" />
            <div className="h-3 w-full bg-gray-100 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SelectedEmptyState({
  canCollect,
  canAddMore,
  onAddReference,
}: {
  canCollect: boolean
  canAddMore: boolean
  onAddReference: () => void
}) {
  if (!canCollect) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-6 text-center">
        <p className="text-sm text-gray-500">No trusted references yet.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-6 text-center">
      <ShieldCheck className="mx-auto h-7 w-7 text-emerald-500" aria-hidden="true" />
      <p className="mt-2 text-sm font-semibold text-gray-900">No references yet</p>
      <p className="mt-1 text-xs text-gray-600">
        Ask coaches, teammates, and clubs to vouch for you. Each one strengthens your profile.
      </p>
      {canAddMore && (
        <button
          type="button"
          onClick={onAddReference}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Reference
        </button>
      )}
    </div>
  )
}
