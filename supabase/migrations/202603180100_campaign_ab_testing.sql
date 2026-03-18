-- ============================================================================
-- Campaign A/B Testing
-- ============================================================================
-- Adds A/B testing capability to email campaigns.
--
-- Changes:
--   1. Add `variant` column to email_sends (tracks which variant each send belongs to)
--   2. Add `ab_variants` JSONB column to email_campaigns (stores variant config)
--   3. New RPC: admin_get_campaign_variant_metrics (per-variant metric breakdown)
--   4. Update create/update/duplicate/list/detail RPCs to include ab_variants
-- ============================================================================

-- ============================================================================
-- 1. Add variant column to email_sends
-- ============================================================================

ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS variant TEXT CHECK (variant IS NULL OR variant IN ('A', 'B'));

CREATE INDEX IF NOT EXISTS idx_email_sends_variant
  ON public.email_sends(campaign_id, variant) WHERE variant IS NOT NULL;

-- ============================================================================
-- 2. Add ab_variants JSONB column to email_campaigns
-- ============================================================================

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS ab_variants JSONB DEFAULT NULL;

COMMENT ON COLUMN public.email_campaigns.ab_variants IS
  'A/B test config: {"A": {"subject": "..."}, "B": {"subject": "..."}}. NULL = not an A/B test.';

-- ============================================================================
-- 3. New RPC: per-variant metric breakdown
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_campaign_variant_metrics(
  p_campaign_id UUID
)
RETURNS TABLE (
  variant TEXT,
  total BIGINT,
  delivered BIGINT,
  opened BIGINT,
  clicked BIGINT,
  bounced BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() != 'service_role' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    s.variant,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE s.status IN ('delivered','opened','clicked'))::BIGINT AS delivered,
    COUNT(*) FILTER (WHERE s.status IN ('opened','clicked'))::BIGINT AS opened,
    COUNT(*) FILTER (WHERE s.status = 'clicked')::BIGINT AS clicked,
    COUNT(*) FILTER (WHERE s.status = 'bounced')::BIGINT AS bounced
  FROM public.email_sends s
  WHERE s.campaign_id = p_campaign_id
    AND s.variant IS NOT NULL
  GROUP BY s.variant
  ORDER BY s.variant;
END;
$$;

-- ============================================================================
-- 4. Update admin_create_email_campaign to accept ab_variants
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_email_campaign(
  p_name TEXT,
  p_template_id UUID,
  p_category TEXT DEFAULT 'notification',
  p_audience_filter JSONB DEFAULT '{}'::jsonb,
  p_audience_source TEXT DEFAULT 'users',
  p_ab_variants JSONB DEFAULT NULL
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
  v_total_recipients INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT template_key INTO v_template_key
  FROM public.email_templates
  WHERE id = p_template_id;

  IF v_template_key IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  IF COALESCE(p_audience_source, 'users') = 'users' THEN
    IF p_audience_filter ? 'roles' AND jsonb_typeof(p_audience_filter->'roles') = 'array'
      AND jsonb_array_length(p_audience_filter->'roles') > 0 THEN
      SELECT string_agg(role_name, ',')
      INTO v_target_role
      FROM jsonb_array_elements_text(p_audience_filter->'roles') AS role_name;
    ELSE
      v_target_role := NULLIF(p_audience_filter->>'role', '');
    END IF;
  END IF;

  v_total_recipients := public.admin_count_campaign_recipients(p_audience_source, p_audience_filter);

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
    total_recipients,
    ab_variants,
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
    NULLIF(p_audience_filter->>'country', ''),
    v_total_recipients,
    p_ab_variants,
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
    'total_recipients', v_campaign.total_recipients,
    'ab_variants', v_campaign.ab_variants,
    'created_at', v_campaign.created_at,
    'updated_at', v_campaign.updated_at
  );
END;
$$;

-- ============================================================================
-- 5. Update admin_update_email_campaign to accept ab_variants
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
      ab_variants = COALESCE(p_ab_variants, ab_variants),
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

-- ============================================================================
-- 6. Update admin_duplicate_email_campaign to copy ab_variants
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
  v_total_recipients INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  v_total_recipients := public.admin_count_campaign_recipients(v_campaign.audience_source, v_campaign.audience_filter);

  INSERT INTO public.email_campaigns (
    template_id,
    template_key,
    name,
    category,
    status,
    audience_filter,
    target_role,
    target_country,
    total_recipients,
    audience_source,
    ab_variants,
    created_by
  ) VALUES (
    v_campaign.template_id,
    v_campaign.template_key,
    v_campaign.name || ' (Copy)',
    v_campaign.category,
    'draft',
    v_campaign.audience_filter,
    v_campaign.target_role,
    v_campaign.target_country,
    v_total_recipients,
    v_campaign.audience_source,
    v_campaign.ab_variants,
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

-- ============================================================================
-- 7. Update admin_get_email_campaigns to include ab_variants
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_email_campaigns(
  p_status TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
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
    'id', c.id,
    'template_id', c.template_id,
    'template_key', c.template_key,
    'template_name', t.name,
    'name', c.name,
    'category', c.category,
    'status', c.status,
    'audience_filter', c.audience_filter,
    'audience_source', c.audience_source,
    'target_role', c.target_role,
    'target_country', c.target_country,
    'scheduled_at', c.scheduled_at,
    'sent_at', c.sent_at,
    'total_recipients',
      CASE
        WHEN c.status = 'draft' THEN public.admin_count_campaign_recipients(c.audience_source, c.audience_filter)
        ELSE c.total_recipients
      END,
    'created_by', c.created_by,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'ab_variants', c.ab_variants,
    'total_sent', COALESCE(m.total, 0),
    'total_delivered', COALESCE(m.delivered, 0),
    'total_opened', COALESCE(m.opened, 0),
    'total_clicked', COALESCE(m.clicked, 0),
    'total_count', COUNT(*) OVER()
  )
  FROM public.email_campaigns c
  LEFT JOIN public.email_templates t ON t.id = c.template_id
  LEFT JOIN LATERAL public.admin_get_campaign_email_metrics(c.id) AS m ON TRUE
  WHERE (p_status IS NULL OR c.status = p_status)
    AND (p_category IS NULL OR c.category = p_category)
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ============================================================================
-- 8. Update admin_get_campaign_detail to include ab_variants + variant_metrics
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_campaign_detail(
  p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_variant_metrics JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'campaign', jsonb_build_object(
      'id', c.id,
      'template_id', c.template_id,
      'template_key', c.template_key,
      'template_name', t.name,
      'name', c.name,
      'category', c.category,
      'status', c.status,
      'audience_filter', c.audience_filter,
      'audience_source', c.audience_source,
      'target_role', c.target_role,
      'target_country', c.target_country,
      'scheduled_at', c.scheduled_at,
      'sent_at', c.sent_at,
      'total_recipients', c.total_recipients,
      'ab_variants', c.ab_variants,
      'created_by', c.created_by,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ),
    'stats', jsonb_build_object(
      'total', COALESCE(m.total, 0),
      'delivered', COALESCE(m.delivered, 0),
      'opened', COALESCE(m.opened, 0),
      'clicked', COALESCE(m.clicked, 0),
      'bounced', COALESCE(m.bounced, 0)
    )
  ) INTO v_result
  FROM public.email_campaigns c
  LEFT JOIN public.email_templates t ON t.id = c.template_id
  LEFT JOIN LATERAL public.admin_get_campaign_email_metrics(c.id) AS m ON TRUE
  WHERE c.id = p_campaign_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  -- Add variant metrics for A/B campaigns
  IF (v_result->'campaign'->'ab_variants') IS NOT NULL
     AND (v_result->'campaign'->'ab_variants')::TEXT != 'null' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'variant', vm.variant,
      'total', vm.total,
      'delivered', vm.delivered,
      'opened', vm.opened,
      'clicked', vm.clicked,
      'bounced', vm.bounced
    )), '[]'::jsonb)
    INTO v_variant_metrics
    FROM public.admin_get_campaign_variant_metrics(p_campaign_id) vm;

    v_result := v_result || jsonb_build_object('variant_metrics', v_variant_metrics);
  END IF;

  RETURN v_result;
END;
$$;
