-- Rollback for 20261012130000_brand_list_profile_id.sql: rows without profile_id.
CREATE OR REPLACE FUNCTION public.get_brands(p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_open_to_partners boolean DEFAULT NULL::boolean)
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
