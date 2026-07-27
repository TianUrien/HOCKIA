-- Live landing-page stats.
--
-- The landing page printed hard-coded numbers (258 members, 43 nationalities,
-- 281 clubs, 11 open roles) captured by hand on 2026-07-25. On a page whose
-- whole argument is "this is a real, active platform", a frozen count quietly
-- becomes false — and the first person to notice will be someone deciding
-- whether to trust us.
--
-- Aggregate counts only. No row is exposed, so this is safe for anon: it is
-- the same information we already print on the page, just true.
--
-- Cheap by construction (4 counts over small tables) and STABLE, so repeated
-- calls in a statement are folded.

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
  SELECT
    (SELECT count(*) FROM profiles
       WHERE COALESCE(is_test_account, false) = false
         AND onboarding_completed = true
         AND NOT public.profile_is_hidden(is_blocked, frozen_minor_at)),
    (SELECT count(DISTINCT TRIM(nationality)) FROM profiles
       WHERE COALESCE(is_test_account, false) = false
         AND nationality IS NOT NULL AND TRIM(nationality) <> ''),
    (SELECT count(*) FROM world_clubs),
    (SELECT count(*) FROM opportunities WHERE status = 'open');
$function$;

-- Public marketing data: anon is the whole point.
GRANT EXECUTE ON FUNCTION public.get_landing_stats() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_landing_stats() IS
  'Aggregate counts for the public landing page. Anon-callable by design — '
  'exposes no rows. Excludes test accounts and hidden profiles.';
