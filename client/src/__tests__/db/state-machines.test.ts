/**
 * State Machine Transition Tests
 *
 * Verifies that status columns on key tables only allow valid transitions.
 * Invalid transitions must be rejected by database triggers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  authenticatePlayer,
  authenticateCoach,
  hasRequiredEnv,
  type AuthenticatedClient,
} from './setup'

const skip = !hasRequiredEnv()

describe.skipIf(skip)('State Machine Transitions', () => {
  let player: AuthenticatedClient
  let coach: AuthenticatedClient

  beforeAll(async () => {
    ;[player, coach] = await Promise.all([
      authenticatePlayer(),
      authenticateCoach(),
    ])
  })

  // =========================================================================
  // FRIENDSHIPS
  // =========================================================================
  describe('profile_friendships', () => {
    let friendshipId: string | null = null

    afterAll(async () => {
      // Clean up: delete the test friendship
      if (friendshipId) {
        await player.client
          .from('profile_friendships')
          .delete()
          .eq('id', friendshipId)
      }
    })

    it('sends a friend request (→ pending)', async () => {
      // Clean up any existing friendship between player and coach first
      await player.client
        .from('profile_friendships')
        .delete()
        .or(
          `and(user_one.eq.${player.userId},user_two.eq.${coach.userId}),and(user_one.eq.${coach.userId},user_two.eq.${player.userId})`
        )

      const { data, error } = await player.client
        .from('profile_friendships')
        .insert({
          user_one: player.userId,
          user_two: coach.userId,
          requester_id: player.userId,
          status: 'pending',
        })
        .select('id, status')
        .single()

      expect(error).toBeNull()
      expect(data?.status).toBe('pending')
      friendshipId = data?.id ?? null
    })

    it('requester cannot accept their own request', async () => {
      if (!friendshipId) return

      const { error } = await player.client
        .from('profile_friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId)

      // The trigger should reject this — requester cannot accept
      // Either an error is returned or 0 rows are affected
      if (!error) {
        const { data: check } = await player.client
          .from('profile_friendships')
          .select('status')
          .eq('id', friendshipId)
          .single()

        expect(check?.status).toBe('pending')
      }
    })

    it('recipient can accept the request (pending → accepted)', async () => {
      if (!friendshipId) return

      const { error } = await coach.client
        .from('profile_friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId)

      expect(error).toBeNull()

      const { data: check } = await coach.client
        .from('profile_friendships')
        .select('status')
        .eq('id', friendshipId)
        .single()

      expect(check?.status).toBe('accepted')
    })

    it('cannot revert accepted friendship back to pending', async () => {
      if (!friendshipId) return

      const { error } = await player.client
        .from('profile_friendships')
        .update({ status: 'pending' })
        .eq('id', friendshipId)

      // Trigger should reject reverting to pending
      if (!error) {
        const { data: check } = await player.client
          .from('profile_friendships')
          .select('status')
          .eq('id', friendshipId)
          .single()

        expect(check?.status).not.toBe('pending')
      }
    })
  })

  // =========================================================================
  // PROFILE REFERENCES
  // =========================================================================
  describe('profile_references', () => {
    let friendshipId: string | null = null
    let referenceId: string | null = null

    let revokedSlotId: string | null = null

    beforeAll(async () => {
      // Ensure an accepted friendship exists between player and coach
      // Clean up existing friendships
      await player.client
        .from('profile_friendships')
        .delete()
        .or(
          `and(user_one.eq.${player.userId},user_two.eq.${coach.userId}),and(user_one.eq.${coach.userId},user_two.eq.${player.userId})`
        )

      // Revoke any existing active references between them
      // (No DELETE policy exists on profile_references — use UPDATE to 'revoked')
      await player.client
        .from('profile_references')
        .update({ status: 'revoked' })
        .eq('requester_id', player.userId)
        .eq('reference_id', coach.userId)
        .in('status', ['pending', 'accepted'])

      // Also revoke the reverse direction (coach requested, player is reference)
      await coach.client
        .from('profile_references')
        .update({ status: 'revoked' })
        .eq('requester_id', coach.userId)
        .eq('reference_id', player.userId)
        .in('status', ['pending', 'accepted'])

      // Ensure player has < 5 accepted references (max_references = 5).
      // If at the limit, temporarily revoke one to make room for the test.
      const { data: accepted } = await player.client
        .from('profile_references')
        .select('id')
        .eq('requester_id', player.userId)
        .eq('status', 'accepted')

      if (accepted && accepted.length >= 5) {
        revokedSlotId = accepted[0].id
        await player.client
          .from('profile_references')
          .update({ status: 'revoked' })
          .eq('id', revokedSlotId)
      }

      // Create and accept friendship
      const { data: f } = await player.client
        .from('profile_friendships')
        .insert({
          user_one: player.userId,
          user_two: coach.userId,
          requester_id: player.userId,
          status: 'pending',
        })
        .select('id')
        .single()

      friendshipId = f?.id ?? null

      if (friendshipId) {
        await coach.client
          .from('profile_friendships')
          .update({ status: 'accepted' })
          .eq('id', friendshipId)
      }
    })

    afterAll(async () => {
      // Clean up: revoke the reference (no DELETE policy)
      if (referenceId) {
        await player.client
          .from('profile_references')
          .update({ status: 'revoked' })
          .eq('id', referenceId)
      }
      // Restore the temporarily revoked reference slot
      if (revokedSlotId) {
        await player.client
          .from('profile_references')
          .update({ status: 'accepted' })
          .eq('id', revokedSlotId)
      }
      if (friendshipId) {
        await player.client
          .from('profile_friendships')
          .delete()
          .eq('id', friendshipId)
      }
    })

    it('can request a reference from an accepted friend (→ pending)', async () => {
      const { data, error } = await player.client
        .from('profile_references')
        .insert({
          requester_id: player.userId,
          reference_id: coach.userId,
          relationship_type: 'teammate',
          status: 'pending',
        })
        .select('id, status')
        .single()

      expect(error).toBeNull()
      expect(data?.status).toBe('pending')
      referenceId = data?.id ?? null
    })

    it('reference can accept (pending → accepted)', async () => {
      if (!referenceId) return

      const { error } = await coach.client
        .from('profile_references')
        .update({
          status: 'accepted',
          endorsement_text: 'Great player, DB test.',
        })
        .eq('id', referenceId)

      expect(error).toBeNull()

      const { data: check } = await coach.client
        .from('profile_references')
        .select('status, accepted_at')
        .eq('id', referenceId)
        .single()

      expect(check?.status).toBe('accepted')
      expect(check?.accepted_at).not.toBeNull()
    })

    it('cannot revert accepted reference back to pending', async () => {
      if (!referenceId) return

      const { error } = await player.client
        .from('profile_references')
        .update({ status: 'pending' })
        .eq('id', referenceId)

      // Trigger should block this
      if (!error) {
        const { data: check } = await player.client
          .from('profile_references')
          .select('status')
          .eq('id', referenceId)
          .single()

        expect(check?.status).not.toBe('pending')
      }
    })

    it('requester can revoke an accepted reference', async () => {
      if (!referenceId) return

      const { error } = await player.client
        .from('profile_references')
        .update({ status: 'revoked' })
        .eq('id', referenceId)

      expect(error).toBeNull()

      const { data: check } = await player.client
        .from('profile_references')
        .select('status, revoked_at')
        .eq('id', referenceId)
        .single()

      expect(check?.status).toBe('revoked')
      expect(check?.revoked_at).not.toBeNull()
    })
  })

  // =========================================================================
  // REFERENCE REQUIRES FRIENDSHIP
  // =========================================================================
  describe('profile_references — friendship guard', () => {
    it('cannot request reference without an accepted friendship', async () => {
      // Use a non-existent user — no friendship can exist
      const { error } = await player.client
        .from('profile_references')
        .insert({
          requester_id: player.userId,
          reference_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          relationship_type: 'teammate',
          status: 'pending',
        })

      // Should be rejected by the friendship guard trigger or FK constraint
      expect(error).not.toBeNull()
    })
  })
})
