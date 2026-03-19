import { useMemo, useState, useRef, useCallback } from 'react'
import { format } from 'date-fns'
import { ShieldCheck, Plus, Clock3, AlertTriangle } from 'lucide-react'
import { logger } from '@/lib/logger'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import TrustedReferenceCard from './TrustedReferenceCard'
import ConfirmActionModal from './ConfirmActionModal'
import AddReferenceModal, { type ReferenceFriendOption } from './AddReferenceModal'
import ReferenceEndorsementModal from './ReferenceEndorsementModal'
import InfoTooltip from './InfoTooltip'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import type { Profile } from '@/lib/supabase'

interface TrustedReferencesSectionProps {
  profileId: string
  friendOptions: ReferenceFriendOption[]
  profileRole?: Profile['role'] | null
  /** When true, hides owner-only features (for Public View mode) */
  readOnly?: boolean
}

type ConfirmState = {
  mode: 'remove' | 'withdraw'
  referenceId: string
  headline: string
  description: string
}

const TRUSTED_REFERENCES_GUIDE = (
  <div className="space-y-2 text-sm text-gray-100">
    <p className="font-semibold text-white">How trusted references work</p>
    <ul className="list-disc space-y-1 pl-4 text-gray-200">
      <li>Choose up to five trusted people from your connections.</li>
      <li>References must accept your request before they appear.</li>
      <li>Each reference can add an endorsement to your profile.</li>
      <li>Clubs and coaches can contact them in one click.</li>
    </ul>
  </div>
)

export default function TrustedReferencesSection({ profileId, friendOptions, profileRole, readOnly = false }: TrustedReferencesSectionProps) {
  const {
    loading,
    isOwner: isActualOwner,
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
  } = useTrustedReferences(profileId)

  // In readOnly mode, treat as non-owner even if viewing own profile
  const isOwner = !readOnly && isActualOwner

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [endorsementRequest, setEndorsementRequest] = useState<typeof incomingRequests[number] | null>(null)
  const [editingReference, setEditingReference] = useState<typeof givenReferences[number] | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [messageTarget, setMessageTarget] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const navigate = useNavigate()
  const dismissNotification = useNotificationStore((state) => state.dismissBySource)
  const allowedRequesterRoles: Profile['role'][] = ['player', 'coach']
  const canCollectReferences = isOwner && !!profileRole && allowedRequesterRoles.includes(profileRole)

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || container.children.length === 0) return
    const containerCenter = container.scrollLeft + container.clientWidth / 2
    let closestIdx = 0
    let closestDist = Infinity
    for (let i = 0; i < container.children.length; i++) {
      const card = container.children[i] as HTMLElement
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const dist = Math.abs(cardCenter - containerCenter)
      if (dist < closestDist) {
        closestDist = dist
        closestIdx = i
      }
    }
    setActiveIndex(closestIdx)
  }, [])

  const availableFriends = useMemo(() => {
    if (!canCollectReferences) return []
    const excludedIds = new Set<string>()
    acceptedReferences.forEach((ref) => {
      if (ref.profile?.id) excludedIds.add(ref.profile.id)
    })
    pendingReferences.forEach((ref) => {
      if (ref.profile?.id) excludedIds.add(ref.profile.id)
    })
    return friendOptions.filter((friend) => !excludedIds.has(friend.id))
  }, [acceptedReferences, pendingReferences, friendOptions, canCollectReferences])

  const handleMessage = async (targetId: string | null) => {
    if (!targetId) return
    if (!user) {
      addToast('Sign in to message references.', 'info')
      navigate('/')
      return
    }

    setMessageTarget(targetId)
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${targetId}),and(participant_one_id.eq.${targetId},participant_two_id.eq.${user.id})`
        )
        .maybeSingle()

      if (error) throw error

      if (data?.id) {
        navigate(`/messages?conversation=${data.id}`)
      } else {
        navigate(`/messages?new=${targetId}`)
      }
    } catch (error) {
      logger.error('Failed to open messages', error)
      addToast('Unable to start conversation. Please try again.', 'error')
    } finally {
      setMessageTarget(null)
    }
  }

  const handleOpenReferenceProfile = (targetId: string | null, role?: string | null) => {
    if (!targetId) return
    if (role === 'club') {
      navigate(`/clubs/id/${targetId}`)
    } else {
      navigate(`/players/id/${targetId}`)
    }
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
    if (success) {
      dismissNotification('reference_request_received', requestId)
    }
  }

  const openRemoveConfirm = (referenceId: string, referenceName: string) => {
    setConfirmState({
      mode: 'remove',
      referenceId,
      headline: 'Remove trusted reference',
      description: `This will remove ${referenceName} from your trusted references. You can always invite them again later.`,
    })
  }

  const handleEditEndorsement = async (endorsement: string | null) => {
    if (!editingReference) return false
    const success = await editEndorsement(editingReference.id, endorsement)
    if (success) {
      setEditingReference(null)
    }
    return success
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
    const success = mode === 'remove'
      ? await removeReference(referenceId)
      : await withdrawReference(referenceId)
    if (success) {
      setConfirmState(null)
      void refresh()
    }
  }

  const confirmLoading = confirmState ? isMutating(confirmState.mode, confirmState.referenceId) : false

  if (!profileId) return null

  if (!isOwner) {
    return (
      <section className="space-y-5 rounded-3xl border border-gray-100 bg-white/80 p-6 shadow-sm shadow-gray-100">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Trusted References</p>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900">Key people who vouch for this profile</h2>
              <InfoTooltip label="How trusted references work" alignment="start">
                {TRUSTED_REFERENCES_GUIDE}
              </InfoTooltip>
            </div>
            <p className="text-sm text-gray-600">Message anyone to learn more.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {acceptedReferences.length}/{maxReferences} selected
          </span>
        </header>

        {loading ? (
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none]">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="min-w-[220px] flex-shrink-0 rounded-2xl border border-gray-100 bg-gray-50 p-4 shadow-sm animate-pulse">
                <div className="mb-4 h-4 w-2/3 rounded bg-gray-200" />
                <div className="h-3 w-full rounded bg-gray-100" />
                <div className="mt-2 h-3 w-3/4 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : acceptedReferences.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white/90 p-5 text-center">
            <p className="text-sm text-gray-600">No trusted references yet. This user hasn&apos;t added any references on HOCKIA.</p>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 snap-x snap-mandatory scroll-smooth scrollbar-hide [scrollbar-width:none]"
            >
              {acceptedReferences.map((reference) => (
                <TrustedReferenceCard
                  key={reference.id}
                  reference={reference}
                  onMessage={handleMessage}
                  messageLoading={messageTarget === reference.profile?.id}
                  layout="carousel"
                  endorsementFallback="No written endorsement yet."
                  onOpenProfile={handleOpenReferenceProfile}
                  className="snap-center"
                />
              ))}
            </div>
            {acceptedReferences.length > 1 && (
              <div className="mt-3 flex justify-center gap-2 md:hidden">
                {acceptedReferences.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`Go to reference ${idx + 1}`}
                    onClick={() => {
                      const container = scrollRef.current
                      const card = container?.children[idx] as HTMLElement | undefined
                      if (container && card) {
                        container.scrollTo({ left: card.offsetLeft - 4, behavior: 'smooth' })
                      }
                    }}
                    className={cn(
                      'rounded-full transition-all duration-200',
                      idx === activeIndex
                        ? 'h-2 w-5 bg-emerald-500'
                        : 'h-2 w-2 bg-gray-300'
                    )}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-3xl border border-gray-100 bg-white/80 p-6 shadow-sm shadow-gray-100">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Trusted References</p>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900">Key people who vouch for you</h2>
            <InfoTooltip label="How trusted references work" alignment="start">
              {TRUSTED_REFERENCES_GUIDE}
            </InfoTooltip>
          </div>
          {canCollectReferences ? (
            <p className="text-sm text-gray-600">{acceptedCount}/{maxReferences} references selected</p>
          ) : (
            <p className="text-sm text-gray-600">This role can respond to requests but cannot send new ones.</p>
          )}
        </div>
        {canCollectReferences && canAddMore && (
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30"
          >
            <Plus className="h-4 w-4" />
            Add Reference
          </button>
        )}
      </header>

      {canCollectReferences && pendingReferences.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50/80 p-4">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm font-semibold">
              {pendingReferences.length === 1
                ? '1 reference request waiting for approval'
                : `${pendingReferences.length} reference requests waiting for approval`}
            </p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {pendingReferences.map((pending) => (
              <div key={pending.id} className="flex items-center gap-3 rounded-2xl border border-amber-100 bg-white/70 px-4 py-3">
                <Avatar
                  src={pending.profile?.avatarUrl}
                  initials={pending.profile?.fullName?.slice(0, 2) ?? '?'}
                  alt={pending.profile?.fullName ?? 'Reference'}
                  size="sm"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{pending.profile?.fullName ?? 'HOCKIA Member'}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <RoleBadge role={pending.profile?.role ?? undefined} />
                    <span>{pending.relationshipType}</span>
                    {pending.createdAt && (
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {format(new Date(pending.createdAt), 'MMM d, yyyy')}
                      </span>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Pending</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Trusted contacts ({acceptedCount}/{maxReferences})</h3>
          {!isOwner && <p className="text-sm text-gray-500">Message anyone to learn more.</p>}
        </div>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-3 snap-x snap-mandatory scroll-smooth scrollbar-hide [scrollbar-width:none] sm:mx-0 sm:px-0"
        >
          {loading && acceptedReferences.length === 0 ? (
            Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="min-w-[280px] flex-shrink-0 rounded-2xl border border-gray-100 bg-gray-50 p-4 shadow-sm animate-pulse">
                <div className="mb-4 h-4 w-1/2 rounded bg-gray-200" />
                <div className="mb-2 h-3 w-3/4 rounded bg-gray-200" />
                <div className="h-24 rounded-xl bg-gray-200" />
              </div>
            ))
          ) : acceptedReferences.length === 0 ? (
            <div className="min-w-full rounded-2xl border border-dashed border-gray-200 bg-white/80 p-4 text-center text-sm text-gray-500">
              {canCollectReferences
                ? 'No trusted references yet. Send a request to get started.'
                : 'You do not have any trusted references selected.'}
            </div>
          ) : (
            <>
              {acceptedReferences.map((reference) => (
                <TrustedReferenceCard
                  key={reference.id}
                  reference={reference}
                  onMessage={handleMessage}
                  messageLoading={messageTarget === reference.profile?.id}
                  layout="carousel"
                  endorsementFallback="No endorsement added yet."
                  onOpenProfile={handleOpenReferenceProfile}
                  className="snap-center"
                  secondaryAction={(
                    <button
                      type="button"
                      onClick={() => openRemoveConfirm(reference.id, reference.profile?.fullName ?? 'this reference')}
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  )}
                />
              ))}
              {canCollectReferences && canAddMore && (
                <button
                  type="button"
                  onClick={() => setAddModalOpen(true)}
                  className="min-w-[260px] flex-shrink-0 snap-center rounded-3xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-5 text-center text-emerald-700"
                >
                  <Plus className="mx-auto mb-2 h-6 w-6" />
                  <p className="font-semibold">Add Reference</p>
                  <p className="text-sm">{maxReferences - acceptedCount} spots left</p>
                </button>
              )}
            </>
          )}
        </div>
        {acceptedReferences.length > 1 && (
          <div className="mt-3 flex justify-center gap-2 md:hidden">
            {acceptedReferences.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Go to reference ${idx + 1}`}
                onClick={() => {
                  const container = scrollRef.current
                  const card = container?.children[idx] as HTMLElement | undefined
                  if (container && card) {
                    container.scrollTo({ left: card.offsetLeft - 8, behavior: 'smooth' })
                  }
                }}
                className={cn(
                  'rounded-full transition-all duration-200',
                  idx === activeIndex
                    ? 'h-2 w-5 bg-emerald-500'
                    : 'h-2 w-2 bg-gray-300'
                )}
              />
            ))}
          </div>
        )}
      </div>

      {isOwner && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-gray-100 bg-gray-50/60 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Reference requests</h3>
              <span className="text-sm text-gray-500">{incomingRequests.length} pending</span>
            </div>
            {incomingRequests.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">No new requests right now.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {incomingRequests.map((request) => (
                  <div key={request.id} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={request.requesterProfile?.avatarUrl}
                        initials={request.requesterProfile?.fullName?.slice(0, 2) ?? '?'}
                        alt={request.requesterProfile?.fullName ?? 'Player'}
                        size="sm"
                      />
                      <div>
                        <p className="font-semibold text-gray-900">{request.requesterProfile?.fullName ?? 'HOCKIA Member'}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <RoleBadge role={request.requesterProfile?.role ?? undefined} />
                          <span>{request.relationshipType}</span>
                        </div>
                      </div>
                    </div>
                    {request.requestNote && (
                      <p className="mt-3 rounded-2xl bg-gray-50 p-3 text-sm text-gray-600">“{request.requestNote}”</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEndorsementRequest(request)}
                        className="flex-1 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-emerald-500/40"
                        disabled={isMutating('respond', request.id)}
                      >
                        {isMutating('respond', request.id) && endorsementRequest?.id === request.id ? 'Processing…' : 'Accept & endorse'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeclineRequest(request.id)}
                        disabled={isMutating('respond', request.id)}
                        className="flex-1 rounded-2xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-gray-100 bg-gray-50/60 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">References you gave</h3>
              <span className="text-sm text-gray-500">{givenReferences.length}</span>
            </div>
            {givenReferences.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">You haven’t endorsed anyone yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {givenReferences.map((reference) => (
                  <div key={reference.id} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={reference.requesterProfile?.avatarUrl}
                        initials={reference.requesterProfile?.fullName?.slice(0, 2) ?? '?'}
                        alt={reference.requesterProfile?.fullName ?? 'Player'}
                        size="sm"
                      />
                      <div>
                        <p className="font-semibold text-gray-900">{reference.requesterProfile?.fullName ?? 'HOCKIA Member'}</p>
                        <p className="text-xs text-gray-500">{reference.relationshipType}</p>
                      </div>
                    </div>
                    {reference.endorsementText && (
                      <p className="mt-3 text-sm text-gray-600">“{reference.endorsementText}”</p>
                    )}
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingReference(reference)}
                        className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                        disabled={isMutating('edit', reference.id)}
                      >
                        {reference.endorsementText ? 'Edit' : 'Add endorsement'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openWithdrawConfirm(reference.id, reference.requesterProfile?.fullName ?? 'this player')}
                        className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                        disabled={isMutating('withdraw', reference.id)}
                      >
                        {isMutating('withdraw', reference.id) ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {canCollectReferences && (
        <AddReferenceModal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          friends={availableFriends}
          onSubmit={requestReference}
          isSubmitting={isMutating('request')}
          remainingSlots={maxReferences - acceptedCount}
          requesterRole={profileRole}
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
    </section>
  )
}
