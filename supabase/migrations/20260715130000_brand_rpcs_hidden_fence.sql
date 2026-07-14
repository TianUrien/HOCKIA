-- M11 — fence hidden (banned/frozen) brands out of the public brand surfaces.
--
-- get_brands (Marketplace directory), get_brand_by_slug (/brands/:slug page),
-- and get_brand_feed (global brand feed) are SECURITY DEFINER reads that return
-- a brand and its content, but none applied the hidden-profile predicate on the
-- brand's owning profile. So an admin-banned brand (profiles.is_blocked = true)
-- vanished from Community/search yet kept its Marketplace card, profile page,
-- products and posts live — violating the standing invariant (CLAUDE.md) that
-- every DEFINER read returning people/their content fences hidden rows itself.
--
-- The hidden exclusion is UNCONDITIONAL (not gated by is_staging_env like the
-- test-account filter): a banned/frozen brand must never appear, even on
-- staging. All brand reads in the client go through these three RPCs (no direct
-- .from('brands') select), so these fences cover the full client surface. The
-- anon direct-table RLS policy on public.brands remains a separate
-- defense-in-depth follow-up.
--
-- Each function is the verbatim live body with only the fence added.

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

CREATE OR REPLACE FUNCTION public.get_brands(p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
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
    SELECT br.id, br.slug, br.name, br.logo_url, br.bio, br.category,
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

CREATE OR REPLACE FUNCTION public.get_brand_feed(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_is_test BOOLEAN;
BEGIN
  v_is_test := is_staging_env() OR COALESCE((SELECT is_test_account FROM profiles WHERE id = auth.uid()), false);

  SELECT
    (SELECT count(*) FROM brand_products bp JOIN brands b ON b.id = bp.brand_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = b.profile_id AND p.is_test_account = true))
        AND NOT EXISTS (SELECT 1 FROM profiles ph WHERE ph.id = b.profile_id AND public.profile_is_hidden(ph.is_blocked, ph.frozen_minor_at)))
    + (SELECT count(*) FROM brand_posts bpo JOIN brands b ON b.id = bpo.brand_id
      WHERE bpo.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = b.profile_id AND p.is_test_account = true))
        AND NOT EXISTS (SELECT 1 FROM profiles ph WHERE ph.id = b.profile_id AND public.profile_is_hidden(ph.is_blocked, ph.frozen_minor_at)))
  INTO v_total;

  SELECT COALESCE(jsonb_agg(sub.item), '[]'::jsonb) INTO v_items
  FROM (
    SELECT item FROM (
      SELECT jsonb_build_object(
        'type','product','id',bp.id,'brand_id',bp.brand_id,'brand_name',b.name,'brand_slug',b.slug,
        'brand_logo_url',b.logo_url,'brand_category',b.category,
        'brand_is_verified', COALESCE(owner.is_verified, false),
        'created_at',bp.created_at,'product_name',bp.name,'product_description',bp.description,
        'product_images',bp.images,'product_external_url',bp.external_url
      ) AS item, bp.created_at AS item_date
      FROM brand_products bp JOIN brands b ON b.id = bp.brand_id
      LEFT JOIN profiles owner ON owner.id = b.profile_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = b.profile_id AND pp.is_test_account = true))
        AND NOT EXISTS (SELECT 1 FROM profiles ph WHERE ph.id = b.profile_id AND public.profile_is_hidden(ph.is_blocked, ph.frozen_minor_at))
      UNION ALL
      SELECT jsonb_build_object(
        'type','post','id',bpo.id,'brand_id',bpo.brand_id,'brand_name',b.name,'brand_slug',b.slug,
        'brand_logo_url',b.logo_url,'brand_category',b.category,
        'brand_is_verified', COALESCE(owner.is_verified, false),
        'created_at',bpo.created_at,'post_content',bpo.content,'post_image_url',bpo.image_url
      ) AS item, bpo.created_at AS item_date
      FROM brand_posts bpo JOIN brands b ON b.id = bpo.brand_id
      LEFT JOIN profiles owner ON owner.id = b.profile_id
      WHERE bpo.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = b.profile_id AND pp.is_test_account = true))
        AND NOT EXISTS (SELECT 1 FROM profiles ph WHERE ph.id = b.profile_id AND public.profile_is_hidden(ph.is_blocked, ph.frozen_minor_at))
    ) feed
    ORDER BY item_date DESC LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END;
$function$;
