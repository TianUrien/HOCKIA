-- ============================================================================
-- Vacancy Notification — Deliverability Optimization
-- ============================================================================
-- Problem: "New Opportunity" emails land in Gmail Promotions tab because:
--   1. Identical HTML sent to many recipients simultaneously (batch send)
--   2. Marketing-like language ("Don't miss out", emoji in subject/heading)
--
-- Fix:
--   1. Add {{first_name}} variable for per-recipient personalization
--      (handled in notify-vacancy Edge Function via renderForRecipient)
--   2. Remove emoji from heading
--   3. Remove urgency/marketing footnote
--   4. Make subject more notification-like (less branded)
--   5. Tone down heading from exclamation to informational
-- ============================================================================

-- Update the live template
UPDATE public.email_templates
SET
  subject_template = '{{club_name}} posted: {{vacancy_title}}',
  content_json = '[
    {"type": "heading", "text": "New Opportunity", "level": 1},
    {"type": "paragraph", "text": "Hi {{first_name}}, a club has published a new opportunity that may interest you."},
    {"type": "card", "title": "{{vacancy_title}}", "subtitle": "{{club_name}}", "fields": [
      {"label": "Position", "value": "{{position}}", "conditional": true},
      {"label": "Location", "value": "{{location}}", "conditional": true}
    ]},
    {"type": "paragraph", "text": "{{summary}}", "conditional": true},
    {"type": "button", "text": "View Opportunity", "url": "{{cta_url}}"}
  ]'::jsonb,
  text_template = E'New Opportunity\n\nHi {{first_name}}, a club has published a new opportunity that may interest you.\n\n{{vacancy_title}}\n{{club_name}}\nPosition: {{position}}\nLocation: {{location}}\n\n{{summary}}\n\nView this opportunity:\n{{cta_url}}\n\n---\nYou''re receiving this because you have a HOCKIA account.\nManage preferences: {{settings_url}}',
  variables = '[
    {"name": "vacancy_title", "description": "Opportunity title", "required": true},
    {"name": "club_name", "description": "Club display name", "required": true},
    {"name": "first_name", "description": "Recipient first name (personalized per-recipient)", "required": false},
    {"name": "position", "description": "Position type (e.g. Goalkeeper, Midfielder)", "required": false},
    {"name": "location", "description": "City, Country", "required": false},
    {"name": "summary", "description": "Description excerpt (max 200 chars)", "required": false},
    {"name": "cta_url", "description": "Link to the opportunity page", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  current_version = 2,
  updated_at = now()
WHERE template_key = 'vacancy_notification';

-- Create version 2 snapshot
INSERT INTO public.email_template_versions (
  template_id, version_number, subject_template, content_json,
  text_template, variables, change_note
)
SELECT
  t.id,
  2,
  t.subject_template,
  t.content_json,
  t.text_template,
  t.variables,
  'Deliverability fix: added per-recipient first_name personalization, removed emoji and marketing language to avoid Gmail Promotions tab'
FROM public.email_templates t
WHERE t.template_key = 'vacancy_notification';
