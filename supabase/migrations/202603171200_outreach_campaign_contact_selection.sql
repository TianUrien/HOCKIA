-- =============================================================================
-- Outreach Campaign: Contact Selection + Club Filter
-- =============================================================================
-- Adds support for:
--   1. Selecting specific contacts by ID (contact_ids in audience_filter)
--   2. Filtering by club name
-- Updates: admin_preview_outreach_audience RPC
-- =============================================================================

-- =============================================================================
-- 1. Update admin_preview_outreach_audience to support club + contact_ids
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_preview_outreach_audience(
  p_audience_filter JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country TEXT;
  v_status TEXT;
  v_club TEXT;
  v_contact_ids UUID[];
  v_count BIGINT;
  v_sample JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_country := p_audience_filter->>'country';
  v_status := p_audience_filter->>'status';
  v_club := p_audience_filter->>'club';

  -- Extract contact_ids array if present
  IF p_audience_filter ? 'contact_ids' AND jsonb_typeof(p_audience_filter->'contact_ids') = 'array' THEN
    SELECT array_agg(elem::text::uuid)
    INTO v_contact_ids
    FROM jsonb_array_elements_text(p_audience_filter->'contact_ids') AS elem;
  END IF;

  -- Count eligible contacts
  SELECT COUNT(*) INTO v_count
  FROM public.outreach_contacts
  WHERE status NOT IN ('bounced', 'unsubscribed', 'signed_up')
    AND (v_contact_ids IS NULL OR id = ANY(v_contact_ids))
    AND (v_country IS NULL OR country ILIKE '%' || v_country || '%')
    AND (v_status IS NULL OR status = v_status)
    AND (v_club IS NULL OR club_name ILIKE '%' || v_club || '%');

  -- Sample 10
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO v_sample
  FROM (
    SELECT jsonb_build_object(
      'contact_name', contact_name,
      'email', email,
      'club_name', club_name,
      'country', country,
      'status', status
    ) AS row_data
    FROM public.outreach_contacts
    WHERE status NOT IN ('bounced', 'unsubscribed', 'signed_up')
      AND (v_contact_ids IS NULL OR id = ANY(v_contact_ids))
      AND (v_country IS NULL OR country ILIKE '%' || v_country || '%')
      AND (v_status IS NULL OR status = v_status)
      AND (v_club IS NULL OR club_name ILIKE '%' || v_club || '%')
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'count', v_count,
    'sample', v_sample
  );
END;
$$;
