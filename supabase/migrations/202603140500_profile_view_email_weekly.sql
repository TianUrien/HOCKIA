-- ============================================================================
-- Change profile view email digest from daily to weekly (every 7 days)
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- A. Replace enqueue function: 24-hour window → 7-day window
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_profile_view_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - INTERVAL '7 days';
  v_user RECORD;
BEGIN
  FOR v_user IN
    WITH view_stats AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COUNT(*) AS total_views,
        COUNT(DISTINCT e.user_id) AS unique_viewers,
        -- Top 5 most recent distinct viewers (for avatar display in email)
        (ARRAY(
          SELECT DISTINCT ON (sub.user_id) sub.user_id
          FROM events sub
          WHERE sub.event_name = 'profile_view'
            AND sub.entity_type = 'profile'
            AND sub.entity_id = e.entity_id
            AND sub.user_id IS NOT NULL
            AND sub.user_id != e.entity_id
            AND sub.created_at >= v_since
          ORDER BY sub.user_id, sub.created_at DESC
          LIMIT 5
        )) AS top_viewers
      FROM events e
      INNER JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'profile_view'
        AND e.entity_type = 'profile'
        AND e.user_id IS NOT NULL
        AND e.user_id != e.entity_id
        AND e.created_at >= v_since
        AND COALESCE(vp.is_test_account, false) = false
        AND vp.browse_anonymously = false
      GROUP BY e.entity_id
    ),
    anon_counts AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COUNT(DISTINCT e.user_id) AS anon_viewers
      FROM events e
      INNER JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'profile_view'
        AND e.entity_type = 'profile'
        AND e.user_id IS NOT NULL
        AND e.user_id != e.entity_id
        AND e.created_at >= v_since
        AND COALESCE(vp.is_test_account, false) = false
        AND vp.browse_anonymously = true
      GROUP BY e.entity_id
    )
    SELECT
      vs.viewed_user_id,
      vs.total_views,
      vs.unique_viewers,
      COALESCE(ac.anon_viewers, 0) AS anonymous_viewers,
      vs.top_viewers
    FROM view_stats vs
    LEFT JOIN anon_counts ac ON ac.viewed_user_id = vs.viewed_user_id
    INNER JOIN profiles p ON p.id = vs.viewed_user_id
    WHERE p.notify_profile_views = true
      AND p.onboarding_completed = true
      AND COALESCE(p.is_test_account, false) = false
      -- 7-day cooldown (was 24 hours)
      AND (p.last_profile_view_email_at IS NULL
           OR p.last_profile_view_email_at < v_since)
  LOOP
    INSERT INTO profile_view_email_queue (
      recipient_id, unique_viewers, total_views, anonymous_viewers, top_viewer_ids
    ) VALUES (
      v_user.viewed_user_id,
      v_user.unique_viewers,
      v_user.total_views,
      v_user.anonymous_viewers,
      v_user.top_viewers
    );

    UPDATE profiles
    SET last_profile_view_email_at = now()
    WHERE id = v_user.viewed_user_id;
  END LOOP;
END;
$$;

-- ============================================================================
-- B. Reschedule cron: daily → weekly (Monday 4:00 AM UTC)
-- ============================================================================

DO $$
BEGIN
  BEGIN
    DELETE FROM cron.job WHERE jobname = 'profile_view_email_digest';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron cleanup: insufficient privileges';
  END;

  BEGIN
    PERFORM cron.schedule(
      'profile_view_email_digest',
      '0 4 * * 1',
      'SELECT public.enqueue_profile_view_emails();'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron scheduling: insufficient privileges';
  END;
END;
$$;

-- ============================================================================
-- C. Update email template text: "last 24 hours" → "this week"
-- ============================================================================

UPDATE public.email_templates
SET
  content_json = '[
    {"type": "heading", "text": "{{heading}}", "level": 1},
    {"type": "paragraph", "text": "Hi {{first_name}}, here''s who checked out your profile this week."},
    {"type": "paragraph", "text": "{{unique_viewers}} unique viewers · {{total_views}} total views", "size": "small", "color": "#6b7280"},
    {"type": "button", "text": "{{cta_label}}", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Keep your profile fresh to attract more views."}
  ]'::jsonb,
  text_template = E'{{heading}} on PLAYR\n\nHi {{first_name}},\n\nHere''s who checked out your profile this week.\n\n{{unique_viewers}} unique viewers · {{total_views}} total views\n\n{{cta_label}}:\n{{cta_url}}\n\nKeep your profile fresh to attract more views.\n\n---\nYou''re receiving this because you''re on PLAYR.\nManage preferences: {{settings_url}}',
  description = 'Weekly digest summarising who viewed the user''s profile. Sent once every 7 days when profile views are detected.'
WHERE template_key = 'profile_view_digest';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
