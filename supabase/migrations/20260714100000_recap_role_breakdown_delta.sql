-- ============================================================================
-- Monday profile-view recap upgrade: role breakdown + week-over-week delta
-- ============================================================================
-- The recap email said only "{{view_count}} checked out your profile". This
-- adds (a) WHO by role ("2 clubs · 1 coach · 4 players") and (b) a real
-- week-over-week trend ("up from 9 views the week before"), both computed at
-- ENQUEUE time so the email always matches one consistent snapshot. The CTA
-- moves from the dashboard viewers section to /home (the Pulse), which now
-- carries the weekly-visibility card.
--
-- Invariants preserved from 20260710150000 (hidden-profile hardening):
--   * hidden viewers are excluded from every count (list/count parity),
--   * anonymous browsers are never broken down by role (a role bucket of 1
--     would deanonymize them) — they stay in anonymous_viewers only,
--   * test accounts never counted, hidden recipients never enqueued.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────
-- A. Queue columns (nullable: rows enqueued before this migration stay
--    valid; the edge fn treats NULL as "no breakdown / no trend line").
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profile_view_email_queue
  ADD COLUMN IF NOT EXISTS viewers_by_role jsonb,
  ADD COLUMN IF NOT EXISTS views_prior_7d integer;

COMMENT ON COLUMN public.profile_view_email_queue.viewers_by_role IS
  'Distinct identified (non-anonymous) viewers per role in the 7-day window, e.g. {"club":2,"coach":1,"player":4}. Sums to unique_viewers.';
COMMENT ON COLUMN public.profile_view_email_queue.views_prior_7d IS
  'Identified profile views in the PRIOR 7-day window (14→7 days ago), same filters as total_views. NULL on pre-upgrade rows.';

-- ────────────────────────────────────────────────────────────────────
-- B. Enqueue: compute breakdown + prior-week views in the same snapshot
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_profile_view_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - INTERVAL '7 days';
  v_prior TIMESTAMPTZ := now() - INTERVAL '14 days';
  v_user RECORD;
BEGIN
  FOR v_user IN
    WITH view_stats AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COUNT(*) AS total_views,
        COUNT(DISTINCT e.user_id) AS unique_viewers,
        -- Top 5 most recent distinct viewers (for avatar display in email).
        -- Same filters as the outer count so the array and the counts can
        -- never disagree.
        (ARRAY(
          SELECT DISTINCT ON (sub.user_id) sub.user_id
          FROM events sub
          WHERE sub.event_name = 'profile_view'
            AND sub.entity_type = 'profile'
            AND sub.entity_id = e.entity_id
            AND sub.user_id IS NOT NULL
            AND sub.user_id != e.entity_id
            AND sub.created_at >= v_since
            AND EXISTS (
              SELECT 1 FROM profiles svp
              WHERE svp.id = sub.user_id
                AND COALESCE(svp.is_test_account, false) = false
                AND svp.browse_anonymously = false
                AND NOT public.profile_is_hidden(svp.is_blocked, svp.frozen_minor_at)
            )
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
        AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
      GROUP BY e.entity_id
    ),
    -- Distinct identified viewers per role. Same filters as view_stats, so
    -- the role buckets sum exactly to unique_viewers. Anonymous browsers are
    -- deliberately absent: naming the role of a single anonymous viewer
    -- would deanonymize them.
    role_counts AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COALESCE(vp.role, 'other') AS viewer_role,
        COUNT(DISTINCT e.user_id) AS viewer_count
      FROM events e
      INNER JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'profile_view'
        AND e.entity_type = 'profile'
        AND e.user_id IS NOT NULL
        AND e.user_id != e.entity_id
        AND e.created_at >= v_since
        AND COALESCE(vp.is_test_account, false) = false
        AND vp.browse_anonymously = false
        AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
      GROUP BY e.entity_id, COALESCE(vp.role, 'other')
    ),
    role_json AS (
      SELECT viewed_user_id, jsonb_object_agg(viewer_role, viewer_count) AS viewers_by_role
      FROM role_counts
      GROUP BY viewed_user_id
    ),
    -- Prior 7-day window (14→7 days ago), identical filters to total_views
    -- so the week-over-week comparison is like-for-like.
    prior_views AS (
      SELECT
        e.entity_id AS viewed_user_id,
        COUNT(*) AS views_prior
      FROM events e
      INNER JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'profile_view'
        AND e.entity_type = 'profile'
        AND e.user_id IS NOT NULL
        AND e.user_id != e.entity_id
        AND e.created_at >= v_prior
        AND e.created_at < v_since
        AND COALESCE(vp.is_test_account, false) = false
        AND vp.browse_anonymously = false
        AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
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
        AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
      GROUP BY e.entity_id
    )
    SELECT
      vs.viewed_user_id,
      vs.total_views,
      vs.unique_viewers,
      COALESCE(ac.anon_viewers, 0) AS anonymous_viewers,
      vs.top_viewers,
      rj.viewers_by_role,
      COALESCE(pv.views_prior, 0) AS views_prior_7d
    FROM view_stats vs
    LEFT JOIN anon_counts ac ON ac.viewed_user_id = vs.viewed_user_id
    LEFT JOIN role_json rj ON rj.viewed_user_id = vs.viewed_user_id
    LEFT JOIN prior_views pv ON pv.viewed_user_id = vs.viewed_user_id
    INNER JOIN profiles p ON p.id = vs.viewed_user_id
    WHERE p.notify_profile_views = true
      AND p.onboarding_completed = true
      AND COALESCE(p.is_test_account, false) = false
      -- Hidden recipients never get the digest.
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      -- Cooldown: 6 days, NOT 7. The stamp is written with the cron run's
      -- transaction now(); v_since is the NEXT run's now()-7d — so pure
      -- millisecond jitter between two Monday 04:00 runs decides the
      -- comparison. On 2026-07-13 the run started 10ms earlier than
      -- 2026-07-06's and silently skipped 8 eligible recipients. The Monday
      -- cron is the real cadence; the cooldown only guards double-sends.
      AND (p.last_profile_view_email_at IS NULL
           OR p.last_profile_view_email_at < now() - INTERVAL '6 days')
  LOOP
    INSERT INTO profile_view_email_queue (
      recipient_id, unique_viewers, total_views, anonymous_viewers,
      top_viewer_ids, viewers_by_role, views_prior_7d
    ) VALUES (
      v_user.viewed_user_id,
      v_user.unique_viewers,
      v_user.total_views,
      v_user.anonymous_viewers,
      v_user.top_viewers,
      v_user.viewers_by_role,
      v_user.views_prior_7d
    );

    UPDATE profiles
    SET last_profile_view_email_at = now()
    WHERE id = v_user.viewed_user_id;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- C. Template: breakdown + trend paragraphs (conditional: an old edge fn
--    that doesn't pass the vars renders them empty → blocks are dropped,
--    so template and fn can deploy in either order). CTA is var-driven
--    ({{cta_url}}), so the /home switch ships in the edge fn.
-- ────────────────────────────────────────────────────────────────────
UPDATE public.email_templates
SET
  content_json = '[
    {"type": "paragraph", "text": "Hi {{first_name}},"},
    {"type": "paragraph", "text": "{{view_count}} checked out your HOCKIA profile this week."},
    {"type": "paragraph", "text": "{{stats_line}}", "conditional": true},
    {"type": "paragraph", "text": "{{trend_line}}", "color": "#6b7280", "conditional": true},
    {"type": "paragraph", "text": "Log in to see who''s been looking and what caught their attention.", "color": "#6b7280"},
    {"type": "button", "text": "{{cta_label}}", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Tip: Keep your profile up to date so others can see everything you have to offer."}
  ]'::jsonb,
  text_template = E'Hi {{first_name}},\n\n{{view_count}} checked out your HOCKIA profile this week.\n{{stats_line}}\n{{trend_line}}\n\nLog in to see who''s been looking and what caught their attention.\n\n{{cta_label}}:\n{{cta_url}}\n\nTip: Keep your profile up to date so others can see everything you have to offer.\n\n---\nYou''re receiving this because you''re on HOCKIA.\nManage preferences: {{settings_url}}',
  description = 'Weekly recap teasing profile view count, viewer-role breakdown and week-over-week trend. Drives users back to the Home Pulse.',
  variables = '[
    {"name": "first_name", "description": "Recipient first name", "required": true},
    {"name": "view_count", "description": "View count phrase (e.g. ''3 people'' or ''1 person'')", "required": true},
    {"name": "stats_line", "description": "Viewer breakdown by role (e.g. ''2 clubs · 1 coach · 4 players''); empty on pre-upgrade queue rows", "required": false},
    {"name": "trend_line", "description": "Week-over-week trend (e.g. ''Up from 9 profile views the week before.''); empty on pre-upgrade queue rows", "required": false},
    {"name": "cta_url", "description": "Link to the Home Pulse", "required": true},
    {"name": "cta_label", "description": "CTA button text", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  updated_at = now()
WHERE template_key = 'profile_view_digest';

-- ────────────────────────────────────────────────────────────────────
-- D. Self-check: hidden fences survived the rewrite and the new columns
--    are wired into the live body.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.enqueue_profile_view_emails()'::regprocedure);
  IF position('profile_is_hidden(vp.is_blocked' in v_def) = 0
     OR position('profile_is_hidden(p.is_blocked' in v_def) = 0
     OR position('profile_is_hidden(svp.is_blocked' in v_def) = 0 THEN
    RAISE EXCEPTION 'RECAP-FENCE-CHECK: hidden fences missing from enqueue_profile_view_emails';
  END IF;
  IF position('viewers_by_role' in v_def) = 0
     OR position('views_prior_7d' in v_def) = 0 THEN
    RAISE EXCEPTION 'RECAP-FENCE-CHECK: new recap columns not wired into enqueue';
  END IF;
  IF position('6 days' in v_def) = 0 THEN
    RAISE EXCEPTION 'RECAP-FENCE-CHECK: jitter-tolerant cooldown missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_templates
    WHERE template_key = 'profile_view_digest'
      AND content_json::text LIKE '%stats_line%'
  ) THEN
    RAISE EXCEPTION 'RECAP-FENCE-CHECK: profile_view_digest template not updated';
  END IF;
END $$;
