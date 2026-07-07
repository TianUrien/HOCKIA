-- ⚠️ TEMPORARY (paired with 20260707230000) — safety net for the mitigation
-- window. The P0 regrant restored direct UPDATE(date_of_birth) for old
-- native clients, which reopened the write-path bypass closed on 07-05: a
-- clock-running unknown-age minor could write an adult DOB directly and
-- never freeze. These triggers route EVERY direct DOB write through the
-- same under-18 logic as declare_date_of_birth. Old clients keep working;
-- a minor writing their real DOB gets correctly frozen (desired behavior).
--
-- Two-trigger decomposition (a BEFORE trigger may not UPDATE its own row
-- via a nested statement — error 27000): BEFORE mutates only NEW (sets the
-- freeze flag atomically with the write); AFTER performs the side-effects
-- (withdrawals, feed cleanup, goodbye enqueue → ban lands via the drain).
-- freeze_minor_account's own profiles UPDATE no-ops there via COALESCE and
-- targets a column outside the OF list — no recursion.
--
-- DROP CONDITION (1.3.8/vc12 re-revoke checklist): re-run BOTH revokes
-- (SELECT and UPDATE on date_of_birth) AND drop both triggers + functions,
-- then re-run the original adversarial probes.
CREATE OR REPLACE FUNCTION public.guard_dob_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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

CREATE OR REPLACE FUNCTION public.guard_dob_direct_write_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND NEW.date_of_birth IS NOT NULL
     AND NEW.role IN ('player', 'coach', 'umpire')
     AND NEW.date_of_birth > (timezone('utc', now()))::date - INTERVAL '18 years' THEN
    PERFORM public.freeze_minor_account(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_guard_dob_direct_write ON public.profiles;
CREATE TRIGGER trigger_guard_dob_direct_write
  BEFORE UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_dob_direct_write();

DROP TRIGGER IF EXISTS trigger_guard_dob_direct_write_effects ON public.profiles;
CREATE TRIGGER trigger_guard_dob_direct_write_effects
  AFTER UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_dob_direct_write_effects();
