-- Rollback for 20261006100000_audit_db_hardening.sql.
-- Restores every function body, policy, trigger, grant and cron job that migration
-- changed, as the repository had them before it (source file named per block).
--
-- Grants are restored to what the migration history leaves. A function created
-- without explicit grants received this platform's default ACL (PUBLIC, anon,
-- authenticated, service_role), so those blocks grant to all four. If the live
-- database had tighter grants than the repository (a revoke run by hand), compare
-- with audit_db_hardening_acl.probe.sql output captured BEFORE the migration and
-- leave out the extra grants below accordingly.

-- ── 14 · push device owner ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS push_subscriptions_single_owner ON public.push_subscriptions;
DROP FUNCTION IF EXISTS public._push_subscription_single_owner();

-- ── 13 · push for re-surfaced notifications ──────────────────────────────────────
DROP TRIGGER IF EXISTS "send-push-resurfaced" ON public.profile_notifications;

-- ── 12 · ai_questions_today, from 20261003140000_ai_usage_log.sql ────────────────
CREATE OR REPLACE FUNCTION public.ai_questions_today(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM public.ai_usage_log l
   WHERE l.user_id = p_user
     AND l.function <> 'alert'
     AND l.created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
$$;

REVOKE ALL ON FUNCTION public.ai_questions_today(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_questions_today(uuid) TO service_role;

-- ── 11 · AI opinion quota functions (new) ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.ai_opinion_quota_take(uuid, integer);
DROP FUNCTION IF EXISTS public.ai_opinion_quota_release(uuid);

-- ── 10 · link_signup_attribution: both signatures back ───────────────────────────
-- 6-argument body from 20260828100000_attribution_v2.sql (grants: 20260725100000, unchanged).
CREATE OR REPLACE FUNCTION public.link_signup_attribution(
  p_anonymous_id text,
  p_first_referrer text DEFAULT NULL,
  p_first_source text DEFAULT NULL,
  p_utm jsonb DEFAULT NULL,
  p_landing_path text DEFAULT NULL,
  p_first_seen_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.record_signup_attribution(jsonb_build_object(
    'anonymous_id', p_anonymous_id,
    'attribution_method', 'legacy_client',
    'first_touch', jsonb_build_object(
      'utm_source', p_utm->>'source',
      'utm', p_utm,
      'referrer', p_first_referrer,
      'referring_domain', CASE
        WHEN p_first_referrer ~* '^https?://' THEN split_part(split_part(p_first_referrer, '//', 2), '/', 1)
        ELSE p_first_referrer END,
      'landing_page', p_landing_path,
      'captured_at', p_first_seen_at
    )
  ));
$$;

REVOKE ALL ON FUNCTION public.link_signup_attribution(text, text, text, jsonb, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_signup_attribution(text, text, text, jsonb, text, timestamptz) TO authenticated, service_role;

-- 5-argument overload from 20260828140000_attribution_audit_fixes.sql (created there without grants).
CREATE OR REPLACE FUNCTION public.link_signup_attribution(
  p_anonymous_id text,
  p_first_referrer text DEFAULT NULL,
  p_utm jsonb DEFAULT NULL,
  p_landing_path text DEFAULT NULL,
  p_first_seen_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.record_signup_attribution(jsonb_build_object(
    'anonymous_id', p_anonymous_id,
    'attribution_method', 'legacy_client',
    'first_touch', jsonb_build_object(
      'utm_source', p_utm->>'source',
      'utm', p_utm,
      'referrer', p_first_referrer,
      -- scheme://[user@]host[:port]/… → host; a bare hostname passes through
      'referring_domain', COALESCE(
        substring(p_first_referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/]+@)?([^/:?#]+)'),
        p_first_referrer),
      'landing_page', p_landing_path,
      'captured_at', p_first_seen_at
    )
  ));
$$;

GRANT EXECUTE ON FUNCTION public.link_signup_attribution(text, text, jsonb, text, timestamptz) TO PUBLIC, anon, authenticated, service_role;

-- ── 9 · scheduled jobs ───────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup_rate_limits_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No cleanup_rate_limits_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('prune_old_heartbeats_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prune_old_heartbeats_daily schedule found';
END $$;
-- archive_messages_daily exactly as 202511171630_data_retention.sql scheduled it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive_messages_daily') THEN
    PERFORM cron.schedule('archive_messages_daily', '15 02 * * *', 'SELECT public.archive_old_messages();');
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'Skipping cron job scheduling: insufficient privileges';
END $$;

-- ── 8 · lookup functions ─────────────────────────────────────────────────────────
-- Default ACL (no explicit grants): 202511130102, 20260707151000, 20260427170000.
GRANT EXECUTE ON FUNCTION public.club_has_applicant(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_in_conversation(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_product_health_score() TO PUBLIC, anon, authenticated, service_role;
-- 202603250500: default ACL plus an explicit GRANT to authenticated.
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
-- 20260928210000: REVOKE FROM PUBLIC only, so anon kept its default grant.
GRANT EXECUTE ON FUNCTION public.is_suggestible(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_toggle_open_to_play(uuid) TO anon, authenticated, service_role;

-- ── 7 · removed-account notice ───────────────────────────────────────────────────
-- From 20261004300000_new_conversation_limits.sql (grants unchanged).
CREATE OR REPLACE FUNCTION public.admin_send_removed_account_notice(p_removed_profile_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_title constant text := 'A message about your safety';
  c_text  constant text := 'An account that messaged you has been removed for spam. Hockia will never ask you for money. Don''t send money, crypto or personal details to people you haven''t met, and be careful if someone asks to move to WhatsApp or another app. If something feels off, tap Report.';
  v_admin  uuid := auth.uid();
  v_hidden boolean;
  v_url    text;
  v_nid    uuid;
  v_n      integer := 0;
  r        record;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_removed_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at) INTO v_hidden
    FROM public.profiles p
   WHERE p.id = p_removed_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('removed_account_notice:' || p_removed_profile_id::text));

  INSERT INTO public.removed_account_notices (profile_id, created_by)
  VALUES (p_removed_profile_id, v_admin)
  ON CONFLICT (profile_id) DO NOTHING;

  FOR r IN
    SELECT DISTINCT ON (x.recipient_id) x.recipient_id, x.conversation_id
      FROM (
        SELECT CASE WHEN c.participant_one_id = p_removed_profile_id THEN c.participant_two_id ELSE c.participant_one_id END AS recipient_id,
               c.id AS conversation_id
          FROM public.conversations c
         WHERE (c.participant_one_id = p_removed_profile_id OR c.participant_two_id = p_removed_profile_id)
           AND EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id)
      ) x
      JOIN public.profiles rp ON rp.id = x.recipient_id
     WHERE x.recipient_id <> p_removed_profile_id
       AND NOT public.profile_is_hidden(rp.is_blocked, rp.frozen_minor_at)
       AND NOT EXISTS (
             SELECT 1 FROM public.removed_account_notice_recipients d
              WHERE d.profile_id = p_removed_profile_id AND d.recipient_id = x.recipient_id)
     ORDER BY x.recipient_id, x.conversation_id
  LOOP
    INSERT INTO public.removed_account_notice_recipients (profile_id, recipient_id)
    VALUES (p_removed_profile_id, r.recipient_id)
    ON CONFLICT (profile_id, recipient_id) DO NOTHING;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- A conversation with a hidden account is not listed in the inbox, so the
    -- notice opens the inbox instead of a thread that would not load.
    v_url := CASE WHEN v_hidden THEN '/messages' ELSE '/messages/' || r.conversation_id::text END;

    v_nid := public.enqueue_notification(
      r.recipient_id,
      NULL,
      'system_announcement'::public.profile_notification_kind,
      p_removed_profile_id,
      jsonb_build_object(
        'notice', 'removed_account',
        'title', c_title,
        'summary', c_text,
        'target_url', v_url),
      v_url);

    UPDATE public.removed_account_notice_recipients
       SET notification_id = v_nid
     WHERE profile_id = p_removed_profile_id AND recipient_id = r.recipient_id;

    v_n := v_n + 1;
  END LOOP;

  UPDATE public.removed_account_notices
     SET notified_count = notified_count + v_n,
         last_sent_at = now()
   WHERE profile_id = p_removed_profile_id;

  PERFORM public.admin_log_action(
    'send_removed_account_notice', 'profile', p_removed_profile_id,
    NULL, jsonb_build_object('notified', v_n), '{}'::jsonb);

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_removed_account_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_removed_account_notice(uuid) TO authenticated, service_role;

-- From 202512091301_admin_rpc_functions.sql (grants: 202512101002 + 202512101500, unchanged).
CREATE OR REPLACE FUNCTION public.admin_unblock_user(
  p_profile_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_data JSONB;
  v_new_data JSONB;
BEGIN
  -- Verify caller is admin
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Get current state
  SELECT jsonb_build_object(
    'is_blocked', p.is_blocked,
    'blocked_at', p.blocked_at,
    'blocked_reason', p.blocked_reason,
    'blocked_by', p.blocked_by
  )
  INTO v_old_data
  FROM profiles p
  WHERE p.id = p_profile_id;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'Profile not found: %', p_profile_id;
  END IF;

  -- Update profile
  UPDATE profiles
  SET 
    is_blocked = false,
    blocked_at = NULL,
    blocked_reason = NULL,
    blocked_by = NULL,
    updated_at = now()
  WHERE id = p_profile_id;

  -- Get new state
  v_new_data := jsonb_build_object(
    'is_blocked', false,
    'blocked_at', NULL,
    'blocked_reason', NULL,
    'blocked_by', NULL
  );

  -- Log the action
  PERFORM public.admin_log_action(
    'unblock_user',
    'profile',
    p_profile_id,
    v_old_data,
    v_new_data,
    '{}'::JSONB
  );

  RETURN json_build_object(
    'success', true,
    'profile_id', p_profile_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unblock_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unblock_user(uuid) TO authenticated, service_role;

-- ── 6 · messages / conversations / work permits ──────────────────────────────────
DROP TRIGGER IF EXISTS conversations_client_start_guard ON public.conversations;
DROP FUNCTION IF EXISTS public._guard_client_conversation_start();
DROP TRIGGER IF EXISTS messages_client_sender_guard ON public.messages;
DROP FUNCTION IF EXISTS public._guard_client_message_sender();

-- Policy as in 20260928200000_d2_player_work_permits.sql.
DROP POLICY IF EXISTS player_work_permits_recruiter_select ON public.player_work_permits;
CREATE POLICY player_work_permits_recruiter_select ON public.player_work_permits
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_recruiter((SELECT auth.uid())))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = player_work_permits.player_id
         AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    )
  );
DROP FUNCTION IF EXISTS public.is_adult_profile(uuid);

-- ── 5 · world_clubs ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS world_clubs_guard_client_update ON public.world_clubs;
DROP FUNCTION IF EXISTS public._guard_world_club_client_update();

-- From 20260717100000_world_club_claim_audit.sql.
CREATE OR REPLACE FUNCTION public.claim_world_club(
  p_world_club_id UUID,
  p_profile_id UUID,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID;
  v_role TEXT;
  v_mode TEXT;
  v_club RECORD;
  v_profile_avatar TEXT;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  -- Identity comes from the session, never from the payload. Legit clients
  -- (including old pinned native bundles) always pass their own profile id,
  -- so requiring a match is invisible to them and only stops forgery.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_profile_id IS DISTINCT FROM v_caller THEN
    RETURN json_build_object('success', false, 'error', 'You can only claim a club for your own account');
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN json_build_object('success', false, 'error', 'Only club accounts can claim a club');
  END IF;

  v_mode := COALESCE(
    (SELECT value FROM app_settings WHERE key = 'world_club_claim_review_mode'),
    'auto'
  );

  SELECT * INTO v_club FROM world_clubs WHERE id = p_world_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Club not found');
  END IF;

  IF v_club.is_claimed THEN
    RETURN json_build_object('success', false, 'error', 'Club has already been claimed');
  END IF;

  SELECT avatar_url INTO v_profile_avatar FROM profiles WHERE id = v_caller;
  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  IF v_mode = 'manual' THEN
    -- File the request; grant nothing on the directory row. The club's own
    -- profile still gets the association so their account works normally.
    INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
    VALUES (p_world_club_id, v_caller, 'claimed_existing', 'pending')
    ON CONFLICT (world_club_id, profile_id) WHERE status = 'pending' DO NOTHING;

    UPDATE profiles
    SET current_world_club_id = p_world_club_id,
        mens_league_division = v_men_league_name,
        womens_league_division = v_women_league_name,
        mens_league_id = p_men_league_id,
        womens_league_id = p_women_league_id,
        world_region_id = v_club.province_id
    WHERE id = v_caller;

    RETURN json_build_object('success', true, 'club_id', p_world_club_id, 'pending', true);
  END IF;

  -- auto mode: grant instantly (today's behavior) and log it.
  UPDATE world_clubs
  SET
    is_claimed = true,
    claimed_profile_id = v_caller,
    claimed_at = timezone('utc', now()),
    men_league_id = p_men_league_id,
    women_league_id = p_women_league_id,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND v_profile_avatar IS NOT NULL THEN v_profile_avatar
      ELSE avatar_url
    END
  WHERE id = p_world_club_id;

  UPDATE profiles
  SET
    current_world_club_id = p_world_club_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = v_club.province_id,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND v_club.avatar_url IS NOT NULL THEN v_club.avatar_url
      ELSE avatar_url
    END
  WHERE id = v_caller;

  INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
  VALUES (p_world_club_id, v_caller, 'claimed_existing', 'auto_approved');

  RETURN json_build_object('success', true, 'club_id', p_world_club_id);
END;
$function$;

-- From 20260717120000_world_visibility_and_attribution.sql.
CREATE OR REPLACE FUNCTION public.create_and_claim_world_club(
  p_club_name TEXT,
  p_country_id INT,
  p_province_id INT DEFAULT NULL,
  p_profile_id UUID DEFAULT NULL,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID;
  v_role TEXT;
  v_mode TEXT;
  v_normalized TEXT;
  v_club_id TEXT;
  v_new_id UUID;
  v_existing RECORD;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_profile_id IS DISTINCT FROM v_caller THEN
    RETURN json_build_object('success', false, 'error', 'You can only claim a club for your own account');
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN json_build_object('success', false, 'error', 'Only club accounts can claim a club');
  END IF;

  v_mode := COALESCE(
    (SELECT value FROM app_settings WHERE key = 'world_club_claim_review_mode'),
    'auto'
  );

  v_normalized := lower(trim(p_club_name));
  IF length(v_normalized) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Club name must be at least 2 characters');
  END IF;

  SELECT * INTO v_existing FROM world_clubs
  WHERE club_name_normalized = v_normalized
    AND country_id = p_country_id
    AND COALESCE(province_id, 0) = COALESCE(p_province_id, 0);
  IF FOUND THEN
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END IF;

  v_club_id := replace(v_normalized, ' ', '_') || '_' || p_country_id || '_' || extract(epoch from now())::int;

  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  BEGIN
    INSERT INTO world_clubs (
      club_id, club_name, club_name_normalized, country_id, province_id,
      men_league_id, women_league_id, is_claimed, claimed_profile_id,
      claimed_at, created_from, created_by
    ) VALUES (
      v_club_id, p_club_name, v_normalized, p_country_id, p_province_id,
      p_men_league_id, p_women_league_id,
      (v_mode <> 'manual'),
      CASE WHEN v_mode <> 'manual' THEN v_caller ELSE NULL END,
      CASE WHEN v_mode <> 'manual' THEN timezone('utc', now()) ELSE NULL END,
      'user', v_caller
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END;

  INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
  VALUES (
    v_new_id, v_caller, 'created_and_claimed',
    CASE WHEN v_mode = 'manual' THEN 'pending' ELSE 'auto_approved' END
  );

  UPDATE profiles
  SET
    current_world_club_id = v_new_id,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = p_province_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name
  WHERE id = v_caller;

  IF v_mode = 'manual' THEN
    RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true, 'pending', true);
  END IF;
  RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) TO authenticated, service_role;

-- ── 4 · profiles column grants (20260612120000) ──────────────────────────────────
GRANT UPDATE (created_at, email) ON public.profiles TO authenticated;

-- ── 3 · rate-limit wrappers ──────────────────────────────────────────────────────
-- From 202601273000_database_rate_limiting.sql.
CREATE OR REPLACE FUNCTION public.check_application_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(p_user_id::TEXT, 'apply', 10, 3600);
$$;

-- From 202602180300_rate_limit_messages.sql.
CREATE OR REPLACE FUNCTION public.check_message_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(p_user_id::TEXT, 'send_message', 30, 60);
$$;

-- From 202602101700_rate_limit_user_posts.sql.
CREATE OR REPLACE FUNCTION public.check_user_post_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(p_user_id::TEXT, 'create_post', 10, 3600);
$$;

GRANT EXECUTE ON FUNCTION public.check_application_rate_limit(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_message_rate_limit(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_user_post_rate_limit(uuid) TO PUBLIC, anon, authenticated, service_role;

-- From 202603060400_fix_rate_limit_identifiers.sql (CREATE there; OR REPLACE here so
-- the grants are kept; VOLATILE + SECURITY DEFINER reset what the stub changed).
CREATE OR REPLACE FUNCTION public.check_login_rate_limit(p_email TEXT)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(lower(COALESCE(NULLIF(trim(p_email), ''), 'anonymous')), 'login_attempt', 5, 900);
$$;

COMMENT ON FUNCTION public.check_login_rate_limit(text) IS 'Rate limit: 5 login attempts per 15 minutes per email address';
GRANT EXECUTE ON FUNCTION public.check_login_rate_limit(text) TO PUBLIC, anon, authenticated, service_role;

-- ── 2 · rate-limit engine and maintenance jobs ───────────────────────────────────
-- check_rate_limit: default ACL + GRANT authenticated, anon (202601273000).
-- cleanup_rate_limits: default ACL + GRANT service_role (202601273000).
-- prune_old_heartbeats (202601051400), prune_old_logs (202603230300): default ACL.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_heartbeats(integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_logs() TO PUBLIC, anon, authenticated, service_role;

-- ── 1 · internal helpers (default ACL) ───────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public._enqueue_user_post_media(uuid, jsonb, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_milestone(uuid, text, boolean, jsonb) TO PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
