-- ============================================================================
-- P3 — 18+ age gate: core schema + freeze machinery (Master Order v2)
-- ============================================================================
-- SCOPE RULE (load-bearing): every restriction below keys on natural-person
-- roles (player/coach/umpire). Club and brand accounts are organizations —
-- they have no DOB by nature and must NEVER be frozen or restricted; their
-- requirement is an 18+ operator attestation (org_attested_18plus_at).
--
-- Enforcement is three-layered (fixing the known "inconsistent block
-- enforcement" audit theme for is_blocked at the same time, per founder
-- decision 2026-07-07):
--   (1) base RLS SELECT policies on profiles      — this migration
--   (2) BEFORE-INSERT triggers on the three direct-write contact paths
--       (conversations / messages / profile_friendships) — this migration
--   (3) per-RPC filters in the SECURITY DEFINER read surfaces — follow-up
--       migration (safe to trail: no account is frozen/restricted until the
--       backfill is armed; predicates are false for everyone today)
--
-- DOB privacy note: date_of_birth column grants are NOT revoked here — the
-- client must first migrate to profiles_self (own reads) and
-- get_profile_ages (public age display). The revoke ships in a follow-up
-- migration after the client is live everywhere. AGE stays fully visible
-- product-wide (server-computed); only the raw birthdate becomes private.

-- ────────────────────────────────────────────────────────────────────
-- 1. Columns (profiles uses COLUMN-LEVEL grants: every new column must be
--    granted explicitly or authenticated `select('*')` breaks app-wide)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS frozen_minor_at timestamptz,
  ADD COLUMN IF NOT EXISTS dob_required_since timestamptz,
  ADD COLUMN IF NOT EXISTS org_attested_18plus_at timestamptz;

-- Readable by authenticated (rows of frozen users are hidden from others by
-- the RLS below, so this leaks nothing); server-set only — no UPDATE grants.
GRANT SELECT (frozen_minor_at, dob_required_since, org_attested_18plus_at)
  ON public.profiles TO authenticated;

CREATE INDEX IF NOT EXISTS idx_profiles_frozen_minor
  ON public.profiles (frozen_minor_at) WHERE frozen_minor_at IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 2. Juniors waitlist (Phase 2 demand data) + age-gate email queue
-- ────────────────────────────────────────────────────────────────────
-- Written by the age-gate edge fn (blocked minors have no account, so the
-- endpoint is anon-facing + rate-limited; the table itself is service-only).
CREATE TABLE public.juniors_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  date_of_birth date,
  source text NOT NULL DEFAULT 'signup_gate',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE UNIQUE INDEX idx_juniors_waitlist_email ON public.juniors_waitlist (lower(email));
ALTER TABLE public.juniors_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.juniors_waitlist FROM anon, authenticated;

CREATE TABLE public.age_gate_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('goodbye', 'welcome_back', 'dob_reminder', 'dob_final')),
  sweep_date date NOT NULL DEFAULT (timezone('utc', now()))::date,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (profile_id, kind, sweep_date)
);
ALTER TABLE public.age_gate_email_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.age_gate_email_queue FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 3. The shared predicates (single source of truth for all three layers)
-- ────────────────────────────────────────────────────────────────────
-- HIDDEN = invisible everywhere (admin ban OR frozen minor).
CREATE OR REPLACE FUNCTION public.profile_is_hidden(
  p_is_blocked boolean,
  p_frozen_minor_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_is_blocked, false) OR p_frozen_minor_at IS NOT NULL
$$;

-- UNCONTACTABLE = hidden, OR an unknown-age person account whose 14-day
-- DOB-confirmation grace (clocked from the enforcement email) has lapsed.
-- Organizations (club/brand) can NEVER be uncontactable through the person
-- branch — the role check is inside the predicate, not at call sites.
CREATE OR REPLACE FUNCTION public.profile_is_uncontactable(
  p_is_blocked boolean,
  p_frozen_minor_at timestamptz,
  p_role text,
  p_date_of_birth date,
  p_dob_required_since timestamptz
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT public.profile_is_hidden(p_is_blocked, p_frozen_minor_at)
      OR (p_role IN ('player', 'coach', 'umpire')
          AND p_date_of_birth IS NULL
          AND p_dob_required_since IS NOT NULL
          AND p_dob_required_since < timezone('utc', now()) - interval '14 days')
$$;

-- ────────────────────────────────────────────────────────────────────
-- 4. Layer 1 — base RLS (previously is_blocked was NOT filtered here: an
--    admin-banned profile's public page still rendered; fixed now for both)
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon can view active onboarded profiles" ON public.profiles;
CREATE POLICY "Anon can view active onboarded profiles" ON public.profiles
  FOR SELECT TO anon
  USING (
    onboarding_completed = true
    AND COALESCE(is_test_account, false) = false
    AND NOT public.profile_is_hidden(is_blocked, frozen_minor_at)
  );

-- Own-profile visibility survives via the separate "Users can view their own
-- profile" policy (permissive OR) — a frozen user still reaches their goodbye
-- screen; admins keep full visibility via "Admins can view all profiles".
DROP POLICY IF EXISTS "Authenticated can view onboarded profiles" ON public.profiles;
CREATE POLICY "Authenticated can view onboarded profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    onboarding_completed = true
    AND NOT public.profile_is_hidden(is_blocked, frozen_minor_at)
  );

DROP POLICY IF EXISTS "Clubs can view applicant player profiles" ON public.profiles;
CREATE POLICY "Clubs can view applicant player profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    role = 'player'
    AND public.club_has_applicant((SELECT auth.uid()), id)
    AND NOT public.profile_is_hidden(is_blocked, frozen_minor_at)
  );

-- Withdrawn applications must not keep the applicant club-visible…
CREATE OR REPLACE FUNCTION public.club_has_applicant(p_club_id uuid, p_player_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.opportunity_applications oa
    JOIN public.opportunities o ON o.id = oa.opportunity_id
    WHERE oa.applicant_id = p_player_id
      AND o.club_id = p_club_id
      AND oa.status <> 'withdrawn'
  );
$function$;

-- …and must vanish from the publisher's application lists entirely.
DROP POLICY IF EXISTS "Publishers can view applications to their opportunities" ON public.opportunity_applications;
CREATE POLICY "Publishers can view applications to their opportunities" ON public.opportunity_applications
  FOR SELECT TO authenticated
  USING (
    status <> 'withdrawn'
    AND EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE o.id = opportunity_applications.opportunity_id
        AND o.club_id = (SELECT auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 5. Layer 2 — contact-path triggers (copy stays NEUTRAL: no surface may
--    reveal an age-related freeze)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_conversation_not_blocked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bad integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.participant_one_id AND blocked_id = NEW.participant_two_id)
       OR (blocker_id = NEW.participant_two_id AND blocked_id = NEW.participant_one_id)
  ) THEN
    RAISE EXCEPTION 'Cannot start a conversation with a user you have blocked or who has blocked you.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Age-gate / account-status fence: no NEW conversation may involve a
  -- hidden (banned/frozen), contact-restricted, or not-yet-onboarded
  -- account. Also closes the pre-onboarding stub hole (OAuth signups have a
  -- profile row before the DOB step — it must be uncontactable).
  SELECT count(*) INTO v_bad
  FROM public.profiles p
  WHERE p.id IN (NEW.participant_one_id, NEW.participant_two_id)
    AND (
      public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
      OR COALESCE(p.onboarding_completed, false) = false
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'This user is not available for messaging right now.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_message_not_blocked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conv RECORD;
BEGIN
  SELECT c.participant_one_id, c.participant_two_id INTO v_conv
  FROM public.conversations c WHERE c.id = NEW.conversation_id;

  IF v_conv IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_conv.participant_one_id AND blocked_id = v_conv.participant_two_id)
       OR (blocker_id = v_conv.participant_two_id AND blocked_id = v_conv.participant_one_id)
  ) THEN
    RAISE EXCEPTION 'Cannot message a user you have blocked or who has blocked you.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- HIDDEN participants (banned / frozen) kill the thread both directions.
  -- Grace-restricted (unknown-age) accounts may continue EXISTING threads —
  -- only new contact is fenced (spec: "cannot send or receive new DMs").
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id IN (v_conv.participant_one_id, v_conv.participant_two_id)
      AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  ) THEN
    RAISE EXCEPTION 'This user is not available for messaging right now.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_friendship_not_blocked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bad integer;
BEGIN
  -- A blocked pair (either direction) must not (re)establish a friendship. block_user
  -- deletes any existing row on block, so a blocked pair should have no row at all —
  -- any INSERT/UPDATE here between a blocked pair is illegitimate.
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.user_one AND blocked_id = NEW.user_two)
       OR (blocker_id = NEW.user_two AND blocked_id = NEW.user_one)
  ) THEN
    RAISE EXCEPTION 'Cannot send a friend request to a user you have blocked or who has blocked you.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Age-gate / account-status fence (same rules as conversation creation).
  SELECT count(*) INTO v_bad
  FROM public.profiles p
  WHERE p.id IN (NEW.user_one, NEW.user_two)
    AND (
      public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
      OR COALESCE(p.onboarding_completed, false) = false
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'This user is not available right now.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 6. Freeze / declare / unfreeze machinery
-- ────────────────────────────────────────────────────────────────────
-- The history ledger's changed_via CHECK predates the freeze marker.
ALTER TABLE public.application_status_history
  DROP CONSTRAINT IF EXISTS application_status_history_changed_via_check;
ALTER TABLE public.application_status_history
  ADD CONSTRAINT application_status_history_changed_via_check
  CHECK (changed_via = ANY (ARRAY['email_action'::text, 'auto_expiry'::text, 'minor_freeze'::text]));

-- Freeze, never delete. Withdraws pending applications silently (own
-- changed_via marker; the notify trigger's IN-list ignores 'withdrawn', so
-- no notification fires anywhere), clears authored feed items, queues the
-- warm goodbye email. Session ban happens in the age-gate edge fn (auth
-- admin API is unreachable from SQL).
CREATE OR REPLACE FUNCTION public.freeze_minor_account(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_withdrawn integer := 0;
BEGIN
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = p_profile_id;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  -- SCOPE RULE: organizations can never be frozen.
  IF v_role NOT IN ('player', 'coach', 'umpire') THEN
    RETURN jsonb_build_object('outcome', 'not_a_person_role');
  END IF;

  UPDATE profiles
     SET frozen_minor_at = COALESCE(frozen_minor_at, timezone('utc', now()))
   WHERE id = p_profile_id;

  -- Silent withdrawal: same write shape as triage so the history trigger
  -- records changed_via; excluded from responsiveness + digests + club lists.
  UPDATE opportunity_applications a
     SET status = 'withdrawn',
         metadata = COALESCE(a.metadata, '{}'::jsonb)
                    || jsonb_build_object('changed_via', 'minor_freeze')
   WHERE a.applicant_id = p_profile_id
     AND a.status = 'pending';
  GET DIAGNOSTICS v_withdrawn = ROW_COUNT;

  DELETE FROM home_feed_items WHERE author_profile_id = p_profile_id;

  INSERT INTO age_gate_email_queue (profile_id, kind)
  VALUES (p_profile_id, 'goodbye')
  ON CONFLICT (profile_id, kind, sweep_date) DO NOTHING;

  RETURN jsonb_build_object('outcome', 'frozen', 'withdrawn_applications', v_withdrawn);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.freeze_minor_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_minor_account(uuid) TO service_role;

-- Login-modal / onboarding DOB declaration. Authenticated-callable; the
-- under-18 branch freezes atomically server-side (a client cannot skip it).
CREATE OR REPLACE FUNCTION public.declare_date_of_birth(p_dob date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF p_dob IS NULL OR p_dob < DATE '1900-01-01' OR p_dob > (timezone('utc', now()))::date - INTERVAL '4 years' THEN
    RETURN jsonb_build_object('outcome', 'invalid_dob');
  END IF;

  SELECT p.role INTO v_role FROM profiles p WHERE p.id = v_uid;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  UPDATE profiles
     SET date_of_birth = p_dob,
         dob_required_since = NULL,
         updated_at = timezone('utc', now())
   WHERE id = v_uid;

  IF v_role IN ('player', 'coach', 'umpire')
     AND p_dob > (timezone('utc', now()))::date - INTERVAL '18 years' THEN
    RETURN public.freeze_minor_account(v_uid);
  END IF;

  RETURN jsonb_build_object('outcome', 'confirmed');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.declare_date_of_birth(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_date_of_birth(date) TO authenticated;

-- Club/brand operator attestation (soft prompt; never blocking).
CREATE OR REPLACE FUNCTION public.attest_org_operator_adult()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = v_uid;
  IF v_role NOT IN ('club', 'brand') THEN
    RETURN jsonb_build_object('outcome', 'not_an_org_role');
  END IF;
  UPDATE profiles
     SET org_attested_18plus_at = COALESCE(org_attested_18plus_at, timezone('utc', now()))
   WHERE id = v_uid;
  RETURN jsonb_build_object('outcome', 'attested');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attest_org_operator_adult() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attest_org_operator_adult() TO authenticated;

-- Auto-unfreeze at the 18th birthday (founder decision #4). Withdrawn
-- applications stay withdrawn — the welcome-back email points at FRESH
-- opportunities instead (drain fn reuses similar_open_opportunities).
CREATE OR REPLACE FUNCTION public.unfreeze_adults()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    UPDATE profiles p
       SET frozen_minor_at = NULL
     WHERE p.frozen_minor_at IS NOT NULL
       AND p.date_of_birth IS NOT NULL
       AND p.date_of_birth <= (timezone('utc', now()))::date - INTERVAL '18 years'
     RETURNING p.id
  LOOP
    v_count := v_count + 1;
    INSERT INTO age_gate_email_queue (profile_id, kind)
    VALUES (r.id, 'welcome_back')
    ON CONFLICT (profile_id, kind, sweep_date) DO NOTHING;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.unfreeze_adults() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unfreeze_adults() TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 7. Age stays first-class product data: server-computed, predicate-aware.
--    (Raw DOB becomes owner/admin/server-only in the follow-up revoke.)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_profile_ages(p_ids uuid[])
RETURNS TABLE (profile_id uuid, age integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, EXTRACT(YEAR FROM age((timezone('utc', now()))::date, p.date_of_birth))::int
  FROM public.profiles p
  WHERE p.id = ANY (p_ids)
    AND p.date_of_birth IS NOT NULL
    AND p.onboarding_completed = true
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
$function$;

GRANT EXECUTE ON FUNCTION public.get_profile_ages(uuid[]) TO anon, authenticated;

-- Self-only full-row view: carries the owner's raw date_of_birth after the
-- column revoke (view owner bypasses column grants; the WHERE is the fence).
-- NOTE: `SELECT *` is frozen at creation — future profiles columns need a
-- view recreation to appear here (deliberate: new sensitive columns don't
-- auto-leak to the owner-facing API surface either).
CREATE VIEW public.profiles_self
WITH (security_barrier = true) AS
  SELECT * FROM public.profiles WHERE id = (SELECT auth.uid());

REVOKE ALL ON public.profiles_self FROM anon;
GRANT SELECT ON public.profiles_self TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 8. Responsiveness metric: a silent withdrawal is NOT a club response
--    (body identical to 20260706100000 plus the new_status exclusion)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.snapshot_publisher_responsiveness()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_launch timestamptz;
BEGIN
  SELECT s.launch_date INTO v_launch FROM application_response_settings s;
  -- Pre-launch the metric is undefined by construction; also wipes nothing.
  IF v_launch IS NULL THEN
    RETURN;
  END IF;

  WITH first_response AS (
    SELECT DISTINCT ON (h.application_id)
      h.application_id,
      h.created_at AS responded_at,
      o.club_id AS publisher_id,
      a.applied_at
    FROM application_status_history h
    JOIN opportunity_applications a ON a.id = h.application_id
    JOIN opportunities o ON o.id = a.opportunity_id
    WHERE h.old_status = 'pending'
      -- System withdrawals (minor freeze) are neither a response nor a
      -- non-response — the row simply never enters the metric.
      AND h.new_status <> 'withdrawn'
      AND a.applied_at >= v_launch
      AND h.created_at >= timezone('utc', now()) - interval '90 days'
    ORDER BY h.application_id, h.created_at ASC
  ),
  ranked AS (
    SELECT fr.publisher_id,
           EXTRACT(EPOCH FROM (fr.responded_at - fr.applied_at)) / 3600.0 AS hours,
           row_number() OVER (PARTITION BY fr.publisher_id ORDER BY fr.responded_at DESC) AS rn
    FROM first_response fr
  ),
  agg AS (
    SELECT r.publisher_id,
           count(*)::int AS sample_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.hours) AS median_hours
    FROM ranked r
    WHERE r.rn <= 20
    GROUP BY r.publisher_id
  ),
  upserted AS (
    INSERT INTO publisher_responsiveness (publisher_id, median_hours, sample_count, tier, computed_at)
    SELECT a.publisher_id,
           round(a.median_hours::numeric, 1),
           a.sample_count,
           CASE
             WHEN a.sample_count < 3 THEN NULL
             WHEN a.median_hours <= 72  THEN 'fast'
             WHEN a.median_hours <= 168 THEN 'week'
             WHEN a.median_hours <= 336 THEN 'two_weeks'
             ELSE NULL
           END,
           timezone('utc', now())
    FROM agg a
    ON CONFLICT (publisher_id) DO UPDATE
      SET median_hours = EXCLUDED.median_hours,
          sample_count = EXCLUDED.sample_count,
          tier         = EXCLUDED.tier,
          computed_at  = EXCLUDED.computed_at
    RETURNING publisher_id
  )
  -- Publishers that dropped out of the window lose their row (neutral state).
  DELETE FROM publisher_responsiveness pr
  WHERE pr.publisher_id NOT IN (SELECT a.publisher_id FROM agg a);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 9. Cron: unfreeze daily 05:00 UTC (before all other daily jobs)
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('age_gate_unfreeze_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior age_gate_unfreeze_daily schedule found';
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'age_gate_unfreeze_daily',
    '0 5 * * *',
    $cron$SELECT public.unfreeze_adults();$cron$
  );
END $$;
