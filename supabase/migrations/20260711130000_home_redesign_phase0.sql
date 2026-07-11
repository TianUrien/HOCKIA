-- Home Redesign (Pulse + Feed V2) — Phase 0 foundations.
-- Tian's green light 2026-07-11; decisions Q1-Q7 locked. This migration is
-- deploy-dark: nothing user-visible changes until Phase 1 ships the new Home.
--
--  A. home_module_impressions — bucketed impression log for the new Home's
--     modules (clone of the profile_search_appearances hour_bucket pattern;
--     approved over raw events rows for volume: every Home open × modules).
--  B. opportunities.closed_reason + filled_via_hockia — explicit
--     "Mark as filled" (Q5: clean data over proxy; a false "filled" story
--     poisons the market-moves feed). Auto-expiry stamps 'expired'.
--  C. role_filled feed generator — fires ONLY on closed_reason='filled'.
--     Silent-accumulates (excluded from today's feed reads) until the
--     market-moves module ships.
--  D. get_my_streak() — consecutive-day engagement streak for the hero chip.
--  E. get_my_weekly_visibility() — the Player/Coach hero payload: 7d views/
--     previews/uniques + prior-7d deltas + viewer-role breakdown. Counts
--     exclude hidden and test viewers (list/count invariant).

-- =========================================================================
-- A. home_module_impressions
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.home_module_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  -- Position of the module in the rendered column at impression time.
  position SMALLINT NOT NULL DEFAULT 0,
  role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- Same viewer seeing the same module within an hour = one impression.
  -- 3-arg date_trunc is IMMUTABLE (required for a STORED generated column).
  hour_bucket TIMESTAMPTZ GENERATED ALWAYS AS (date_trunc('hour', created_at, 'UTC')) STORED,

  CONSTRAINT home_module_impressions_module_len CHECK (char_length(module_id) BETWEEN 1 AND 64)
);

COMMENT ON TABLE public.home_module_impressions IS
  'Bucketed impression log for Home (Pulse/Feed V2) modules. One row per (user, module, hour) via the dedup index — the client upserts with ignoreDuplicates. Clicks are regular events rows (home_module_click), impressions are NOT (volume).';

CREATE UNIQUE INDEX IF NOT EXISTS home_module_impressions_dedup
  ON public.home_module_impressions (user_id, module_id, hour_bucket);
CREATE INDEX IF NOT EXISTS home_module_impressions_module_created
  ON public.home_module_impressions (module_id, created_at DESC);

ALTER TABLE public.home_module_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY home_module_impressions_insert_self
  ON public.home_module_impressions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY home_module_impressions_admin_read
  ON public.home_module_impressions
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- No user SELECT/UPDATE/DELETE: write-only telemetry for its writers.
REVOKE UPDATE, DELETE ON TABLE public.home_module_impressions FROM anon, authenticated;
REVOKE ALL ON TABLE public.home_module_impressions FROM anon;

-- =========================================================================
-- B. closed_reason + filled_via_hockia
-- =========================================================================
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS closed_reason TEXT
    CHECK (closed_reason IS NULL OR closed_reason IN ('filled', 'expired', 'withdrawn')),
  ADD COLUMN IF NOT EXISTS filled_via_hockia BOOLEAN;

COMMENT ON COLUMN public.opportunities.closed_reason IS
  'Why the listing closed: filled (club one-tap ''Mark as filled''), expired (auto-expiry sweep), withdrawn (club closed without filling). NULL = open/draft or a legacy close of unknown reason — the role_filled generator fires ONLY on explicit ''filled''.';
COMMENT ON COLUMN public.opportunities.filled_via_hockia IS
  'Optional: club said the hire came through HOCKIA. Investor-grade stat; only meaningful when closed_reason=''filled''.';

-- Backfill: auto-closed rows were expiries by definition. Legacy manual
-- closes stay NULL (unknown) — never guess "filled".
UPDATE public.opportunities
   SET closed_reason = 'expired'
 WHERE closed_reason IS NULL AND auto_closed_at IS NOT NULL;

-- Auto-expiry stamps the reason from now on (self-splice with anchor guard).
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'close_expired_opportunities';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PHASE0-GUARD: close_expired_opportunities not found';
  END IF;
  IF position('closed_reason' in v_def) > 0 THEN
    RETURN; -- already patched
  END IF;

  v_new := replace(
    v_def,
    $o$SET status = 'closed',
           closed_at = v_now,$o$,
    $o$SET status = 'closed',
           closed_reason = 'expired',
           closed_at = v_now,$o$
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'PHASE0-GUARD: splice anchor not found in close_expired_opportunities';
  END IF;
  EXECUTE v_new;
END $$;

-- =========================================================================
-- C. role_filled generator (silent-accumulate)
-- =========================================================================
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'member_joined','opportunity_posted','milestone_achieved','reference_received',
    'brand_post','brand_product','career_move','club_responded','media_added',
    'video_added','open_to_play_confirmed','role_filled'
  ]::text[]));

CREATE OR REPLACE FUNCTION public.generate_role_filled_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pub RECORD;
BEGIN
  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_pub
  FROM public.profiles p WHERE p.id = NEW.club_id;

  -- Hidden (banned/frozen) publisher -> no card (standing invariant).
  IF v_pub.id IS NULL
     OR public.profile_is_hidden(v_pub.is_blocked, v_pub.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata, created_at)
  VALUES (
    'role_filled', NEW.id, 'vacancy', v_pub.is_test,
    v_pub.id, v_pub.role, v_pub.nationality_country_id,
    jsonb_build_object(
      'opportunity_id', NEW.id,
      'title', NEW.title,
      'position', NEW."position",
      'opportunity_type', NEW.opportunity_type,
      'filled_via_hockia', COALESCE(NEW.filled_via_hockia, false),
      'club_id', v_pub.id,
      'club_name', v_pub.full_name,
      'club_avatar_url', v_pub.avatar_url),
    timezone('utc', now()))
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_role_filled_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('opportunity_id', NEW.id, 'club_id', NEW.club_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_role_filled_feed ON public.opportunities;
CREATE TRIGGER trigger_role_filled_feed
  AFTER UPDATE ON public.opportunities
  FOR EACH ROW
  WHEN (NEW.closed_reason = 'filled' AND OLD.closed_reason IS DISTINCT FROM 'filled')
  EXECUTE FUNCTION public.generate_role_filled_feed_item();

-- Silent accumulation: exclude role_filled from today's feed reads until the
-- market-moves module surfaces it (guarded self-splice on BOTH read fns —
-- the count must never include what the list hides).
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY['get_home_feed', 'get_home_feed_new_count'])
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'PHASE0-GUARD: % not found', v_fn;
    END IF;
    IF position('''role_filled''' in v_def) > 0 THEN
      CONTINUE; -- already patched
    END IF;

    v_new := replace(v_def, $o$'member_joined'$o$, $o$'member_joined', 'role_filled'$o$);
    IF v_new = v_def THEN
      RAISE EXCEPTION 'PHASE0-GUARD: exclusion anchor not found in %', v_fn;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

-- =========================================================================
-- D. get_my_streak — consecutive-day engagement streak
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_my_streak()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_today date := (timezone('utc', now()))::date;
  v_cursor date;
  v_streak int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('current_streak_days', 0);
  END IF;

  -- A streak is alive if the last active day is today or yesterday; walk
  -- back day by day. Bounded to 365 iterations.
  SELECT max(date) INTO v_cursor FROM user_engagement_daily WHERE user_id = v_uid;
  IF v_cursor IS NULL OR v_cursor < v_today - 1 THEN
    RETURN jsonb_build_object('current_streak_days', 0);
  END IF;

  WHILE v_streak < 365 AND EXISTS (
    SELECT 1 FROM user_engagement_daily
    WHERE user_id = v_uid AND date = v_cursor
  ) LOOP
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  END LOOP;

  RETURN jsonb_build_object('current_streak_days', v_streak);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_streak() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_streak() TO authenticated;

-- =========================================================================
-- E. get_my_weekly_visibility — the hero payload
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_my_weekly_visibility()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_since timestamptz := timezone('utc', now()) - interval '7 days';
  v_prior timestamptz := timezone('utc', now()) - interval '14 days';
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated');
  END IF;

  -- Viewer fence: hidden (banned/frozen) and test viewers never count
  -- (list/count invariant with the weekly digest + pulse card).
  WITH visible_views AS (
    SELECT e.event_name, e.user_id AS viewer_id, e.role AS viewer_role, e.created_at
    FROM events e
    JOIN profiles vp ON vp.id = e.user_id
    WHERE e.event_name IN ('profile_view', 'profile_preview')
      AND e.entity_type = 'profile'
      AND e.entity_id = v_uid
      AND e.user_id IS NOT NULL
      AND e.user_id <> v_uid
      AND e.created_at >= v_prior
      AND COALESCE(vp.is_test_account, false) = false
      AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
  )
  SELECT jsonb_build_object(
    'views_7d',          count(*) FILTER (WHERE event_name = 'profile_view'   AND created_at >= v_since),
    'views_prior_7d',    count(*) FILTER (WHERE event_name = 'profile_view'   AND created_at <  v_since),
    'unique_viewers_7d', count(DISTINCT viewer_id) FILTER (WHERE event_name = 'profile_view' AND created_at >= v_since),
    'previews_7d',       count(*) FILTER (WHERE event_name = 'profile_preview' AND created_at >= v_since),
    'previews_prior_7d', count(*) FILTER (WHERE event_name = 'profile_preview' AND created_at <  v_since),
    'viewers_by_role',   COALESCE((
      SELECT jsonb_object_agg(viewer_role, cnt)
      FROM (
        SELECT viewer_role, count(DISTINCT viewer_id) AS cnt
        FROM visible_views
        WHERE event_name = 'profile_view' AND created_at >= v_since AND viewer_role IS NOT NULL
        GROUP BY viewer_role
      ) r
    ), '{}'::jsonb)
  ) INTO v_result
  FROM visible_views;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_weekly_visibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_weekly_visibility() TO authenticated;

-- =========================================================================
-- Self-check
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='home_module_impressions') THEN
    RAISE EXCEPTION 'PHASE0-CHECK: home_module_impressions missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='opportunities' AND column_name='closed_reason') THEN
    RAISE EXCEPTION 'PHASE0-CHECK: closed_reason missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_role_filled_feed') THEN
    RAISE EXCEPTION 'PHASE0-CHECK: role_filled trigger missing';
  END IF;
  IF position('''role_filled''' in (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
       WHERE p.proname='get_home_feed' AND p.pronamespace='public'::regnamespace)) = 0 THEN
    RAISE EXCEPTION 'PHASE0-CHECK: role_filled not excluded from get_home_feed';
  END IF;
  RAISE NOTICE 'PHASE0-CHECK: OK';
END $$;
