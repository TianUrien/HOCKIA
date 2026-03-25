-- Fix: Replace is_blocked_pair() calls in RLS policies with inline subqueries.
-- SECURITY DEFINER functions in RLS policies cause PostgreSQL error 42P10
-- ("no unique or exclusion constraint matching ON CONFLICT specification")
-- because PostgREST's schema cache interprets them incorrectly for INSERT planning.

-- 1. Conversations INSERT — use inline check
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    (participant_one_id = auth.uid() OR participant_two_id = auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = participant_one_id AND ub.blocked_id = participant_two_id)
         OR (ub.blocker_id = participant_two_id AND ub.blocked_id = participant_one_id)
    )
  );

-- 2. Profile comments SELECT — use inline check
DROP POLICY IF EXISTS "Visible comments are public" ON public.profile_comments;
CREATE POLICY "Visible comments are public"
  ON public.profile_comments FOR SELECT
  USING (
    (status = 'visible' OR profile_id = auth.uid() OR author_profile_id = auth.uid() OR public.is_platform_admin())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = author_profile_id)
         OR (ub.blocker_id = author_profile_id AND ub.blocked_id = auth.uid())
    )
  );

-- 3. Profile comments INSERT — use inline check
DROP POLICY IF EXISTS "Users can create comments" ON public.profile_comments;
CREATE POLICY "Users can create comments"
  ON public.profile_comments FOR INSERT
  WITH CHECK (
    auth.uid() = author_profile_id
    AND author_profile_id <> profile_id
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = profile_id)
         OR (ub.blocker_id = profile_id AND ub.blocked_id = auth.uid())
    )
  );

-- 4. Community questions SELECT — use inline check
DROP POLICY IF EXISTS "questions_select" ON public.community_questions;
CREATE POLICY "questions_select" ON public.community_questions FOR SELECT
  USING (
    deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_test_account = true) OR is_test_content = false OR public.is_platform_admin())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = author_id)
         OR (ub.blocker_id = author_id AND ub.blocked_id = auth.uid())
    )
  );

-- 5. Community answers SELECT — use inline check
DROP POLICY IF EXISTS "answers_select" ON public.community_answers;
CREATE POLICY "answers_select" ON public.community_answers FOR SELECT
  USING (
    deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_test_account = true) OR is_test_content = false OR public.is_platform_admin())
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = author_id)
         OR (ub.blocker_id = author_id AND ub.blocked_id = auth.uid())
    )
  );

-- 6. Messages INSERT — use inline check (already was inline, just verify)
DROP POLICY IF EXISTS "Users can send messages in their conversations v2" ON public.messages;
CREATE POLICY "Users can send messages in their conversations v2"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.user_in_conversation(conversation_id, auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.user_blocks ub ON
        (ub.blocker_id = auth.uid() AND ub.blocked_id = CASE WHEN c.participant_one_id = auth.uid() THEN c.participant_two_id ELSE c.participant_one_id END)
        OR (ub.blocked_id = auth.uid() AND ub.blocker_id = CASE WHEN c.participant_one_id = auth.uid() THEN c.participant_two_id ELSE c.participant_one_id END)
      WHERE c.id = conversation_id
    )
  );
