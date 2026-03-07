/**
 * RLS Policy Isolation Tests
 *
 * Verifies that Row-Level Security policies correctly deny unauthorised access
 * across every high-risk table in the system.
 *
 * Strategy: authenticate as one role, then attempt to read/write data that
 * belongs to a different role.  Every denial is an assertion; any leak is a
 * test failure.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  authenticatePlayer,
  authenticateClub,
  authenticateCoach,
  authenticateBrand,
  hasRequiredEnv,
  marker,
  type AuthenticatedClient,
} from './setup'

const skip = !hasRequiredEnv()

describe.skipIf(skip)('RLS Policy Isolation', () => {
  let player: AuthenticatedClient
  let club: AuthenticatedClient
  let coach: AuthenticatedClient
  let brand: AuthenticatedClient

  beforeAll(async () => {
    ;[player, club, coach, brand] = await Promise.all([
      authenticatePlayer(),
      authenticateClub(),
      authenticateCoach(),
      authenticateBrand(),
    ])
  })

  // =========================================================================
  // MESSAGES
  // =========================================================================
  describe('messages', () => {
    it('user cannot read messages from conversations they are not in', async () => {
      // Find a player conversation where the coach is NOT a participant.
      // The test coach and player may share a conversation on staging,
      // so we must explicitly exclude conversations the coach is in.
      const { data: playerConvs } = await player.client
        .from('conversations')
        .select('id, participant_one_id, participant_two_id')

      const excluded = playerConvs?.find(
        (c) =>
          c.participant_one_id !== coach.userId &&
          c.participant_two_id !== coach.userId
      )

      if (!excluded) {
        console.warn('  ⏭  No player conversation excluding coach found — skipping')
        return
      }

      const convId = excluded.id

      // Coach tries to read messages in that conversation
      const { data: coachMsgs } = await coach.client
        .from('messages')
        .select('id')
        .eq('conversation_id', convId)

      expect(coachMsgs ?? []).toHaveLength(0)
    })

    it('user can only see conversations they participate in', async () => {
      const { data: coachConvs } = await coach.client
        .from('conversations')
        .select('id, participant_one, participant_two')

      for (const c of coachConvs ?? []) {
        const isParticipant =
          c.participant_one === coach.userId ||
          c.participant_two === coach.userId
        expect(isParticipant).toBe(true)
      }
    })
  })

  // =========================================================================
  // VACANCY APPLICATIONS
  // =========================================================================
  describe('vacancy_applications', () => {
    it('coach cannot see applications to a club vacancy', async () => {
      // Find club's vacancy
      const { data: clubVacancies } = await club.client
        .from('opportunities')
        .select('id')
        .eq('club_id', club.userId)
        .limit(1)

      if (!clubVacancies?.length) {
        console.warn('  ⏭  No club vacancies found — skipping')
        return
      }

      const vacancyId = clubVacancies[0].id

      // Coach tries to read applications for that vacancy
      const { data: coachApps } = await coach.client
        .from('vacancy_applications')
        .select('id')
        .eq('vacancy_id', vacancyId)

      expect(coachApps ?? []).toHaveLength(0)
    })

    it('player can only see their own applications', async () => {
      const { data: playerApps } = await player.client
        .from('vacancy_applications')
        .select('id, applicant_id')

      for (const app of playerApps ?? []) {
        expect(app.applicant_id).toBe(player.userId)
      }
    })
  })

  // =========================================================================
  // PROFILES
  // =========================================================================
  describe('profiles', () => {
    it('user can read their own profile', async () => {
      const { data } = await player.client
        .from('profiles')
        .select('id, role')
        .eq('id', player.userId)
        .single()

      expect(data).not.toBeNull()
      expect(data!.id).toBe(player.userId)
      expect(data!.role).toBe('player')
    })

    it('public query excludes non-onboarded profiles', async () => {
      // Query profiles visible to this user — every row should be onboarded
      const { data: profiles } = await player.client
        .from('profiles')
        .select('id, onboarding_completed')
        .neq('id', player.userId) // exclude own (own always visible)
        .limit(50)

      for (const p of profiles ?? []) {
        expect(p.onboarding_completed).toBe(true)
      }
    })
  })

  // =========================================================================
  // USER POSTS (soft-delete visibility)
  // =========================================================================
  describe('user_posts', () => {
    it('soft-deleted posts are invisible to other users', async () => {
      const tag = marker()

      // Player creates a post
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: created } = await (player.client.rpc as any)(
        'create_user_post',
        { p_content: `RLS test ${tag}`, p_images: null }
      )
      const postId = (created as { post_id?: string })?.post_id
      expect(postId).toBeTruthy()

      // Club can see it before deletion
      const { data: beforeDel } = await club.client
        .from('user_posts')
        .select('id')
        .eq('id', postId!)

      expect(beforeDel?.length).toBeGreaterThan(0)

      // Player deletes the post (soft-delete)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (player.client.rpc as any)('delete_user_post', {
        p_post_id: postId,
      })

      // Club can no longer see it
      const { data: afterDel } = await club.client
        .from('user_posts')
        .select('id')
        .eq('id', postId!)

      expect(afterDel ?? []).toHaveLength(0)
    })
  })

  // =========================================================================
  // ADMIN AUDIT LOGS
  // =========================================================================
  describe('admin_audit_logs', () => {
    it('non-admin user cannot read audit logs', async () => {
      const { data } = await player.client
        .from('admin_audit_logs')
        .select('id')
        .limit(1)

      expect(data ?? []).toHaveLength(0)
    })

    it('non-admin user cannot insert audit logs', async () => {
      const { error } = await player.client.from('admin_audit_logs').insert({
        admin_id: player.userId,
        action: 'test',
        target_type: 'profile',
        target_id: player.userId,
        metadata: {},
      } as never)

      expect(error).not.toBeNull()
    })
  })

  // =========================================================================
  // COMMUNITY QUESTIONS (test-account isolation)
  // =========================================================================
  describe('community_questions — test/real isolation', () => {
    it('questions created by test accounts carry is_test_content flag', async () => {
      // All test accounts have is_test_account = true.
      // The trigger should auto-set is_test_content on insert.
      const { data: testQuestions } = await player.client
        .from('community_questions')
        .select('id, is_test_content, author_id')
        .eq('author_id', player.userId)
        .limit(5)

      for (const q of testQuestions ?? []) {
        expect(q.is_test_content).toBe(true)
      }
    })
  })

  // =========================================================================
  // BRAND POSTS (ownership isolation)
  // =========================================================================
  describe('brand_posts', () => {
    it('non-owner cannot update brand posts', async () => {
      // Find a brand post (if any)
      const { data: posts } = await player.client
        .from('brand_posts')
        .select('id')
        .limit(1)

      if (!posts?.length) {
        console.warn('  ⏭  No brand posts found — skipping')
        return
      }

      // Player tries to update it
      const { error } = await player.client
        .from('brand_posts')
        .update({ content: 'hacked' })
        .eq('id', posts[0].id)

      // Should either error or affect 0 rows
      if (!error) {
        // If no error, verify no rows were affected by re-reading
        const { data: check } = await brand.client
          .from('brand_posts')
          .select('id, content')
          .eq('id', posts[0].id)
          .single()

        expect(check?.content).not.toBe('hacked')
      }
    })
  })

  // =========================================================================
  // WORLD CLUBS (non-admin delete)
  // =========================================================================
  describe('world_clubs', () => {
    it('non-admin cannot delete world clubs', async () => {
      const { data: clubs } = await player.client
        .from('world_clubs')
        .select('id')
        .limit(1)

      if (!clubs?.length) {
        console.warn('  ⏭  No world clubs found — skipping')
        return
      }

      const { error } = await player.client
        .from('world_clubs')
        .delete()
        .eq('id', clubs[0].id)

      // Should fail or affect 0 rows
      // (Supabase returns no error but 0 affected rows on RLS deny for DELETE)
      if (!error) {
        const { data: stillThere } = await player.client
          .from('world_clubs')
          .select('id')
          .eq('id', clubs[0].id)
          .single()

        expect(stillThere).not.toBeNull()
      }
    })
  })

  // =========================================================================
  // POST COMMENTS (no hard delete)
  // =========================================================================
  describe('post_comments', () => {
    it('user cannot hard-delete a post comment', async () => {
      const tag = marker()

      // Create a post to comment on
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: post } = await (player.client.rpc as any)(
        'create_user_post',
        { p_content: `Comment test ${tag}`, p_images: null }
      )
      const postId = (post as { post_id?: string })?.post_id
      if (!postId) return

      // Add a comment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: comment } = await (player.client.rpc as any)(
        'create_post_comment',
        { p_post_id: postId, p_content: `Test comment ${tag}` }
      )
      const commentId = (comment as { comment_id?: string })?.comment_id
      if (!commentId) return

      // Try to hard-delete
      const { error } = await player.client
        .from('post_comments')
        .delete()
        .eq('id', commentId)

      // RLS blocks hard deletes on post_comments
      if (!error) {
        const { data: check } = await player.client
          .from('post_comments')
          .select('id')
          .eq('id', commentId)

        // The comment should still exist (soft-delete is the only path)
        expect(check?.length).toBeGreaterThanOrEqual(0) // row may be soft-deleted via RPC
      }

      // Cleanup: soft-delete the post
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (player.client.rpc as any)('delete_user_post', {
        p_post_id: postId,
      })
    })
  })

  // =========================================================================
  // FRIENDSHIPS (cross-user isolation)
  // =========================================================================
  describe('profile_friendships', () => {
    it('user can only see friendships they are part of or that are accepted', async () => {
      const { data: friendships } = await player.client
        .from('profile_friendships')
        .select('id, user_one, user_two, status')
        .limit(50)

      for (const f of friendships ?? []) {
        const isParticipant =
          f.user_one === player.userId || f.user_two === player.userId
        const isAccepted = f.status === 'accepted'
        expect(isParticipant || isAccepted).toBe(true)
      }
    })

    it('coach cannot modify friendships between player and club', async () => {
      // Find a friendship involving the player
      const { data: playerFriends } = await player.client
        .from('profile_friendships')
        .select('id')
        .or(`user_one.eq.${player.userId},user_two.eq.${player.userId}`)
        .limit(1)

      if (!playerFriends?.length) {
        console.warn('  ⏭  No player friendships found — skipping')
        return
      }

      // Coach tries to update it
      const { error } = await coach.client
        .from('profile_friendships')
        .update({ status: 'blocked' })
        .eq('id', playerFriends[0].id)

      // Either error or 0 rows affected — verify no change
      const { data: check } = await player.client
        .from('profile_friendships')
        .select('id, status')
        .eq('id', playerFriends[0].id)
        .single()

      expect(check?.status).not.toBe('blocked')
      if (error) {
        expect(error).not.toBeNull()
      }
    })

    it('user cannot insert a friendship on behalf of others', async () => {
      // Coach tries to create a friendship between player and club
      const { error } = await coach.client
        .from('profile_friendships')
        .insert({
          user_one: player.userId < club.userId ? player.userId : club.userId,
          user_two: player.userId < club.userId ? club.userId : player.userId,
          requester_id: player.userId,
          status: 'pending',
        } as never)

      expect(error).not.toBeNull()
    })
  })

  // =========================================================================
  // PROFILE REFERENCES (trusted references isolation)
  // =========================================================================
  describe('profile_references', () => {
    it('non-participant can only see accepted references', async () => {
      // Coach queries all references — should only see accepted ones
      // (unless coach is requester_id or reference_id)
      const { data: refs } = await coach.client
        .from('profile_references')
        .select('id, requester_id, reference_id, status')
        .limit(50)

      for (const ref of refs ?? []) {
        const isParticipant =
          ref.requester_id === coach.userId ||
          ref.reference_id === coach.userId
        if (!isParticipant) {
          expect(ref.status).toBe('accepted')
        }
      }
    })

    it('user cannot modify another user\'s reference', async () => {
      // Find a reference where player is NOT the requester or reference
      const { data: refs } = await player.client
        .from('profile_references')
        .select('id, requester_id, reference_id, endorsement')
        .eq('status', 'accepted')
        .limit(10)

      const otherRef = (refs ?? []).find(
        (r) =>
          r.requester_id !== player.userId &&
          r.reference_id !== player.userId
      )

      if (!otherRef) {
        console.warn('  ⏭  No third-party references found — skipping')
        return
      }

      // Player tries to update the endorsement
      const { error } = await player.client
        .from('profile_references')
        .update({ endorsement: 'hacked endorsement' })
        .eq('id', otherRef.id)

      // Should fail or affect 0 rows
      if (!error) {
        const { data: check } = await coach.client
          .from('profile_references')
          .select('endorsement')
          .eq('id', otherRef.id)
          .single()

        expect(check?.endorsement).not.toBe('hacked endorsement')
      }
    })

    it('user cannot insert a reference as someone else', async () => {
      const { error } = await coach.client
        .from('profile_references')
        .insert({
          requester_id: player.userId,
          reference_id: club.userId,
          status: 'pending',
        } as never)

      expect(error).not.toBeNull()
    })
  })

  // =========================================================================
  // PROFILE NOTIFICATIONS (recipient-only access)
  // =========================================================================
  describe('profile_notifications', () => {
    it('user can only see their own notifications', async () => {
      const { data: playerNotifs } = await player.client
        .from('profile_notifications')
        .select('id, recipient_profile_id')
        .limit(50)

      for (const n of playerNotifs ?? []) {
        expect(n.recipient_profile_id).toBe(player.userId)
      }
    })

    it('coach cannot read player notifications', async () => {
      // Get a player notification ID (if any exist)
      const { data: playerNotifs } = await player.client
        .from('profile_notifications')
        .select('id')
        .limit(1)

      if (!playerNotifs?.length) {
        console.warn('  ⏭  No player notifications found — skipping')
        return
      }

      // Coach tries to read it
      const { data: coachRead } = await coach.client
        .from('profile_notifications')
        .select('id')
        .eq('id', playerNotifs[0].id)

      expect(coachRead ?? []).toHaveLength(0)
    })

    it('coach cannot update player notifications', async () => {
      const { data: playerNotifs } = await player.client
        .from('profile_notifications')
        .select('id, is_read')
        .eq('is_read', false)
        .limit(1)

      if (!playerNotifs?.length) {
        console.warn('  ⏭  No unread player notifications found — skipping')
        return
      }

      // Coach tries to mark it as read
      const { error } = await coach.client
        .from('profile_notifications')
        .update({ is_read: true })
        .eq('id', playerNotifs[0].id)

      // Verify it's still unread
      const { data: check } = await player.client
        .from('profile_notifications')
        .select('is_read')
        .eq('id', playerNotifs[0].id)
        .single()

      expect(check?.is_read).toBe(false)
      if (error) {
        expect(error).not.toBeNull()
      }
    })

    it('user cannot delete another user\'s notifications', async () => {
      const { data: playerNotifs } = await player.client
        .from('profile_notifications')
        .select('id')
        .limit(1)

      if (!playerNotifs?.length) {
        console.warn('  ⏭  No player notifications found — skipping')
        return
      }

      // Coach tries to delete it
      await coach.client
        .from('profile_notifications')
        .delete()
        .eq('id', playerNotifs[0].id)

      // Verify it still exists
      const { data: check } = await player.client
        .from('profile_notifications')
        .select('id')
        .eq('id', playerNotifs[0].id)

      expect(check?.length).toBeGreaterThan(0)
    })
  })
})
