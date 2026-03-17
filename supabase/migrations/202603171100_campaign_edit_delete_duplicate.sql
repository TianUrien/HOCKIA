-- ============================================================================
-- Campaign Management: Edit, Delete, Duplicate
-- ============================================================================

-- ============================================================================
-- 1. Update campaign (draft only)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_email_campaign(
  p_campaign_id UUID,
  p_name TEXT DEFAULT NULL,
  p_template_id UUID DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_audience_filter JSONB DEFAULT NULL,
  p_audience_source TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign email_campaigns%ROWTYPE;
  v_template_key TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_campaign FROM email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  IF v_campaign.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft campaigns can be edited';
  END IF;

  -- Look up template_key if template_id is changing
  IF p_template_id IS NOT NULL AND p_template_id != v_campaign.template_id THEN
    SELECT template_key INTO v_template_key
    FROM email_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found';
    END IF;
  END IF;

  UPDATE email_campaigns SET
    name = COALESCE(p_name, name),
    template_id = COALESCE(p_template_id, template_id),
    template_key = COALESCE(v_template_key, template_key),
    category = COALESCE(p_category, category),
    audience_filter = COALESCE(p_audience_filter, audience_filter),
    audience_source = COALESCE(p_audience_source, audience_source),
    updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object('success', true, 'campaign_id', p_campaign_id);
END;
$$;

-- ============================================================================
-- 2. Delete campaign
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_email_campaign(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign email_campaigns%ROWTYPE;
  v_deleted_sends INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_campaign FROM email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  -- Delete associated email_events first (FK on send_id)
  DELETE FROM email_events
  WHERE send_id IN (SELECT id FROM email_sends WHERE campaign_id = p_campaign_id);

  -- Delete associated sends
  DELETE FROM email_sends WHERE campaign_id = p_campaign_id;
  GET DIAGNOSTICS v_deleted_sends = ROW_COUNT;

  -- Delete the campaign
  DELETE FROM email_campaigns WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', p_campaign_id,
    'deleted_sends', v_deleted_sends
  );
END;
$$;

-- ============================================================================
-- 3. Duplicate campaign (creates a new draft copy)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_duplicate_email_campaign(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign email_campaigns%ROWTYPE;
  v_new_id UUID;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_campaign FROM email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  INSERT INTO email_campaigns (
    template_id, template_key, name, category, status,
    audience_filter, target_role, target_country,
    total_recipients, audience_source, created_by
  ) VALUES (
    v_campaign.template_id,
    v_campaign.template_key,
    v_campaign.name || ' (Copy)',
    v_campaign.category,
    'draft',
    v_campaign.audience_filter,
    v_campaign.target_role,
    v_campaign.target_country,
    0,
    v_campaign.audience_source,
    auth.uid()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'campaign_id', v_new_id,
    'source_campaign_id', p_campaign_id
  );
END;
$$;
