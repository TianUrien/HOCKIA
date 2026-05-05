-- =========================================================================
-- Lock down internal queue tables to service_role only
-- =========================================================================
-- Three queue tables are written by SECURITY DEFINER cron functions and
-- processed by edge functions using service_role. They contain recipient
-- user_ids; profile_view_email_queue carries enough metadata to enumerate
-- platform activity per user. They must never be queryable by anon or
-- authenticated PostgREST callers.
--
-- Audit context (prod RLS scan):
--   - profile_view_email_queue: RLS DISABLED (~184 rows containing user
--     activity metadata)
--   - reference_reminder_queue: RLS DISABLED
--   - onboarding_reminder_queue: RLS ENABLED but ZERO policies (denies all
--     reads anyway, but inconsistent with siblings — make intent explicit)
--
-- Fix: enable RLS on all three + REVOKE all permissions from anon and
-- authenticated. service_role bypasses RLS so the edge functions and
-- cron jobs continue to work unchanged.
-- =========================================================================

ALTER TABLE public.profile_view_email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_reminder_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_reminder_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profile_view_email_queue FROM anon, authenticated;
REVOKE ALL ON public.reference_reminder_queue FROM anon, authenticated;
REVOKE ALL ON public.onboarding_reminder_queue FROM anon, authenticated;

COMMENT ON TABLE public.profile_view_email_queue IS
  'Service-role-only queue. Written by SECURITY DEFINER triggers, processed by notify-profile-views edge function. NEVER expose to anon/authenticated.';

COMMENT ON TABLE public.reference_reminder_queue IS
  'Service-role-only queue. Written by enqueue_reference_reminders() cron, processed by notify-reference-reminder edge function. NEVER expose to anon/authenticated.';

COMMENT ON TABLE public.onboarding_reminder_queue IS
  'Service-role-only queue. Written by enqueue_onboarding_reminders() cron, processed by notify-onboarding-reminder edge function. NEVER expose to anon/authenticated.';
