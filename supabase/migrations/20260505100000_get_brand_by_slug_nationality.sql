-- =========================================================================
-- get_brand_by_slug — expose owner's nationality for the public Snapshot
-- =========================================================================
-- The Profile Snapshot's brand-side surface needs the brand owner's
-- country to render the public Country signal. The previous RPC returned
-- only brand fields, so BrandProfilePage built a synthetic profile with
-- no nationality and the Country ✓ silently never appeared.
--
-- Adding nationality_country_id + nationality from the same profiles
-- LEFT JOIN that already supplies is_verified. Output shape extended
-- (additive only) so existing callers keep working.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_brand_by_slug(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        -- Owner nationality — drives the brand-side Country signal in the
        -- public Profile Snapshot. Both fields needed because the snapshot's
        -- hasNationality check accepts either.
        p.nationality_country_id,
        p.nationality
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.slug = p_slug
        AND br.deleted_at IS NULL
    ) b
  );
END;
$$;
