-- ROLLBACK for 20261011150200_home_v1_congrats_feed_comments_signing_tags.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011150200 --linked
--
-- Drops Congrats, feed-item comments, the comment / signing guards and the
-- signing-tag notification; restores the previous signing search and takedown.

DROP TRIGGER IF EXISTS trg_guard_post_comment_insert ON public.post_comments;
DROP TRIGGER IF EXISTS trg_guard_signing_tag ON public.user_posts;
DROP TRIGGER IF EXISTS trg_notify_signing_tagged ON public.user_posts;
DROP FUNCTION IF EXISTS public.guard_post_comment_insert();
DROP FUNCTION IF EXISTS public.guard_signing_tag();
DROP FUNCTION IF EXISTS public.notify_signing_tagged();
DROP FUNCTION IF EXISTS public.remove_signing_tag(uuid);
DROP FUNCTION IF EXISTS public.toggle_congrats(text, uuid);
DROP FUNCTION IF EXISTS public.create_feed_item_comment(uuid, text);
DROP FUNCTION IF EXISTS public.get_feed_item_comments(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.delete_feed_item_comment(uuid);
DROP FUNCTION IF EXISTS public.set_feed_item_comments_enabled(uuid, boolean);
DROP TABLE IF EXISTS public.feed_congrats;
DROP TABLE IF EXISTS public.feed_item_comments;
DROP FUNCTION IF EXISTS public.update_feed_item_comment_count();
DROP FUNCTION IF EXISTS public.enforce_feed_item_comment_rate_limit();
DROP FUNCTION IF EXISTS public.feed_item_engageable(text);
ALTER TABLE public.home_feed_items DROP COLUMN IF EXISTS comment_count, DROP COLUMN IF EXISTS comments_enabled;

DELETE FROM public.user_reports WHERE content_type = 'feed_item_comment';
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item']));

CREATE OR REPLACE FUNCTION public.admin_takedown_content(
  p_content_type text,
  p_content_id uuid,
  p_report_id uuid DEFAULT NULL,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_found boolean := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  CASE p_content_type
    WHEN 'post' THEN
      UPDATE user_posts SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    WHEN 'comment' THEN
      UPDATE post_comments SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    WHEN 'profile_comment' THEN
      UPDATE profile_comments SET status = 'hidden' WHERE id = p_content_id AND status <> 'hidden';
      v_found := FOUND;
    WHEN 'feed_item' THEN
      UPDATE home_feed_items SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
      v_found := FOUND;
    ELSE
      RAISE EXCEPTION 'Unsupported content type: %', p_content_type;
  END CASE;

  IF p_report_id IS NOT NULL THEN
    UPDATE user_reports SET status = 'resolved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_report_id;
  END IF;

  INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'takedown_content', p_content_type, p_content_id,
          jsonb_build_object('report_id', p_report_id, 'admin_note', p_admin_note, 'was_visible', v_found));

  RETURN jsonb_build_object('success', true, 'taken_down', v_found);
END;
$function$;

CREATE OR REPLACE FUNCTION "public"."search_people_for_signing"("p_query" "text", "p_limit" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "full_name" "text", "avatar_url" "text", "role" "text", "position" "text", "current_club" "text", "base_location" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_user_id UUID := auth.uid(); v_normalized TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  v_normalized := lower(trim(p_query));
  IF char_length(v_normalized) < 2 THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.avatar_url, p.role, p.position, p.current_club, p.base_location
  FROM profiles p
  WHERE p.role IN ('player', 'coach') AND p.onboarding_completed = true AND p.id != v_user_id
    AND lower(p.full_name) LIKE '%' || v_normalized || '%'
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
    -- age-gate: layer-3 contact fence (also this RPC's first is_blocked filter)
    AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
  ORDER BY CASE WHEN lower(p.full_name) LIKE v_normalized || '%' THEN 0 ELSE 1 END, p.full_name ASC
  LIMIT LEAST(p_limit, 20);
END;
$$;
