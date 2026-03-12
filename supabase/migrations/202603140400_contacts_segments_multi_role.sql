-- ============================================================================
-- Contact Segmentation + Multi-Role Campaign Targeting
-- ============================================================================
-- 1. admin_get_email_contacts_summary — per-role counts of email-eligible users
-- 2. admin_get_email_contacts — paginated contact list with filters
-- 3. Update admin_preview_campaign_audience — support roles[] array
-- 4. Update admin_create_email_campaign — store multi-role target
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- A. admin_get_email_contacts_summary
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_email_contacts_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'player', COUNT(*) FILTER (WHERE p.role = 'player'),
      'coach', COUNT(*) FILTER (WHERE p.role = 'coach'),
      'club', COUNT(*) FILTER (WHERE p.role = 'club'),
      'brand', COUNT(*) FILTER (WHERE p.role = 'brand')
    )
    FROM public.profiles p
    WHERE p.email IS NOT NULL
      AND p.email <> ''
      AND p.is_blocked = false
      AND COALESCE(p.is_test_account, false) = false
  );
END;
$$;

-- ============================================================================
-- B. admin_get_email_contacts — paginated contact list
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_email_contacts(
  p_role TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'full_name', p.full_name,
    'username', p.username,
    'role', p.role,
    'avatar_url', p.avatar_url,
    'base_location', p.base_location,
    'country_name', c.name,
    'country_code', c.code,
    'onboarding_completed', p.onboarding_completed,
    'created_at', p.created_at,
    'total_count', COUNT(*) OVER()
  )
  FROM public.profiles p
  LEFT JOIN public.countries c ON c.id = p.nationality_country_id
  WHERE p.email IS NOT NULL
    AND p.email <> ''
    AND p.is_blocked = false
    AND COALESCE(p.is_test_account, false) = false
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_country IS NULL OR c.code = p_country)
    AND (p_search IS NULL OR p_search = '' OR
         p.full_name ILIKE '%' || p_search || '%' OR
         p.email ILIKE '%' || p_search || '%' OR
         p.username ILIKE '%' || p_search || '%')
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ============================================================================
-- C. Update admin_preview_campaign_audience — support roles[] array
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_preview_campaign_audience(
  p_category TEXT DEFAULT 'notification',
  p_audience_filter JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles TEXT[];
  v_country TEXT;
  v_count BIGINT;
  v_sample JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Support both "roles" array and legacy "role" string
  IF p_audience_filter ? 'roles' AND jsonb_array_length(p_audience_filter->'roles') > 0 THEN
    SELECT array_agg(r::text) INTO v_roles
    FROM jsonb_array_elements_text(p_audience_filter->'roles') r;
  ELSIF p_audience_filter->>'role' IS NOT NULL AND p_audience_filter->>'role' <> '' THEN
    v_roles := ARRAY[p_audience_filter->>'role'];
  END IF;

  v_country := p_audience_filter->>'country';

  -- Count matching recipients
  SELECT COUNT(*) INTO v_count
  FROM public.profiles p
  LEFT JOIN public.countries c ON c.id = p.nationality_country_id
  WHERE p.email IS NOT NULL
    AND p.email <> ''
    AND p.is_blocked = false
    AND COALESCE(p.is_test_account, false) = false
    AND (v_roles IS NULL OR p.role = ANY(v_roles))
    AND (v_country IS NULL OR c.code = v_country);

  -- Get sample of 10
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO v_sample
  FROM (
    SELECT jsonb_build_object(
      'full_name', p.full_name,
      'email', p.email,
      'role', p.role,
      'country_name', c.name
    ) AS row_data
    FROM public.profiles p
    LEFT JOIN public.countries c ON c.id = p.nationality_country_id
    WHERE p.email IS NOT NULL
      AND p.email <> ''
      AND p.is_blocked = false
      AND COALESCE(p.is_test_account, false) = false
      AND (v_roles IS NULL OR p.role = ANY(v_roles))
      AND (v_country IS NULL OR c.code = v_country)
    ORDER BY p.created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'count', v_count,
    'sample', v_sample
  );
END;
$$;

-- ============================================================================
-- D. Update admin_create_email_campaign — store multi-role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_email_campaign(
  p_name TEXT,
  p_template_id UUID,
  p_category TEXT DEFAULT 'notification',
  p_audience_filter JSONB DEFAULT '{}'::jsonb,
  p_audience_source TEXT DEFAULT 'users'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_template_key TEXT;
  v_target_role TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Look up template_key from template_id
  SELECT template_key INTO v_template_key
  FROM public.email_templates
  WHERE id = p_template_id;

  IF v_template_key IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- Build target_role: comma-separated from roles[] or single role
  IF p_audience_filter ? 'roles' AND jsonb_array_length(p_audience_filter->'roles') > 0 THEN
    SELECT string_agg(r::text, ',') INTO v_target_role
    FROM jsonb_array_elements_text(p_audience_filter->'roles') r;
  ELSE
    v_target_role := p_audience_filter->>'role';
  END IF;

  INSERT INTO public.email_campaigns (
    template_id,
    template_key,
    name,
    category,
    status,
    audience_filter,
    audience_source,
    target_role,
    target_country,
    created_by
  ) VALUES (
    p_template_id,
    v_template_key,
    p_name,
    p_category,
    'draft',
    p_audience_filter,
    p_audience_source,
    v_target_role,
    p_audience_filter->>'country',
    auth.uid()
  )
  RETURNING * INTO v_campaign;

  RETURN jsonb_build_object(
    'id', v_campaign.id,
    'template_id', v_campaign.template_id,
    'template_key', v_campaign.template_key,
    'name', v_campaign.name,
    'category', v_campaign.category,
    'status', v_campaign.status,
    'audience_filter', v_campaign.audience_filter,
    'audience_source', v_campaign.audience_source,
    'target_role', v_campaign.target_role,
    'target_country', v_campaign.target_country,
    'created_at', v_campaign.created_at
  );
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
