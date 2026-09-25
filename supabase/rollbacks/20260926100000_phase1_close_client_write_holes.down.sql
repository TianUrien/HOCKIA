-- ROLLBACK for supabase/migrations/20260926100000_phase1_close_client_write_holes.sql
-- NOT a migration (this folder is never pushed). Only for an emergency: it REOPENS the
-- five holes. Restores the exact pre-migration policies, grants and function bodies as
-- read from production/staging on 2026-09-26 (identical on both).
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then, so the migration history matches:
--   supabase migration repair --status reverted 20260926100000 --linked

-- 5. messages
DROP TRIGGER IF EXISTS messages_normalize_client_insert ON public.messages;
DROP FUNCTION IF EXISTS public.normalize_message_client_insert();
DROP FUNCTION IF EXISTS public.shared_post_card(uuid, text);

CREATE OR REPLACE FUNCTION public.enforce_message_update_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid             uuid    := auth.uid();
  v_content_changed boolean := NEW.content    IS DISTINCT FROM OLD.content;
  v_edited_changed  boolean := NEW.edited_at  IS DISTINCT FROM OLD.edited_at;
  v_deleted_changed boolean := NEW.deleted_at IS DISTINCT FROM OLD.deleted_at;
BEGIN
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Message sender is immutable';
  END IF;
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'Message conversation is immutable';
  END IF;
  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    RAISE EXCEPTION 'Message timestamp is immutable';
  END IF;
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'Message idempotency key is immutable';
  END IF;
  IF NOT v_content_changed AND NOT v_edited_changed AND NOT v_deleted_changed THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Only the author can edit or delete a message';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted messages cannot be modified';
  END IF;
  IF v_content_changed
     AND NOT v_edited_changed
     AND NOT (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Message content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. user_posts
GRANT INSERT, UPDATE ON public.user_posts TO anon, authenticated;
CREATE POLICY user_posts_insert_own ON public.user_posts
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid() AS uid));
CREATE POLICY user_posts_update_own ON public.user_posts
  FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid() AS uid));

-- 3. profile_references
CREATE POLICY profile_references_insert ON public.profile_references
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.role() AS role) = 'service_role'::text)
              OR (((SELECT auth.uid() AS uid) = requester_id) AND (status = 'pending'::profile_reference_status)));
CREATE POLICY profile_references_reference_update ON public.profile_references
  FOR UPDATE TO authenticated
  USING (((SELECT auth.role() AS role) = 'service_role'::text) OR ((SELECT auth.uid() AS uid) = reference_id))
  WITH CHECK (((SELECT auth.role() AS role) = 'service_role'::text)
              OR (((SELECT auth.uid() AS uid) = reference_id)
                  AND (status = ANY (ARRAY['pending'::profile_reference_status, 'accepted'::profile_reference_status,
                                           'declined'::profile_reference_status, 'revoked'::profile_reference_status]))));
CREATE POLICY profile_references_requester_update ON public.profile_references
  FOR UPDATE TO authenticated
  USING (((SELECT auth.role() AS role) = 'service_role'::text) OR ((SELECT auth.uid() AS uid) = requester_id))
  WITH CHECK (((SELECT auth.role() AS role) = 'service_role'::text)
              OR (((SELECT auth.uid() AS uid) = requester_id)
                  AND (status = ANY (ARRAY['pending'::profile_reference_status, 'revoked'::profile_reference_status]))));

-- 2. opportunity_applications
DROP TRIGGER IF EXISTS trg_guard_application_client_write ON public.opportunity_applications;
DROP FUNCTION IF EXISTS public.guard_application_client_write();
REVOKE UPDATE (status, metadata) ON public.opportunity_applications FROM authenticated;
GRANT UPDATE ON public.opportunity_applications TO anon, authenticated;

-- 1. conversations
CREATE POLICY "Users can update conversations" ON public.conversations
  FOR UPDATE TO authenticated
  USING ((participant_one_id = (SELECT auth.uid() AS uid)) OR (participant_two_id = (SELECT auth.uid() AS uid)));
ALTER FUNCTION public.update_conversation_timestamp() SECURITY INVOKER;
DROP TRIGGER IF EXISTS enforce_conversation_immutability ON public.conversations;
DROP FUNCTION IF EXISTS public.enforce_conversation_update_immutability();
