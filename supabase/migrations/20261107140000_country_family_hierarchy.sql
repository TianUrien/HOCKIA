-- country_family_ids (20261107130000) treated the UK and its four nations as one
-- flat family, so an offer for Scotland reached a member in England. Now it is a
-- hierarchy: a nation counts as itself and the United Kingdom; the United
-- Kingdom counts as itself and every nation. An offer for England reaches a
-- member whose country is England or United Kingdom, never Scotland.
-- Codes, not ids: ids differ between staging and production.
-- Rollback: supabase/rollbacks/20261107140000_country_family_hierarchy.down.sql

CREATE OR REPLACE FUNCTION public.country_family_ids(p_country_id integer)
RETURNS integer[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH me AS (SELECT c.id, c.code FROM public.countries c WHERE c.id = p_country_id)
  SELECT coalesce(ARRAY(
    SELECT me.id FROM me
    UNION
    -- a nation (GB-ENG…) also counts as the United Kingdom
    SELECT uk.id FROM me JOIN public.countries uk ON uk.code = 'GB' WHERE me.code LIKE 'GB-%'
    UNION
    -- the United Kingdom also counts as each nation
    SELECT n.id FROM me JOIN public.countries n ON n.code LIKE 'GB-%' WHERE me.code = 'GB'
  ), '{}'::integer[]);
$$;
REVOKE ALL ON FUNCTION public.country_family_ids(integer) FROM PUBLIC, anon, authenticated;
