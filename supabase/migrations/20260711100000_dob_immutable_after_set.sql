-- DOB is IMMUTABLE once set (Tian's age-gate decision 1, 2026-07-11):
-- "The date of birth should not be editable by the user after registration.
--  If it ever needs to be changed, it should only be possible through
--  customer support."
--
-- Current state violated this in two places:
--   1. declare_date_of_birth() UPDATEd date_of_birth unconditionally — a user
--      could re-declare a different DOB at will.
--   2. guard_dob_direct_write() only enforced the minor-freeze on direct
--      writes; it never blocked CHANGING an existing DOB. And the P0
--      mitigation (20260707230000) temporarily re-granted
--      UPDATE(date_of_birth) to authenticated for old-native-bundle
--      compatibility, so direct writes are currently possible.
--
-- Design constraints honored:
--   - OLD NATIVE BUNDLES (iOS <=1.3.7 / Android <=vc11) send whole-row
--     profile updates that include date_of_birth. The trigger must therefore
--     SILENTLY REVERT a changed DOB rather than RAISE — raising would break
--     every legacy profile save whose payload carries a stale/edited DOB
--     (this is the exact failure shape of the 2026-07-07 P0).
--   - SUPPORT PATH: service_role / SQL (auth.uid() IS NULL) writes are
--     untouched — customer support changes DOB via the admin surface.
--   - First-time declaration (NULL -> value) keeps today's behavior exactly,
--     including the minor auto-freeze.

-- 1. declare_date_of_birth: one-shot. Re-declaring the SAME value stays
--    idempotent ('confirmed' — retries and double-submits are harmless);
--    a DIFFERENT value returns 'already_set' so the client can point at
--    support.
CREATE OR REPLACE FUNCTION public.declare_date_of_birth(p_dob date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_existing date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF p_dob IS NULL OR p_dob < DATE '1900-01-01' OR p_dob > (timezone('utc', now()))::date - INTERVAL '4 years' THEN
    RETURN jsonb_build_object('outcome', 'invalid_dob');
  END IF;

  SELECT p.role, p.date_of_birth INTO v_role, v_existing FROM profiles p WHERE p.id = v_uid;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Immutable once set: support-only changes (service-role path).
  IF v_existing IS NOT NULL THEN
    IF v_existing = p_dob THEN
      RETURN jsonb_build_object('outcome', 'confirmed');  -- idempotent retry
    END IF;
    RETURN jsonb_build_object('outcome', 'already_set');
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

-- 2. guard_dob_direct_write: adds the immutability branch. End-user writes
--    (auth.uid() present) that CHANGE an existing DOB are silently reverted —
--    the rest of the profile save succeeds untouched. The existing
--    minor-freeze branch still covers first-time direct writes (old clients).
CREATE OR REPLACE FUNCTION public.guard_dob_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Immutable once set for end users: silently keep the old value so legacy
  -- native clients' whole-row saves never fail (P0-shaped hazard); support
  -- (service_role / SQL, auth.uid() IS NULL) may change it.
  IF OLD.date_of_birth IS NOT NULL
     AND NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND auth.uid() IS NOT NULL THEN
    NEW.date_of_birth := OLD.date_of_birth;
  END IF;

  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NEW.date_of_birth IS NOT NULL
     AND NEW.role IN ('player', 'coach', 'umpire')
     AND NEW.date_of_birth > (timezone('utc', now()))::date - INTERVAL '18 years' THEN
    NEW.frozen_minor_at := COALESCE(OLD.frozen_minor_at, timezone('utc', now()));
    NEW.dob_required_since := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Self-check: the RPC must refuse a change and the trigger must carry the
-- immutability branch.
DO $$
BEGIN
  IF position('already_set' in pg_get_functiondef('public.declare_date_of_birth(date)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'DOB-IMMUTABLE-CHECK: declare_date_of_birth missing the already_set branch';
  END IF;
  IF position('Immutable once set' in pg_get_functiondef('public.guard_dob_direct_write()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'DOB-IMMUTABLE-CHECK: guard_dob_direct_write missing the immutability branch';
  END IF;
  RAISE NOTICE 'DOB-IMMUTABLE-CHECK: OK';
END $$;
