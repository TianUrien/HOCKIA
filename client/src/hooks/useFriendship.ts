import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import {
  type FriendEdge,
  getFriendshipEdgeState,
  loadFriendshipEdges,
  subscribeFriendshipEdges,
} from '@/hooks/friendshipEdgeCache'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { extractErrorMessage } from '@/lib/utils'
import { trackDbEvent } from '@/lib/trackDbEvent'

type FriendStatus = Database['public']['Enums']['friendship_status']

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
  const [, forceRender] = useState(0)
  const [mutating, setMutating] = useState(false)

  const isAuthenticated = Boolean(viewerId)
  const isOwnProfile = Boolean(viewerId && viewerId === profileId)

  const { ready: cacheReady, edges } = getFriendshipEdgeState(viewerId)

  // Subscribe to shared-cache updates; kick the shared fetch on mount.
  useEffect(() => {
    const unsubscribe = subscribeFriendshipEdges(() => forceRender((n) => n + 1))
    if (viewerId && !isOwnProfile) {
      void loadFriendshipEdges(viewerId)
      // The shared fetch can resolve between this card's render and the
      // effect flush — before the listener above existed. Re-render if the
      // cache state moved in that gap so the card can't strand on loading.
      if (getFriendshipEdgeState(viewerId).ready !== cacheReady) {
        forceRender((n) => n + 1)
      }
    }
    return unsubscribe
  }, [viewerId, isOwnProfile, cacheReady])

  const relationship: FriendEdge | null =
    viewerId && !isOwnProfile && cacheReady ? (edges?.get(profileId) ?? null) : null
  const loading = Boolean(viewerId && !isOwnProfile && !cacheReady)

  const status = relationship?.status ?? null
  const isFriend = status === 'accepted'
  const isPending = status === 'pending'
  const isOutgoingRequest = Boolean(isPending && relationship?.requester_id === viewerId)
  const isIncomingRequest = Boolean(isPending && relationship?.requester_id !== viewerId)

  const fetchRelationship = useCallback(async () => {
    if (!viewerId || isOwnProfile) return
    await loadFriendshipEdges(viewerId, true)
  }, [viewerId, isOwnProfile])

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
      trackDbEvent('friend_request_send', 'friendship', profileId)
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
        trackDbEvent('friend_request_update', 'friendship', friendshipId, { status: nextStatus })
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
        // A rejected transition usually means the cached edge is stale
        // (accepted from the notifications panel, another device...) —
        // refetch so the card self-heals instead of looping the error.
        void fetchRelationship()
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
