-- ============================================================================
-- Onboarding Reminder Email System
-- ============================================================================
-- Sends automated reminder emails to users who signed up but never completed
-- onboarding. Uses the same architecture as message_digest:
--   pg_cron → enqueue function → queue table → webhook → edge function
--
-- 3-touch cadence:
--   Reminder 1: 24 hours after signup
--   Reminder 2: 72 hours after signup
--   Reminder 3: 7 days after signup
--
-- Safety:
--   - Skips test accounts
--   - Skips users who already completed onboarding
--   - UNIQUE constraint prevents duplicate reminders
--   - Only queues next reminder after previous one is processed
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- A. Create onboarding_reminder_queue table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_reminder_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reminder_number INTEGER NOT NULL CHECK (reminder_number IN (1, 2, 3)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  processed_at TIMESTAMPTZ,
  UNIQUE(recipient_id, reminder_number)
);

COMMENT ON TABLE public.onboarding_reminder_queue
  IS 'Queue for onboarding reminder emails. pg_cron inserts rows; webhook fires edge function to send.';

CREATE INDEX IF NOT EXISTS idx_onboarding_reminder_queue_unprocessed
  ON public.onboarding_reminder_queue (created_at)
  WHERE processed_at IS NULL;

-- No RLS — accessed only by SECURITY DEFINER function and edge function (service role)

-- ============================================================================
-- B. Create enqueue_onboarding_reminders() function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_onboarding_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
  -- -----------------------------------------------------------------------
  -- Reminder 1: Users who signed up > 24 hours ago
  -- -----------------------------------------------------------------------
  INSERT INTO onboarding_reminder_queue (recipient_id, reminder_number)
  SELECT p.id, 1
  FROM profiles p
  WHERE p.onboarding_completed = false
    AND p.is_test_account = false
    AND p.email IS NOT NULL
    AND p.created_at < v_now - interval '24 hours'
    -- No previous reminder required for #1
    AND NOT EXISTS (
      SELECT 1 FROM onboarding_reminder_queue orq
      WHERE orq.recipient_id = p.id AND orq.reminder_number = 1
    )
  ON CONFLICT (recipient_id, reminder_number) DO NOTHING;

  -- -----------------------------------------------------------------------
  -- Reminder 2: Users who signed up > 72 hours ago
  --             AND reminder 1 was already processed
  -- -----------------------------------------------------------------------
  INSERT INTO onboarding_reminder_queue (recipient_id, reminder_number)
  SELECT p.id, 2
  FROM profiles p
  WHERE p.onboarding_completed = false
    AND p.is_test_account = false
    AND p.email IS NOT NULL
    AND p.created_at < v_now - interval '72 hours'
    -- Reminder 1 must have been sent (processed)
    AND EXISTS (
      SELECT 1 FROM onboarding_reminder_queue orq
      WHERE orq.recipient_id = p.id
        AND orq.reminder_number = 1
        AND orq.processed_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM onboarding_reminder_queue orq
      WHERE orq.recipient_id = p.id AND orq.reminder_number = 2
    )
  ON CONFLICT (recipient_id, reminder_number) DO NOTHING;

  -- -----------------------------------------------------------------------
  -- Reminder 3: Users who signed up > 7 days ago
  --             AND reminder 2 was already processed
  -- -----------------------------------------------------------------------
  INSERT INTO onboarding_reminder_queue (recipient_id, reminder_number)
  SELECT p.id, 3
  FROM profiles p
  WHERE p.onboarding_completed = false
    AND p.is_test_account = false
    AND p.email IS NOT NULL
    AND p.created_at < v_now - interval '7 days'
    -- Reminder 2 must have been sent (processed)
    AND EXISTS (
      SELECT 1 FROM onboarding_reminder_queue orq
      WHERE orq.recipient_id = p.id
        AND orq.reminder_number = 2
        AND orq.processed_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM onboarding_reminder_queue orq
      WHERE orq.recipient_id = p.id AND orq.reminder_number = 3
    )
  ON CONFLICT (recipient_id, reminder_number) DO NOTHING;
END;
$$;

-- ============================================================================
-- C. Schedule pg_cron job — daily at 10:00 UTC
-- ============================================================================

SELECT cron.schedule(
  'onboarding_reminder_emails',
  '0 10 * * *',
  'SELECT public.enqueue_onboarding_reminders();'
);

-- ============================================================================
-- D. Seed onboarding_reminder email template
-- ============================================================================
-- Uses reminder_number to select subject + content variation at send time.
-- The edge function overrides subject based on reminder_number; the template
-- body is generic enough for all 3 touches.
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'onboarding_reminder',
  'Onboarding Reminder',
  'Sent to users who verified email but did not complete onboarding. 3-touch cadence: 24h, 72h, 7d after signup.',
  'notification',
  'Complete your HOCKIA profile and start connecting',
  '[
    {"type": "heading", "text": "Your profile is waiting for you \uD83C\uDFD1", "level": 1},
    {"type": "paragraph", "text": "Hi {{first_name}},"},
    {"type": "paragraph", "text": "{{body_text}}"},
    {"type": "button", "text": "{{cta_label}}", "url": "{{cta_url}}"},
    {"type": "divider"},
    {"type": "footnote", "text": "If you didn''t create this account, you can safely ignore this email."}
  ]'::jsonb,
  E'{{heading}}\n\nHi {{first_name}},\n\n{{body_text}}\n\n{{cta_label}}:\n{{cta_url}}\n\nIf you didn''t create this account, you can safely ignore this email.\n\n---\nYou''re receiving this because you signed up for HOCKIA.\nManage preferences: {{settings_url}}',
  '[
    {"name": "first_name", "description": "Recipient first name (derived from email if full_name is NULL)", "required": true},
    {"name": "heading", "description": "Dynamic heading based on reminder number", "required": true},
    {"name": "body_text", "description": "Dynamic body paragraph based on reminder number", "required": true},
    {"name": "cta_label", "description": "CTA button text", "required": true},
    {"name": "cta_url", "description": "Link to complete-profile page", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
)
ON CONFLICT (template_key) DO NOTHING;

-- Create version 1 snapshot for the new template
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
  'Initial version — 3-touch onboarding reminder (24h, 72h, 7d)'
FROM public.email_templates t
WHERE t.template_key = 'onboarding_reminder';
