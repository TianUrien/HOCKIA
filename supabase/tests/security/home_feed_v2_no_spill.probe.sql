-- Probe for 20261025190000_home_feed_v2_no_spill.sql (run on staging; rolls itself back).
-- Loads the previous and the new get_home_feed_v2 as temporary functions and
-- compares them for several viewers and pages: same total, same items (by
-- feed_item_id, as a set per page; ties on created_at may order differently),
-- and the same JSON for every item.
CREATE OR REPLACE FUNCTION pg_temp.feed_old(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
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

CREATE OR REPLACE FUNCTION pg_temp.feed_new(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
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

  WITH keys AS (
    -- Feed items in the design (Figma Home v1): opportunities, references,
    -- photos, videos (highlights + public full matches), brand content,
    -- profile-100% milestones.
    SELECT 'item'::text AS src, hfi.id, hfi.created_at
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type IN ('opportunity_posted', 'reference_received', 'media_added', 'video_added', 'brand_post', 'brand_product', 'milestone_achieved')
      AND (hfi.item_type <> 'milestone_achieved' OR hfi.metadata->>'milestone_type' = 'profile_100_percent')
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY (v_blocked)))
      AND NOT EXISTS (SELECT 1 FROM profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))

    UNION ALL

    -- Members digest: only when ≥ 4 members this viewer may see.
    SELECT 'digest'::text, hfi.id, hfi.created_at
    FROM home_feed_items hfi
    WHERE hfi.item_type = 'members_digest' AND hfi.deleted_at IS NULL
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

DO $probe$
DECLARE
  viewers uuid[] := ARRAY[NULL,
    '48111dbd-cce7-4ed3-991d-9d46d2959a48'::uuid,   -- E2E player
    '38965930-2a53-47bf-85af-a0e9852c257b'::uuid,   -- E2E club
    'b2f1cff7-f71b-44ec-8086-d5e22bed27fd'::uuid];  -- E2E brand
  pages int[][] := ARRAY[[20,0],[20,20],[50,0],[50,500],[50,5650]];
  v uuid; i int; o jsonb; n jsonb; out text := ''; ok boolean := true;
  o_ids jsonb; n_ids jsonb; same_json boolean;
BEGIN
  FOREACH v IN ARRAY viewers LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN v IS NULL THEN '' ELSE json_build_object('sub', v, 'role', 'authenticated')::text END, true);
    FOR i IN 1..array_length(pages,1) LOOP
      o := pg_temp.feed_old(pages[i][1], pages[i][2]);
      n := pg_temp.feed_new(pages[i][1], pages[i][2]);
      SELECT jsonb_agg(e->'feed_item_id' ORDER BY e->>'feed_item_id') INTO o_ids FROM jsonb_array_elements(o->'items') e;
      SELECT jsonb_agg(e->'feed_item_id' ORDER BY e->>'feed_item_id') INTO n_ids FROM jsonb_array_elements(n->'items') e;
      SELECT NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(o->'items') oe
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(n->'items') ne WHERE ne = oe)) INTO same_json;
      IF (o->'total') <> (n->'total') OR coalesce(o_ids,'[]') <> coalesce(n_ids,'[]') OR NOT same_json THEN
        ok := false;
        out := out || format('DIFF viewer=%s page=%s/%s total %s vs %s; ', coalesce(v::text,'anon'), pages[i][1], pages[i][2], o->'total', n->'total');
      END IF;
    END LOOP;
    out := out || format('%s total=%s; ', coalesce(left(v::text,8),'anon'), n->'total');
  END LOOP;
  RAISE EXCEPTION 'PROBE % (rolled back) :: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, out;
END $probe$;
