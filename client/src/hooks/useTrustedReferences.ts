import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Json } from '@/lib/database.types'
import type { Database } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { tMedia } from '@/i18n/ns/media'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { extractErrorMessage } from '@/lib/utils'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackReferenceRequestSent, trackReferenceRequestResponded } from '@/lib/analytics'

const MAX_REFERENCES = 5 as const

export type ReferenceStatus = Database['public']['Enums']['profile_reference_status']

type MyReferenceRow = Database['public']['Functions']['get_my_references']['Returns'][number]
type ReferenceRequestRow = Database['public']['Functions']['get_my_reference_requests']['Returns'][number]
type GivenReferenceRow = Database['public']['Functions']['get_references_i_gave']['Returns'][number]
type PublicReferenceRow = Database['public']['Functions']['get_profile_references']['Returns'][number]

type ProfileSummary = {
  id: string
  fullName: string | null
  role: string | null
  username: string | null
  avatarUrl: string | null
  baseLocation: string | null
  position: string | null
  currentClub: string | null
  nationalityCountryId: number | null
  nationality2CountryId: number | null
}

export type ReferenceCard = {
  id: string
  relationshipType: string
  requestNote: string | null
  endorsementText: string | null
  status: ReferenceStatus
  createdAt: string
  respondedAt: string | null
  acceptedAt: string | null
  profile: ProfileSummary | null
}

export type PublicReferenceCard = {
  id: string
  relationshipType: string
  endorsementText: string | null
  acceptedAt: string | null
  profile: ProfileSummary | null
}

export type IncomingReferenceRequest = {
  id: string
  relationshipType: string
  requestNote: string | null
  createdAt: string
  requesterProfile: ProfileSummary | null
}

export type GivenReference = {
  id: string
  relationshipType: string
  endorsementText: string | null
  acceptedAt: string | null
  requesterProfile: ProfileSummary | null
}

type MutationType = 'request' | 'respond' | 'remove' | 'withdraw' | 'edit'

type MutationState = {
  type: MutationType | null
  targetId: string | null
}

const initialMutation: MutationState = { type: null, targetId: null }

const parseProfile = (value: Json | null): ProfileSummary | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, Json>
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null

  return {
    id,
    fullName: typeof record.full_name === 'string' ? record.full_name : null,
    role: typeof record.role === 'string' ? record.role : null,
    username: typeof record.username === 'string' ? record.username : null,
    avatarUrl: typeof record.avatar_url === 'string' ? record.avatar_url : null,
    baseLocation: typeof record.base_location === 'string' ? record.base_location : null,
    position: typeof record.position === 'string' ? record.position : null,
    currentClub: typeof record.current_club === 'string' ? record.current_club : null,
    nationalityCountryId: typeof record.nationality_country_id === 'number' ? record.nationality_country_id : null,
    nationality2CountryId: typeof record.nationality2_country_id === 'number' ? record.nationality2_country_id : null,
  }
}

const mapMyReference = (row: MyReferenceRow): ReferenceCard => ({
  id: row.id,
  relationshipType: row.relationship_type,
  requestNote: row.request_note,
  endorsementText: row.endorsement_text,
  status: row.status,
  createdAt: row.created_at,
  respondedAt: row.responded_at,
  acceptedAt: row.accepted_at,
  profile: parseProfile((row.reference_profile ?? null) as Json | null),
})

const mapPublicReference = (row: PublicReferenceRow): PublicReferenceCard => ({
  id: row.id,
  relationshipType: row.relationship_type,
  endorsementText: row.endorsement_text,
  acceptedAt: row.accepted_at,
  profile: parseProfile((row.reference_profile ?? null) as Json | null),
})

const mapIncomingRequest = (row: ReferenceRequestRow): IncomingReferenceRequest => ({
  id: row.id,
  relationshipType: row.relationship_type,
  requestNote: row.request_note,
  createdAt: row.created_at,
  requesterProfile: parseProfile((row.requester_profile ?? null) as Json | null),
})

const mapGivenReference = (row: GivenReferenceRow): GivenReference => ({
  id: row.id,
  relationshipType: row.relationship_type,
  endorsementText: row.endorsement_text,
  acceptedAt: row.accepted_at,
  requesterProfile: parseProfile((row.requester_profile ?? null) as Json | null),
})

export function useTrustedReferences(profileId: string) {
  const { profile: authProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const isOwner = authProfile?.id === profileId

  const [myReferences, setMyReferences] = useState<ReferenceCard[]>([])
  const [publicReferences, setPublicReferences] = useState<PublicReferenceCard[]>([])
  const [incomingRequests, setIncomingRequests] = useState<IncomingReferenceRequest[]>([])
  const [givenReferences, setGivenReferences] = useState<GivenReference[]>([])
  const [loading, setLoading] = useState(true)
  const [mutation, setMutation] = useState<MutationState>(initialMutation)

  const resetState = useCallback(() => {
    setMyReferences([])
    setPublicReferences([])
    setIncomingRequests([])
    setGivenReferences([])
  }, [])

  const fetchReferences = useCallback(async (signal?: AbortSignal) => {
    if (!profileId) {
      resetState()
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      if (isOwner) {
        const [myRefsRes, incomingRes, givenRes] = await Promise.all([
          supabase.rpc('get_my_references'),
          supabase.rpc('get_my_reference_requests'),
          supabase.rpc('get_references_i_gave')
        ])

        // Don't update state if cancelled
        if (signal?.aborted) return

        if (myRefsRes.error) throw myRefsRes.error
        if (incomingRes.error) throw incomingRes.error
        if (givenRes.error) throw givenRes.error

        setMyReferences((myRefsRes.data ?? []).map(mapMyReference))
        setIncomingRequests((incomingRes.data ?? []).map(mapIncomingRequest))
        setGivenReferences((givenRes.data ?? []).map(mapGivenReference))
        setPublicReferences([])
      } else {
        const { data, error } = await supabase.rpc('get_profile_references', {
          p_profile_id: profileId,
        })

        // Don't update state if cancelled
        if (signal?.aborted) return

        if (error) throw error
        setPublicReferences((data ?? []).map(mapPublicReference))
        setMyReferences([])
        setIncomingRequests([])
        setGivenReferences([])
      }
    } catch (error) {
      // Don't show error toast if cancelled
      if (signal?.aborted) return
      logger.error('Failed to load references', error)
      addToast(tMedia('references.toasts.loadFailed'), 'error')
      resetState()
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [profileId, isOwner, addToast, resetState])

  useEffect(() => {
    const abortController = new AbortController()
    void fetchReferences(abortController.signal)
    
    return () => {
      abortController.abort()
    }
  }, [fetchReferences])

  const acceptedReferences = useMemo(() => {
    if (isOwner) {
      return myReferences.filter((item) => item.status === 'accepted')
    }
    return publicReferences
  }, [isOwner, myReferences, publicReferences])

  const pendingReferences = useMemo(() => {
    if (!isOwner) return []
    return myReferences.filter((item) => item.status === 'pending')
  }, [isOwner, myReferences])

  const acceptedCount = acceptedReferences.length

  const canAddMore = isOwner && acceptedCount < MAX_REFERENCES

  const setMutating = (type: MutationType | null, targetId: string | null = null) => {
    setMutation({ type, targetId })
  }

  const requestReference = useCallback(
    async (params: { referenceId: string; relationshipType: string; requestNote?: string | null }) => {
      if (!isOwner) return false
      if (!params.referenceId) {
        addToast(tMedia('references.toasts.selectConnection'), 'error')
        return false
      }

      if (!canAddMore) {
        addToast(tMedia('references.toasts.maxReached'), 'info')
        return false
      }

      setMutating('request', params.referenceId)
      try {
        const { error } = await supabase.rpc('request_reference', {
          p_reference_id: params.referenceId,
          p_relationship_type: params.relationshipType,
          p_request_note: params.requestNote ?? undefined,
        })

        if (error) throw error
        trackDbEvent('reference_request', 'reference', params.referenceId, { relationship_type: params.relationshipType })
        trackReferenceRequestSent(authProfile?.role ?? 'unknown', params.relationshipType)
        addToast(tMedia('references.toasts.requestSent'), 'success')
        await fetchReferences()
        return true
      } catch (error) {
        logger.error('Failed to send reference request', error)
        addToast(extractErrorMessage(error, tMedia('references.toasts.requestFailed')), 'error')
        return false
      } finally {
        setMutating(null)
      }
    },
    [isOwner, canAddMore, addToast, fetchReferences, authProfile?.role]
  )

  const respondToRequest = useCallback(
    async (params: { referenceId: string; accept: boolean; endorsement?: string | null }) => {
      setMutating('respond', params.referenceId)
      try {
        const { error } = await supabase.rpc('respond_reference', {
          p_reference_id: params.referenceId,
          p_accept: params.accept,
          p_endorsement: params.endorsement ?? undefined,
        })

        if (error) throw error
        trackDbEvent('reference_respond', 'reference', params.referenceId, { accepted: params.accept })
        trackReferenceRequestResponded(params.accept ? 'accept' : 'decline')
        addToast(params.accept ? tMedia('references.toasts.accepted') : tMedia('references.toasts.declined'), 'success')
        await fetchReferences()
        return true
      } catch (error) {
        logger.error('Failed to respond to reference request', error)
        addToast(extractErrorMessage(error, tMedia('references.toasts.respondFailed')), 'error')
        // Refetch on error too — the bug-bundle migration's friendship-lost
        // re-check (#4a) means the request can fail because the requester is
        // no longer a friend. Without a refetch the now-orphaned pending row
        // sits in the UI as a ghost the user can never resolve. Reload the
        // truth from the server on every error path.
        try {
          await fetchReferences()
        } catch (refetchError) {
          logger.error('Refetch after respond_reference error also failed', refetchError)
        }
        return false
      } finally {
        setMutating(null)
      }
    },
    [addToast, fetchReferences]
  )

  const removeReference = useCallback(
    async (referenceId: string) => {
      if (!isOwner) return false
      setMutating('remove', referenceId)
      try {
        const { error } = await supabase.rpc('remove_reference', { p_reference_id: referenceId })
        if (error) throw error
        trackDbEvent('reference_remove', 'reference', referenceId)
        addToast(tMedia('references.toasts.removed'), 'success')
        await fetchReferences()
        return true
      } catch (error) {
        logger.error('Failed to remove reference', error)
        addToast(extractErrorMessage(error, tMedia('references.toasts.removeFailed')), 'error')
        return false
      } finally {
        setMutating(null)
      }
    },
    [isOwner, addToast, fetchReferences]
  )

  const withdrawReference = useCallback(
    async (referenceId: string) => {
      setMutating('withdraw', referenceId)
      try {
        const { error } = await supabase.rpc('withdraw_reference', { p_reference_id: referenceId })
        if (error) throw error
        trackDbEvent('reference_withdraw', 'reference', referenceId)
        addToast(tMedia('references.toasts.withdrawn'), 'success')
        await fetchReferences()
        return true
      } catch (error) {
        logger.error('Failed to withdraw reference', error)
        addToast(extractErrorMessage(error, tMedia('references.toasts.withdrawFailed')), 'error')
        return false
      } finally {
        setMutating(null)
      }
    },
    [addToast, fetchReferences]
  )

  const editEndorsement = useCallback(
    async (referenceId: string, endorsement: string | null) => {
      setMutating('edit', referenceId)
      try {
        const { error } = await supabase.rpc('edit_endorsement', {
          p_reference_id: referenceId,
          p_endorsement: endorsement ?? '',
        })

        if (error) throw error
        trackDbEvent('reference_edit', 'reference', referenceId)
        addToast(tMedia('references.toasts.endorsementUpdated'), 'success')
        await fetchReferences()
        return true
      } catch (error) {
        logger.error('Failed to edit endorsement', error)
        addToast(extractErrorMessage(error, tMedia('references.toasts.endorsementFailed')), 'error')
        return false
      } finally {
        setMutating(null)
      }
    },
    [addToast, fetchReferences]
  )

  const isMutating = useCallback(
    (type: MutationType, targetId?: string) => {
      if (mutation.type !== type) return false
      if (!targetId) return mutation.type === type
      return mutation.targetId === targetId
    },
    [mutation]
  )

  return {
    loading,
    isOwner,
    acceptedReferences,
    pendingReferences,
    incomingRequests,
    givenReferences,
    acceptedCount,
    maxReferences: MAX_REFERENCES,
    canAddMore,
    requestReference,
    respondToRequest,
    removeReference,
    withdrawReference,
    editEndorsement,
    refresh: fetchReferences,
    isMutating,
  }
}
