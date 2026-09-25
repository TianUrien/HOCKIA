-- Phase 1 · step 6 — Club v2 bugs (backend half).
--
-- 1. Player roles can't target a youth team.
--    Founder ruling 2026-09-25 (C): Boys/Girls are removed from PLAYER roles
--    (under-18s are never recruitable); the enum values stay for staff/coach
--    roles. Figma D1.6 dev note: "the server rejects a player role with a
--    youth gender". The client no longer offers them (Post a role v2 and the
--    desktop CreateOpportunityModal); this is the server-side guard.
--
--    CHECK constraint, not a trigger: the rule is a pure function of the row,
--    so a declarative constraint is enforced for every writer (client, RPCs,
--    service role, admin tools), can't be skipped by trigger ordering or a
--    session_replication_role change, costs nothing per row, and is visible
--    in the catalog. It holds for EVERY writer on purpose (unlike the step-2
--    client-write guards): no path should create a youth player role.
--    Pre-check 2026-09-26: 0 rows with gender IN ('Boys','Girls') on prod and
--    on staging (any opportunity_type). NOT VALID + VALIDATE keeps the
--    ACCESS EXCLUSIVE lock to the catalog change; the scan runs under
--    SHARE UPDATE EXCLUSIVE. If a violating row appears before this reaches
--    prod, VALIDATE fails and the whole migration rolls back (nothing half-applied).
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_player_role_not_youth
  CHECK (opportunity_type IS DISTINCT FROM 'player'::public.opportunity_type
         OR gender IS NULL
         OR gender NOT IN ('Boys'::public.opportunity_gender, 'Girls'::public.opportunity_gender))
  NOT VALID;

ALTER TABLE public.opportunities VALIDATE CONSTRAINT opportunities_player_role_not_youth;

COMMENT ON CONSTRAINT opportunities_player_role_not_youth ON public.opportunities IS
  'Founder ruling 2026-09-25: player roles never target Boys/Girls (under-18s are never recruitable). Boys/Girls remain valid for coach/staff roles.';

-- 2. search_world_clubs gets an optional country filter.
--    Link your club (Club v2 D1.11) filtered a GLOBAL top-40 by country on the
--    client, so a club outside the global top 40 for that name was reported
--    missing and the club created a duplicate. The filter now runs in SQL.
--
--    Signature change is safe as a DROP + CREATE with a defaulted trailing
--    parameter: every caller (web WorldClubSearch, WorldSearchDropdown,
--    ClubLinkPrompt, LinkClubScreen, and the August native bundle) uses named
--    args {p_query[, p_limit]}, which PostgREST resolves to this single
--    function. Keeping the old 2-arg function alongside would make those calls
--    ambiguous (PGRST203), so it is replaced, not overloaded. No SQL function
--    or edge function calls it (checked pg_proc.prosrc and supabase/functions).
--    Body is otherwise identical to the live one (md5 f2bcce3c… on both projects).
DROP FUNCTION IF EXISTS public.search_world_clubs(text, integer);

CREATE FUNCTION public.search_world_clubs(
  p_query text,
  p_limit integer DEFAULT 15,
  p_country_id integer DEFAULT NULL
)
RETURNS TABLE(
  id uuid, club_name text, club_name_normalized text, avatar_url text,
  country_id integer, country_name text, country_code text, flag_emoji text,
  province_id integer, province_name text, province_slug text,
  men_league_id integer, women_league_id integer,
  men_league_name text, women_league_name text,
  men_league_tier integer, women_league_tier integer,
  is_claimed boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_normalized TEXT;
BEGIN
  v_normalized := lower(trim(p_query));

  -- Require at least 2 characters
  IF length(v_normalized) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    wc.id,
    wc.club_name,
    wc.club_name_normalized,
    wc.avatar_url,
    wc.country_id,
    c.name AS country_name,
    c.code::TEXT AS country_code,
    c.flag_emoji,
    wc.province_id,
    wp.name AS province_name,
    wp.slug AS province_slug,
    wc.men_league_id,
    wc.women_league_id,
    ml.name AS men_league_name,
    wl.name AS women_league_name,
    ml.tier AS men_league_tier,
    wl.tier AS women_league_tier,
    wc.is_claimed
  FROM world_clubs wc
  JOIN countries c ON c.id = wc.country_id
  LEFT JOIN world_provinces wp ON wp.id = wc.province_id
  LEFT JOIN world_leagues ml ON ml.id = wc.men_league_id
  LEFT JOIN world_leagues wl ON wl.id = wc.women_league_id
  WHERE (p_country_id IS NULL OR wc.country_id = p_country_id)
    AND (wc.club_name_normalized LIKE v_normalized || '%'
         OR wc.club_name_normalized LIKE '%' || v_normalized || '%')
  ORDER BY
    -- Prefix matches come first
    CASE WHEN wc.club_name_normalized LIKE v_normalized || '%' THEN 0 ELSE 1 END,
    wc.club_name ASC
  LIMIT p_limit;
END;
$function$;

-- Same effective access as before (anon + authenticated + service_role; the
-- directory is public — world_clubs has a USING (true) SELECT policy), but
-- explicit instead of inherited from PUBLIC (Oct 30 default-ACL change).
REVOKE ALL ON FUNCTION public.search_world_clubs(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_world_clubs(text, integer, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
