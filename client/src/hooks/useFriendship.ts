import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { extractErrorMessage } from '@/lib/utils'

type FriendStatus = Database['public']['Enums']['friendship_status']
type FriendEdge = Database['public']['Views']['profile_friend_edges']['Row']

type FriendshipState = {
  loading: boolean
  mutating: boolean
  isAuthenticated: boolean
  isOwnProfile: boolean
  relationship: FriendEdge | null
  status: FriendStatus | null
  isFriend: boolean
  isIncomingRequest: boolean
  isOutgoingRequest: boolean
  sendRequest: () => Promise<void>
  acceptRequest: () => Promise<void>
  rejectRequest: () => Promise<void>
  cancelRequest: () => Promise<void>
  removeFriend: () => Promise<void>
  refresh: () => Promise<void>
}

export function useFriendship(profileId: string): FriendshipState {
  const { profile: authProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const dismissNotification = useNotificationStore((state) => state.dismissBySource)
  const viewerId = authProfile?.id
  const [relationship, setRelationship] = useState<FriendEdge | null>(null)
  const [loading, setLoading] = useState(false)
  const [mutating, setMutating] = useState(false)

  const isAuthenticated = Boolean(viewerId)
  const isOwnProfile = Boolean(viewerId && viewerId === profileId)

  const status = relationship?.status ?? null
  const isFriend = status === 'accepted'
  const isPending = status === 'pending'
  const isOutgoingRequest = Boolean(isPending && relationship?.requester_id === viewerId)
  const isIncomingRequest = Boolean(isPending && relationship?.requester_id !== viewerId)

  const fetchRelationship = useCallback(async (signal?: AbortSignal) => {
    if (!viewerId || isOwnProfile) {
      setRelationship(null)
      setLoading(false)
      return
    }

    setLoading(true)
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'friendships.fetch_edge',
      data: { viewerId, profileId },
      level: 'info'
    })
    const { data, error } = await supabase
      .from('profile_friend_edges')
      .select('*')
      .eq('profile_id', viewerId)
      .eq('friend_id', profileId)
      .maybeSingle()

    // Don't update state if cancelled
    if (signal?.aborted) return

    if (error) {
      logger.error('Failed to fetch friendship state', error)
      reportSupabaseError('friends.fetch_state', error, { viewerId, profileId }, {
        feature: 'friends',
        operation: 'fetch_friendship'
      })
      addToast('Unable to load friendship status.', 'error')
      setRelationship(null)
    } else {
      setRelationship((data as FriendEdge | null) ?? null)
    }

    setLoading(false)
  }, [viewerId, profileId, isOwnProfile, addToast])

  useEffect(() => {
    setRelationship(null)
    if (!viewerId || isOwnProfile) return
    
    const abortController = new AbortController()
    void fetchRelationship(abortController.signal)
    
    return () => {
      abortController.abort()
    }
  }, [fetchRelationship, viewerId, isOwnProfile])

  const sendRequest = useCallback(async () => {
    if (!viewerId) {
      addToast('Sign in to connect with other members.', 'error')
      return
    }

    if (viewerId === profileId) {
      addToast('You cannot send a friend request to yourself.', 'error')
      return
    }

    if (isFriend) {
      addToast('You are already friends.', 'info')
      return
    }

    if (isOutgoingRequest) {
      addToast('Friend request already sent.', 'info')
      return
    }

    if (isIncomingRequest) {
      addToast('This member already sent you a request—check your notifications.', 'info')
      return
    }

    setMutating(true)
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'friendships.send_request',
        data: { viewerId, profileId },
        level: 'info'
      })
      const { error } = await supabase
        .from('profile_friendships')
        .upsert(
          {
            user_one: viewerId,
            user_two: profileId,
            requester_id: viewerId,
            status: 'pending' as FriendStatus,
            accepted_at: null,
          },
          { onConflict: 'pair_key_lower,pair_key_upper' }
        )

      if (error) throw error
      addToast('Friend request sent.', 'success')
      await fetchRelationship()
    } catch (error) {
      logger.error('Failed to send friend request', error)
      reportSupabaseError('friends.send_request', error, { viewerId, profileId }, {
        feature: 'friends',
        operation: 'send_request'
      })
      addToast(extractErrorMessage(error, 'Unable to send friend request. Please try again.'), 'error')
    } finally {
      setMutating(false)
    }
  }, [viewerId, profileId, addToast, fetchRelationship, isFriend, isOutgoingRequest, isIncomingRequest])

  const updateStatus = useCallback(
    async (nextStatus: FriendStatus, successMessage: string) => {
      if (!viewerId) {
        addToast('Sign in to manage connections.', 'error')
        return
      }

      if (!relationship || !relationship.id) {
        addToast('Friendship state not found.', 'error')
        return
      }

      setMutating(true)
      try {
        const friendshipId = relationship.id
        Sentry.addBreadcrumb({
          category: 'supabase',
          message: 'friendships.update_status',
          data: { friendshipId, nextStatus },
          level: 'info'
        })
        const { error } = await supabase
          .from('profile_friendships')
          .update({ status: nextStatus })
          .eq('id', friendshipId)

        if (error) throw error
        addToast(successMessage, 'success')
        dismissNotification('friend_request_received', friendshipId)
        await fetchRelationship()
      } catch (error) {
        logger.error('Failed to update friendship state', error)
        reportSupabaseError('friends.update_status', error, { friendshipId: relationship?.id, nextStatus }, {
          feature: 'friends',
          operation: 'update_friendship'
        })
        addToast(extractErrorMessage(error, 'Unable to update friendship. Please try again.'), 'error')
      } finally {
        setMutating(false)
      }
    },
    [viewerId, relationship, addToast, fetchRelationship, dismissNotification]
  )

  const acceptRequest = useCallback(async () => {
    if (!isIncomingRequest) {
      addToast('No incoming request to accept.', 'info')
      return
    }

    await updateStatus('accepted', 'Friend request accepted.')
  }, [isIncomingRequest, updateStatus, addToast])

  const rejectRequest = useCallback(async () => {
    if (!isIncomingRequest) {
      addToast('No incoming request to reject.', 'info')
      return
    }

    await updateStatus('rejected', 'Friend request declined.')
  }, [isIncomingRequest, updateStatus, addToast])

  const cancelRequest = useCallback(async () => {
    if (!isOutgoingRequest) {
      addToast('No pending request to cancel.', 'info')
      return
    }

    await updateStatus('cancelled', 'Friend request cancelled.')
  }, [isOutgoingRequest, updateStatus, addToast])

  const removeFriend = useCallback(async () => {
    if (!isFriend) {
      addToast('You are not connected yet.', 'info')
      return
    }

    await updateStatus('cancelled', 'Friend removed.')
  }, [isFriend, updateStatus, addToast])

  return useMemo(
    () => ({
      loading,
      mutating,
      isAuthenticated,
      isOwnProfile,
      relationship,
      status,
      isFriend,
      isIncomingRequest,
      isOutgoingRequest,
      sendRequest,
      acceptRequest,
      rejectRequest,
      cancelRequest,
      removeFriend,
      refresh: fetchRelationship,
    }),
    [
      loading,
      mutating,
      isAuthenticated,
      isOwnProfile,
      relationship,
      status,
      isFriend,
      isIncomingRequest,
      isOutgoingRequest,
      sendRequest,
      acceptRequest,
      rejectRequest,
      cancelRequest,
      removeFriend,
      fetchRelationship,
    ]
  )
}
