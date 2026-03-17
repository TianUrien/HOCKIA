-- ============================================================================
-- Email Metrics Diagnostic & Repair
-- ============================================================================
-- Adds two admin RPCs:
--   1. admin_diagnose_email_metrics() — shows status breakdown per template
--      and checks for orphaned events
--   2. admin_backfill_email_statuses() — syncs email_sends.status from
--      email_events for any rows where events exist but status wasn't updated
-- ============================================================================

-- ============================================================================
-- 1. Diagnostic RPC — shows per-template status breakdown
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_diagnose_email_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN jsonb_build_object(
    -- Per-template status breakdown
    'template_status_breakdown', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          s.template_key,
          s.status,
          COUNT(*) AS count,
          COUNT(*) FILTER (WHERE s.resend_email_id IS NULL) AS null_resend_id_count
        FROM email_sends s
        GROUP BY s.template_key, s.status
        ORDER BY s.template_key, s.status
      ) sub
    ),
    -- Events received per template (from email_events)
    'events_per_template', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(s.template_key, '(no send row)') AS template_key,
          e.event_type,
          COUNT(*) AS count
        FROM email_events e
        LEFT JOIN email_sends s ON s.id = e.send_id
        GROUP BY s.template_key, e.event_type
        ORDER BY s.template_key, e.event_type
      ) sub
    ),
    -- Orphaned events (events with no matching send row)
    'orphaned_events', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          e.event_type,
          COUNT(*) AS count
        FROM email_events e
        WHERE e.send_id IS NULL
        GROUP BY e.event_type
        ORDER BY e.event_type
      ) sub
    ),
    -- Events with send_id but status mismatch (should have been updated)
    'status_mismatches', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          s.id AS send_id,
          s.template_key,
          s.status AS current_status,
          s.resend_email_id,
          max_event.highest_event
        FROM email_sends s
        INNER JOIN (
          SELECT
            e.send_id,
            (ARRAY['sent','delivered','opened','clicked'])[
              GREATEST(
                CASE WHEN bool_or(e.event_type = 'clicked') THEN 4 ELSE 0 END,
                CASE WHEN bool_or(e.event_type = 'opened') THEN 3 ELSE 0 END,
                CASE WHEN bool_or(e.event_type = 'delivered') THEN 2 ELSE 0 END,
                1
              )
            ] AS highest_event
          FROM email_events e
          WHERE e.send_id IS NOT NULL
            AND e.event_type IN ('delivered', 'opened', 'clicked')
          GROUP BY e.send_id
        ) max_event ON max_event.send_id = s.id
        WHERE s.status NOT IN ('bounced', 'complained', 'unsubscribed')
          AND (
            (max_event.highest_event = 'clicked' AND s.status != 'clicked')
            OR (max_event.highest_event = 'opened' AND s.status NOT IN ('opened', 'clicked'))
            OR (max_event.highest_event = 'delivered' AND s.status NOT IN ('delivered', 'opened', 'clicked'))
          )
        LIMIT 100
      ) sub
    ),
    -- Total counts
    'totals', jsonb_build_object(
      'total_sends', (SELECT COUNT(*) FROM email_sends),
      'total_events', (SELECT COUNT(*) FROM email_events),
      'sends_with_null_resend_id', (SELECT COUNT(*) FROM email_sends WHERE resend_email_id IS NULL),
      'events_with_null_send_id', (SELECT COUNT(*) FROM email_events WHERE send_id IS NULL)
    )
  );
END;
$$;

-- ============================================================================
-- 2. Repair RPC — backfill email_sends.status from email_events
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_backfill_email_statuses()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT := 0;
  v_details JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- For each email_send that has events with higher status, update it
  WITH highest_events AS (
    SELECT
      e.send_id,
      -- Determine highest priority event
      CASE
        WHEN bool_or(e.event_type = 'complained') THEN 'complained'
        WHEN bool_or(e.event_type = 'unsubscribed') THEN 'unsubscribed'
        WHEN bool_or(e.event_type = 'bounced') THEN 'bounced'
        WHEN bool_or(e.event_type = 'clicked') THEN 'clicked'
        WHEN bool_or(e.event_type = 'opened') THEN 'opened'
        WHEN bool_or(e.event_type = 'delivered') THEN 'delivered'
        ELSE 'sent'
      END AS highest_status,
      -- Get timestamps
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'delivered') AS first_delivered_at,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'opened') AS first_opened_at,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'clicked') AS first_clicked_at,
      MIN(e.occurred_at) FILTER (WHERE e.event_type = 'bounced') AS first_bounced_at
    FROM email_events e
    WHERE e.send_id IS NOT NULL
    GROUP BY e.send_id
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
      -- Priority mapping
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
    INNER JOIN email_sends s ON s.id = he.send_id
  ),
  updates AS (
    UPDATE email_sends s
    SET
      status = sp.highest_status,
      delivered_at = COALESCE(s.delivered_at, sp.first_delivered_at),
      opened_at = COALESCE(s.opened_at, sp.first_opened_at),
      clicked_at = COALESCE(s.clicked_at, sp.first_clicked_at),
      bounced_at = COALESCE(s.bounced_at, sp.first_bounced_at)
    FROM status_priority sp
    WHERE s.id = sp.send_id
      AND sp.new_priority > sp.current_priority
    RETURNING s.id, sp.template_key, sp.current_status AS old_status, sp.highest_status AS new_status
  )
  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
    'send_id', u.id,
    'template_key', u.template_key,
    'old_status', u.old_status,
    'new_status', u.new_status
  )), '[]'::jsonb)
  INTO v_updated, v_details
  FROM updates u;

  RETURN jsonb_build_object(
    'updated_count', v_updated,
    'details', v_details
  );
END;
$$;
