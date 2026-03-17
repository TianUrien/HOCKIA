-- ============================================================================
-- Fix campaign audience source + recipient counts
-- ============================================================================
-- Problem:
--   1. admin_get_email_campaigns did not return audience_source, so outreach
--      campaigns were loaded back into the admin UI as user campaigns.
--   2. total_recipients stayed at 0 for drafts because create/update flows never
--      recalculated it.
--   3. admin_update_campaign_status overloaded total_recipients with sent_count,
--      which mixes intended audience size with successful sends.
--
-- This migration:
--   - adds a shared recipient-count helper
--   - stores draft recipient counts on create/update/duplicate
--   - returns audience_source from campaign list/detail RPCs
--   - computes live draft counts in admin_get_email_campaigns
--   - updates campaign status without clobbering recipient totals
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_count_campaign_recipients(
  p_audience_source TEXT DEFAULT 'users',
  p_audience_filter JSONB DEFAULT '{}'::jsonb
)
RETURNS INT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_source TEXT := COALESCE(NULLIF(p_audience_source, ''), 'users');
  v_roles TEXT[];
  v_country TEXT;
  v_status TEXT;
  v_club TEXT;
  v_contact_ids UUID[];
  v_has_contact_ids BOOLEAN := false;
  v_count BIGINT := 0;
BEGIN
  IF v_source = 'outreach' THEN
    v_country := NULLIF(p_audience_filter->>'country', '');
    v_status := NULLIF(p_audience_filter->>'status', '');
    v_club := NULLIF(p_audience_filter->>'club', '');
    v_has_contact_ids := p_audience_filter ? 'contact_ids'
      AND jsonb_typeof(p_audience_filter->'contact_ids') = 'array';

    IF v_has_contact_ids THEN
      SELECT array_agg(elem::text::uuid)
      INTO v_contact_ids
      FROM jsonb_array_elements_text(p_audience_filter->'contact_ids') AS elem;

      IF COALESCE(array_length(v_contact_ids, 1), 0) = 0 THEN
        RETURN 0;
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.outreach_contacts oc
    WHERE oc.status NOT IN ('bounced', 'unsubscribed', 'signed_up')
      AND (NOT v_has_contact_ids OR oc.id = ANY(v_contact_ids))
      AND (v_country IS NULL OR oc.country ILIKE '%' || v_country || '%')
      AND (v_status IS NULL OR oc.status = v_status)
      AND (v_club IS NULL OR oc.club_name ILIKE '%' || v_club || '%');

    RETURN COALESCE(v_count, 0)::INT;
  END IF;

  v_country := NULLIF(p_audience_filter->>'country', '');

  IF p_audience_filter ? 'roles' AND jsonb_typeof(p_audience_filter->'roles') = 'array' THEN
    SELECT array_agg(role_name)
    INTO v_roles
    FROM jsonb_array_elements_text(p_audience_filter->'roles') AS role_name;

    IF COALESCE(array_length(v_roles, 1), 0) = 0 THEN
      v_roles := NULL;
    END IF;
  ELSIF NULLIF(p_audience_filter->>'role', '') IS NOT NULL THEN
    v_roles := ARRAY[p_audience_filter->>'role'];
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.profiles p
  LEFT JOIN public.countries c ON c.id = p.nationality_country_id
  WHERE p.email IS NOT NULL
    AND p.email <> ''
    AND p.is_blocked = false
    AND COALESCE(p.is_test_account, false) = false
    AND (v_roles IS NULL OR p.role = ANY(v_roles))
    AND (v_country IS NULL OR c.code = v_country);

  RETURN COALESCE(v_count, 0)::INT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_count_campaign_recipients(TEXT, JSONB) FROM PUBLIC;


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
    'created_at', v_campaign.created_at,
    'updated_at', v_campaign.updated_at
  );
END;
$$;


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
      'created_by', c.created_by,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ),
    'stats', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id),
      'delivered', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status IN ('delivered', 'opened', 'clicked')),
      'opened', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status IN ('opened', 'clicked')),
      'clicked', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status = 'clicked'),
      'bounced', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status = 'bounced')
    )
  ) INTO v_result
  FROM public.email_campaigns c
  LEFT JOIN public.email_templates t ON t.id = c.template_id
  WHERE c.id = p_campaign_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  RETURN v_result;
END;
$$;


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
    'total_sent', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id),
    'total_delivered', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status IN ('delivered', 'opened', 'clicked')),
    'total_opened', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status IN ('opened', 'clicked')),
    'total_clicked', (SELECT COUNT(*) FROM public.email_sends s WHERE s.campaign_id = c.id AND s.status = 'clicked'),
    'total_count', COUNT(*) OVER()
  )
  FROM public.email_campaigns c
  LEFT JOIN public.email_templates t ON t.id = c.template_id
  WHERE (p_status IS NULL OR c.status = p_status)
    AND (p_category IS NULL OR c.category = p_category)
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_update_campaign_status(
  p_campaign_id UUID,
  p_status TEXT,
  p_sent_count INT DEFAULT 0,
  p_total_recipients INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  IF p_status NOT IN ('draft', 'sending', 'sent', 'failed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  UPDATE public.email_campaigns
  SET status = p_status,
      total_recipients = COALESCE(p_total_recipients, total_recipients),
      sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
  WHERE id = p_campaign_id;
END;
$$;


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


UPDATE public.email_campaigns c
SET total_recipients = public.admin_count_campaign_recipients(c.audience_source, c.audience_filter)
WHERE c.status = 'draft';


NOTIFY pgrst, 'reload schema';
