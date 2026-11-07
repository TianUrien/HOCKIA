-- Rollback for 20261107140000_country_family_hierarchy.sql: back to the flat
-- UK family from 20261107130000_brand_offer_reach.sql.

CREATE OR REPLACE FUNCTION public.country_family_ids(p_country_id integer)
RETURNS integer[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_country_id IS NULL THEN '{}'::integer[]
    WHEN (SELECT c.code FROM public.countries c WHERE c.id = p_country_id) LIKE 'GB%'
      THEN ARRAY(SELECT c.id FROM public.countries c WHERE c.code LIKE 'GB%')
    ELSE ARRAY[p_country_id]
  END;
$$;
REVOKE ALL ON FUNCTION public.country_family_ids(integer) FROM PUBLIC, anon, authenticated;
