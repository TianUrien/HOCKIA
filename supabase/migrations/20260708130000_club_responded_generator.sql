-- P4 Phase 0 — club_responded / "Active recruiter" feed generator + shared
-- feed-gen observability (Tian point 4: failures must be queryable, not
-- just RAISE WARNING).
--
-- club_responded is an AGGREGATE, not one-per-event: "Club X reviewed N
-- applications this week", carrying the club's responsiveness tier. One
-- home_feed_items row per (club, ISO week); each real triage upserts +1 and
-- bumps freshness so an actively-responding club resurfaces.
--
-- A "response" = a first triage of a pending application by the publisher:
-- application_status_history row with old_status='pending', new_status in
-- (shortlisted|maybe|rejected), and changed_via in (NULL=in-app,
-- 'email_action'). Excludes 'auto_expiry' (no_response — the system, not the
-- club) and 'minor_freeze' (withdrawn). Re-triage (e.g. shortlisted→rejected)
-- has old_status<>'pending' so it never double-counts an application.
--
-- Feed-only, hidden-fenced (no card for a banned club), silent-accumulate
-- (excluded from today's get_home_feed), resilient (a feed-gen failure never
-- blocks the triage), and now OBSERVABLE (failures logged to error_logs).

-- ────────────────────────────────────────────────────────────────────
-- 1. Shared feed-gen failure logger (point 4). Queryable in error_logs;
--    its own insert is guarded so logging can never break a trigger.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._log_feed_gen_failure(
  p_fn text, p_sqlstate text, p_message text, p_context jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.error_logs
    (source, function_name, error_type, error_code, error_message, severity, metadata)
  VALUES
    ('feed_generator', p_fn, 'trigger_exception', p_sqlstate, p_message, 'warning', p_context);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'feed-gen failure (and error_logs insert failed) in %: %', p_fn, p_message;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._log_feed_gen_failure(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2. Retrofit career_move's wrapper to log to error_logs (point 4).
--    Body identical to 20260708121000; only the EXCEPTION handler changes.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_career_move_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mover_id uuid;
  v_mover RECORD;
  v_club_name text := NEW.metadata->>'club_name';
  v_club_profile_id uuid := NULLIF(NEW.metadata->>'club_profile_id', '')::uuid;
  v_club_avatar text := NEW.metadata->>'club_avatar_url';
  v_meta_world_club uuid := NULLIF(NEW.metadata->>'world_club_id', '')::uuid;
  v_club_country_id integer := NULLIF(NEW.metadata->>'club_country_id', '')::integer;
  v_world_club_id uuid;
  v_author_is_test boolean;
BEGIN
  IF NEW.post_type = 'transfer' THEN
    v_mover_id := NEW.author_id;
  ELSE
    v_mover_id := NULLIF(NEW.metadata->>'person_profile_id', '')::uuid;
  END IF;
  IF v_mover_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_mover FROM public.profiles p WHERE p.id = v_mover_id;
  IF v_mover.id IS NULL
     OR public.profile_is_hidden(v_mover.is_blocked, v_mover.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  IF v_club_profile_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.profiles cp WHERE cp.id = v_club_profile_id
         AND public.profile_is_hidden(cp.is_blocked, cp.frozen_minor_at)) THEN
    RETURN NEW;
  END IF;

  v_world_club_id := COALESCE(v_meta_world_club,
    public.resolve_world_club_by_name(v_club_name, v_club_country_id));

  SELECT COALESCE(p.is_test_account, false) INTO v_author_is_test
  FROM public.profiles p WHERE p.id = NEW.author_id;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata)
  VALUES (
    'career_move', NEW.id, 'user_post',
    v_mover.is_test OR COALESCE(v_author_is_test, false),
    v_mover.id, v_mover.role, v_mover.nationality_country_id,
    jsonb_build_object(
      'post_id', NEW.id, 'direction', NEW.post_type,
      'mover_profile_id', v_mover.id, 'mover_name', v_mover.full_name,
      'mover_role', v_mover.role, 'mover_avatar_url', v_mover.avatar_url,
      'club_name', v_club_name, 'club_world_club_id', v_world_club_id,
      'club_avatar_url', v_club_avatar, 'club_profile_id', v_club_profile_id))
  ON CONFLICT (item_type, source_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_career_move_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('post_id', NEW.id, 'post_type', NEW.post_type));
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 3. Whitelists: allow the new type + source
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'member_joined','opportunity_posted','milestone_achieved',
    'reference_received','brand_post','brand_product','career_move','club_responded'
  ]::text[]));
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_source_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'profile','vacancy','profile_reference','brand_post','brand_product',
    'milestone','user_post','application_response'
  ]::text[]));

-- ────────────────────────────────────────────────────────────────────
-- 4. Generator: upsert the weekly per-club aggregate
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_club_responded_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_club RECORD;
  v_week_start date;
  v_source_id uuid;
  v_tier text;
BEGIN
  -- Only count a genuine first triage (in-app or email), never system moves.
  IF NEW.new_status NOT IN ('shortlisted', 'maybe', 'rejected')
     OR NOT (NEW.changed_via IS NULL OR NEW.changed_via = 'email_action') THEN
    RETURN NEW;
  END IF;

  -- Publisher = the opportunity's club, via the application.
  SELECT cp.id, cp.full_name, cp.avatar_url, cp.role, cp.nationality_country_id,
         cp.is_blocked, cp.frozen_minor_at, COALESCE(cp.is_test_account, false) AS is_test
    INTO v_club
  FROM public.opportunity_applications a
  JOIN public.opportunities o ON o.id = a.opportunity_id
  JOIN public.profiles cp ON cp.id = o.club_id
  WHERE a.id = NEW.application_id;

  IF v_club.id IS NULL
     OR public.profile_is_hidden(v_club.is_blocked, v_club.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  v_week_start := date_trunc('week', NEW.created_at)::date;
  v_source_id  := md5(v_club.id::text || '|' || v_week_start::text)::uuid;

  SELECT pr.tier INTO v_tier
  FROM public.publisher_responsiveness pr WHERE pr.publisher_id = v_club.id;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata, created_at)
  VALUES (
    'club_responded', v_source_id, 'application_response', v_club.is_test,
    v_club.id, v_club.role, v_club.nationality_country_id,
    jsonb_build_object(
      'club_id', v_club.id, 'club_name', v_club.full_name,
      'club_avatar_url', v_club.avatar_url, 'week_start', v_week_start,
      'response_count', 1, 'responsiveness_tier', v_tier,
      'last_response_at', NEW.created_at),
    NEW.created_at)
  ON CONFLICT (item_type, source_id) DO UPDATE SET
    metadata = jsonb_set(
                 public.home_feed_items.metadata, '{response_count}',
                 to_jsonb(COALESCE((public.home_feed_items.metadata->>'response_count')::int, 0) + 1))
               || jsonb_build_object('last_response_at', NEW.created_at, 'responsiveness_tier', v_tier),
    created_at = NEW.created_at,   -- bump freshness: active recruiter resurfaces
    deleted_at = NULL,
    is_test_account = EXCLUDED.is_test_account;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_club_responded_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('application_id', NEW.application_id, 'new_status', NEW.new_status));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_club_responded_feed ON public.application_status_history;
CREATE TRIGGER trigger_club_responded_feed
  AFTER INSERT ON public.application_status_history
  FOR EACH ROW
  WHEN (NEW.old_status = 'pending')
  EXECUTE FUNCTION public.generate_club_responded_feed_item();

-- ────────────────────────────────────────────────────────────────────
-- 5. Silent accumulation: exclude 'club_responded' from today's feed too
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def,
      'NOT IN (''member_joined'', ''career_move'')',
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'')');
    IF v_new = v_def OR position('club_responded' in v_new) = 0 THEN
      RAISE EXCEPTION 'club_responded exclusion not applied to %()', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
