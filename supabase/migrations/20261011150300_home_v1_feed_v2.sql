-- Home v1, step 3: the new Home feed (Figma Home handoff + rulings 11 Oct 2026).
-- Rollback: supabase/rollbacks/20261011150300_home_v1_feed_v2.down.sql
-- Probe:    supabase/tests/security/home_v1_feed_v2_acl.probe.sql (read-only)
--
-- get_home_feed (old apps) is NOT changed: the new Home calls
-- get_home_feed_v2, so old app versions keep the item types they know.
--
-- 1. Full matches reach the feed ONLY when public (the player's full-match
--    visibility, 26 Sep ruling stands). Re-publishing a video brings its card
--    back (it used to stay deleted), unless an admin took it down.
-- 2. Members digest: one row per ISO week, kept up to date as members join;
--    shown only when ≥ 4 visible members joined that week.
-- 3. get_home_feed_v2: the design's item types only, with Congrats and
--    comment counts; milestones limited to profile_100_percent.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. full matches when public
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY['member_joined', 'opportunity_posted', 'milestone_achieved', 'reference_received',
    'brand_post', 'brand_product', 'career_move', 'club_responded', 'media_added', 'video_added',
    'open_to_play_confirmed', 'role_filled', 'members_digest']));
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_source_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_source_type_check
  CHECK (source_type = ANY (ARRAY['profile', 'vacancy', 'profile_reference', 'brand_post', 'brand_product',
    'milestone', 'user_post', 'application_response', 'media', 'digest']));

-- The guard now keeps only NON-public full matches out of the feed.
CREATE OR REPLACE FUNCTION public.guard_home_feed_no_full_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.item_type = 'video_added'
     AND COALESCE(NEW.metadata->>'kind', '') = 'full_match'
     AND COALESCE(NEW.metadata->>'visibility', '') <> 'public'
     AND NEW.deleted_at IS NULL THEN
    NEW.deleted_at := timezone('utc', now());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_video_added_feed_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_up RECORD;
BEGIN
  -- Highlights, and full matches the player made public (Home v1 ruling
  -- 2026-10-11). Reels/posts have their own paths.
  IF NEW.kind NOT IN ('highlight', 'full_match') OR NEW.visibility IS DISTINCT FROM 'public' THEN
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
      'video_source', 'native',
      'video_id', NEW.id,
      'kind', NEW.kind,
      'title', NEW.title,
      'duration_seconds', NEW.duration_seconds,
      'visibility', NEW.visibility,
      'uploader_id', v_up.id,
      'uploader_name', v_up.full_name,
      'uploader_role', v_up.role,
      'uploader_avatar_url', v_up.avatar_url),
    timezone('utc', now()))
  -- Made public again → the card comes back, unless an admin took it down.
  ON CONFLICT (item_type, source_id) DO UPDATE
    SET deleted_at = NULL, metadata = EXCLUDED.metadata
    WHERE home_feed_items.deleted_at IS NOT NULL
      AND COALESCE(home_feed_items.metadata->>'taken_down', '') <> 'true';

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_video_added_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('player_video_id', NEW.id, 'user_id', NEW.user_id));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_video_added_feed_insert ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_insert
  AFTER INSERT ON public.player_videos
  FOR EACH ROW WHEN (NEW.status = 'ready' AND NEW.visibility = 'public' AND NEW.kind IN ('highlight', 'full_match'))
  EXECUTE FUNCTION public.generate_video_added_feed_item();

DROP TRIGGER IF EXISTS trigger_video_added_feed_update ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_update
  AFTER UPDATE ON public.player_videos
  FOR EACH ROW WHEN (NEW.status = 'ready' AND NEW.visibility = 'public' AND NEW.kind IN ('highlight', 'full_match')
    AND (OLD.status IS DISTINCT FROM 'ready' OR OLD.visibility IS DISTINCT FROM 'public'))
  EXECUTE FUNCTION public.generate_video_added_feed_item();

-- Takedowns mark the row so re-publishing can't bring it back.
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
      UPDATE home_feed_items
      SET deleted_at = COALESCE(deleted_at, v_now), metadata = metadata || jsonb_build_object('taken_down', true)
      WHERE id = p_content_id;
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
-- 2. members digest (one row per ISO week)
CREATE OR REPLACE FUNCTION public.upsert_members_digest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_week date := date_trunc('week', NEW.created_at AT TIME ZONE 'utc')::date;
BEGIN
  INSERT INTO home_feed_items (item_type, source_id, source_type, is_test_account, metadata, created_at)
  VALUES (
    'members_digest',
    md5('members_digest|' || v_week::text)::uuid,
    'digest',
    false,
    jsonb_build_object('week_start', v_week, 'member_ids', jsonb_build_array(NEW.author_profile_id)),
    NEW.created_at
  )
  ON CONFLICT (item_type, source_id) DO UPDATE
    SET metadata = jsonb_set(
          home_feed_items.metadata, '{member_ids}',
          CASE WHEN home_feed_items.metadata->'member_ids' @> jsonb_build_array(NEW.author_profile_id)
               THEN home_feed_items.metadata->'member_ids'
               ELSE home_feed_items.metadata->'member_ids' || jsonb_build_array(NEW.author_profile_id) END),
        created_at = GREATEST(home_feed_items.created_at, NEW.created_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('upsert_members_digest', SQLSTATE, SQLERRM,
    jsonb_build_object('profile_id', NEW.author_profile_id));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.upsert_members_digest() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_members_digest ON public.home_feed_items;
CREATE TRIGGER trg_members_digest
  AFTER INSERT ON public.home_feed_items
  FOR EACH ROW WHEN (NEW.item_type = 'member_joined' AND NEW.author_profile_id IS NOT NULL)
  EXECUTE FUNCTION public.upsert_members_digest();

-- Backfill the last 8 weeks from existing member_joined rows.
INSERT INTO public.home_feed_items (item_type, source_id, source_type, is_test_account, metadata, created_at)
SELECT 'members_digest',
       md5('members_digest|' || w.week::text)::uuid,
       'digest',
       false,
       jsonb_build_object('week_start', w.week, 'member_ids', w.ids),
       w.last_at
FROM (
  SELECT date_trunc('week', created_at AT TIME ZONE 'utc')::date AS week,
         jsonb_agg(author_profile_id ORDER BY created_at) AS ids,
         max(created_at) AS last_at
  FROM public.home_feed_items
  WHERE item_type = 'member_joined' AND deleted_at IS NULL AND author_profile_id IS NOT NULL
    AND created_at > now() - interval '8 weeks'
  GROUP BY 1
) w
ON CONFLICT (item_type, source_id) DO NOTHING;

-- Old apps: the existing get_home_feed (live body of 20261011140000) keeps
-- digest rows out — ONLY 'members_digest' added to its exclusion lists.
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
         AND hfi.item_type NOT IN ('member_joined', 'career_move', 'members_digest')
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
          AND hfi.item_type NOT IN ('member_joined', 'career_move', 'members_digest')
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
      AND hfi.item_type NOT IN ('member_joined', 'career_move', 'members_digest')
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
        AND hfi2.item_type NOT IN ('member_joined', 'career_move', 'members_digest')
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. get_home_feed_v2
CREATE OR REPLACE FUNCTION public.get_home_feed_v2(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_test boolean;
  v_blocked uuid[];
  v_items jsonb;
  v_total bigint;
BEGIN
  SELECT is_staging_env() OR COALESCE((SELECT is_test_account FROM profiles WHERE id = v_user_id), false) INTO v_is_test;
  SELECT COALESCE(array_agg(other_id), ARRAY[]::uuid[]) INTO v_blocked FROM (
    SELECT blocked_id AS other_id FROM user_blocks WHERE blocker_id = v_user_id
    UNION SELECT blocker_id FROM user_blocks WHERE blocked_id = v_user_id
  ) b;

  WITH items AS (
    -- Feed items in the design (Figma Home v1): opportunities, references,
    -- photos, videos (highlights + public full matches), brand content,
    -- profile-100% milestones.
    SELECT hfi.created_at,
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at,
        'author_role', hfi.author_role,
        'author_profile_id', hfi.author_profile_id,
        'comment_count', CASE WHEN public.feed_item_engageable(hfi.item_type) THEN hfi.comment_count END,
        'comments_enabled', CASE WHEN public.feed_item_engageable(hfi.item_type) THEN hfi.comments_enabled END,
        'congrats_count', CASE WHEN public.feed_item_engageable(hfi.item_type)
          THEN (SELECT count(*) FROM feed_congrats fc WHERE fc.target_type = 'feed_item' AND fc.target_id = hfi.id) END,
        'has_congrats', CASE WHEN public.feed_item_engageable(hfi.item_type)
          THEN EXISTS (SELECT 1 FROM feed_congrats fc WHERE fc.target_type = 'feed_item' AND fc.target_id = hfi.id AND fc.user_id = v_user_id) END
      ) AS item_data
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type IN ('opportunity_posted', 'reference_received', 'media_added', 'video_added', 'brand_post', 'brand_product', 'milestone_achieved')
      AND (hfi.item_type <> 'milestone_achieved' OR hfi.metadata->>'milestone_type' = 'profile_100_percent')
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY (v_blocked)))
      AND NOT EXISTS (SELECT 1 FROM profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))

    UNION ALL

    -- Members digest: only the members this viewer may see, only when ≥ 4.
    SELECT hfi.created_at,
      jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', 'members_digest',
        'created_at', hfi.created_at,
        'week_start', hfi.metadata->>'week_start',
        'member_count', d.n,
        'members', d.members
      )
    FROM home_feed_items hfi
    CROSS JOIN LATERAL (
      SELECT count(*) AS n,
             COALESCE(jsonb_agg(jsonb_build_object('id', v.id, 'full_name', v.full_name, 'avatar_url', v.avatar_url, 'role', v.role)
                        ORDER BY v.ord DESC) FILTER (WHERE v.rn <= 6), '[]'::jsonb) AS members
      FROM (
        SELECT p.id, p.full_name, p.avatar_url, p.role, m.ord,
               row_number() OVER (ORDER BY m.ord DESC) AS rn
        FROM jsonb_array_elements_text(hfi.metadata->'member_ids') WITH ORDINALITY AS m(pid, ord)
        JOIN profiles p ON p.id = m.pid::uuid
        WHERE p.onboarding_completed = true
          AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
          AND (v_is_test OR COALESCE(p.is_test_account, false) = false)
          AND NOT (p.id = ANY (v_blocked))
          AND p.id IS DISTINCT FROM v_user_id
      ) v
    ) d
    WHERE hfi.item_type = 'members_digest' AND hfi.deleted_at IS NULL AND d.n >= 4

    UNION ALL

    -- Posts (New signing, transfers render as normal posts on the client).
    SELECT up.created_at,
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
        'comments_enabled', up.comments_enabled,
        'post_type', up.post_type,
        'metadata', CASE
          WHEN up.post_type = 'signing' AND up.metadata ? 'person_profile_id' AND EXISTS (
            SELECT 1 FROM profiles tp
            WHERE tp.id::text = up.metadata->>'person_profile_id'
              AND (public.profile_is_hidden(tp.is_blocked, tp.frozen_minor_at)
                   OR (v_user_id IS NOT NULL AND public.is_blocked_pair(v_user_id, tp.id)))
          ) THEN up.metadata - 'person_profile_id' - 'person_name' - 'person_avatar_url' - 'person_role' - 'person_position'
          ELSE up.metadata
        END,
        'has_liked', EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = up.id AND pl.user_id = v_user_id),
        'congrats_count', CASE WHEN up.post_type = 'signing'
          THEN (SELECT count(*) FROM feed_congrats fc WHERE fc.target_type = 'post' AND fc.target_id = up.id) END,
        'has_congrats', CASE WHEN up.post_type = 'signing'
          THEN EXISTS (SELECT 1 FROM feed_congrats fc WHERE fc.target_type = 'post' AND fc.target_id = up.id AND fc.user_id = v_user_id) END
      )
    FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    LEFT JOIN brands b ON b.profile_id = p.id
    WHERE up.deleted_at IS NULL
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT (up.author_id = ANY (v_blocked))
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  )
  SELECT (SELECT count(*) FROM items),
         COALESCE((SELECT jsonb_agg(x.item_data ORDER BY x.created_at DESC)
                   FROM (SELECT item_data, created_at FROM items ORDER BY created_at DESC
                         LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) x), '[]'::jsonb)
    INTO v_total, v_items;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_home_feed_v2(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_home_feed_v2(integer, integer) TO anon, authenticated, service_role;
