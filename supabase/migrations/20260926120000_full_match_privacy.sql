-- =========================================================================
-- Phase 1 · step 3 — full matches are for clubs and recruiting coaches
-- =========================================================================
-- Founder ruling 2026-09-25: a player's full matches default to
-- "clubs & coaches only"; highlights stay public; full matches never appear
-- in the Home feed.
--
-- Design (scratchpad audit 11-video-privacy.md):
--   * NEW profiles.full_match_visibility ('recruiters' | 'public'), default
--     'recruiters'. highlight_visibility is NOT touched: it also gates the
--     legacy linked highlight in desktop v1 and in the shipped native app.
--     ADD COLUMN with a constant default is catalog-only — no UPDATE runs on
--     profiles, so set_profiles_updated_at and the other profile triggers do
--     not fire (the 2026-08-28 updated_at incident class).
--   * Each video row's own `visibility` stays the ENFORCED column (RLS, the
--     video-playback-token function and the old native app all read it).
--     The profile column is the player's master switch: new full-match rows
--     inherit it on insert, and changing it rewrites all the player's
--     full-match rows. A single video can still be changed afterwards.
--   * "Recruiter" = club, or coach with coach_recruits_for_team, and not a
--     hidden profile — one definition, public.is_recruiter(uid), used by both
--     SELECT policies and by video-playback-token.
--   * Full matches never produce Home feed cards; a guard on home_feed_items
--     keeps any such card soft-deleted whatever writes it.
--   * get_video_access_summary(profile) returns counts only, so the UI can
--     draw "Clubs and coaches only" locked tiles for rows RLS hides.
--   * One-time notice: a user_pulse_items row 'full_match_privacy_default'
--     per visible player, excluded from get_my_pulse so older app builds
--     never see an unknown pulse type.
--
-- DATA CHANGES (prod will need a dump of these rows before apply):
--   * player_full_game_videos: public → recruiters (prod: 6 rows, 5 players)
--   * player_videos kind='full_match': public → recruiters (prod: 0 rows)
--   * home_feed_items video_added cards for full matches → soft-deleted
--     (prod: 0 rows at 2026-09-25)
--   * user_pulse_items: one notice row per non-hidden player (INSERT only)
-- No UPDATE is run on public.profiles.
-- =========================================================================

BEGIN;

-- ── 1. Master switch ──────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_match_visibility text NOT NULL DEFAULT 'recruiters';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_full_match_visibility_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_match_visibility_check
  CHECK (full_match_visibility IN ('public', 'recruiters'));

COMMENT ON COLUMN public.profiles.full_match_visibility IS
  'Player master switch for full-match videos (player_videos kind=full_match and player_full_game_videos). '
  'Copied to each row''s visibility on insert and on change; the row visibility is what RLS enforces.';

-- profiles uses column-level grants (table ACL for anon/authenticated is
-- MAINTAIN only). Mirror highlight_visibility: anon reads, members write.
GRANT SELECT (full_match_visibility) ON public.profiles TO anon, authenticated;
GRANT INSERT (full_match_visibility), UPDATE (full_match_visibility) ON public.profiles TO authenticated;

-- profiles_self: expose the new column, appended after the view's EXISTING columns.
-- The column order differs between environments (contact_email_public sits at a
-- different position on prod and staging), and CREATE OR REPLACE VIEW can only
-- append, so the select list is built from the view's current columns.
DO $view$
DECLARE
  v_cols text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.profiles_self'::regclass
                AND attname = 'full_match_visibility' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.profiles_self'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'CREATE OR REPLACE VIEW public.profiles_self WITH (security_barrier = true, security_invoker = true) AS '
    'SELECT %s, full_match_visibility FROM public.profiles WHERE id = (SELECT auth.uid())',
    v_cols);
END
$view$;

-- ── 2. Who counts as a recruiter (the single definition) ──────────────────
CREATE OR REPLACE FUNCTION public.is_recruiter(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = p_uid
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
       AND (p.role = 'club' OR (p.role = 'coach' AND p.coach_recruits_for_team IS TRUE))
  );
$$;

COMMENT ON FUNCTION public.is_recruiter(uuid) IS
  'Club, or coach with coach_recruits_for_team, and not hidden (banned / frozen minor). '
  'Gates recruiters-only videos in RLS and in the video-playback-token edge function.';

-- Policies evaluate as the caller, so anon + authenticated need EXECUTE.
REVOKE ALL ON FUNCTION public.is_recruiter(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_recruiter(uuid) TO anon, authenticated, service_role;

-- ── 3. RLS: recruiters-only rows use is_recruiter (owner always sees own) ─
DROP POLICY IF EXISTS player_videos_select ON public.player_videos;
CREATE POLICY player_videos_select ON public.player_videos
  FOR SELECT TO public
  USING (
    (
      status = 'ready'
      AND (
        visibility = 'public'
        OR (visibility = 'recruiters' AND (SELECT public.is_recruiter((SELECT auth.uid()))))
      )
    )
    OR (SELECT auth.uid()) = user_id
  );

DROP POLICY IF EXISTS player_full_game_videos_select ON public.player_full_game_videos;
CREATE POLICY player_full_game_videos_select ON public.player_full_game_videos
  FOR SELECT TO public
  USING (
    visibility = 'public'
    OR (visibility = 'recruiters' AND (SELECT public.is_recruiter((SELECT auth.uid()))))
    OR (SELECT auth.uid()) = user_id
  );

-- ── 4. Backfill existing full-match ROWS (never profiles) ─────────────────
UPDATE public.player_full_game_videos
   SET visibility = 'recruiters'
 WHERE visibility = 'public';

UPDATE public.player_videos
   SET visibility = 'recruiters'
 WHERE kind = 'full_match'
   AND visibility = 'public';

-- Legacy links default to the private value too, for any writer that
-- bypasses the insert trigger's profile lookup.
ALTER TABLE public.player_full_game_videos ALTER COLUMN visibility SET DEFAULT 'recruiters';

-- ── 5. New full-match rows inherit the player's master switch ─────────────
CREATE OR REPLACE FUNCTION public.apply_full_match_default_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vis text;
BEGIN
  -- Nested IF on purpose: plpgsql does not short-circuit AND, and
  -- player_full_game_videos rows have no `kind` field.
  IF TG_TABLE_NAME = 'player_videos' THEN
    IF NEW.kind IS DISTINCT FROM 'full_match' THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT p.full_match_visibility INTO v_vis FROM public.profiles p WHERE p.id = NEW.user_id;
  NEW.visibility := COALESCE(v_vis, 'recruiters');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_full_match_default_visibility() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_player_videos_full_match_default ON public.player_videos;
CREATE TRIGGER trg_player_videos_full_match_default
  BEFORE INSERT ON public.player_videos
  FOR EACH ROW WHEN (NEW.kind = 'full_match')
  EXECUTE FUNCTION public.apply_full_match_default_visibility();

DROP TRIGGER IF EXISTS trg_player_full_game_videos_default ON public.player_full_game_videos;
CREATE TRIGGER trg_player_full_game_videos_default
  BEFORE INSERT ON public.player_full_game_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_full_match_default_visibility();

-- ── 6. Changing the master switch rewrites the player's full-match rows ───
-- Writes only the video tables; never profiles (so profiles.updated_at is
-- only bumped by the player's own settings save, as for any other setting).
CREATE OR REPLACE FUNCTION public.cascade_full_match_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.player_videos
     SET visibility = NEW.full_match_visibility
   WHERE user_id = NEW.id
     AND kind = 'full_match'
     AND visibility IS DISTINCT FROM NEW.full_match_visibility;

  UPDATE public.player_full_game_videos
     SET visibility = NEW.full_match_visibility
   WHERE user_id = NEW.id
     AND visibility IS DISTINCT FROM NEW.full_match_visibility;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cascade_full_match_visibility() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_full_match_visibility_cascade ON public.profiles;
CREATE TRIGGER trg_profiles_full_match_visibility_cascade
  AFTER UPDATE OF full_match_visibility ON public.profiles
  FOR EACH ROW
  WHEN (OLD.full_match_visibility IS DISTINCT FROM NEW.full_match_visibility)
  EXECUTE FUNCTION public.cascade_full_match_visibility();

-- ── 7. Home feed: highlights only ─────────────────────────────────────────
-- 7a. Generation: only highlights produce video_added cards.
CREATE OR REPLACE FUNCTION public.generate_video_added_feed_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trigger_video_added_feed_insert ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_insert
  AFTER INSERT ON public.player_videos
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND NEW.visibility = 'public' AND NEW.kind = 'highlight')
  EXECUTE FUNCTION public.generate_video_added_feed_item();

DROP TRIGGER IF EXISTS trigger_video_added_feed_update ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_update
  AFTER UPDATE ON public.player_videos
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND NEW.visibility = 'public' AND NEW.kind = 'highlight'
        AND (OLD.status IS DISTINCT FROM 'ready' OR OLD.visibility IS DISTINCT FROM 'public'))
  EXECUTE FUNCTION public.generate_video_added_feed_item();

-- 7b. A video that stops being public loses its card (was a latent leak:
--     the card stayed live and tapping it returned 403).
CREATE OR REPLACE FUNCTION public.handle_player_video_unpublic_feed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.home_feed_items
     SET deleted_at = timezone('utc', now())
   WHERE item_type = 'video_added'
     AND source_id = NEW.id
     AND deleted_at IS NULL;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('handle_player_video_unpublic_feed', SQLSTATE, SQLERRM,
    jsonb_build_object('player_video_id', NEW.id, 'user_id', NEW.user_id));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_player_video_unpublic_feed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_player_video_unpublic_feed ON public.player_videos;
CREATE TRIGGER trg_player_video_unpublic_feed
  AFTER UPDATE OF visibility ON public.player_videos
  FOR EACH ROW
  WHEN (OLD.visibility = 'public' AND NEW.visibility IS DISTINCT FROM 'public')
  EXECUTE FUNCTION public.handle_player_video_unpublic_feed();

-- 7c. Guard: a full-match video card can never be live, whoever writes it.
--     get_home_feed / get_market_moves only return deleted_at IS NULL, so
--     this keeps full matches out of every feed reader, old and new.
CREATE OR REPLACE FUNCTION public.guard_home_feed_no_full_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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

REVOKE ALL ON FUNCTION public.guard_home_feed_no_full_match() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_home_feed_no_full_match ON public.home_feed_items;
CREATE TRIGGER trg_home_feed_no_full_match
  BEFORE INSERT OR UPDATE ON public.home_feed_items
  FOR EACH ROW
  WHEN (NEW.item_type = 'video_added')
  EXECUTE FUNCTION public.guard_home_feed_no_full_match();

-- 7d. Remove any existing full-match cards (prod: 0 at 2026-09-25).
UPDATE public.home_feed_items
   SET deleted_at = timezone('utc', now())
 WHERE item_type = 'video_added'
   AND metadata->>'kind' = 'full_match'
   AND deleted_at IS NULL;

-- ── 8. Locked-tile counts ─────────────────────────────────────────────────
-- Counts only (never ids, titles or URLs). Zero for the owner and for
-- recruiters (they see the rows themselves). NULL for a hidden or blocked
-- profile so the caller treats it as "nothing to show".
CREATE OR REPLACE FUNCTION public.get_video_access_summary(p_profile_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'locked_full_matches',
      CASE
        WHEN (SELECT auth.uid()) = p.id OR public.is_recruiter((SELECT auth.uid())) THEN 0
        ELSE
          (SELECT count(*) FROM public.player_videos v
            WHERE v.user_id = p.id AND v.kind = 'full_match'
              AND v.status = 'ready' AND v.visibility = 'recruiters')
          + (SELECT count(*) FROM public.player_full_game_videos g
              WHERE g.user_id = p.id AND g.visibility = 'recruiters')
      END,
    'locked_highlights',
      CASE
        WHEN (SELECT auth.uid()) = p.id OR public.is_recruiter((SELECT auth.uid())) THEN 0
        ELSE
          (SELECT count(*) FROM public.player_videos v
            WHERE v.user_id = p.id AND v.kind = 'highlight'
              AND v.status = 'ready' AND v.visibility = 'recruiters')
      END,
    'full_match_visibility', p.full_match_visibility)
  FROM public.profiles p
  WHERE p.id = p_profile_id
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT COALESCE(public.is_blocked_pair((SELECT auth.uid()), p.id), false);
$$;

REVOKE ALL ON FUNCTION public.get_video_access_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_video_access_summary(uuid) TO anon, authenticated, service_role;

-- ── 9. One-time notice ────────────────────────────────────────────────────
-- get_my_pulse must never return it: older app builds render every pulse
-- row and Sentry-log unknown types. The new client reads the row directly
-- (RLS select_self) and dismisses it with mark_pulse_dismissed.
CREATE OR REPLACE FUNCTION public.get_my_pulse(p_limit integer DEFAULT 20)
RETURNS SETOF public.user_pulse_items
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT *
    FROM public.user_pulse_items
   WHERE user_id = auth.uid()
     AND dismissed_at IS NULL
     AND item_type <> 'full_match_privacy_default'
   ORDER BY priority ASC, created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 50);
$function$;

INSERT INTO public.user_pulse_items (user_id, item_type, priority, metadata)
SELECT p.id,
       'full_match_privacy_default',
       1,
       jsonb_build_object('had_full_matches', COALESCE(p.full_game_video_count, 0) > 0
                            OR EXISTS (SELECT 1 FROM public.player_videos v
                                        WHERE v.user_id = p.id AND v.kind = 'full_match'))
  FROM public.profiles p
 WHERE p.role = 'player'
   AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
   AND NOT EXISTS (SELECT 1 FROM public.user_pulse_items u
                    WHERE u.user_id = p.id AND u.item_type = 'full_match_privacy_default');

COMMIT;
