-- =========================================================================
-- Performance Wave 3 — wrap auth.uid() / auth.role() in 81 long-tail policies
-- =========================================================================
-- Wave 1 dropped 5 duplicate indexes + added 20 missing FK indexes.
-- Wave 2 wrapped 24 policies on the 5 hottest tables.
-- Wave 3 (this) wraps the remaining 81 policies across 39 tables —
-- finishes the auth_rls_initplan slate from the perf advisor.
--
-- Same mechanical rewrite as Wave 2: each policy DROPped + re-CREATEd
-- with exact same USING / WITH CHECK / cmd / role; only auth.uid() and
-- auth.role() call sites are wrapped as `(SELECT auth.<fn>())` so the
-- planner caches the result instead of evaluating per row.
--
-- Other functions left untouched: is_platform_admin(),
-- current_profile_role(), is_blocked_pair(), user_in_conversation(),
-- club_has_applicant(), auth.jwt().
--
-- TO authenticated vs TO public preserved per policy.
-- =========================================================================

-- ─────────────────────────────────────────────────────────────────────
-- archived_messages (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role manages archived messages" ON public.archived_messages;
CREATE POLICY "Service role manages archived messages"
  ON public.archived_messages
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Users can view their archived messages" ON public.archived_messages;
CREATE POLICY "Users can view their archived messages"
  ON public.archived_messages
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = archived_messages.conversation_id
      AND ((c.participant_one_id = (SELECT auth.uid())) OR (c.participant_two_id = (SELECT auth.uid())))
  ));

-- ─────────────────────────────────────────────────────────────────────
-- brand_followers (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS brand_followers_delete ON public.brand_followers;
CREATE POLICY brand_followers_delete
  ON public.brand_followers
  FOR DELETE
  USING (follower_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS brand_followers_insert ON public.brand_followers;
CREATE POLICY brand_followers_insert
  ON public.brand_followers
  FOR INSERT
  WITH CHECK (
    (follower_id = (SELECT auth.uid()))
    AND (EXISTS (SELECT 1 FROM brands b WHERE b.id = brand_followers.brand_id AND b.deleted_at IS NULL))
    AND (COALESCE(current_profile_role(), '') <> 'brand')
    AND (NOT EXISTS (SELECT 1 FROM brands b WHERE b.id = brand_followers.brand_id AND b.profile_id = (SELECT auth.uid())))
    AND (NOT EXISTS (SELECT 1 FROM brands b WHERE b.id = brand_followers.brand_id AND is_blocked_pair((SELECT auth.uid()), b.profile_id)))
  );

-- ─────────────────────────────────────────────────────────────────────
-- brand_posts (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS brand_posts_insert_owner ON public.brand_posts;
CREATE POLICY brand_posts_insert_owner
  ON public.brand_posts
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM brands
    WHERE brands.id = brand_posts.brand_id
      AND brands.profile_id = (SELECT auth.uid())
      AND brands.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS brand_posts_update_owner ON public.brand_posts;
CREATE POLICY brand_posts_update_owner
  ON public.brand_posts
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM brands
    WHERE brands.id = brand_posts.brand_id
      AND brands.profile_id = (SELECT auth.uid())
      AND brands.deleted_at IS NULL
  ));

-- ─────────────────────────────────────────────────────────────────────
-- brand_products (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Brand owners can create products" ON public.brand_products;
CREATE POLICY "Brand owners can create products"
  ON public.brand_products
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM brands
    WHERE brands.id = brand_products.brand_id
      AND brands.profile_id = (SELECT auth.uid())
      AND brands.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "Brand owners can update their products" ON public.brand_products;
CREATE POLICY "Brand owners can update their products"
  ON public.brand_products
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM brands
    WHERE brands.id = brand_products.brand_id
      AND brands.profile_id = (SELECT auth.uid())
      AND brands.deleted_at IS NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM brands
    WHERE brands.id = brand_products.brand_id
      AND brands.profile_id = (SELECT auth.uid())
      AND brands.deleted_at IS NULL
  ));

-- ─────────────────────────────────────────────────────────────────────
-- brands (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Brand users can create their brand" ON public.brands;
CREATE POLICY "Brand users can create their brand"
  ON public.brands
  FOR INSERT
  WITH CHECK (((SELECT auth.uid()) = profile_id) AND (current_profile_role() = 'brand'));

DROP POLICY IF EXISTS "Brand users can update their brand" ON public.brands;
CREATE POLICY "Brand users can update their brand"
  ON public.brands
  FOR UPDATE
  USING ((SELECT auth.uid()) = profile_id)
  WITH CHECK ((SELECT auth.uid()) = profile_id);

-- ─────────────────────────────────────────────────────────────────────
-- club_media (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Clubs can manage their media" ON public.club_media;
CREATE POLICY "Clubs can manage their media"
  ON public.club_media
  FOR ALL
  USING (((SELECT auth.uid()) = club_id) AND (COALESCE(current_profile_role(), '') = 'club'))
  WITH CHECK (((SELECT auth.uid()) = club_id) AND (COALESCE(current_profile_role(), '') = 'club'));

-- ─────────────────────────────────────────────────────────────────────
-- community_answers (4)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS answers_delete ON public.community_answers;
CREATE POLICY answers_delete
  ON public.community_answers
  FOR DELETE
  USING ((author_id = (SELECT auth.uid())) OR is_platform_admin());

DROP POLICY IF EXISTS answers_insert ON public.community_answers;
CREATE POLICY answers_insert
  ON public.community_answers
  FOR INSERT
  WITH CHECK (((SELECT auth.role()) = 'authenticated') AND (author_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS answers_select ON public.community_answers;
CREATE POLICY answers_select
  ON public.community_answers
  FOR SELECT
  USING (
    (deleted_at IS NULL)
    AND (
      (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_test_account = true))
      OR (is_test_content = false)
      OR is_platform_admin()
    )
  );

DROP POLICY IF EXISTS answers_update ON public.community_answers;
CREATE POLICY answers_update
  ON public.community_answers
  FOR UPDATE
  USING (author_id = (SELECT auth.uid()))
  WITH CHECK (author_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- community_questions (4)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS questions_delete ON public.community_questions;
CREATE POLICY questions_delete
  ON public.community_questions
  FOR DELETE
  USING ((author_id = (SELECT auth.uid())) OR is_platform_admin());

DROP POLICY IF EXISTS questions_insert ON public.community_questions;
CREATE POLICY questions_insert
  ON public.community_questions
  FOR INSERT
  WITH CHECK (((SELECT auth.role()) = 'authenticated') AND (author_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS questions_select ON public.community_questions;
CREATE POLICY questions_select
  ON public.community_questions
  FOR SELECT
  USING (
    (deleted_at IS NULL)
    AND (
      (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_test_account = true))
      OR (is_test_content = false)
      OR is_platform_admin()
    )
  );

DROP POLICY IF EXISTS questions_update ON public.community_questions;
CREATE POLICY questions_update
  ON public.community_questions
  FOR UPDATE
  USING (author_id = (SELECT auth.uid()))
  WITH CHECK (author_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- conversations (3)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations
  FOR INSERT
  WITH CHECK ((participant_one_id = (SELECT auth.uid())) OR (participant_two_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can update conversations" ON public.conversations;
CREATE POLICY "Users can update conversations"
  ON public.conversations
  FOR UPDATE
  USING ((participant_one_id = (SELECT auth.uid())) OR (participant_two_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations"
  ON public.conversations
  FOR SELECT
  USING ((participant_one_id = (SELECT auth.uid())) OR (participant_two_id = (SELECT auth.uid())));

-- ─────────────────────────────────────────────────────────────────────
-- country_text_aliases (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role manages country aliases" ON public.country_text_aliases;
CREATE POLICY "Service role manages country aliases"
  ON public.country_text_aliases
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ─────────────────────────────────────────────────────────────────────
-- error_logs (1) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can insert own error logs" ON public.error_logs;
CREATE POLICY "Authenticated can insert own error logs"
  ON public.error_logs
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) OR (user_id IS NULL));

-- ─────────────────────────────────────────────────────────────────────
-- events (1) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own events" ON public.events;
CREATE POLICY "Users can insert own events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) OR (user_id IS NULL));

-- ─────────────────────────────────────────────────────────────────────
-- gallery_photos (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage their gallery photos" ON public.gallery_photos;
CREATE POLICY "Users can manage their gallery photos"
  ON public.gallery_photos
  FOR ALL
  USING (((SELECT auth.uid()) = user_id) AND (COALESCE(current_profile_role(), '') = ANY (ARRAY['player', 'coach', 'umpire', 'brand'])))
  WITH CHECK (((SELECT auth.uid()) = user_id) AND (COALESCE(current_profile_role(), '') = ANY (ARRAY['player', 'coach', 'umpire', 'brand'])));

-- ─────────────────────────────────────────────────────────────────────
-- home_feed_items (1) — TO authenticated; auth.jwt() left unwrapped
-- (auth.jwt() is also a per-row eval but the advisor flagged auth.uid()
-- here; keeping the jwt() call as-is for safety)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS home_feed_items_update_admin ON public.home_feed_items;
CREATE POLICY home_feed_items_update_admin
  ON public.home_feed_items
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND ((((auth.jwt() ->> 'app_metadata'::text))::jsonb ->> 'is_admin'::text) = 'true'::text)
  ));

-- ─────────────────────────────────────────────────────────────────────
-- messages (3)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can mark messages as read v2" ON public.messages;
CREATE POLICY "Users can mark messages as read v2"
  ON public.messages
  FOR UPDATE
  USING (user_in_conversation(conversation_id, (SELECT auth.uid())) AND (sender_id <> (SELECT auth.uid())))
  WITH CHECK (user_in_conversation(conversation_id, (SELECT auth.uid())) AND (sender_id <> (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can send messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can send messages in their conversations v2"
  ON public.messages
  FOR INSERT
  WITH CHECK ((sender_id = (SELECT auth.uid())) AND user_in_conversation(conversation_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can view messages in their conversations v2"
  ON public.messages
  FOR SELECT
  USING (user_in_conversation(conversation_id, (SELECT auth.uid())));

-- ─────────────────────────────────────────────────────────────────────
-- opportunities (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Publishers can manage their opportunities" ON public.opportunities;
CREATE POLICY "Publishers can manage their opportunities"
  ON public.opportunities
  FOR ALL
  USING (
    ((SELECT auth.uid()) = club_id)
    AND (
      (COALESCE(current_profile_role(), '') = 'club')
      OR (
        (COALESCE(current_profile_role(), '') = 'coach')
        AND (COALESCE((SELECT profiles.coach_recruits_for_team FROM profiles WHERE profiles.id = (SELECT auth.uid())), false) = true)
      )
    )
  )
  WITH CHECK (
    ((SELECT auth.uid()) = club_id)
    AND (
      (COALESCE(current_profile_role(), '') = 'club')
      OR (
        (COALESCE(current_profile_role(), '') = 'coach')
        AND (COALESCE((SELECT profiles.coach_recruits_for_team FROM profiles WHERE profiles.id = (SELECT auth.uid())), false) = true)
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- opportunity_inbox_state (3)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert their opportunity inbox state" ON public.opportunity_inbox_state;
CREATE POLICY "Users can insert their opportunity inbox state"
  ON public.opportunity_inbox_state
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can read their opportunity inbox state" ON public.opportunity_inbox_state;
CREATE POLICY "Users can read their opportunity inbox state"
  ON public.opportunity_inbox_state
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their opportunity inbox state" ON public.opportunity_inbox_state;
CREATE POLICY "Users can update their opportunity inbox state"
  ON public.opportunity_inbox_state
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- player_full_game_videos (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS player_full_game_videos_owner_manage ON public.player_full_game_videos;
CREATE POLICY player_full_game_videos_owner_manage
  ON public.player_full_game_videos
  FOR ALL
  USING (((SELECT auth.uid()) = user_id) AND (COALESCE(current_profile_role(), '') = 'player'))
  WITH CHECK (((SELECT auth.uid()) = user_id) AND (COALESCE(current_profile_role(), '') = 'player'));

DROP POLICY IF EXISTS player_full_game_videos_select ON public.player_full_game_videos;
CREATE POLICY player_full_game_videos_select
  ON public.player_full_game_videos
  FOR SELECT
  USING (
    (visibility = 'public')
    OR ((visibility = 'recruiters') AND (COALESCE(current_profile_role(), '') = ANY (ARRAY['club', 'coach'])))
    OR ((SELECT auth.uid()) = user_id)
  );

-- ─────────────────────────────────────────────────────────────────────
-- post_comments (2) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS post_comments_insert_own ON public.post_comments;
CREATE POLICY post_comments_insert_own
  ON public.post_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS post_comments_update_own ON public.post_comments;
CREATE POLICY post_comments_update_own
  ON public.post_comments
  FOR UPDATE
  TO authenticated
  USING (author_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- post_likes (2) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS post_likes_delete_own ON public.post_likes;
CREATE POLICY post_likes_delete_own
  ON public.post_likes
  FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS post_likes_insert_own ON public.post_likes;
CREATE POLICY post_likes_insert_own
  ON public.post_likes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- profile_comments (4)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authors can delete comments" ON public.profile_comments;
CREATE POLICY "Authors can delete comments"
  ON public.profile_comments
  FOR DELETE
  USING ((SELECT auth.uid()) = author_profile_id);

DROP POLICY IF EXISTS "Authors can edit comments" ON public.profile_comments;
CREATE POLICY "Authors can edit comments"
  ON public.profile_comments
  FOR UPDATE
  USING ((SELECT auth.uid()) = author_profile_id)
  WITH CHECK ((SELECT auth.uid()) = author_profile_id);

DROP POLICY IF EXISTS "Users can create comments" ON public.profile_comments;
CREATE POLICY "Users can create comments"
  ON public.profile_comments
  FOR INSERT
  WITH CHECK (((SELECT auth.uid()) = author_profile_id) AND (author_profile_id <> profile_id));

DROP POLICY IF EXISTS "Visible comments are public" ON public.profile_comments;
CREATE POLICY "Visible comments are public"
  ON public.profile_comments
  FOR SELECT
  USING (
    (status = 'visible'::comment_status)
    OR (profile_id = (SELECT auth.uid()))
    OR (author_profile_id = (SELECT auth.uid()))
    OR is_platform_admin()
  );

-- ─────────────────────────────────────────────────────────────────────
-- profile_milestones (1) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profile_milestones_select_own ON public.profile_milestones;
CREATE POLICY profile_milestones_select_own
  ON public.profile_milestones
  FOR SELECT
  TO authenticated
  USING (profile_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- profile_notifications (3)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Recipients can delete notifications" ON public.profile_notifications;
CREATE POLICY "Recipients can delete notifications"
  ON public.profile_notifications
  FOR DELETE
  USING (recipient_profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Recipients can read notifications" ON public.profile_notifications;
CREATE POLICY "Recipients can read notifications"
  ON public.profile_notifications
  FOR SELECT
  USING (recipient_profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Recipients can update notifications" ON public.profile_notifications;
CREATE POLICY "Recipients can update notifications"
  ON public.profile_notifications
  FOR UPDATE
  USING (recipient_profile_id = (SELECT auth.uid()))
  WITH CHECK (recipient_profile_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- profile_search_appearances (1) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profile_search_appearances_insert_self ON public.profile_search_appearances;
CREATE POLICY profile_search_appearances_insert_self
  ON public.profile_search_appearances
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = viewer_id);

-- ─────────────────────────────────────────────────────────────────────
-- push_subscriptions (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  USING (profile_id = (SELECT auth.uid()))
  WITH CHECK (profile_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- pwa_installs (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users read own PWA installs" ON public.pwa_installs;
CREATE POLICY "Users read own PWA installs"
  ON public.pwa_installs
  FOR SELECT
  USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users track own PWA installs" ON public.pwa_installs;
CREATE POLICY "Users track own PWA installs"
  ON public.pwa_installs
  FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- storage_cleanup_queue (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role only for cleanup queue" ON public.storage_cleanup_queue;
CREATE POLICY "Service role only for cleanup queue"
  ON public.storage_cleanup_queue
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ─────────────────────────────────────────────────────────────────────
-- terms_acceptance (2) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can accept terms" ON public.terms_acceptance;
CREATE POLICY "Users can accept terms"
  ON public.terms_acceptance
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own acceptance" ON public.terms_acceptance;
CREATE POLICY "Users can view own acceptance"
  ON public.terms_acceptance
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- umpire_appointments (3)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can delete own umpire appointments" ON public.umpire_appointments;
CREATE POLICY "Users can delete own umpire appointments"
  ON public.umpire_appointments
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own umpire appointments" ON public.umpire_appointments;
CREATE POLICY "Users can insert own umpire appointments"
  ON public.umpire_appointments
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own umpire appointments" ON public.umpire_appointments;
CREATE POLICY "Users can update own umpire appointments"
  ON public.umpire_appointments
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- user_blocks (4) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all blocks" ON public.user_blocks;
CREATE POLICY "Admins can view all blocks"
  ON public.user_blocks
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'admin'
  ));

DROP POLICY IF EXISTS "Users can create blocks" ON public.user_blocks;
CREATE POLICY "Users can create blocks"
  ON public.user_blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can remove own blocks" ON public.user_blocks;
CREATE POLICY "Users can remove own blocks"
  ON public.user_blocks
  FOR DELETE
  TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own blocks" ON public.user_blocks;
CREATE POLICY "Users can view own blocks"
  ON public.user_blocks
  FOR SELECT
  TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- user_devices (3)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users read own devices" ON public.user_devices;
CREATE POLICY "Users read own devices"
  ON public.user_devices
  FOR SELECT
  USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users track own devices" ON public.user_devices;
CREATE POLICY "Users track own devices"
  ON public.user_devices
  FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users update own devices" ON public.user_devices;
CREATE POLICY "Users update own devices"
  ON public.user_devices
  FOR UPDATE
  USING (profile_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- user_engagement_daily (1) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own daily stats" ON public.user_engagement_daily;
CREATE POLICY "Users can read own daily stats"
  ON public.user_engagement_daily
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- user_engagement_heartbeats (2) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own heartbeats" ON public.user_engagement_heartbeats;
CREATE POLICY "Users can insert own heartbeats"
  ON public.user_engagement_heartbeats
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own heartbeats" ON public.user_engagement_heartbeats;
CREATE POLICY "Users can read own heartbeats"
  ON public.user_engagement_heartbeats
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- user_posts (2) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS user_posts_insert_own ON public.user_posts;
CREATE POLICY user_posts_insert_own
  ON public.user_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_posts_update_own ON public.user_posts;
CREATE POLICY user_posts_update_own
  ON public.user_posts
  FOR UPDATE
  TO authenticated
  USING (author_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- user_pulse_items (1) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS user_pulse_items_select_self ON public.user_pulse_items;
CREATE POLICY user_pulse_items_select_self
  ON public.user_pulse_items
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- user_reports (3) — TO authenticated
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins full access to reports" ON public.user_reports;
CREATE POLICY "Admins full access to reports"
  ON public.user_reports
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'admin'
  ));

DROP POLICY IF EXISTS "Users can create reports" ON public.user_reports;
CREATE POLICY "Users can create reports"
  ON public.user_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own reports" ON public.user_reports;
CREATE POLICY "Users can view own reports"
  ON public.user_reports
  FOR SELECT
  TO authenticated
  USING (reporter_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- user_unread_counters (1)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can select their unread counter" ON public.user_unread_counters;
CREATE POLICY "Users can select their unread counter"
  ON public.user_unread_counters
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- user_unread_senders (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role manages unread senders" ON public.user_unread_senders;
CREATE POLICY "Service role manages unread senders"
  ON public.user_unread_senders
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

DROP POLICY IF EXISTS "Users can view their own unread senders" ON public.user_unread_senders;
CREATE POLICY "Users can view their own unread senders"
  ON public.user_unread_senders
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- world_clubs (2)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can create world clubs" ON public.world_clubs;
CREATE POLICY "Authenticated users can create world clubs"
  ON public.world_clubs
  FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "Clubs can update their claimed club" ON public.world_clubs;
CREATE POLICY "Clubs can update their claimed club"
  ON public.world_clubs
  FOR UPDATE
  USING (((SELECT auth.uid()) = claimed_profile_id) OR is_platform_admin());
