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
    // References are written ONLY through the SECURITY DEFINER RPCs the app uses
    // (request_reference / respond_reference / remove_reference). Direct table
    // writes were closed in 20260926100000_phase1_close_client_write_holes: they let
    // an endorser flip a revoked reference back to accepted.
    let friendshipId: string | null = null
    let referenceId: string | null = null
    // request_reference allows 3 requests per requester per rolling 24h and 5 accepted
    // references in total. CI runs this suite many times a day on the shared staging
    // accounts, so when a limit is hit the lifecycle tests skip (like missing fixtures).
    let skipReason: string | null = null

    const activeReferences = async () => {
      const { data } = await player.client
        .from('profile_references')
        .select('id, requester_id, status')
        .or(
          `and(requester_id.eq.${player.userId},reference_id.eq.${coach.userId}),and(requester_id.eq.${coach.userId},reference_id.eq.${player.userId})`
        )
        .in('status', ['pending', 'accepted'])
      return data ?? []
    }

    beforeAll(async () => {
      // Clear any active reference between player and coach, as the requester would.
      for (const ref of await activeReferences()) {
        const who = ref.requester_id === player.userId ? player : coach
        await who.client.rpc('remove_reference', { p_reference_id: ref.id })
      }

      // Ensure an accepted friendship between player and coach (reuse one left over
      // from the friendship block above, or create it).
      const { data: existing } = await player.client
        .from('profile_friendships')
        .select('id, status')
        .or(
          `and(user_one.eq.${player.userId},user_two.eq.${coach.userId}),and(user_one.eq.${coach.userId},user_two.eq.${player.userId})`
        )
        .maybeSingle()

      if (existing?.status === 'accepted') {
        friendshipId = existing.id
      } else {
        if (existing) {
          await player.client.from('profile_friendships').delete().eq('id', existing.id)
        }
        const { data: f, error: fErr } = await player.client
          .from('profile_friendships')
          .insert({
            user_one: player.userId,
            user_two: coach.userId,
            requester_id: player.userId,
            status: 'pending',
          })
          .select('id')
          .single()
        if (fErr) throw new Error(`Friendship insert failed: ${fErr.message}`)
        friendshipId = f?.id ?? null

        if (friendshipId) {
          const { error: acceptErr } = await coach.client
            .from('profile_friendships')
            .update({ status: 'accepted' })
            .eq('id', friendshipId)
          if (acceptErr) throw new Error(`Friendship accept failed: ${acceptErr.message}`)
        }
      }
    })

    afterAll(async () => {
      // Leave no active reference behind (the requester removes it, as in the app).
      for (const ref of await activeReferences()) {
        const who = ref.requester_id === player.userId ? player : coach
        await who.client.rpc('remove_reference', { p_reference_id: ref.id })
      }
      if (friendshipId) {
        await player.client.from('profile_friendships').delete().eq('id', friendshipId)
      }
    })

    it('direct INSERT is refused — requests go through request_reference', async () => {
      const { error } = await player.client.from('profile_references').insert({
        requester_id: player.userId,
        reference_id: coach.userId,
        relationship_type: 'teammate',
        status: 'pending',
      })
      expect(error).not.toBeNull()
    })

    it('can request a reference from an accepted friend (→ pending)', async () => {
      const { data, error } = await player.client.rpc('request_reference', {
        p_reference_id: coach.userId,
        p_relationship_type: 'teammate',
        p_request_note: 'DB test',
      })

      if (error && /per day|already have 5/i.test(error.message)) {
        skipReason = error.message
        console.warn(`  ⏭  request_reference limit reached — skipping the lifecycle tests: ${error.message}`)
        return
      }
      expect(error).toBeNull()
      expect(data?.status).toBe('pending')
      referenceId = data?.id ?? null
    })

    it('reference can accept (pending → accepted)', async () => {
      if (!referenceId || skipReason) return

      const { error } = await coach.client.rpc('respond_reference', {
        p_reference_id: referenceId,
        p_accept: true,
        p_endorsement: 'Great player, DB test.',
      })
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
      if (!referenceId || skipReason) return

      await player.client
        .from('profile_references')
        .update({ status: 'pending' })
        .eq('id', referenceId)

      const { data: check } = await player.client
        .from('profile_references')
        .select('status')
        .eq('id', referenceId)
        .single()
      expect(check?.status).toBe('accepted')
    })

    it('requester can revoke an accepted reference', async () => {
      if (!referenceId || skipReason) return

      const { error } = await player.client.rpc('remove_reference', { p_reference_id: referenceId })
      expect(error).toBeNull()

      const { data: check } = await player.client
        .from('profile_references')
        .select('status, revoked_at')
        .eq('id', referenceId)
        .single()

      expect(check?.status).toBe('revoked')
      expect(check?.revoked_at).not.toBeNull()
    })

    it('endorser cannot bring a revoked reference back to accepted', async () => {
      if (!referenceId || skipReason) return

      await coach.client
        .from('profile_references')
        .update({ status: 'accepted', endorsement_text: 'Restored by the endorser' })
        .eq('id', referenceId)

      const { data: check } = await player.client
        .from('profile_references')
        .select('status')
        .eq('id', referenceId)
        .single()
      expect(check?.status).toBe('revoked')
    })
  })

  // =========================================================================
  // REFERENCE REQUIRES FRIENDSHIP
  // =========================================================================
  describe('profile_references — friendship guard', () => {
    it('cannot request reference without an accepted friendship', async () => {
      // Use a non-existent user — no friendship can exist
      const { error } = await player.client.rpc('request_reference', {
        p_reference_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        p_relationship_type: 'teammate',
      })

      // Rejected by the friendship check in request_reference (or its daily limit)
      expect(error).not.toBeNull()
    })
  })
})
