-- Rollback for 20261116120000_email_templates_spanish.sql.
-- Deletes exactly the 7 Spanish rows that migration added; their
-- email_template_versions rows go with them (ON DELETE CASCADE) and any
-- campaign pointing at them keeps its row with template_id NULL (ON DELETE
-- SET NULL). The edge functions then fall back to the English rows for every
-- member, so emails keep going out (in English). The English rows are not
-- touched.

DELETE FROM public.email_templates
WHERE template_key IN (
  'application_notification__es',
  'friend_request__es',
  'message_digest__es',
  'onboarding_reminder__es',
  'profile_view_digest__es',
  'reference_request__es',
  'vacancy_notification__es'
);
