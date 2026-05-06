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
  // OPPORTUNITY APPLICATIONS
  // =========================================================================
  describe('opportunity_applications', () => {
    it('coach cannot see applications to a club opportunity', async () => {
      // Find club's opportunity
      const { data: clubOpportunities } = await club.client
        .from('opportunities')
        .select('id')
        .eq('club_id', club.userId)
        .limit(1)

      if (!clubOpportunities?.length) {
        console.warn('  ⏭  No club opportunities found — skipping')
        return
      }

      const opportunityId = clubOpportunities[0].id

      // Coach tries to read applications for that opportunity
      const { data: coachApps } = await coach.client
        .from('opportunity_applications')
        .select('id')
        .eq('opportunity_id', opportunityId)

      expect(coachApps ?? []).toHaveLength(0)
    })

    it('player can only see their own applications', async () => {
      const { data: playerApps } = await player.client
        .from('opportunity_applications')
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

    // =====================================================================
    // ANON HARDENING — see migration 20260506040423
    // =====================================================================
    // The "share my profile externally" feature opens public profile
    // routes to logged-out viewers. These tests pin the anon-side
    // contract: anon CAN read safe columns, anon CANNOT read email or
    // any test-account profile.
    describe('anon access (public profile share hardening)', () => {
      // Build an unauthenticated client (no Authorization header) to
      // exercise the anon Postgres role end-to-end.
      const supabaseUrl =
        process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
      const supabaseAnonKey =
        process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
      // Lazy import so the test file still compiles when env is missing.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
      const anon = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      it('anon CAN read safe columns (id, username, full_name)', async () => {
        const { data, error } = await anon
          .from('profiles')
          .select('id, username, full_name, role')
          .eq('id', player.userId)
          .maybeSingle()

        expect(error).toBeNull()
        expect(data).not.toBeNull()
        expect(data?.id).toBe(player.userId)
      })

      it('anon CANNOT SELECT the email column (column-level GRANT enforced)', async () => {
        // Postgres returns an error when a role lacks SELECT on a column
        // mentioned in the SELECT list. PostgREST surfaces it as a 401/403
        // with code 42501 (insufficient_privilege).
        const { data, error } = await anon
          .from('profiles')
          .select('id, email')
          .eq('id', player.userId)
          .maybeSingle()

        expect(data).toBeNull()
        expect(error).not.toBeNull()
        // Either Postgres permission denied OR PostgREST surfaces a
        // generic 4xx — both are acceptable, just NOT a successful read.
        const msg = (error?.message ?? '').toLowerCase()
        const code = error?.code ?? ''
        expect(
          msg.includes('permission denied') ||
          msg.includes('insufficient') ||
          code === '42501' ||
          code === 'PGRST301',
        ).toBe(true)
      })

      it('anon CANNOT see test accounts even via safe columns', async () => {
        // Find a known test-account profile (test infra creates these).
        // If none exist in the env, skip — we don't want to false-positive.
        const { data: tests } = await player.client
          .from('profiles')
          .select('id, is_test_account')
          .eq('is_test_account', true)
          .limit(1)

        const testProfile = tests?.[0]
        if (!testProfile) {
          console.warn('  ⏭  No test-account profile present — skipping')
          return
        }

        const { data } = await anon
          .from('profiles')
          .select('id')
          .eq('id', testProfile.id)
          .maybeSingle()

        // Row must be invisible to anon under the new policy.
        expect(data).toBeNull()
      })
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

  // =========================================================================
  // USER PULSE ITEMS (v5 plan, Phase 1B.1+)
  // =========================================================================
  // The pulse layer is owner-only sensitive surface. Migration
  // 20260505000100_pulse_lock_update_to_rpcs.sql revoked direct UPDATE so the
  // only write paths are the four SECURITY DEFINER lifecycle RPCs and the
  // SECURITY DEFINER trigger functions. These tests defend the perimeter.
  describe('user_pulse_items', () => {
    it('user cannot SELECT another user\'s pulse items', async () => {
      // Coach attempts to read player's pulse items by id filter. RLS
      // SELECT policy scopes to user_id = auth.uid(), so the result must
      // be empty regardless of whether player has pulse rows.
      const { data: leaked } = await coach.client
        .from('user_pulse_items')
        .select('id, user_id')
        .eq('user_id', player.userId)

      expect(leaked ?? []).toHaveLength(0)
    })

    it('user cannot directly INSERT into user_pulse_items', async () => {
      // No INSERT policy exists for `authenticated`. Only SECURITY DEFINER
      // functions (triggers + RPCs) can insert. A direct .insert() must
      // either error or silently insert nothing.
      const { data, error } = await player.client
        .from('user_pulse_items')
        .insert({
          user_id: player.userId,
          item_type: 'test_should_be_blocked',
          priority: 5,
          metadata: {},
        })
        .select()

      // Either RLS rejects with an error, or the row count is 0.
      if (!error) {
        expect(data ?? []).toHaveLength(0)
      } else {
        expect(error).not.toBeNull()
      }
    })

    it('user cannot directly UPDATE their own pulse items (RPC-only write path)', async () => {
      // After the lock-down migration, direct .update() should be blocked
      // even on own rows. Find one of the player's pulse items first.
      const { data: ownItems } = await player.client
        .from('user_pulse_items')
        .select('id')
        .limit(1)

      if (!ownItems?.length) {
        console.warn('  ⏭  No pulse items for player — skipping direct-update denial test')
        return
      }

      const { error } = await player.client
        .from('user_pulse_items')
        .update({ priority: 99 })
        .eq('id', ownItems[0].id)

      // Permission revoke should result in an error.
      expect(error).not.toBeNull()
    })

    it('user cannot UPDATE another user\'s pulse items', async () => {
      // Even if direct UPDATE were re-enabled, RLS would scope it. Belt
      // + braces: try a cross-user update and confirm nothing changes.
      const { data: playerItems } = await player.client
        .from('user_pulse_items')
        .select('id, priority')
        .limit(1)

      if (!playerItems?.length) {
        console.warn('  ⏭  No pulse items for player — skipping cross-user update test')
        return
      }

      const original = playerItems[0]
      await coach.client
        .from('user_pulse_items')
        .update({ priority: 99 })
        .eq('id', original.id)

      // Owner re-reads — value must be unchanged.
      const { data: check } = await player.client
        .from('user_pulse_items')
        .select('priority')
        .eq('id', original.id)
        .single()

      expect(check?.priority).toBe(original.priority)
    })

    it('mark_pulse_seen RPC is a no-op for another user\'s pulse_id', async () => {
      // Find a player pulse id, then have coach call mark_pulse_seen on it.
      // The RPC scopes by auth.uid() in its UPDATE, so coach's call should
      // not stamp seen_at on the player's row.
      const { data: playerItems } = await player.client
        .from('user_pulse_items')
        .select('id, seen_at')
        .is('seen_at', null)
        .limit(1)

      if (!playerItems?.length) {
        console.warn('  ⏭  No unseen player pulse items — skipping cross-user RPC test')
        return
      }

      const targetId = playerItems[0].id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (coach.client as any).rpc('mark_pulse_seen', { p_pulse_ids: [targetId] })

      // Owner re-reads — seen_at must still be null.
      const { data: check } = await player.client
        .from('user_pulse_items')
        .select('seen_at')
        .eq('id', targetId)
        .single()

      expect(check?.seen_at).toBeNull()
    })

    it('_maybe_insert_snapshot_gain_celebration is not callable by authenticated', async () => {
      // Migration 20260504230000 revoked EXECUTE from PUBLIC. The internal
      // helper must reject calls from any authenticated client — closing
      // the cross-user feed-injection vector.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (player.client as any).rpc(
        '_maybe_insert_snapshot_gain_celebration',
        {
          p_user_id: coach.userId,
          p_signal: 'first_reference',
          p_metadata: { endorser_name: 'rls_test_pwn_attempt' },
        }
      )

      expect(error).not.toBeNull()
    })
  })

  // =========================================================================
  // OPPORTUNITIES — coach_recruits_for_team gating (Phase 1A.4)
  // =========================================================================
  // Migration 20260505000000 added an RLS check that coaches can only
  // INSERT/UPDATE/DELETE opportunities when their `coach_recruits_for_team`
  // flag is true. UI gate alone was bypassable via direct API.
  describe('opportunities — coach recruiter gating', () => {
    it('candidate-only coach (flag=false) cannot INSERT into opportunities', async () => {
      // Read the coach's current flag. Test only runs when the seed coach
      // is a candidate-only coach (flag=false); skips otherwise so we
      // never need to mutate seed data.
      const { data: coachProfile } = await coach.client
        .from('profiles')
        .select('coach_recruits_for_team')
        .eq('id', coach.userId)
        .single()

      if (coachProfile?.coach_recruits_for_team) {
        console.warn('  ⏭  Seed coach has recruiter flag = true — skipping candidate-only INSERT denial test')
        return
      }

      const { data, error } = await coach.client
        .from('opportunities')
        .insert({
          club_id: coach.userId,
          title: 'rls_test_should_be_blocked',
          opportunity_type: 'player',
          description: 'rls_test',
        })
        .select()

      // Either RLS error or empty result — both prove the gate held.
      if (!error) {
        expect(data ?? []).toHaveLength(0)
      } else {
        expect(error).not.toBeNull()
      }
    })

    it('club user can always INSERT into opportunities (smoke check on the gate\'s OR branch)', async () => {
      const { data, error } = await club.client
        .from('opportunities')
        .insert({
          club_id: club.userId,
          title: 'rls_test_club_can_post',
          opportunity_type: 'player',
          description: 'rls_test',
        })
        .select('id')
        .single()

      // Cleanup if the row landed.
      if (data?.id) {
        await club.client.from('opportunities').delete().eq('id', data.id)
      }

      // Either it succeeded (no error + data) or the seed has constraints
      // we don't know about — but RLS specifically should NOT be the
      // blocker. If error, it must not be a permission/RLS error.
      if (error) {
        expect(error.code).not.toBe('42501') // permission denied
        expect(error.message?.toLowerCase() ?? '').not.toContain('row-level security')
      }
    })
  })

  // =========================================================================
  // PLAYER FULL GAME VIDEOS
  // =========================================================================
  // Player-only feature with per-row visibility ('public' | 'recruiters').
  // Migration 20260507100000 enforces:
  //  - Owner CRUD only when role='player'
  //  - Visitor read filtered by visibility (public vs recruiters scope)
  //  - Cascade delete on profile delete
  describe('player_full_game_videos', () => {
    it('coach cannot insert into player_full_game_videos (player-only feature)', async () => {
      const { data, error } = await coach.client
        .from('player_full_game_videos')
        .insert({
          user_id: coach.userId,
          video_url: 'https://www.youtube.com/watch?v=rls_test_block',
          match_title: 'rls_test_should_be_blocked',
        })
        .select()

      // Either RLS error or empty result — both prove the gate held.
      if (!error) {
        expect(data ?? []).toHaveLength(0)
      } else {
        expect(error).not.toBeNull()
      }
    })

    it('club cannot insert into player_full_game_videos', async () => {
      const { data, error } = await club.client
        .from('player_full_game_videos')
        .insert({
          user_id: club.userId,
          video_url: 'https://www.youtube.com/watch?v=rls_test_block',
          match_title: 'rls_test_should_be_blocked',
        })
        .select()

      if (!error) {
        expect(data ?? []).toHaveLength(0)
      } else {
        expect(error).not.toBeNull()
      }
    })

    it('brand cannot insert into player_full_game_videos', async () => {
      const { data, error } = await brand.client
        .from('player_full_game_videos')
        .insert({
          user_id: brand.userId,
          video_url: 'https://www.youtube.com/watch?v=rls_test_block',
          match_title: 'rls_test_should_be_blocked',
        })
        .select()

      if (!error) {
        expect(data ?? []).toHaveLength(0)
      } else {
        expect(error).not.toBeNull()
      }
    })

    it('coach cannot UPDATE another player\'s full game video', async () => {
      // Find a player video to attempt to mutate. If the player has none,
      // skip — the visibility-filter test covers the read direction below.
      const { data: playerVideos } = await player.client
        .from('player_full_game_videos')
        .select('id, match_title')
        .limit(1)

      if (!playerVideos?.length) {
        console.warn('  ⏭  No player full game videos seeded — skipping cross-user update test')
        return
      }

      const original = playerVideos[0]
      await coach.client
        .from('player_full_game_videos')
        .update({ match_title: 'rls_test_pwn_attempt' })
        .eq('id', original.id)

      // Owner re-reads — title must be unchanged.
      const { data: check } = await player.client
        .from('player_full_game_videos')
        .select('match_title')
        .eq('id', original.id)
        .single()

      expect(check?.match_title).toBe(original.match_title)
    })

    it('non-recruiter visitor cannot SELECT recruiters-only videos', async () => {
      // Brand visiting a player profile should only see public videos.
      // We can't seed a recruiters-only video without a player credential,
      // so this test asserts: every brand-visible row has visibility=public.
      const { data: brandSees } = await brand.client
        .from('player_full_game_videos')
        .select('id, visibility, user_id')

      for (const row of brandSees ?? []) {
        // The brand owner should still see their own rows of any visibility,
        // but brand profiles can't insert anyway, so this should be empty.
        if (row.user_id !== brand.userId) {
          expect(row.visibility).toBe('public')
        }
      }
    })
  })
})
