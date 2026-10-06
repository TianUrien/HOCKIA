-- Function grants, column write rules, contact rules and scheduled clean-ups.
-- Rollback: supabase/rollbacks/20261006100000_audit_db_hardening.down.sql
-- Probes:   supabase/tests/security/audit_db_hardening_acl.probe.sql (read-only, safe on prod)
--           supabase/tests/security/audit_db_hardening.probe.sql      (staging, rolled back)
--
-- Release review 2026-10-06, founder-approved items. Every existing object this file
-- redefines was copied in full from its NEWEST definition and changed only where noted.
--
-- Existing objects redefined (source of the copied definition):
--   claim_world_club(uuid, uuid, int, int)               20260717100000_world_club_claim_audit.sql
--     + one claimed club per account (advisory lock + check); nothing else changed
--   create_and_claim_world_club(text, int, int, uuid, int, int)
--                                                         20260717120000_world_visibility_and_attribution.sql
--     + one claimed club per account (advisory lock + check); nothing else changed
--   admin_send_removed_account_notice(uuid)              20261004300000_new_conversation_limits.sql
--     + refuses unless profiles.is_blocked; nothing else changed
--   admin_unblock_user(uuid)                             202512091301_admin_rpc_functions.sql
--     + deletes the removed_account_notices marker; nothing else changed
--   check_login_rate_limit(text)                         202603060400_fix_rate_limit_identifiers.sql
--     body replaced: always answers "allowed" and records nothing (see section 3)
--   check_application_rate_limit(uuid)                   202601273000_database_rate_limiting.sql
--   check_message_rate_limit(uuid)                       202602180300_rate_limit_messages.sql
--   check_user_post_rate_limit(uuid)                     202602101700_rate_limit_user_posts.sql
--     identifier = coalesce(auth.uid(), p_user_id) instead of p_user_id
--   link_signup_attribution(text, text, text, jsonb, text, timestamptz)
--                                                         body from 20260828140000_attribution_audit_fixes.sql
--     (the 5-argument overload, which that file created by mistake), signature and
--     grants from 20260725100000_analytics_foundation.sql; the 5-argument overload is dropped
--   policy player_work_permits_recruiter_select          20260928200000_d2_player_work_permits.sql
--     + the player must be a known adult (is_adult_profile)
--
-- Grant-only changes (definitions untouched):
--   _enqueue_user_post_media(uuid, jsonb, text)          202602140300  callers: two SECURITY DEFINER triggers
--   record_milestone(uuid, text, boolean, jsonb)         20260425010000 callers: three SECURITY DEFINER triggers
--   check_rate_limit(text, text, int, int)               202601273000  callers: SECURITY DEFINER wrappers and
--                                                                       post RPCs, edge functions via the service role
--   cleanup_rate_limits(int)                             202601273000
--   prune_old_heartbeats(int)                            202601051400
--   prune_old_logs()                                     202603230300
--   compute_product_health_score()                       20260427170000 callers: two SECURITY DEFINER admin fns
--   club_has_applicant(uuid, uuid)                       20260707151000 used by a profiles policy TO authenticated
--   user_in_conversation(uuid, uuid)                     202511130102  used by messages policies TO authenticated
--   is_blocked_pair(uuid, uuid)                          202603250500  called by signed-in profile pages
--   is_suggestible(uuid)                                 20260928210000
--   can_toggle_open_to_play(uuid)                        20260928210000 called by the signed-in open-to-play screen
--   profiles: UPDATE (created_at, email) revoked from authenticated (20260612120000 granted it)
--
--   ai_questions_today(uuid)                             20261003140000_ai_usage_log.sql
--     counts function = 'nl-search' only (was: everything except 'alert')
--
-- New objects: is_adult_profile(uuid), _guard_world_club_client_update() + trigger,
--   _guard_client_conversation_start() + trigger, _guard_client_message_sender() + trigger,
--   ai_opinion_quota_take(uuid, int), ai_opinion_quota_release(uuid),
--   trigger "send-push-resurfaced" on profile_notifications (clone of the Dashboard
--   send-push webhook), _push_subscription_single_owner() + trigger.
--
-- DEPLOY ORDER: deploy the send-push edge function that ignores UPDATE events unless
-- created_at changed BEFORE applying this migration (section 13).
--
-- Note on anon: until 2026-10-30 this platform grants EXECUTE on new functions to anon
-- by default ACL, so revoking from PUBLIC alone leaves anon able to call. Every revoke
-- below names PUBLIC and anon explicitly.
--
-- Not done here, on purpose:
--   * profiles.email READ: the store builds before iOS 1.3.8 / Android vc12 still run
--     profiles select('*'); a column revoke would break them exactly like 2026-07-07
--     (see 20260707230000). Waits for the same minimum-version bump as date_of_birth.
--   * date_of_birth grants: untouched.


-- ═══ 1 · Internal helpers: no client access ═════════════════════════════════════

REVOKE ALL ON FUNCTION public._enqueue_user_post_media(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enqueue_user_post_media(uuid, jsonb, text) TO service_role;

-- record_milestone: the only signature left (20260425010000 re-created it after a DROP).
REVOKE ALL ON FUNCTION public.record_milestone(uuid, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_milestone(uuid, text, boolean, jsonb) TO service_role;


-- ═══ 2 · Rate-limit engine and maintenance jobs: server only ════════════════════

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(integer) TO service_role;

REVOKE ALL ON FUNCTION public.prune_old_heartbeats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_heartbeats(integer) TO service_role;

REVOKE ALL ON FUNCTION public.prune_old_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_logs() TO service_role;


-- ═══ 3 · Rate-limit wrappers ════════════════════════════════════════════════════

-- Per-user wrappers count against the CALLER. p_user_id is kept so existing clients
-- keep working; it is only used when there is no signed-in user (service role).
CREATE OR REPLACE FUNCTION public.check_application_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(coalesce(auth.uid(), p_user_id)::TEXT, 'apply', 10, 3600);
$$;

CREATE OR REPLACE FUNCTION public.check_message_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(coalesce(auth.uid(), p_user_id)::TEXT, 'send_message', 30, 60);
$$;

CREATE OR REPLACE FUNCTION public.check_user_post_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(coalesce(auth.uid(), p_user_id)::TEXT, 'create_post', 10, 3600);
$$;

REVOKE ALL ON FUNCTION public.check_application_rate_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_application_rate_limit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_message_rate_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_message_rate_limit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_user_post_rate_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_user_post_rate_limit(uuid) TO authenticated, service_role;

-- Sign-in pre-check. It was keyed by the email typed in, callable before sign-in, and
-- the app honoured its answer, so anyone could use up the allowance for someone
-- else's address. It never limited a real attacker (the sign-in endpoint does not
-- consult it); Supabase Auth applies its own sign-in limits. It now always answers
-- "allowed" in the same shape and records nothing. Kept, with its grants, because
-- installed app builds call it before every password and magic-link sign-in.
-- Signup and password-reset pre-checks are unchanged.
CREATE OR REPLACE FUNCTION public.check_login_rate_limit(p_email TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'allowed', true,
    'remaining', 5,
    'reset_at', now() + interval '15 minutes',
    'limit', 5
  );
$$;

COMMENT ON FUNCTION public.check_login_rate_limit(text) IS
  'Compatibility stub for installed app builds: always allowed, records nothing. Sign-in limits are enforced by Supabase Auth.';

REVOKE ALL ON FUNCTION public.check_login_rate_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_login_rate_limit(text) TO anon, authenticated, service_role;


-- ═══ 4 · profiles: created_at and email are not client-writable ═════════════════

-- No current or store-release client sends either column in an UPDATE (checked:
-- current client/src and the release commits 14512848, 27cc3dc0, 27bcddb0, bac44f07;
-- profiles is never upserted by the client). email follows auth.users through
-- SECURITY DEFINER code, which is not subject to these grants. INSERT is unchanged:
-- the first-login placeholder insert sends email.
REVOKE UPDATE (created_at, email) ON public.profiles FROM authenticated, anon;


-- ═══ 5 · world_clubs: directory facts change only through the server ════════════

-- Clients update world_clubs directly only from the Admin Portal. A club account's
-- legitimate changes reach its row through SECURITY DEFINER code (claim functions,
-- the profile → club league and crest sync triggers), where current_user is not
-- 'authenticated', so this trigger does not fire for them. For a signed-in non-admin
-- the only directly editable column is avatar_url (updated_at is set by a trigger).
CREATE OR REPLACE FUNCTION public._guard_world_club_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.verified_at          IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by          IS DISTINCT FROM OLD.verified_by
     OR NEW.is_claimed           IS DISTINCT FROM OLD.is_claimed
     OR NEW.claimed_profile_id   IS DISTINCT FROM OLD.claimed_profile_id
     OR NEW.claimed_at           IS DISTINCT FROM OLD.claimed_at
     OR NEW.club_id              IS DISTINCT FROM OLD.club_id
     OR NEW.club_name            IS DISTINCT FROM OLD.club_name
     OR NEW.club_name_normalized IS DISTINCT FROM OLD.club_name_normalized
     OR NEW.country_id           IS DISTINCT FROM OLD.country_id
     OR NEW.province_id          IS DISTINCT FROM OLD.province_id
     OR NEW.men_league_id        IS DISTINCT FROM OLD.men_league_id
     OR NEW.women_league_id      IS DISTINCT FROM OLD.women_league_id
     OR NEW.created_by           IS DISTINCT FROM OLD.created_by
     OR NEW.created_from         IS DISTINCT FROM OLD.created_from
     OR NEW.created_at           IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only Hockia can change this club detail.'
      USING ERRCODE = '42501', DETAIL = 'world_club_locked_column';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._guard_world_club_client_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._guard_world_club_client_update() TO service_role;

DROP TRIGGER IF EXISTS world_clubs_guard_client_update ON public.world_clubs;
CREATE TRIGGER world_clubs_guard_client_update
  BEFORE UPDATE ON public.world_clubs
  FOR EACH ROW
  WHEN (current_user = 'authenticated')
  EXECUTE FUNCTION public._guard_world_club_client_update();

-- One claimed club per club account.
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

  -- One club account holds at most one claimed club (audit 2026-10-06).
  PERFORM pg_advisory_xact_lock(hashtext('world_club_claim:' || v_caller::text));
  IF EXISTS (SELECT 1 FROM world_clubs WHERE claimed_profile_id = v_caller AND id <> p_world_club_id) THEN
    RETURN json_build_object('success', false,
      'error', 'Your account is already linked to a club. To change it, contact us.');
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

  -- One club account holds at most one claimed club (audit 2026-10-06).
  PERFORM pg_advisory_xact_lock(hashtext('world_club_claim:' || v_caller::text));
  IF EXISTS (SELECT 1 FROM world_clubs WHERE claimed_profile_id = v_caller) THEN
    RETURN json_build_object('success', false,
      'error', 'Your account is already linked to a club. To change it, contact us.');
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

-- Grants unchanged from 20260717100000 (restated).
REVOKE ALL ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) TO authenticated, service_role;


-- ═══ 6 · Messages: blocked senders, clubs and coaches with under-18s ════════════

-- Both triggers carry WHEN (current_user = 'authenticated'): they fire for a statement
-- a signed-in client runs and never inside SECURITY DEFINER server functions (send_invite,
-- make_offer, mark_signed … keep their own rules), the service role or the owner. The
-- existing triggers (enforce_message_not_blocked / enforce_conversation_not_blocked,
-- 20260707151000) are unchanged and still refuse any thread with a hidden participant.
-- Names sort before those ("…_client_…" < "…_enforce_…"; BEFORE triggers fire in name
-- order) so a hidden SENDER gets its own sentence rather than "This user is not
-- available"; refusals about the OTHER member are still answered by the existing ones.
--
-- Note: an account that declares an under-18 date of birth is frozen (frozen_minor_at,
-- 20260711100000) and so already uncontactable. The rule below covers an under-18
-- that is not frozen (e.g. a date set by support, or a role outside the freeze).

-- An admin-blocked (or frozen) account cannot send.
CREATE OR REPLACE FUNCTION public._guard_client_message_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.sender_id
       AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  ) THEN
    RAISE EXCEPTION 'You can''t send messages right now.'
      USING ERRCODE = 'check_violation', DETAIL = 'sender_unavailable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._guard_client_message_sender() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._guard_client_message_sender() TO service_role;

DROP TRIGGER IF EXISTS messages_client_sender_guard ON public.messages;
CREATE TRIGGER messages_client_sender_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  WHEN (current_user = 'authenticated')
  EXECUTE FUNCTION public._guard_client_message_sender();

-- A new conversation started from a client:
--   * the starter (auth.uid()) must not be admin-blocked or frozen;
--   * founder ruling 2026-10-06: a club or a recruiting coach (is_recruiter) and an
--     under-18 (is_minor: known date of birth) cannot start a conversation, whichever
--     side starts it. A pair that already has a conversation is left to the unique
--     index (the client then opens the existing conversation), so existing
--     conversations keep working. Minors may still start conversations with each
--     other and with anyone who is not a recruiter.
CREATE OR REPLACE FUNCTION public._guard_client_conversation_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = v_uid
       AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  ) THEN
    RAISE EXCEPTION 'You can''t start conversations right now.'
      USING ERRCODE = 'check_violation', DETAIL = 'sender_unavailable';
  END IF;

  IF NEW.participant_one_id IS NULL OR NEW.participant_two_id IS NULL
     OR NEW.participant_one_id = NEW.participant_two_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE least(c.participant_one_id, c.participant_two_id) = least(NEW.participant_one_id, NEW.participant_two_id)
       AND greatest(c.participant_one_id, c.participant_two_id) = greatest(NEW.participant_one_id, NEW.participant_two_id)
  ) THEN
    RETURN NEW;
  END IF;

  -- A hidden (frozen / blocked) member is left to enforce_conversation_not_blocked,
  -- whose neutral sentence must not be replaced by one that hints at an age.
  IF (public.is_recruiter(NEW.participant_one_id) AND public.is_minor(NEW.participant_two_id)
        AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.participant_two_id
                         AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)))
     OR (public.is_recruiter(NEW.participant_two_id) AND public.is_minor(NEW.participant_one_id)
        AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.participant_one_id
                         AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at))) THEN
    RAISE EXCEPTION 'This member can''t be contacted by clubs or coaches.'
      USING ERRCODE = 'P0001', DETAIL = 'recruiter_minor';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._guard_client_conversation_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._guard_client_conversation_start() TO service_role;

DROP TRIGGER IF EXISTS conversations_client_start_guard ON public.conversations;
CREATE TRIGGER conversations_client_start_guard
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  WHEN (current_user = 'authenticated')
  EXECUTE FUNCTION public._guard_client_conversation_start();

-- Work permits: recruiters read them only for known adults. A SECURITY DEFINER helper,
-- so the policy does not read profiles.date_of_birth with the caller's column grants
-- (that grant is temporary, 20260707230000). Answers only true/false for a known
-- adult; age itself is already shown product-wide.
CREATE OR REPLACE FUNCTION public.is_adult_profile(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_uid
       AND public.profile_is_adult(p.date_of_birth)
  );
$$;

REVOKE ALL ON FUNCTION public.is_adult_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_adult_profile(uuid) TO authenticated, service_role;

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
    AND public.is_adult_profile(player_work_permits.player_id)
  );


-- ═══ 7 · Removed-account safety notice ══════════════════════════════════════════

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
  v_blocked boolean;
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

  SELECT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at), coalesce(p.is_blocked, false)
    INTO v_hidden, v_blocked
    FROM public.profiles p
   WHERE p.id = p_removed_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  -- The notice says the account "has been removed": only true once it is blocked.
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Block the account first.' USING DETAIL = 'account_not_blocked';
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

  -- An unblocked account is no longer "removed": clear the marker so the chat
  -- stops showing the removed-account notice (audit 2026-10-06).
  DELETE FROM removed_account_notices WHERE profile_id = p_profile_id;

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

-- Grants as left by 202512101002 + 202512101500 (restated).
REVOKE ALL ON FUNCTION public.admin_unblock_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unblock_user(uuid) TO authenticated, service_role;


-- ═══ 8 · Lookup functions: not callable signed out ══════════════════════════════

-- No signed-out page calls any of these (client/src checked). authenticated keeps
-- EXECUTE where a signed-in page or a policy TO authenticated uses it.
REVOKE ALL ON FUNCTION public.club_has_applicant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_has_applicant(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_in_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_in_conversation(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_blocked_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_suggestible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_suggestible(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_toggle_open_to_play(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_toggle_open_to_play(uuid) TO authenticated, service_role;

-- Platform-wide metrics with no caller check of its own: reached only through the
-- admin wrappers (admin_get_product_health_score, snapshot_product_health_score).
REVOKE ALL ON FUNCTION public.compute_product_health_score() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_product_health_score() TO service_role;


-- ═══ 9 · Scheduled jobs ═════════════════════════════════════════════════════════

-- archive_messages_daily (202511171630) deletes messages older than a year; stopped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive_messages_daily') THEN
    PERFORM cron.unschedule('archive_messages_daily');
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_function OR invalid_schema_name THEN RAISE NOTICE 'pg_cron not available; nothing to unschedule';
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule archive_messages_daily; continuing';
END $$;

-- rate_limits: the longest window in use is one hour; keep 24 hours. 03:40 UTC.
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup_rate_limits_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior cleanup_rate_limits_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('cleanup_rate_limits_daily', '40 3 * * *',
    $cron$SELECT public.cleanup_rate_limits(24);$cron$);
END $$;

-- user_engagement_heartbeats: its only reader, admin_get_user_engagement_detail, looks
-- back 90 days (its default and the Admin Portal's); the daily totals live in
-- user_engagement_daily and are not touched. Keep 90 days. 03:50 UTC.
DO $$
BEGIN
  PERFORM cron.unschedule('prune_old_heartbeats_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior prune_old_heartbeats_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('prune_old_heartbeats_daily', '50 3 * * *',
    $cron$SELECT public.prune_old_heartbeats(90);$cron$);
END $$;


-- ═══ 10 · link_signup_attribution: one signature ════════════════════════════════

-- Installed builds (native 1.16 / 1.3.15) call it with p_first_source, which only the
-- 6-argument signature accepts. The newer body (real host extraction) moves into it;
-- p_first_source stays accepted and unused, as in both earlier bodies.
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
      -- scheme://[user@]host[:port]/… → host; a bare hostname passes through
      'referring_domain', COALESCE(
        substring(p_first_referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/]+@)?([^/:?#]+)'),
        p_first_referrer),
      'landing_page', p_landing_path,
      'captured_at', p_first_seen_at
    )
  ));
$$;

DROP FUNCTION IF EXISTS public.link_signup_attribution(text, text, jsonb, text, timestamptz);

REVOKE ALL ON FUNCTION public.link_signup_attribution(text, text, text, jsonb, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_signup_attribution(text, text, text, jsonb, text, timestamptz) TO authenticated, service_role;


-- ═══ 11 · AI opinion: atomic daily quota (edge-function fix branch) ═════════════

-- Table ai_opinion_quota (viewer_id, day, count), PK (viewer_id, day), 20260528130000.
-- The ai-opinion edge function counts in UTC days (toISOString), so the day here
-- is the UTC date too. take: +1 and the new count, or NULL when the cap is reached
-- (the row is left untouched). release: gives one back after a failed generation.
CREATE OR REPLACE FUNCTION public.ai_opinion_quota_take(p_viewer uuid, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_viewer IS NULL OR coalesce(p_limit, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.ai_opinion_quota AS q (viewer_id, day, count)
  VALUES (p_viewer, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (viewer_id, day) DO UPDATE
    SET count = q.count + 1
    WHERE q.count < p_limit
  RETURNING q.count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_opinion_quota_take(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_opinion_quota_take(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_opinion_quota_release(p_viewer uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ai_opinion_quota
     SET count = count - 1
   WHERE viewer_id = p_viewer
     AND day = (now() AT TIME ZONE 'utc')::date
     AND count > 0;
$$;

REVOKE ALL ON FUNCTION public.ai_opinion_quota_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_opinion_quota_release(uuid) TO service_role;


-- ═══ 12 · ai_questions_today: Hockia AI questions only ══════════════════════════

-- Copied from 20261003140000_ai_usage_log.sql; only the function filter changed
-- (was: function <> 'alert'). Drafting functions now log usage to ai_usage_log
-- too and must not use up the member's daily Hockia AI questions.
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
     AND l.function = 'nl-search'
     AND l.created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
$$;

REVOKE ALL ON FUNCTION public.ai_questions_today(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_questions_today(uuid) TO service_role;


-- ═══ 13 · Push for re-surfaced notifications ════════════════════════════════════

-- DEPLOY ORDER: the send-push edge function that ignores UPDATE events unless
-- created_at changed must be deployed BEFORE this migration runs.
--
-- enqueue_notification (newest: 202603251400) upserts on (recipient, kind, source)
-- and sets created_at again, so a later step on the same item re-surfaces the row
-- by UPDATE; the send-push database webhook (created in the Dashboard) fires on
-- INSERT only. This clones that webhook trigger as "send-push-resurfaced",
-- AFTER UPDATE, only when created_at changed. Nothing else changes created_at on
-- profile_notifications: handle_message_notifications (newest 20260928110000)
-- updates rows but keeps created_at on purpose; no edge function or client
-- updates the table's created_at.
DO $$
DECLARE
  v_def    text;
  v_n      integer;
  v_new    text;
BEGIN
  SELECT count(*), max(pg_get_triggerdef(t.oid))
    INTO v_n, v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.profile_notifications'::regclass
     AND NOT t.tgisinternal
     AND t.tgname <> 'send-push-resurfaced'
     AND pg_get_triggerdef(t.oid) LIKE '%/functions/v1/send-push%';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'send-push webhook trigger not found on public.profile_notifications';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'more than one send-push webhook trigger on public.profile_notifications (%)', v_n;
  END IF;

  v_new := regexp_replace(v_def, '^CREATE TRIGGER .*? AFTER INSERT ON ', 'CREATE TRIGGER "send-push-resurfaced" AFTER UPDATE ON ');
  v_new := regexp_replace(v_new, ' FOR EACH ROW EXECUTE ', ' FOR EACH ROW WHEN (OLD.created_at IS DISTINCT FROM NEW.created_at) EXECUTE ');
  IF v_new NOT LIKE 'CREATE TRIGGER "send-push-resurfaced" AFTER UPDATE ON public.profile_notifications FOR EACH ROW WHEN (OLD.created_at IS DISTINCT FROM NEW.created_at) EXECUTE %' THEN
    RAISE EXCEPTION 'could not derive the AFTER UPDATE ... WHEN clone from the send-push trigger definition';
  END IF;

  DROP TRIGGER IF EXISTS "send-push-resurfaced" ON public.profile_notifications;
  EXECUTE v_new;
END $$;


-- ═══ 14 · One owner per push device ═════════════════════════════════════════════

-- push_subscriptions (202602200300 + 202603230600): profile_id, endpoint (web push,
-- nullable since 202603230600), fcm_token (native, nullable); UNIQUE (profile_id,
-- endpoint) and UNIQUE (profile_id, fcm_token) are per profile only, so a device
-- shared by two accounts (sign out, sign in as someone else) kept pushing to both.
-- Registering a device now removes it from every OTHER profile.
CREATE OR REPLACE FUNCTION public._push_subscription_single_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.endpoint IS NULL AND NEW.fcm_token IS NULL THEN
    RETURN NEW;
  END IF;
  DELETE FROM public.push_subscriptions s
   WHERE s.profile_id IS DISTINCT FROM NEW.profile_id
     AND ((NEW.endpoint IS NOT NULL AND s.endpoint = NEW.endpoint)
       OR (NEW.fcm_token IS NOT NULL AND s.fcm_token = NEW.fcm_token));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._push_subscription_single_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._push_subscription_single_owner() TO service_role;

DROP TRIGGER IF EXISTS push_subscriptions_single_owner ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_single_owner
  BEFORE INSERT OR UPDATE OF endpoint, fcm_token, profile_id ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public._push_subscription_single_owner();


-- ═══ Self-checks ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public._enqueue_user_post_media(uuid, jsonb, text)',
    'public.check_rate_limit(text, text, integer, integer)',
    'public.cleanup_rate_limits(integer)',
    'public.prune_old_heartbeats(integer)',
    'public.prune_old_logs()',
    'public.compute_product_health_score()',
    'public.ai_opinion_quota_take(uuid, integer)',
    'public.ai_opinion_quota_release(uuid)',
    'public.ai_questions_today(uuid)',
    'public._push_subscription_single_owner()'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is still callable by a client role', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.club_has_applicant(uuid, uuid)',
    'public.user_in_conversation(uuid, uuid)',
    'public.is_blocked_pair(uuid, uuid)',
    'public.is_suggestible(uuid)',
    'public.can_toggle_open_to_play(uuid)',
    'public.check_application_rate_limit(uuid)',
    'public.check_message_rate_limit(uuid)',
    'public.check_user_post_rate_limit(uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: anon can still execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: authenticated lost EXECUTE on %', v_fn;
    END IF;
  END LOOP;

  IF has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check: authenticated can still update profiles.email / created_at';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check: authenticated lost UPDATE on profiles.full_name';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profile_notifications'::regclass
                  AND tgname = 'send-push-resurfaced' AND pg_get_triggerdef(oid) ILIKE '%AFTER UPDATE%WHEN%created_at%') THEN
    RAISE EXCEPTION 'self-check: send-push-resurfaced trigger missing or not AFTER UPDATE ... WHEN';
  END IF;

  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'link_signup_attribution') <> 1 THEN
    RAISE EXCEPTION 'self-check: link_signup_attribution should have exactly one signature';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
