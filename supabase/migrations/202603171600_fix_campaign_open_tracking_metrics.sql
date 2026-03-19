-- ============================================================================
-- Fix Campaign Open Tracking Metrics
-- ============================================================================
-- Problem:
--   Resend can record delivered/opened events, but HOCKIA campaign metrics still
--   show 0 opens if the email_events row is not linked back to email_sends in
--   time. The existing campaign RPCs only read email_sends.status.
--
-- Fix:
--   1. Add a resilient campaign metrics helper that falls back to email_events
--      matched by send_id or resend_email_id.
--   2. Update campaign list/detail RPCs to use that helper.
--   3. Link orphaned email_events rows to email_sends automatically on insert.
--   4. Improve the backfill RPC so it can repair rows using resend_email_id.
--   5. Backfill existing production/staging data immediately.
-- ============================================================================

-- ============================================================================
-- 1. Internal helper: campaign metrics with email_events fallback
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_campaign_email_metrics(
  p_campaign_id UUID
)
RETURNS TABLE (
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
  WITH campaign_sends AS (
    SELECT
      s.id,
      s.resend_email_id,
      s.status
    FROM public.email_sends s
    WHERE s.campaign_id = p_campaign_id
  ),
  event_rollup AS (
    SELECT
      s.id AS send_id,
      bool_or(e.event_type IN ('delivered', 'opened', 'clicked')) AS has_delivered,
      bool_or(e.event_type IN ('opened', 'clicked')) AS has_opened,
      bool_or(e.event_type = 'clicked') AS has_clicked,
      bool_or(e.event_type = 'bounced') AS has_bounced
    FROM campaign_sends s
    INNER JOIN public.email_events e
      ON e.send_id = s.id
      OR (
        e.send_id IS NULL
        AND s.resend_email_id IS NOT NULL
        AND e.resend_email_id = s.resend_email_id
      )
    GROUP BY s.id
  )
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (
      WHERE s.status IN ('delivered', 'opened', 'clicked')
        OR COALESCE(er.has_delivered, false)
    )::BIGINT AS delivered,
    COUNT(*) FILTER (
      WHERE s.status IN ('opened', 'clicked')
        OR COALESCE(er.has_opened, false)
    )::BIGINT AS opened,
    COUNT(*) FILTER (
      WHERE s.status = 'clicked'
        OR COALESCE(er.has_clicked, false)
    )::BIGINT AS clicked,
    COUNT(*) FILTER (
      WHERE s.status = 'bounced'
        OR COALESCE(er.has_bounced, false)
    )::BIGINT AS bounced
  FROM campaign_sends s
  LEFT JOIN event_rollup er ON er.send_id = s.id;
END;
$$;

-- ============================================================================
-- 2. Update campaign detail RPC to use resilient metrics
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

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. Update campaign list RPC to use resilient metrics
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
-- 4. Trigger: attach orphaned email_events rows when email_sends is inserted
-- ============================================================================

CREATE OR REPLACE FUNCTION public.link_orphan_email_events_to_send()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_highest_status TEXT;
  v_first_delivered_at TIMESTAMPTZ;
  v_first_opened_at TIMESTAMPTZ;
  v_first_clicked_at TIMESTAMPTZ;
  v_first_bounced_at TIMESTAMPTZ;
BEGIN
  IF NEW.resend_email_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.email_events
  SET send_id = NEW.id
  WHERE send_id IS NULL
    AND resend_email_id = NEW.resend_email_id;

  SELECT
    CASE
      WHEN bool_or(e.event_type = 'complained') THEN 'complained'
      WHEN bool_or(e.event_type = 'unsubscribed') THEN 'unsubscribed'
      WHEN bool_or(e.event_type = 'bounced') THEN 'bounced'
      WHEN bool_or(e.event_type = 'clicked') THEN 'clicked'
      WHEN bool_or(e.event_type = 'opened') THEN 'opened'
      WHEN bool_or(e.event_type = 'delivered') THEN 'delivered'
      ELSE NULL
    END,
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'delivered'),
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'opened'),
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'clicked'),
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'bounced')
  INTO
    v_highest_status,
    v_first_delivered_at,
    v_first_opened_at,
    v_first_clicked_at,
    v_first_bounced_at
  FROM public.email_events e
  WHERE e.send_id = NEW.id;

  IF v_highest_status IS NOT NULL THEN
    UPDATE public.email_sends s
    SET
      status = CASE
        WHEN s.status = 'complained' THEN s.status
        WHEN s.status = 'unsubscribed' THEN s.status
        WHEN s.status = 'bounced' AND v_highest_status NOT IN ('complained', 'unsubscribed') THEN s.status
        WHEN s.status = 'clicked' AND v_highest_status NOT IN ('complained', 'unsubscribed', 'bounced') THEN s.status
        WHEN s.status = 'opened' AND v_highest_status NOT IN ('complained', 'unsubscribed', 'bounced', 'clicked') THEN s.status
        WHEN s.status = 'delivered' AND v_highest_status = 'sent' THEN s.status
        ELSE v_highest_status
      END,
      delivered_at = COALESCE(s.delivered_at, v_first_delivered_at, v_first_opened_at, v_first_clicked_at),
      opened_at = COALESCE(s.opened_at, v_first_opened_at, v_first_clicked_at),
      clicked_at = COALESCE(s.clicked_at, v_first_clicked_at),
      bounced_at = COALESCE(s.bounced_at, v_first_bounced_at)
    WHERE s.id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_orphan_email_events_to_send ON public.email_sends;

CREATE TRIGGER trg_link_orphan_email_events_to_send
AFTER INSERT ON public.email_sends
FOR EACH ROW
EXECUTE FUNCTION public.link_orphan_email_events_to_send();

-- ============================================================================
-- 5. Replace the backfill RPC so it also repairs orphaned event rows
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_backfill_email_statuses()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked INT := 0;
  v_updated INT := 0;
  v_details JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  WITH linked AS (
    UPDATE public.email_events e
    SET send_id = s.id
    FROM public.email_sends s
    WHERE e.send_id IS NULL
      AND s.resend_email_id IS NOT NULL
      AND e.resend_email_id = s.resend_email_id
    RETURNING e.id
  )
  SELECT COUNT(*) INTO v_linked FROM linked;

  WITH highest_events AS (
    SELECT
      s.id AS send_id,
      CASE
        WHEN bool_or(e.event_type = 'complained') THEN 'complained'
        WHEN bool_or(e.event_type = 'unsubscribed') THEN 'unsubscribed'
        WHEN bool_or(e.event_type = 'bounced') THEN 'bounced'
        WHEN bool_or(e.event_type = 'clicked') THEN 'clicked'
        WHEN bool_or(e.event_type = 'opened') THEN 'opened'
        WHEN bool_or(e.event_type = 'delivered') THEN 'delivered'
        ELSE 'sent'
      END AS highest_status,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'delivered') AS first_delivered_at,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'opened') AS first_opened_at,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'clicked') AS first_clicked_at,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'bounced') AS first_bounced_at
    FROM public.email_sends s
    INNER JOIN public.email_events e
      ON e.send_id = s.id
      OR (
        e.send_id IS NULL
        AND s.resend_email_id IS NOT NULL
        AND e.resend_email_id = s.resend_email_id
      )
    GROUP BY s.id
  ),
  status_priority AS (
    SELECT
      he.send_id,
      he.highest_status,
      he.first_delivered_at,
      he.first_opened_at,
      he.first_clicked_at,
      he.first_bounced_at,
      s.status AS current_status,
      s.template_key,
      CASE s.status
        WHEN 'sent' THEN 0 WHEN 'delivered' THEN 1 WHEN 'opened' THEN 2
        WHEN 'clicked' THEN 3 WHEN 'bounced' THEN 10
        WHEN 'complained' THEN 11 WHEN 'unsubscribed' THEN 12
        ELSE 0
      END AS current_priority,
      CASE he.highest_status
        WHEN 'sent' THEN 0 WHEN 'delivered' THEN 1 WHEN 'opened' THEN 2
        WHEN 'clicked' THEN 3 WHEN 'bounced' THEN 10
        WHEN 'complained' THEN 11 WHEN 'unsubscribed' THEN 12
        ELSE 0
      END AS new_priority
    FROM highest_events he
    INNER JOIN public.email_sends s ON s.id = he.send_id
  ),
  updates AS (
    UPDATE public.email_sends s
    SET
      status = sp.highest_status,
      delivered_at = COALESCE(s.delivered_at, sp.first_delivered_at, sp.first_opened_at, sp.first_clicked_at),
      opened_at = COALESCE(s.opened_at, sp.first_opened_at, sp.first_clicked_at),
      clicked_at = COALESCE(s.clicked_at, sp.first_clicked_at),
      bounced_at = COALESCE(s.bounced_at, sp.first_bounced_at)
    FROM status_priority sp
    WHERE s.id = sp.send_id
      AND sp.new_priority > sp.current_priority
    RETURNING s.id, sp.template_key, sp.current_status AS old_status, sp.highest_status AS new_status
  )
  SELECT
    COUNT(*),
    COALESCE(jsonb_agg(jsonb_build_object(
      'send_id', u.id,
      'template_key', u.template_key,
      'old_status', u.old_status,
      'new_status', u.new_status
    )), '[]'::jsonb)
  INTO v_updated, v_details
  FROM updates u;

  RETURN jsonb_build_object(
    'linked_orphan_events', v_linked,
    'updated_count', v_updated,
    'details', v_details
  );
END;
$$;

-- ============================================================================
-- 6. Backfill existing orphan events + sync statuses immediately
-- ============================================================================

WITH linked AS (
  UPDATE public.email_events e
  SET send_id = s.id
  FROM public.email_sends s
  WHERE e.send_id IS NULL
    AND s.resend_email_id IS NOT NULL
    AND e.resend_email_id = s.resend_email_id
  RETURNING e.id
),
highest_events AS (
  SELECT
    s.id AS send_id,
    CASE
      WHEN bool_or(e.event_type = 'complained') THEN 'complained'
      WHEN bool_or(e.event_type = 'unsubscribed') THEN 'unsubscribed'
      WHEN bool_or(e.event_type = 'bounced') THEN 'bounced'
      WHEN bool_or(e.event_type = 'clicked') THEN 'clicked'
      WHEN bool_or(e.event_type = 'opened') THEN 'opened'
      WHEN bool_or(e.event_type = 'delivered') THEN 'delivered'
      ELSE 'sent'
    END AS highest_status,
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'delivered') AS first_delivered_at,
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'opened') AS first_opened_at,
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'clicked') AS first_clicked_at,
    MIN(e.occurred_at) FILTER (WHERE e.event_type = 'bounced') AS first_bounced_at
  FROM public.email_sends s
  INNER JOIN public.email_events e ON e.send_id = s.id
  GROUP BY s.id
),
status_priority AS (
  SELECT
    he.send_id,
    he.highest_status,
    he.first_delivered_at,
    he.first_opened_at,
    he.first_clicked_at,
    he.first_bounced_at,
    s.status AS current_status,
    CASE s.status
      WHEN 'sent' THEN 0 WHEN 'delivered' THEN 1 WHEN 'opened' THEN 2
      WHEN 'clicked' THEN 3 WHEN 'bounced' THEN 10
      WHEN 'complained' THEN 11 WHEN 'unsubscribed' THEN 12
      ELSE 0
    END AS current_priority,
    CASE he.highest_status
      WHEN 'sent' THEN 0 WHEN 'delivered' THEN 1 WHEN 'opened' THEN 2
      WHEN 'clicked' THEN 3 WHEN 'bounced' THEN 10
      WHEN 'complained' THEN 11 WHEN 'unsubscribed' THEN 12
      ELSE 0
    END AS new_priority
  FROM highest_events he
  INNER JOIN public.email_sends s ON s.id = he.send_id
)
UPDATE public.email_sends s
SET
  status = sp.highest_status,
  delivered_at = COALESCE(s.delivered_at, sp.first_delivered_at, sp.first_opened_at, sp.first_clicked_at),
  opened_at = COALESCE(s.opened_at, sp.first_opened_at, sp.first_clicked_at),
  clicked_at = COALESCE(s.clicked_at, sp.first_clicked_at),
  bounced_at = COALESCE(s.bounced_at, sp.first_bounced_at)
FROM status_priority sp
WHERE s.id = sp.send_id
  AND sp.new_priority > sp.current_priority;
