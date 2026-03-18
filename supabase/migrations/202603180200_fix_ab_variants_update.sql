-- ============================================================================
-- Fix: Allow clearing ab_variants back to NULL when editing a campaign
-- ============================================================================
-- The original COALESCE(p_ab_variants, ab_variants) prevented NULL from
-- overwriting existing values. Changed to direct assignment so toggling
-- A/B off properly clears the variants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_email_campaign(
  p_campaign_id UUID,
  p_name TEXT DEFAULT NULL,
  p_template_id UUID DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_audience_filter JSONB DEFAULT NULL,
  p_audience_source TEXT DEFAULT NULL,
  p_ab_variants JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign email_campaigns%ROWTYPE;
  v_template_key TEXT;
  v_effective_audience_filter JSONB;
  v_effective_audience_source TEXT;
  v_target_role TEXT;
  v_total_recipients INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  IF v_campaign.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft campaigns can be edited';
  END IF;

  IF p_template_id IS NOT NULL AND p_template_id != v_campaign.template_id THEN
    SELECT template_key INTO v_template_key
    FROM public.email_templates
    WHERE id = p_template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found';
    END IF;
  END IF;

  v_effective_audience_filter := COALESCE(p_audience_filter, v_campaign.audience_filter, '{}'::jsonb);
  v_effective_audience_source := COALESCE(NULLIF(p_audience_source, ''), v_campaign.audience_source, 'users');

  IF v_effective_audience_source = 'users' THEN
    IF v_effective_audience_filter ? 'roles' AND jsonb_typeof(v_effective_audience_filter->'roles') = 'array'
      AND jsonb_array_length(v_effective_audience_filter->'roles') > 0 THEN
      SELECT string_agg(role_name, ',')
      INTO v_target_role
      FROM jsonb_array_elements_text(v_effective_audience_filter->'roles') AS role_name;
    ELSE
      v_target_role := NULLIF(v_effective_audience_filter->>'role', '');
    END IF;
  END IF;

  v_total_recipients := public.admin_count_campaign_recipients(v_effective_audience_source, v_effective_audience_filter);

  UPDATE public.email_campaigns
  SET name = COALESCE(p_name, name),
      template_id = COALESCE(p_template_id, template_id),
      template_key = COALESCE(v_template_key, template_key),
      category = COALESCE(p_category, category),
      audience_filter = v_effective_audience_filter,
      audience_source = v_effective_audience_source,
      target_role = v_target_role,
      target_country = NULLIF(v_effective_audience_filter->>'country', ''),
      total_recipients = v_total_recipients,
      ab_variants = p_ab_variants,
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'total_recipients', v_total_recipients,
    'audience_source', v_effective_audience_source
  );
END;
$$;
