-- ============================================================================
-- Admin Email Portal Improvements
-- ============================================================================
-- 1. Add p_since / p_until date range params to engagement explorer RPC
-- 2. Add complained status filtering to engagement explorer
-- 3. Add admin_toggle_email_template_active RPC
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- A. Update admin_get_email_engagement_explorer — add date range + complained
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_email_engagement_explorer(
  p_template_key TEXT DEFAULT NULL,
  p_campaign_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_since TEXT DEFAULT NULL,
  p_until TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Parse date strings (YYYY-MM-DD) into timestamps
  IF p_since IS NOT NULL AND p_since != '' THEN
    v_since := p_since::date;
  END IF;
  IF p_until IS NOT NULL AND p_until != '' THEN
    -- End of the "until" day
    v_until := (p_until::date + INTERVAL '1 day');
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'send_id', s.id,
    'recipient_id', s.recipient_id,
    'recipient_email', s.recipient_email,
    'recipient_role', s.recipient_role,
    'recipient_country', s.recipient_country,
    'recipient_name', p.full_name,
    'template_key', s.template_key,
    'template_name', t.name,
    'subject', s.subject,
    'status', s.status,
    'engagement_state', CASE
      WHEN s.status = 'bounced' THEN 'bounced'
      WHEN s.status = 'complained' THEN 'complained'
      WHEN s.status = 'unsubscribed' THEN 'unsubscribed'
      WHEN s.status = 'clicked' THEN 'clicked'
      WHEN s.status IN ('opened') THEN 'opened_not_clicked'
      WHEN s.status = 'delivered' THEN 'delivered_not_opened'
      ELSE 'sent'
    END,
    'sent_at', s.sent_at,
    'delivered_at', s.delivered_at,
    'opened_at', s.opened_at,
    'clicked_at', s.clicked_at,
    'total_count', COUNT(*) OVER()
  )
  FROM public.email_sends s
  LEFT JOIN public.email_templates t ON t.template_key = s.template_key
  LEFT JOIN public.profiles p ON p.id = s.recipient_id
  WHERE (p_template_key IS NULL OR s.template_key = p_template_key)
    AND (p_campaign_id IS NULL OR s.campaign_id = p_campaign_id)
    AND (p_role IS NULL OR s.recipient_role = p_role)
    AND (p_country IS NULL OR s.recipient_country = p_country)
    AND (v_since IS NULL OR s.sent_at >= v_since)
    AND (v_until IS NULL OR s.sent_at < v_until)
    AND (p_status IS NULL OR CASE
      WHEN p_status = 'delivered_not_opened' THEN s.status = 'delivered'
      WHEN p_status = 'opened_not_clicked' THEN s.status = 'opened'
      WHEN p_status = 'clicked' THEN s.status = 'clicked'
      WHEN p_status = 'bounced' THEN s.status = 'bounced'
      WHEN p_status = 'complained' THEN s.status = 'complained'
      WHEN p_status = 'unsubscribed' THEN s.status = 'unsubscribed'
      ELSE TRUE
    END)
  ORDER BY s.sent_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ============================================================================
-- B. admin_toggle_email_template_active — Toggle template active state
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_toggle_email_template_active(
  p_template_id UUID,
  p_is_active BOOLEAN
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

  UPDATE public.email_templates
  SET is_active = p_is_active,
      updated_at = now()
  WHERE id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found: %', p_template_id;
  END IF;
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
