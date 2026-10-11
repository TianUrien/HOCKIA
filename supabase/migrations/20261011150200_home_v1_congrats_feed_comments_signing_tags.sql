-- Home v1, step 2 (Figma Home handoff, rulings + agreed proposals 11 Oct 2026):
-- Congrats, comments on feed items (References in v1), a database-level
-- guard for post comments, and New signing tags.
-- Rollback: supabase/rollbacks/20261011150200_home_v1_congrats_feed_comments_signing_tags.down.sql
-- Probe:    supabase/tests/security/home_v1_engagement_acl.probe.sql (read-only)
--
-- 1. Post comments guard (BEFORE INSERT): comments_enabled, blocks and hidden
--    authors are enforced even for direct inserts (the RLS insert policy lets
--    members insert their own rows without going through create_post_comment).
-- 2. feed_item_comments: comments on home_feed_items. v1 allows References
--    only; phase 2 adds photos / videos by widening feed_item_engageable().
--    The item's owner (author_profile_id) may delete comments and turn them off.
-- 3. feed_congrats: 👏 Congrats, one per viewer per item, tap again to undo.
--    v1 targets: New signing posts and References. Count is public (ruling).
-- 4. New signing tags: the tagged member is notified and can remove the tag;
--    tagging is 18+ only (club-facing rule).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. post comments guard
CREATE OR REPLACE FUNCTION public.guard_post_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_post_author uuid;
  v_enabled boolean;
BEGIN
  SELECT author_id, comments_enabled INTO v_post_author, v_enabled
  FROM user_posts WHERE id = NEW.post_id AND deleted_at IS NULL;
  IF v_post_author IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'Comments are turned off for this post.';
  END IF;
  IF public.is_blocked_pair(NEW.author_id, v_post_author) THEN
    RAISE EXCEPTION 'Cannot interact with this user.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_post_comment_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_post_comment_insert ON public.post_comments;
CREATE TRIGGER trg_guard_post_comment_insert
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_comment_insert();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. comments on feed items
ALTER TABLE public.home_feed_items
  ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;

-- Which feed items take comments / congrats (v1: References).
CREATE OR REPLACE FUNCTION public.feed_item_engageable(p_item_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_item_type IN ('reference_received')
$function$;

CREATE TABLE IF NOT EXISTS public.feed_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_item_id uuid NOT NULL REFERENCES public.home_feed_items (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_feed_item_comments_item ON public.feed_item_comments (feed_item_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_feed_item_comments_author ON public.feed_item_comments (author_id, created_at);

ALTER TABLE public.feed_item_comments ENABLE ROW LEVEL SECURITY;

-- Reads go through get_feed_item_comments (fenced); writes only through RPCs.
DROP POLICY IF EXISTS feed_item_comments_read ON public.feed_item_comments;
CREATE POLICY feed_item_comments_read ON public.feed_item_comments
  FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);

REVOKE ALL ON public.feed_item_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.feed_item_comments TO anon, authenticated;
GRANT ALL ON public.feed_item_comments TO service_role;

-- Counter on the feed item.
CREATE OR REPLACE FUNCTION public.update_feed_item_comment_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE home_feed_items SET comment_count = comment_count + 1 WHERE id = NEW.feed_item_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE home_feed_items SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.feed_item_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE home_feed_items SET comment_count = comment_count + 1 WHERE id = NEW.feed_item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.update_feed_item_comment_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_feed_item_comment_count ON public.feed_item_comments;
CREATE TRIGGER trg_feed_item_comment_count
  AFTER INSERT OR UPDATE OF deleted_at ON public.feed_item_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_feed_item_comment_count();

-- Same daily cap as post comments (20 per 24 h across both kinds).
CREATE OR REPLACE FUNCTION public.enforce_feed_item_comment_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF (SELECT COALESCE(is_test_account, false) FROM profiles WHERE id = NEW.author_id) THEN
    RETURN NEW;
  END IF;
  SELECT (SELECT count(*) FROM post_comments WHERE author_id = NEW.author_id AND created_at > now() - interval '24 hours')
       + (SELECT count(*) FROM feed_item_comments WHERE author_id = NEW.author_id AND created_at > now() - interval '24 hours')
    INTO v_count;
  IF v_count >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 20 comments per 24 hours';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_feed_item_comment_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_feed_item_comment_rate_limit ON public.feed_item_comments;
CREATE TRIGGER trg_feed_item_comment_rate_limit
  BEFORE INSERT ON public.feed_item_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feed_item_comment_rate_limit();

CREATE OR REPLACE FUNCTION public.create_feed_item_comment(p_feed_item_id uuid, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_item record;
  v_trimmed text;
  v_reason text;
  v_comment_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  SELECT id, item_type, author_profile_id, comments_enabled INTO v_item
  FROM home_feed_items WHERE id = p_feed_item_id AND deleted_at IS NULL;
  IF v_item.id IS NULL OR NOT public.feed_item_engageable(v_item.item_type) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;
  IF NOT v_item.comments_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comments are turned off for this post.');
  END IF;
  IF v_item.author_profile_id IS NOT NULL AND public.is_blocked_pair(v_user_id, v_item.author_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot interact with this user.');
  END IF;
  v_trimmed := trim(coalesce(p_content, ''));
  IF v_trimmed = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment content is required');
  END IF;
  IF char_length(v_trimmed) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment exceeds 500 character limit');
  END IF;
  v_reason := content_check(v_trimmed);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_reason);
  END IF;

  INSERT INTO feed_item_comments (feed_item_id, author_id, content)
  VALUES (p_feed_item_id, v_user_id, v_trimmed)
  RETURNING id INTO v_comment_id;

  IF v_item.author_profile_id IS NOT NULL AND v_item.author_profile_id <> v_user_id THEN
    BEGIN
      PERFORM public.enqueue_notification(
        v_item.author_profile_id, v_user_id,
        'feed_item_comment_received'::public.profile_notification_kind,
        v_comment_id,
        jsonb_build_object('feed_item_id', p_feed_item_id, 'comment_id', v_comment_id, 'snippet', left(v_trimmed, 140)),
        '/home'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_notification for feed_item_comment_received failed: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'comment_id', v_comment_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_feed_item_comments(p_feed_item_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_comments jsonb;
  v_total bigint;
BEGIN
  -- Same fences as get_post_comments: blocks both ways, hidden authors.
  SELECT count(*) INTO v_total
  FROM feed_item_comments c
  JOIN profiles p ON p.id = c.author_id
  WHERE c.feed_item_id = p_feed_item_id AND c.deleted_at IS NULL
    AND (v_user_id IS NULL OR NOT public.is_blocked_pair(v_user_id, c.author_id))
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', x.id, 'feed_item_id', x.feed_item_id, 'author_id', x.author_id,
    'author_name', x.full_name, 'author_avatar', x.avatar_url, 'author_role', x.role,
    'content', x.content, 'created_at', x.created_at
  ) ORDER BY x.created_at ASC), '[]'::jsonb) INTO v_comments
  FROM (
    SELECT c.id, c.feed_item_id, c.author_id, c.content, c.created_at, p.full_name, p.avatar_url, p.role
    FROM feed_item_comments c
    JOIN profiles p ON p.id = c.author_id
    WHERE c.feed_item_id = p_feed_item_id AND c.deleted_at IS NULL
      AND (v_user_id IS NULL OR NOT public.is_blocked_pair(v_user_id, c.author_id))
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    ORDER BY c.created_at ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;

  RETURN jsonb_build_object('comments', v_comments, 'total', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_feed_item_comment(p_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_author uuid;
  v_owner uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  SELECT c.author_id, i.author_profile_id INTO v_author, v_owner
  FROM feed_item_comments c JOIN home_feed_items i ON i.id = c.feed_item_id
  WHERE c.id = p_comment_id AND c.deleted_at IS NULL;
  IF v_author IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment not found');
  END IF;
  IF v_author <> v_user_id AND v_owner IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;
  UPDATE feed_item_comments SET deleted_at = timezone('utc', now()) WHERE id = p_comment_id;
  UPDATE profile_notifications SET cleared_at = timezone('utc', now())
  WHERE kind = 'feed_item_comment_received' AND source_entity_id = p_comment_id AND cleared_at IS NULL;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_feed_item_comments_enabled(p_feed_item_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  UPDATE home_feed_items SET comments_enabled = p_enabled
  WHERE id = p_feed_item_id AND author_profile_id = auth.uid() AND deleted_at IS NULL
    AND public.feed_item_engageable(item_type);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;
  RETURN jsonb_build_object('success', true, 'comments_enabled', p_enabled);
END;
$function$;

-- Admin takedown and reports cover feed-item comments too.
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment']));

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
    WHEN 'feed_item_comment' THEN
      UPDATE feed_item_comments SET deleted_at = v_now WHERE id = p_content_id AND deleted_at IS NULL;
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Congrats
CREATE TABLE IF NOT EXISTS public.feed_congrats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('post', 'feed_item')),
  target_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (target_type, target_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_congrats_target ON public.feed_congrats (target_type, target_id);

ALTER TABLE public.feed_congrats ENABLE ROW LEVEL SECURITY;
-- Members read their own rows (has_congrats); counts come from the feed RPC.
DROP POLICY IF EXISTS feed_congrats_read_own ON public.feed_congrats;
CREATE POLICY feed_congrats_read_own ON public.feed_congrats
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.feed_congrats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.feed_congrats TO authenticated;
GRANT ALL ON public.feed_congrats TO service_role;

-- Toggle 👏 on a New signing post or a Reference. Returns the new state + count.
CREATE OR REPLACE FUNCTION public.toggle_congrats(p_target_type text, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_owner uuid;        -- whoever the congrats are for
  v_ok boolean := false;
  v_has boolean;
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_target_type = 'post' THEN
    -- New signing: the congrats go to the tagged member (else the club).
    SELECT true, COALESCE(NULLIF(up.metadata->>'person_profile_id', '')::uuid, up.author_id)
      INTO v_ok, v_owner
    FROM user_posts up
    WHERE up.id = p_target_id AND up.deleted_at IS NULL AND up.post_type = 'signing';
  ELSIF p_target_type = 'feed_item' THEN
    SELECT true, i.author_profile_id INTO v_ok, v_owner
    FROM home_feed_items i
    WHERE i.id = p_target_id AND i.deleted_at IS NULL AND public.feed_item_engageable(i.item_type);
  END IF;

  IF NOT COALESCE(v_ok, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not found');
  END IF;
  IF v_owner IS NOT NULL AND public.is_blocked_pair(v_user_id, v_owner) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot interact with this user.');
  END IF;

  DELETE FROM feed_congrats WHERE target_type = p_target_type AND target_id = p_target_id AND user_id = v_user_id;
  IF FOUND THEN
    v_has := false;
  ELSE
    INSERT INTO feed_congrats (target_type, target_id, user_id) VALUES (p_target_type, p_target_id, v_user_id);
    v_has := true;
  END IF;

  SELECT count(*) INTO v_count FROM feed_congrats WHERE target_type = p_target_type AND target_id = p_target_id;

  -- One notification per item, updated with the latest person and the count.
  IF v_has AND v_owner IS NOT NULL AND v_owner <> v_user_id THEN
    BEGIN
      PERFORM public.enqueue_notification(
        v_owner, v_user_id, 'congrats_received'::public.profile_notification_kind, p_target_id,
        jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'count', v_count),
        '/home'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_notification for congrats_received failed: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'has_congrats', v_has, 'count', v_count);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. New signing tags
-- Tagging is 18+ only: the club-facing search lists adults with a known DOB.
CREATE OR REPLACE FUNCTION public.search_people_for_signing(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, full_name text, avatar_url text, role text, "position" text, current_club text, base_location text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- Home v1 (2026-10-11): clubs tag adults only (known DOB, 18+).
    AND public.profile_is_adult(p.date_of_birth)
  ORDER BY CASE WHEN lower(p.full_name) LIKE v_normalized || '%' THEN 0 ELSE 1 END, p.full_name ASC
  LIMIT LEAST(p_limit, 20);
END;
$function$;

-- The same rule at write time, whichever client posts the signing.
CREATE OR REPLACE FUNCTION public.guard_signing_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_person uuid;
BEGIN
  IF NEW.post_type <> 'signing' THEN
    RETURN NEW;
  END IF;
  v_person := NULLIF(NEW.metadata->>'person_profile_id', '')::uuid;
  IF v_person IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = v_person AND public.profile_is_adult(p.date_of_birth)
  ) THEN
    RAISE EXCEPTION 'Only members aged 18 or over can be tagged in a signing.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_signing_tag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_signing_tag ON public.user_posts;
CREATE TRIGGER trg_guard_signing_tag
  BEFORE INSERT ON public.user_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_signing_tag();

-- Tell the tagged member (Figma H15).
CREATE OR REPLACE FUNCTION public.notify_signing_tagged()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_person uuid;
BEGIN
  IF NEW.post_type <> 'signing' THEN
    RETURN NEW;
  END IF;
  v_person := NULLIF(NEW.metadata->>'person_profile_id', '')::uuid;
  IF v_person IS NULL OR v_person = NEW.author_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.enqueue_notification(
      v_person, NEW.author_id, 'signing_tagged'::public.profile_notification_kind, NEW.id,
      jsonb_build_object('post_id', NEW.id, 'club_name', NEW.metadata->>'club_name'),
      '/home'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification for signing_tagged failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_signing_tagged() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_signing_tagged ON public.user_posts;
CREATE TRIGGER trg_notify_signing_tagged
  AFTER INSERT ON public.user_posts
  FOR EACH ROW EXECUTE FUNCTION public.notify_signing_tagged();

-- The tagged member removes their tag (Figma H16): the post stays as a club
-- post without the member's name or photo.
CREATE OR REPLACE FUNCTION public.remove_signing_tag(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  UPDATE user_posts
  SET metadata = (metadata - 'person_profile_id' - 'person_name' - 'person_avatar_url' - 'person_role' - 'person_position')
                 || jsonb_build_object('tag_removed', true)
  WHERE id = p_post_id AND post_type = 'signing' AND deleted_at IS NULL
    AND metadata->>'person_profile_id' = v_user_id::text;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;
  UPDATE profile_notifications SET cleared_at = timezone('utc', now())
  WHERE recipient_profile_id = v_user_id AND kind = 'signing_tagged' AND source_entity_id = p_post_id AND cleared_at IS NULL;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Grants for the member-facing RPCs (explicit; Oct 2026 default-ACL change).
REVOKE ALL ON FUNCTION public.create_feed_item_comment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_feed_item_comment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_feed_item_comments_enabled(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_congrats(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_signing_tag(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_feed_item_comments(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.feed_item_engageable(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_feed_item_comment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_feed_item_comment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_feed_item_comments_enabled(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_congrats(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_signing_tag(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_feed_item_comments(uuid, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.feed_item_engageable(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_takedown_content(text, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_people_for_signing(text, integer) TO authenticated, service_role;
