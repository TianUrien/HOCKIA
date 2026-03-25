-- Revert ALL RLS policies to their original pre-block form.
-- Block enforcement for these features will be done in RPCs only
-- (not in RLS policies, which cause PostgREST schema cache issues).

-- Conversations INSERT — original
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    participant_one_id = auth.uid()
    OR participant_two_id = auth.uid()
  );

-- Messages INSERT — original
DROP POLICY IF EXISTS "Users can send messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can send messages in their conversations v2"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.user_in_conversation(conversation_id, auth.uid())
  );

-- Profile comments SELECT — original
DROP POLICY IF EXISTS "Visible comments are public" ON public.profile_comments;
CREATE POLICY "Visible comments are public"
  ON public.profile_comments FOR SELECT
  USING (
    status = 'visible'
    OR profile_id = auth.uid()
    OR author_profile_id = auth.uid()
    OR public.is_platform_admin()
  );

-- Profile comments INSERT — original
DROP POLICY IF EXISTS "Users can create comments" ON public.profile_comments;
CREATE POLICY "Users can create comments"
  ON public.profile_comments FOR INSERT
  WITH CHECK (
    auth.uid() = author_profile_id
    AND author_profile_id <> profile_id
  );

-- Community questions SELECT — original
DROP POLICY IF EXISTS "questions_select" ON public.community_questions;
CREATE POLICY "questions_select" ON public.community_questions FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_test_account = true)
      OR is_test_content = false
      OR public.is_platform_admin()
    )
  );

-- Community answers SELECT — original
DROP POLICY IF EXISTS "answers_select" ON public.community_answers;
CREATE POLICY "answers_select" ON public.community_answers FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_test_account = true)
      OR is_test_content = false
      OR public.is_platform_admin()
    )
  );

-- Friendships INSERT — original (already clean, just verify)
DROP POLICY IF EXISTS "friendships insert" ON public.profile_friendships;
CREATE POLICY "friendships insert"
  ON public.profile_friendships FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() = requester_id
      AND (auth.uid() = user_one OR auth.uid() = user_two)
      AND status = 'pending'
    )
  );

-- NOTE: Block enforcement is still fully active via:
-- 1. All SECURITY DEFINER RPCs (get_home_feed, search_content, discover_profiles,
--    get_user_conversations, get_post_comments, create_post_comment,
--    get_notifications, get_notification_counts, enqueue_notification,
--    get_profile_references, request_reference, get_my_profile_viewers,
--    get_club_members, get_brand_followers, get_brand_ambassadors_public,
--    get_profile_posts, get_home_feed_new_count, search_people_for_signing)
-- 2. The block_user RPC (severs friendships, references, notifications)
-- 3. Frontend profile page block checks (is_blocked_pair)
