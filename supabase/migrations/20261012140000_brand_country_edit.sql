-- Brand edit screen (Figma PR22): the brand's country becomes editable.
-- update_brand gains p_country_id (must exist in countries; NULL keeps the
-- current value). Same owner-only rule (auth.uid()) and grants. Signature
-- change drops the old overload; every parameter has a default, so callers
-- that don't send a country keep working. Rollback restores the 8-arg form.

DROP FUNCTION IF EXISTS public.update_brand(text, text, text, text, text, text, text, boolean);

CREATE FUNCTION public.update_brand(p_name text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_logo_url text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_instagram_url text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_cover_url text DEFAULT NULL::text, p_open_to_partners boolean DEFAULT NULL::boolean, p_country_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_brand_id UUID;
  v_cover TEXT := nullif(trim(p_cover_url), '');
BEGIN
  SELECT id INTO v_brand_id
  FROM public.brands
  WHERE profile_id = auth.uid()
    AND deleted_at IS NULL;

  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN (
    'equipment', 'apparel', 'accessories', 'nutrition', 'services',
    'technology', 'coaching', 'recruiting', 'media', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  IF v_cover IS NOT NULL AND v_cover NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'Invalid cover URL';
  END IF;

  IF p_country_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.countries WHERE id = p_country_id) THEN
    RAISE EXCEPTION 'Invalid country';
  END IF;

  UPDATE public.brands
  SET
    name = COALESCE(nullif(trim(p_name), ''), name),
    bio = CASE WHEN p_bio IS NOT NULL THEN nullif(trim(p_bio), '') ELSE bio END,
    logo_url = CASE WHEN p_logo_url IS NOT NULL THEN nullif(trim(p_logo_url), '') ELSE logo_url END,
    website_url = CASE WHEN p_website_url IS NOT NULL THEN nullif(trim(p_website_url), '') ELSE website_url END,
    instagram_url = CASE WHEN p_instagram_url IS NOT NULL THEN nullif(trim(p_instagram_url), '') ELSE instagram_url END,
    category = COALESCE(p_category, category),
    cover_url = CASE WHEN p_cover_url IS NOT NULL THEN v_cover ELSE cover_url END,
    open_to_partners = COALESCE(p_open_to_partners, open_to_partners),
    country_id = COALESCE(p_country_id, country_id)
  WHERE id = v_brand_id;

  RETURN json_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_brand(text, text, text, text, text, text, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_brand(text, text, text, text, text, text, text, boolean, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_brand(text, text, text, text, text, text, text, boolean, integer) TO authenticated, service_role;
