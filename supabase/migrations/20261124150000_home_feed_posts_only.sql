-- Home as a feed of posts (founder 2026-11-24).
--
-- The founder's direction for Home is a feed of posts by people, Instagram or
-- LinkedIn style: no automatic cards between them. get_home_feed_v2 gets a
-- fourth argument, p_posts_only (default false). When true the feed returns
-- member posts only (user_posts, signings included): no opportunity,
-- reference or brand cards, no members digest, no "open to play" card.
--
-- Old clients do not send the argument and keep today's feed unchanged,
-- including the installed store apps. The new Home sends it.
--
-- The signature changes, so the three-argument function is dropped first
-- (same approach as 20261110190000); calls with one, two or three named
-- arguments resolve to the new function through its defaults.
-- Grants as before: REVOKE from PUBLIC; EXECUTE to anon, authenticated and
-- service_role. The hidden-profile, block and test-account fences on posts
-- are unchanged.
--
-- The "N new posts" pill needs a count that matches: get_home_feed_new_count
-- counts every feed item, so a posts-only Home would announce posts that are
-- not there. get_home_posts_new_count counts member posts only, with the same
-- fences as the feed (hidden profiles, blocks in both directions, test
-- accounts). New function: REVOKE from PUBLIC and anon, EXECUTE to
-- authenticated and service_role.
-- Rollback: supabase/rollbacks/20261124150000_home_feed_posts_only.down.sql
-- Probe:    supabase/tests/security/home_feed_posts_only.probe.sql

DROP FUNCTION IF EXISTS public.get_home_feed_v2(integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.get_home_feed_v2(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_open_to_play boolean DEFAULT false, p_posts_only boolean DEFAULT false)
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

  WITH otp_people AS (
    -- Players who confirmed in the last 7 days that they are open to play and
    -- still are, as this viewer may see them (hidden, blocked, test and self
    -- excluded).
    SELECT hfi.created_at, p.id AS pid
    FROM home_feed_items hfi
    JOIN profiles p ON p.id = COALESCE(hfi.author_profile_id, NULLIF(hfi.metadata->>'player_id', '')::uuid)
    WHERE p_open_to_play AND NOT p_posts_only
      AND hfi.item_type = 'open_to_play_confirmed' AND hfi.deleted_at IS NULL
      AND hfi.created_at > now() - interval '7 days'
      AND p.onboarding_completed = true AND p.open_to_play = true
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND (v_is_test OR (hfi.is_test_account = false AND COALESCE(p.is_test_account, false) = false))
      AND NOT (p.id = ANY (v_blocked))
      AND p.id IS DISTINCT FROM v_user_id
  ),
  otp_weeks AS (
    -- ONE card (constant id), from 3 players up; it moves up as players confirm.
    SELECT (now() - interval '7 days')::date AS week_start, md5('open_to_play_recent')::uuid AS id,
           max(o.created_at) AS created_at, count(*) AS n
    FROM otp_people o
    HAVING count(*) >= 3
  ),
  keys AS (
    -- Feed items: facts someone would act on (founder 2026-11-10) —
    -- opportunities, references and brand content. Photos and videos added
    -- to a profile and the profile-100% milestone are no longer Home items
    -- (they stay on the profile).
    SELECT 'item'::text AS src, hfi.id, hfi.created_at
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type IN ('opportunity_posted', 'reference_received', 'brand_post', 'brand_product')
      AND NOT p_posts_only
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY (v_blocked)))
      AND NOT EXISTS (SELECT 1 FROM profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))

    UNION ALL

    -- Members digest: the current week's only (one card, never one per past
    -- week), and only when ≥ 4 members this viewer may see.
    SELECT 'digest'::text, hfi.id, hfi.created_at
    FROM home_feed_items hfi
    WHERE hfi.item_type = 'members_digest' AND hfi.deleted_at IS NULL
      AND NOT p_posts_only
      AND hfi.id = (
        SELECT d.id FROM home_feed_items d
        WHERE d.item_type = 'members_digest' AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT 1
      )
      AND (
        SELECT count(*)
        FROM jsonb_array_elements_text(hfi.metadata->'member_ids') AS m(pid)
        JOIN profiles p ON p.id = m.pid::uuid
        WHERE p.onboarding_completed = true
          AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
          AND (v_is_test OR COALESCE(p.is_test_account, false) = false)
          AND NOT (p.id = ANY (v_blocked))
          AND p.id IS DISTINCT FROM v_user_id
      ) >= 4

    UNION ALL

    -- Open to play, one rolling 7-day card (only for clients that ask for it).
    SELECT 'otp'::text, w.id, w.created_at
    FROM otp_weeks w

    UNION ALL

    -- Posts (New signing, transfers render as normal posts on the client).
    SELECT 'post'::text, up.id, up.created_at
    FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT (up.author_id = ANY (v_blocked))
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  ),
  page AS (
    SELECT src, id, created_at FROM keys
    ORDER BY created_at DESC, id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  page_items AS (
    SELECT pg.created_at, pg.id,
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
    FROM page pg JOIN home_feed_items hfi ON pg.src = 'item' AND hfi.id = pg.id

    UNION ALL

    SELECT pg.created_at, pg.id,
      jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', 'members_digest',
        'created_at', hfi.created_at,
        'week_start', hfi.metadata->>'week_start',
        'member_count', d.n,
        'members', d.members
      )
    FROM page pg JOIN home_feed_items hfi ON pg.src = 'digest' AND hfi.id = pg.id
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

    UNION ALL

    SELECT pg.created_at, pg.id,
      jsonb_build_object(
        'feed_item_id', w.id,
        'item_type', 'open_to_play_week',
        'created_at', w.created_at,
        'week_start', to_char(w.week_start, 'YYYY-MM-DD'),
        'member_count', w.n,
        'members', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id', v.id, 'full_name', v.full_name, 'avatar_url', v.avatar_url, 'role', v.role, 'position', v.position)
                   ORDER BY v.created_at DESC), '[]'::jsonb)
          FROM (
            SELECT p.id, p.full_name, p.avatar_url, p.role, p.position, o.created_at
            FROM otp_people o JOIN profiles p ON p.id = o.pid
            ORDER BY o.created_at DESC
            LIMIT 24
          ) v
        )
      )
    FROM page pg JOIN otp_weeks w ON pg.src = 'otp' AND w.id = pg.id

    UNION ALL

    SELECT pg.created_at, pg.id,
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
    FROM page pg JOIN user_posts up ON pg.src = 'post' AND up.id = pg.id
    JOIN profiles p ON p.id = up.author_id
    LEFT JOIN brands b ON b.profile_id = p.id
  )
  SELECT (SELECT count(*) FROM keys),
         COALESCE((SELECT jsonb_agg(x.item_data ORDER BY x.created_at DESC, x.id DESC) FROM page_items x), '[]'::jsonb)
    INTO v_total, v_items;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_home_feed_v2(integer, integer, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_home_feed_v2(integer, integer, boolean, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_home_posts_new_count(p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_test boolean;
  v_count integer;
BEGIN
  IF v_user_id IS NULL OR p_since IS NULL THEN
    RETURN 0;
  END IF;
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;

  SELECT count(*) INTO v_count
  FROM user_posts up
  JOIN profiles p ON p.id = up.author_id
  WHERE up.deleted_at IS NULL
    AND up.created_at > p_since
    AND up.author_id IS DISTINCT FROM v_user_id
    AND (COALESCE(v_is_test, false) OR p.is_test_account IS NULL OR p.is_test_account = false)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id)
         OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id)
    );
  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_home_posts_new_count(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_posts_new_count(timestamptz) TO authenticated, service_role;
