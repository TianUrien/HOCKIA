-- Follow-up to 20260420235035_unify_brand_verified_to_profile.
-- get_brand_by_slug was missed in the initial rewrite and still selected
-- br.is_verified, breaking the brand profile page after the column was
-- dropped. Same JOIN pattern as the other brand RPCs; output shape preserved.

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
        br.updated_at
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.slug = p_slug
        AND br.deleted_at IS NULL
    ) b
  );
END;
$$;
