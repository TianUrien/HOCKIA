-- Opportunity application deadlines (founder ruling 11 Oct 2026).
--
-- Found in production: 4 closed roles from one club with application_deadline
-- 0026-10-01 (typo for 2026; start_date 2026-08-01). Nothing validated the year.
--
-- 1. Correct those rows (+2000 years) with user triggers off for that one
--    write, so no notification webhook fires and updated_at is untouched
--    (lesson of the 2026-08-28 profiles incident).
-- 2. A static sanity range on every row: 2020-01-01 … 2100-12-31.
-- 3. Open roles: a new or changed deadline must be between today and two years
--    ahead (one day of slack for time zones behind UTC). Reopening a role whose
--    deadline has passed moves it 30 days ahead, as the app already does, so
--    older app versions can still reopen.

ALTER TABLE public.opportunities DISABLE TRIGGER USER;
UPDATE public.opportunities
   SET application_deadline = (application_deadline + interval '2000 years')::date
 WHERE application_deadline < DATE '0100-01-01';
ALTER TABLE public.opportunities ENABLE TRIGGER USER;

ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_application_deadline_range;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_application_deadline_range
  CHECK (application_deadline IS NULL OR application_deadline BETWEEN DATE '2020-01-01' AND DATE '2100-12-31');

CREATE OR REPLACE FUNCTION public.guard_opportunity_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := timezone('utc', now())::date;
BEGIN
  IF NEW.status::text <> 'open' OR NEW.application_deadline IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reopening with an untouched deadline that has passed: move it 30 days on.
  IF TG_OP = 'UPDATE'
     AND OLD.status::text IS DISTINCT FROM 'open'
     AND NEW.application_deadline IS NOT DISTINCT FROM OLD.application_deadline
     AND NEW.application_deadline < v_today THEN
    NEW.application_deadline := v_today + 30;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.application_deadline IS DISTINCT FROM OLD.application_deadline
     OR OLD.status::text IS DISTINCT FROM 'open' THEN
    IF NEW.application_deadline < v_today - 1
       OR NEW.application_deadline > (v_today + interval '2 years')::date THEN
      RAISE EXCEPTION 'The application deadline must be between today and 2 years from now.'
        USING ERRCODE = 'check_violation', HINT = 'application_deadline';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_opportunity_deadline() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_opportunity_deadline ON public.opportunities;
CREATE TRIGGER trg_guard_opportunity_deadline
  BEFORE INSERT OR UPDATE OF application_deadline, status ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.guard_opportunity_deadline();
