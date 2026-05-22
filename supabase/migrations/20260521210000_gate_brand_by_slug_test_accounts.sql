-- Gate get_brand_by_slug against test-account brands.
--
-- get_brand_by_slug had no test-account filter, so a brand owned by a
-- test account was reachable by its slug URL (/brands/<slug>) by anyone,
-- including logged-out visitors — even though the brands directory and
-- every other surface correctly hide test accounts.
--
-- Add the same gate the other visibility RPCs use: a test-account brand
-- is returned only when is_staging_env() is true. is_staging_env()
-- excludes anonymous callers and is always false on production, so:
--   * logged-out visitors never see test brands (in either environment);
--   * production never exposes test brands;
--   * logged-in QA on staging still sees them.
-- Everything else is the verbatim current definition.

CREATE OR REPLACE FUNCTION public.get_brand_by_slug(p_slug text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT row_to_json(b)
    FROM (
      SELECT
        br.id,
        br.profile_id,
        br.slug,
        br.name,
        br.logo_url,
        br.bio,
        br.website_url,
        br.instagram_url,
        br.category,
        COALESCE(p.is_verified, false) AS is_verified,
        br.created_at,
        br.updated_at,
        p.nationality_country_id,
        p.nationality
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.slug = p_slug
        AND br.deleted_at IS NULL
        AND (is_staging_env() OR COALESCE(p.is_test_account, false) = false)
    ) b
  );
END;
$function$;
