-- ============================================================================
-- Profile View Email Digest
-- ============================================================================
-- Adds a daily email digest summarising who viewed the user's profile.
-- Architecture mirrors the message digest system:
--   pg_cron → enqueue function → queue table INSERT → webhook → edge function → Resend
--
-- Eligibility:
--   1. User had ≥1 non-anonymous, non-self, non-test profile view in the last 24 h
--   2. User has notify_profile_views = true
--   3. User is not a test account and has completed onboarding
--   4. User has not already received a profile-view email in the last 24 h
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- A. Add notify_profile_views preference to profiles
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_profile_views BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notify_profile_views
  IS 'Whether the user wants daily email digests summarising profile views.';

-- ============================================================================
-- B. Add cooldown tracker to profiles
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_profile_view_email_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.last_profile_view_email_at
  IS 'When the last profile-view digest email was sent. Used for 24-hour cooldown.';

-- ============================================================================
-- C. Create profile_view_email_queue table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profile_view_email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unique_viewers INT NOT NULL DEFAULT 0,
  total_views INT NOT NULL DEFAULT 0,
  anonymous_viewers INT NOT NULL DEFAULT 0,
  top_viewer_ids UUID[] NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.profile_view_email_queue
  IS 'Queue for profile-view digest emails. pg_cron inserts rows; webhook fires edge function to send email.';

CREATE INDEX IF NOT EXISTS idx_profile_view_email_queue_unprocessed
  ON public.profile_view_email_queue (created_at)
  WHERE processed_at IS NULL;

-- No RLS — accessed only by SECURITY DEFINER function and edge function (service role)

-- ============================================================================
-- D. Create enqueue_profile_view_emails() function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_profile_view_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - INTERVAL '24 hours';
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
      -- 24-hour cooldown
      AND (p.last_profile_view_email_at IS NULL
           OR p.last_profile_view_email_at < v_since)
  LOOP
    -- Insert queue row (webhook fires edge function)
    INSERT INTO profile_view_email_queue (
      recipient_id, unique_viewers, total_views, anonymous_viewers, top_viewer_ids
    ) VALUES (
      v_user.viewed_user_id,
      v_user.unique_viewers,
      v_user.total_views,
      v_user.anonymous_viewers,
      v_user.top_viewers
    );

    -- Update cooldown timestamp
    UPDATE profiles
    SET last_profile_view_email_at = now()
    WHERE id = v_user.viewed_user_id;
  END LOOP;
END;
$$;

-- ============================================================================
-- E. Schedule pg_cron job — daily at 4:00 AM UTC (30 min after in-app notification cron)
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
      '0 4 * * *',
      'SELECT public.enqueue_profile_view_emails();'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron scheduling: insufficient privileges';
  END;
END;
$$;

-- ============================================================================
-- F. Seed email_templates row for Admin Portal visibility
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'profile_view_digest',
  'Profile View Digest',
  'Daily digest summarising who viewed the user''s profile. Sent once every 24 hours when profile views are detected.',
  'notification',
  '{{heading}} on PLAYR',
  '[
    {"type": "heading", "text": "{{heading}}", "level": 1},
    {"type": "paragraph", "text": "Hi {{first_name}}, here''s who checked out your profile in the last 24 hours."},
    {"type": "paragraph", "text": "{{unique_viewers}} unique viewers \u00b7 {{total_views}} total views", "size": "small", "color": "#6b7280"},
    {"type": "button", "text": "{{cta_label}}", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Keep your profile fresh to attract more views."}
  ]'::jsonb,
  E'{{heading}} on PLAYR\n\nHi {{first_name}},\n\nHere''s who checked out your profile in the last 24 hours.\n\n{{unique_viewers}} unique viewers \u00b7 {{total_views}} total views\n\n{{cta_label}}:\n{{cta_url}}\n\nKeep your profile fresh to attract more views.\n\n---\nYou''re receiving this because you''re on PLAYR.\nManage preferences: {{settings_url}}',
  '[
    {"name": "first_name", "description": "Recipient first name", "required": true},
    {"name": "heading", "description": "Dynamic heading (e.g. ''3 people viewed your profile'')", "required": true},
    {"name": "unique_viewers", "description": "Number of unique viewers", "required": true},
    {"name": "total_views", "description": "Total view count", "required": true},
    {"name": "anonymous_viewers", "description": "Number of anonymous viewers", "required": false},
    {"name": "cta_url", "description": "Link to profile viewers section", "required": true},
    {"name": "cta_label", "description": "CTA button text", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
)
ON CONFLICT (template_key) DO NOTHING;

-- Snapshot version 1
INSERT INTO public.email_template_versions (
  template_id, version_number, subject_template, content_json,
  text_template, variables, change_note
)
SELECT
  t.id,
  1,
  t.subject_template,
  t.content_json,
  t.text_template,
  t.variables,
  'Initial version — profile view digest email'
FROM public.email_templates t
WHERE t.template_key = 'profile_view_digest'
AND NOT EXISTS (
  SELECT 1 FROM public.email_template_versions v
  WHERE v.template_id = t.id AND v.version_number = 1
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
