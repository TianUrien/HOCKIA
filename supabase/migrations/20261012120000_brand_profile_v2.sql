-- Profile v2 — brand (Figma PR9 / PR13 / PR22, founder rulings 11 Oct).
--
-- brands.cover_url and brands.open_to_partners exist since
-- 20261012100000_profile_v2_backend, but no RPC returns or writes them. This:
--   * get_brand_by_slug / get_my_brand: + cover_url, open_to_partners;
--   * get_brands: + cover_url, open_to_partners in rows, and an optional
--     p_open_to_partners filter (Community "Looking for ambassadors");
--   * update_brand: + p_cover_url (https only, '' clears) and
--     p_open_to_partners.
-- Signature changes (get_brands, update_brand) drop the old overload so a
-- named-argument call never becomes ambiguous; old callers keep working
-- because every new parameter has a default. Rollback restores the previous
-- bodies and signatures.

-- ── get_brand_by_slug ──────────────────────────────────────────────────────
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
        br.cover_url,
        br.open_to_partners,
        br.bio,
        br.website_url,
        br.instagram_url,
        br.category,
        br.country_id,
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
        -- Hidden-profile fence: a banned/frozen brand owner hides the brand.
        AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    ) b
  );
END;
$function$;

-- ── get_my_brand ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_brand()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT row_to_json(b)
    FROM (
      SELECT br.id, br.profile_id, br.slug, br.name, br.logo_url, br.cover_url, br.open_to_partners, br.bio,
             br.website_url, br.instagram_url, br.category,
             COALESCE(p.is_verified, false) AS is_verified,
             br.created_at, br.updated_at
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.profile_id = auth.uid() AND br.deleted_at IS NULL
    ) b
  );
END;
$function$;

-- ── get_brands (+ p_open_to_partners) ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_brands(text, text, integer, integer);

CREATE FUNCTION public.get_brands(p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_open_to_partners boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT;
  v_brands JSON;
  v_is_test BOOLEAN;
  v_search TEXT;
BEGIN
  v_search := CASE WHEN p_search IS NOT NULL THEN escape_ilike(p_search) ELSE NULL END;
  v_is_test := is_staging_env() OR COALESCE((SELECT is_test_account FROM profiles WHERE id = auth.uid()), false);

  SELECT COUNT(*) INTO v_total
  FROM public.brands br
  WHERE br.deleted_at IS NULL
    AND (p_category IS NULL OR br.category = p_category)
    AND (p_open_to_partners IS NULL OR br.open_to_partners = p_open_to_partners)
    AND (v_search IS NULL OR br.name ILIKE '%' || v_search || '%')
    AND (v_is_test OR NOT EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = br.profile_id AND p.is_test_account = true
    ))
    -- Hidden-profile fence (count parity with the list below).
    AND NOT EXISTS (
      SELECT 1 FROM profiles ph WHERE ph.id = br.profile_id
        AND public.profile_is_hidden(ph.is_blocked, ph.frozen_minor_at)
    );

  SELECT COALESCE(json_agg(row_to_json(b) ORDER BY b.created_at DESC), '[]'::json)
  INTO v_brands
  FROM (
    SELECT br.id, br.slug, br.name, br.logo_url, br.cover_url, br.open_to_partners, br.bio, br.category,
           br.website_url, br.instagram_url,
           COALESCE(p.is_verified, false) AS is_verified,
           br.created_at,
           COALESCE(
             GREATEST(
               (SELECT MAX(created_at) FROM brand_products WHERE brand_id = br.id AND deleted_at IS NULL),
               (SELECT MAX(created_at) FROM brand_posts    WHERE brand_id = br.id AND deleted_at IS NULL)
             ),
             br.created_at
           ) AS last_activity_at
    FROM public.brands br
    LEFT JOIN profiles p ON p.id = br.profile_id
    WHERE br.deleted_at IS NULL
      AND (p_category IS NULL OR br.category = p_category)
      AND (p_open_to_partners IS NULL OR br.open_to_partners = p_open_to_partners)
      AND (v_search IS NULL OR br.name ILIKE '%' || v_search || '%')
      AND (v_is_test OR NOT EXISTS (
        SELECT 1 FROM profiles pp WHERE pp.id = br.profile_id AND pp.is_test_account = true
      ))
      -- Hidden-profile fence (count parity with COUNT above).
      AND NOT EXISTS (
        SELECT 1 FROM profiles ph WHERE ph.id = br.profile_id
          AND public.profile_is_hidden(ph.is_blocked, ph.frozen_minor_at)
      )
    ORDER BY br.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) b;

  RETURN json_build_object('brands', v_brands, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_brands(text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_brands(text, text, integer, integer, boolean) TO anon, authenticated, service_role;

-- ── update_brand (+ cover, + open_to_partners) ─────────────────────────────
DROP FUNCTION IF EXISTS public.update_brand(text, text, text, text, text, text);

CREATE FUNCTION public.update_brand(p_name text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_logo_url text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_instagram_url text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_cover_url text DEFAULT NULL::text, p_open_to_partners boolean DEFAULT NULL::boolean)
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

  UPDATE public.brands
  SET
    name = COALESCE(nullif(trim(p_name), ''), name),
    bio = CASE WHEN p_bio IS NOT NULL THEN nullif(trim(p_bio), '') ELSE bio END,
    logo_url = CASE WHEN p_logo_url IS NOT NULL THEN nullif(trim(p_logo_url), '') ELSE logo_url END,
    website_url = CASE WHEN p_website_url IS NOT NULL THEN nullif(trim(p_website_url), '') ELSE website_url END,
    instagram_url = CASE WHEN p_instagram_url IS NOT NULL THEN nullif(trim(p_instagram_url), '') ELSE instagram_url END,
    category = COALESCE(p_category, category),
    cover_url = CASE WHEN p_cover_url IS NOT NULL THEN v_cover ELSE cover_url END,
    open_to_partners = COALESCE(p_open_to_partners, open_to_partners)
  WHERE id = v_brand_id;

  RETURN json_build_object('success', true);
END;
$function$;

-- Owner-only by auth.uid(); anon has nothing to update.
REVOKE ALL ON FUNCTION public.update_brand(text, text, text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_brand(text, text, text, text, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_brand(text, text, text, text, text, text, text, boolean) TO authenticated, service_role;
