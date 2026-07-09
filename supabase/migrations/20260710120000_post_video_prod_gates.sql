-- Pre-production gates for Home post videos (Tian's launch checklist).
--
-- 1. RESTORE the create_user_post rate limit. It was added in 202602101700
--    (10 posts/hour via check_rate_limit) with a test-account bypass in
--    202602101800, survived the Feb rich-media rewrites — and was silently
--    DROPPED on 2026-04-11 by 202604111100_server_side_content_filter.sql,
--    which rewrote the function from a stale base. create_transfer_post and
--    create_signing_post kept theirs the whole time; only the main composer
--    path has been unlimited since April. Same pool ('create_post'), same
--    limits, same is_test_account bypass (the e2e suites post repeatedly and
--    MUST stay exempt).
--
-- 2. SERVER-AUTHORITATIVE launch flag for Cloudflare video posts.
--    Old native bundles pin their JS: on the App-Store-live 1.3.6 bundle a
--    {video_id}-only media item renders as a dead dark tile (Play does
--    nothing), and iOS builds before 1.3.3 don't even have the update prompt,
--    so they can never be force-updated. "Deploy the web client first" is not
--    enough (see the 2026-07-07 P0 note in CLAUDE.md). So creation of NEW
--    Cloudflare video posts is gated on app_settings key
--    'video_posts_enabled' = 'true':
--      - absent row (production today) -> OFF: the code can merge to main
--        without turning the feature on; Tian flips the flag after raising
--        min_version and waiting for adoption.
--      - staging gets the row out of band (same convention as the
--        'environment' row, 20260521200000).
--    The gate applies to NEW video attachments only: update_user_post still
--    accepts video_ids the post already carries, so flipping the flag OFF
--    never bricks the editing of existing video posts, while edit cannot be
--    used to sneak a NEW video past the flag. Legacy {url} MP4 items (old
--    bundles' upload path) are untouched either way.
--
-- 3. Announcements: REJECT Cloudflare video items. create_transfer_post
--    validated video by duration only and create_signing_post not at all —
--    neither checks ownership or kind, so a crafted payload could store a
--    reference to ANOTHER USER's video in an announcement. The announcement
--    cards can't play video anyway (the tile is dead by design there). No
--    legacy client ever produced a {video_id} announcement item, so rejecting
--    them breaks nobody. Legacy {url} video items on transfer posts keep
--    working (old bundles still create those).
--
-- 4. Defense-in-depth: the only thing keeping kind='post'/'reel' videos from
--    generating a recruitment "video_added" Pulse card is the trigger's WHEN
--    clause. Re-creating the trigger from the original generator file
--    (20260708150000, which predates kinds) would silently drop that gate.
--    Duplicate the kind check INSIDE generate_video_added_feed_item() so the
--    fence survives a trigger re-create.

-- ---------------------------------------------------------------------------
-- Launch flag reader. STABLE + SECURITY DEFINER (app_settings is RLS-on with
-- no policy; only definer functions read it — same pattern as is_staging_env).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.video_posts_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_settings
    WHERE key = 'video_posts_enabled' AND value = 'true'
  );
$function$;

GRANT EXECUTE ON FUNCTION public.video_posts_enabled() TO authenticated;

COMMENT ON FUNCTION public.video_posts_enabled IS
  'Launch flag for Cloudflare video posts (app_settings key video_posts_enabled). Absent row = OFF. Gates NEW video attachments in create_user_post/update_user_post; the client also reads it to hide the Add-video button.';

-- ---------------------------------------------------------------------------
-- create_user_post: + rate limit (restored), + launch flag on video items.
-- Body otherwise identical to 20260709150000's (video ownership guard intact).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user_post(p_content text, p_images jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_post_id UUID;
  v_trimmed TEXT;
  v_video_count INT;
  v_duration NUMERIC;
  v_item JSONB;
  v_filter_reason TEXT;
  v_video_id TEXT;
  v_rate_check JSONB;
  v_is_test BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Rate limit: 10 posts/hour, shared 'create_post' pool with the
  -- announcement RPCs. Test accounts exempt (CI/e2e post repeatedly).
  SELECT COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  IF NOT v_is_test THEN
    v_rate_check := public.check_rate_limit(v_user_id::TEXT, 'create_post', 10, 3600);
    IF NOT (v_rate_check ->> 'allowed')::BOOLEAN THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Rate limit exceeded: maximum 10 posts per hour',
        'remaining', (v_rate_check ->> 'remaining')::INT,
        'reset_at', v_rate_check ->> 'reset_at'
      );
    END IF;
  END IF;

  v_trimmed := trim(coalesce(p_content, ''));

  IF v_trimmed = '' AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add text, a photo, or a video to publish.');
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content exceeds 2000 character limit');
  END IF;

  IF v_trimmed <> '' THEN
    v_filter_reason := content_check(v_trimmed);
    IF v_filter_reason IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', v_filter_reason);
    END IF;
  END IF;

  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 5 media items allowed');
  END IF;

  IF p_images IS NOT NULL THEN
    v_video_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
    LOOP
      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;

        IF v_item ? 'video_id' THEN
          -- Launch flag: NEW Cloudflare video posts only while enabled.
          IF NOT public.video_posts_enabled() THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video posts are not available yet.');
          END IF;

          v_video_id := v_item ->> 'video_id';
          IF v_video_id IS NULL OR v_video_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid video reference');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = v_video_id::uuid
              AND pv.user_id = v_user_id
              AND pv.kind = 'post'
              AND pv.visibility = 'public'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found, not yours, or not a public post video');
          END IF;
        ELSE
          v_duration := (v_item ->> 'duration')::NUMERIC;
          IF v_duration IS NOT NULL AND v_duration > 180 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video must be 3 minutes or less');
          END IF;
        END IF;
      END IF;
    END LOOP;

    IF v_video_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Maximum 1 video per post');
    END IF;
  END IF;

  INSERT INTO user_posts (author_id, content, images)
  VALUES (v_user_id, v_trimmed, p_images)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- update_user_post: flag gates only NEWLY-ADDED video_ids. Videos the post
-- already carries stay editable even with the flag off (kill-switch must not
-- brick existing posts).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_user_post(p_post_id uuid, p_content text, p_images jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_trimmed TEXT;
  v_owner_id UUID;
  v_video_count INT;
  v_duration NUMERIC;
  v_item JSONB;
  v_video_id TEXT;
  v_existing_video_ids TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT author_id,
         COALESCE(
           (SELECT array_agg(i ->> 'video_id')
              FROM jsonb_array_elements(COALESCE(images, '[]'::jsonb)) i
             WHERE i ? 'video_id'),
           '{}'::text[]
         )
  INTO v_owner_id, v_existing_video_ids
  FROM user_posts WHERE id = p_post_id AND deleted_at IS NULL;
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post not found');
  END IF;
  IF v_owner_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_trimmed := trim(coalesce(p_content, ''));

  IF v_trimmed = '' AND (p_images IS NULL OR jsonb_array_length(p_images) = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Add text, a photo, or a video to publish.');
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Post content exceeds 2000 character limit');
  END IF;

  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 5 media items allowed');
  END IF;

  IF p_images IS NOT NULL THEN
    v_video_count := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_images)
    LOOP
      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;
        IF v_item ? 'video_id' THEN
          v_video_id := v_item ->> 'video_id';
          IF v_video_id IS NULL OR v_video_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid video reference');
          END IF;

          -- Launch flag: only videos NOT already on this post are "new".
          IF NOT (v_video_id = ANY (v_existing_video_ids)) AND NOT public.video_posts_enabled() THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video posts are not available yet.');
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM public.player_videos pv
            WHERE pv.id = v_video_id::uuid
              AND pv.user_id = v_user_id
              AND pv.kind = 'post'
              AND pv.visibility = 'public'
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video not found, not yours, or not a public post video');
          END IF;
        ELSE
          v_duration := (v_item ->> 'duration')::NUMERIC;
          IF v_duration IS NOT NULL AND v_duration > 180 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Video must be 3 minutes or less');
          END IF;
        END IF;
      END IF;
    END LOOP;

    IF v_video_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Maximum 1 video per post');
    END IF;
  END IF;

  UPDATE user_posts
  SET content = v_trimmed, images = p_images, updated_at = timezone('utc', now())
  WHERE id = p_post_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Announcements: no Cloudflare video items. The cards cannot play them, and
-- neither RPC validates ownership — a {video_id} item here could reference
-- ANOTHER USER's video. Reject at the top of the media loop.
-- (Self-splice: read the live def, insert the guard, assert both changed.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
  v_guard text := $g$      IF v_item ->> 'media_type' = 'video' AND v_item ? 'video_id' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Video attachments are not supported on announcements');
      END IF;
$g$;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY['create_transfer_post', 'create_signing_post'])
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'GUARD: % not found', v_fn;
    END IF;
    IF position('Video attachments are not supported' in v_def) > 0 THEN
      CONTINUE; -- already patched (re-run safety)
    END IF;

    IF v_fn = 'create_transfer_post' THEN
      -- Guard goes first inside the media loop, before the duration check.
      v_new := replace(
        v_def,
        $o$      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;$o$,
        v_guard || $o$      IF v_item ->> 'media_type' = 'video' THEN
        v_video_count := v_video_count + 1;$o$
      );
    ELSE
      -- create_signing_post has no media loop at all: add a standalone check
      -- right after the images-count validation.
      v_new := replace(
        v_def,
        $o$  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 4 images allowed');
  END IF;$o$,
        $o$  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 4 images allowed');
  END IF;

  IF p_images IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_images) i
    WHERE i ->> 'media_type' = 'video' AND i ? 'video_id'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Video attachments are not supported on announcements');
  END IF;$o$
      );
    END IF;

    IF v_new = v_def THEN
      RAISE EXCEPTION 'GUARD: splice anchor not found in %', v_fn;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Defense-in-depth: the recruitment-card kind fence, duplicated inside the
-- generator so it survives a trigger re-create from the pre-kind file.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generate_video_added_feed_item';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'GUARD: generate_video_added_feed_item not found';
  END IF;
  IF position('recruitment kinds only' in v_def) > 0 THEN
    RETURN; -- already patched
  END IF;

  -- Anchor on the body's opening (BEGIN + the profile lookup) — unique in this
  -- def, unlike a bare 'BEGIN' which replace() would hit everywhere.
  v_new := replace(
    v_def,
    $o$BEGIN
  SELECT p.id, p.full_name$o$,
    $o$BEGIN
  -- recruitment kinds only: the trigger WHEN clause also enforces this, but a
  -- trigger re-created from the pre-kind generator file would drop that gate.
  IF NEW.kind NOT IN ('highlight', 'full_match') THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.full_name$o$
  );

  IF v_new = v_def OR position('recruitment kinds only' in v_new) = 0 THEN
    RAISE EXCEPTION 'GUARD: splice anchor not found in generate_video_added_feed_item';
  END IF;
  EXECUTE v_new;
END $$;
