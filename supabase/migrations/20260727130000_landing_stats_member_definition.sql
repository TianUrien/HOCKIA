-- Correct the "members" population in get_landing_stats().
--
-- The first version reused profile_is_hidden() as the fence. That is the right
-- fence for LISTING profiles — you must never expose a hidden profile's row —
-- but this is an aggregate count of registered humans, and no row is exposed.
--
-- On prod it excluded 13 people, all of them frozen minors: real members who
-- registered and completed onboarding, whose profiles are hidden pending age
-- verification. They are members. Hiding a profile for safety is not the same
-- as the person not existing, and undercounting ourselves by 5% is as wrong as
-- overcounting.
--
-- Blocked accounts stay excluded (0 today, but a blocked account is not a
-- member we want to claim). Nationalities now count the same population as
-- members instead of a looser one — two numbers side by side on a marketing
-- page should be drawn from the same set.

CREATE OR REPLACE FUNCTION public.get_landing_stats()
RETURNS TABLE(
  members bigint,
  nationalities bigint,
  clubs_mapped bigint,
  open_roles bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH counted AS (
    SELECT nationality
    FROM profiles
    WHERE COALESCE(is_test_account, false) = false
      AND onboarding_completed = true
      AND COALESCE(is_blocked, false) = false
  )
  SELECT
    (SELECT count(*) FROM counted),
    (SELECT count(DISTINCT TRIM(nationality)) FROM counted
       WHERE nationality IS NOT NULL AND TRIM(nationality) <> ''),
    (SELECT count(*) FROM world_clubs),
    (SELECT count(*) FROM opportunities WHERE status = 'open');
$function$;

GRANT EXECUTE ON FUNCTION public.get_landing_stats() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_landing_stats() IS
  'Aggregate counts for the public landing page. Anon-callable by design — '
  'exposes no rows. Members = onboarded, non-test, non-blocked profiles; '
  'frozen minors are counted (they are members) but their profiles stay hidden.';
