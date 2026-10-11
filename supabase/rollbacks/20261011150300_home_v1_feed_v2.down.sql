-- ROLLBACK for 20261011150300_home_v1_feed_v2.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011150300 --linked
--
-- Drops get_home_feed_v2 and the members digest; full matches leave the feed
-- again; restores the previous video generator, guard, takedown and old feed.

DROP FUNCTION IF EXISTS public.get_home_feed_v2(integer, integer);
DROP TRIGGER IF EXISTS trg_members_digest ON public.home_feed_items;
DROP FUNCTION IF EXISTS public.upsert_members_digest();
DELETE FROM public.home_feed_items WHERE item_type = 'members_digest';

ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY['member_joined', 'opportunity_posted', 'milestone_achieved', 'reference_received',
    'brand_post', 'brand_product', 'career_move', 'club_responded', 'media_added', 'video_added',
    'open_to_play_confirmed', 'role_filled']));
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_source_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_source_type_check
  CHECK (source_type = ANY (ARRAY['profile', 'vacancy', 'profile_reference', 'brand_post', 'brand_product',
    'milestone', 'user_post', 'application_response', 'media']));

UPDATE public.home_feed_items SET deleted_at = timezone('utc', now())
WHERE item_type = 'video_added' AND metadata->>'kind' = 'full_match' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION "public"."guard_home_feed_no_full_match"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.item_type = 'video_added'
     AND COALESCE(NEW.metadata->>'kind', '') = 'full_match'
     AND NEW.deleted_at IS NULL THEN
    NEW.deleted_at := timezone('utc', now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."generate_video_added_feed_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_up RECORD;
BEGIN
  -- Highlights only. Full matches are recruiting evidence, never Home feed
  -- content (founder ruling 2026-09-25); reels/posts have their own paths.
  -- The trigger WHEN clause enforces the same, this guards a re-created trigger.
  IF NEW.kind IS DISTINCT FROM 'highlight' THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_up
  FROM public.profiles p WHERE p.id = NEW.user_id;

  -- Hidden (banned/frozen) uploader → no card.
  IF v_up.id IS NULL
     OR public.profile_is_hidden(v_up.is_blocked, v_up.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata, created_at)
  VALUES (
    'video_added', NEW.id, 'media', v_up.is_test,
    v_up.id, v_up.role, v_up.nationality_country_id,
    jsonb_build_object(
      'media_kind', 'video',
      'video_source', 'native',            -- Cloudflare Stream (vs deprecated full_game)
      'video_id', NEW.id,                  -- token-mint anchor + deep-link; NOT thumbnail_url
      'kind', NEW.kind,                    -- always 'highlight'
      'title', NEW.title,
      'duration_seconds', NEW.duration_seconds,
      'visibility', NEW.visibility,        -- always 'public' (WHEN clause)
      'uploader_id', v_up.id,
      'uploader_name', v_up.full_name,
      'uploader_role', v_up.role,
      'uploader_avatar_url', v_up.avatar_url),
    timezone('utc', now()))                -- dated at ready-time; no day bucket → no cross-midnight split
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_video_added_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('player_video_id', NEW.id, 'user_id', NEW.user_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_video_added_feed_insert ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_insert AFTER INSERT ON public.player_videos
  FOR EACH ROW WHEN (NEW.status = 'ready' AND NEW.visibility = 'public' AND NEW.kind = 'highlight')
  EXECUTE FUNCTION public.generate_video_added_feed_item();
DROP TRIGGER IF EXISTS trigger_video_added_feed_update ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_update AFTER UPDATE ON public.player_videos
  FOR EACH ROW WHEN (NEW.status = 'ready' AND NEW.visibility = 'public' AND NEW.kind = 'highlight'
    AND (OLD.status IS DISTINCT FROM 'ready' OR OLD.visibility IS DISTINCT FROM 'public'))
  EXECUTE FUNCTION public.generate_video_added_feed_item();

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

CREATE OR REPLACE FUNCTION public.get_home_feed(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_item_type text DEFAULT NULL::text, p_country_ids integer[] DEFAULT NULL::integer[], p_roles text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_blocked_ids UUID[];
BEGIN
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  -- Bidirectional: caller blocked them OR they blocked caller. Matches
  -- the semantics of public.is_blocked_pair used by enqueue_notification.
  SELECT COALESCE(array_agg(other_id), ARRAY[]::UUID[])
    INTO v_blocked_ids
    FROM (
      SELECT blocked_id AS other_id FROM user_blocks WHERE blocker_id = v_user_id
      UNION
      SELECT blocker_id AS other_id FROM user_blocks WHERE blocked_id = v_user_id
    ) blocks;

  IF p_item_type IS NULL OR p_item_type = '' THEN

    SELECT (
      (SELECT COUNT(*)
       FROM home_feed_items hfi
       WHERE hfi.deleted_at IS NULL
         AND hfi.item_type NOT IN ('member_joined', 'career_move')
         AND (v_is_test OR hfi.is_test_account = false)
         AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
         -- age-gate: items by hidden authors vanish (NULL authors pass)
         AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
         AND (
           p_roles IS NULL
           OR hfi.author_role = ANY(p_roles)
         )
         AND (
           p_country_ids IS NULL
           OR hfi.item_type IN ('brand_post', 'brand_product')
           OR hfi.author_role = 'brand'
           OR hfi.author_country_id = ANY(p_country_ids)
         )
      )
      +
      (SELECT COUNT(*)
       FROM user_posts up
       JOIN profiles p ON p.id = up.author_id
       WHERE up.deleted_at IS NULL
         AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
         AND NOT (up.author_id = ANY(v_blocked_ids))
         -- age-gate: posts by hidden authors vanish
         AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
         AND (
           p_roles IS NULL
           OR p.role = ANY(p_roles)
         )
         AND (
           p_country_ids IS NULL
           OR p.role = 'brand'
           OR p.nationality_country_id = ANY(p_country_ids)
         )
      )
    ) INTO v_total;

    SELECT COALESCE(jsonb_agg(c.item_data ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT item_data, created_at FROM (
        SELECT
          hfi.created_at,
          hfi.metadata || jsonb_build_object(
            'feed_item_id', hfi.id,
            'item_type', hfi.item_type,
            'created_at', hfi.created_at,
            'author_role', hfi.author_role
          ) AS item_data
        FROM home_feed_items hfi
        WHERE hfi.deleted_at IS NULL
          AND hfi.item_type NOT IN ('member_joined', 'career_move')
          AND (v_is_test OR hfi.is_test_account = false)
          AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
          -- age-gate: items by hidden authors vanish (NULL authors pass)
          AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
          AND (
            p_roles IS NULL
            OR hfi.author_role = ANY(p_roles)
          )
          AND (
            p_country_ids IS NULL
            OR hfi.item_type IN ('brand_post', 'brand_product')
            OR hfi.author_role = 'brand'
            OR hfi.author_country_id = ANY(p_country_ids)
          )

        UNION ALL

        SELECT
          up.created_at,
          jsonb_build_object(
            'feed_item_id', up.id,
            'item_type', 'user_post',
            'created_at', up.created_at,
            'post_id', up.id,
            'author_id', up.author_id,
            'author_name', COALESCE(b.name, p.full_name),
            'author_avatar', COALESCE(b.logo_url, p.avatar_url),
            'author_role', p.role,
            'content', up.content,
            'images', up.images,
            'like_count', up.like_count,
            'comment_count', up.comment_count,
            'metadata', CASE
              -- A signing's tagged member who is now hidden, or in a block
              -- with the viewer, never appears on the card.
              WHEN up.post_type = 'signing' AND up.metadata ? 'person_profile_id' AND EXISTS (
                SELECT 1 FROM profiles tp
                WHERE tp.id::text = up.metadata->>'person_profile_id'
                  AND (public.profile_is_hidden(tp.is_blocked, tp.frozen_minor_at)
                       OR (v_user_id IS NOT NULL AND public.is_blocked_pair(v_user_id, tp.id)))
              ) THEN up.metadata - 'person_profile_id' - 'person_name' - 'person_avatar_url' - 'person_role' - 'person_position'
              ELSE up.metadata
            END,
            'post_type', up.post_type,
            'has_liked', EXISTS (
              SELECT 1 FROM post_likes pl
              WHERE pl.post_id = up.id AND pl.user_id = v_user_id
            )
          ) AS item_data
        FROM user_posts up
        JOIN profiles p ON p.id = up.author_id
        LEFT JOIN brands b ON b.profile_id = p.id
        WHERE up.deleted_at IS NULL
          AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
          AND NOT (up.author_id = ANY(v_blocked_ids))
          -- age-gate: posts by hidden authors vanish
          AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
          AND (
            p_roles IS NULL
            OR p.role = ANY(p_roles)
          )
          AND (
            p_country_ids IS NULL
            OR p.role = 'brand'
            OR p.nationality_country_id = ANY(p_country_ids)
          )
      ) unified
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) c;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  IF p_item_type != 'user_post' THEN
    SELECT COUNT(*) INTO v_total
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type = p_item_type
      AND hfi.item_type NOT IN ('member_joined', 'career_move')
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
      -- age-gate: items by hidden authors vanish (NULL authors pass)
      AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
      AND (p_roles IS NULL OR hfi.author_role = ANY(p_roles))
      AND (
        p_country_ids IS NULL
        OR hfi.item_type IN ('brand_post', 'brand_product')
        OR hfi.author_role = 'brand'
        OR hfi.author_country_id = ANY(p_country_ids)
      );

    SELECT COALESCE(jsonb_agg(
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at,
        'author_role', hfi.author_role
      )
      ORDER BY hfi.created_at DESC
    ), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, item_type, metadata, created_at, author_role
      FROM home_feed_items hfi2
      WHERE hfi2.deleted_at IS NULL
        AND hfi2.item_type = p_item_type
        AND hfi2.item_type NOT IN ('member_joined', 'career_move')
        AND (v_is_test OR hfi2.is_test_account = false)
        AND (hfi2.author_profile_id IS NULL OR NOT (hfi2.author_profile_id = ANY(v_blocked_ids)))
        -- age-gate: items by hidden authors vanish (NULL authors pass)
        AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi2.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
        AND (p_roles IS NULL OR hfi2.author_role = ANY(p_roles))
        AND (
          p_country_ids IS NULL
          OR hfi2.item_type IN ('brand_post', 'brand_product')
          OR hfi2.author_role = 'brand'
          OR hfi2.author_country_id = ANY(p_country_ids)
        )
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) hfi;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM user_posts up
  JOIN profiles p ON p.id = up.author_id
  WHERE up.deleted_at IS NULL
    AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
    AND NOT (up.author_id = ANY(v_blocked_ids))
    -- age-gate: posts by hidden authors vanish
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (
      p_country_ids IS NULL
      OR p.role = 'brand'
      OR p.nationality_country_id = ANY(p_country_ids)
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'feed_item_id', up.id,
      'item_type', 'user_post',
      'created_at', up.created_at,
      'post_id', up.id,
      'author_id', up.author_id,
      'author_name', COALESCE(b.name, p.full_name),
      'author_avatar', COALESCE(b.logo_url, p.avatar_url),
      'author_role', p.role,
      'content', up.content,
      'images', up.images,
      'like_count', up.like_count,
      'comment_count', up.comment_count,
      'metadata', CASE
              -- A signing's tagged member who is now hidden, or in a block
              -- with the viewer, never appears on the card.
              WHEN up.post_type = 'signing' AND up.metadata ? 'person_profile_id' AND EXISTS (
                SELECT 1 FROM profiles tp
                WHERE tp.id::text = up.metadata->>'person_profile_id'
                  AND (public.profile_is_hidden(tp.is_blocked, tp.frozen_minor_at)
                       OR (v_user_id IS NOT NULL AND public.is_blocked_pair(v_user_id, tp.id)))
              ) THEN up.metadata - 'person_profile_id' - 'person_name' - 'person_avatar_url' - 'person_role' - 'person_position'
              ELSE up.metadata
            END,
            'post_type', up.post_type,
      'has_liked', EXISTS (
        SELECT 1 FROM post_likes pl
        WHERE pl.post_id = up.id AND pl.user_id = v_user_id
      )
    )
    ORDER BY up.created_at DESC
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT up2.id, up2.author_id, up2.content, up2.images,
           up2.like_count, up2.comment_count, up2.created_at, up2.post_type, up2.metadata
    FROM user_posts up2
    JOIN profiles p2 ON p2.id = up2.author_id
    WHERE up2.deleted_at IS NULL
      AND (v_is_test OR p2.is_test_account IS NULL OR p2.is_test_account = false)
      AND NOT (up2.author_id = ANY(v_blocked_ids))
      -- age-gate: posts by hidden authors vanish
      AND NOT public.profile_is_hidden(p2.is_blocked, p2.frozen_minor_at)
      AND (p_roles IS NULL OR p2.role = ANY(p_roles))
      AND (
        p_country_ids IS NULL
        OR p2.role = 'brand'
        OR p2.nationality_country_id = ANY(p_country_ids)
      )
    ORDER BY up2.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) up
  JOIN profiles p ON p.id = up.author_id
  LEFT JOIN brands b ON b.profile_id = p.id;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$;
