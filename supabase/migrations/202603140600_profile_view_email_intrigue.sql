-- Update profile_view_digest template to intrigue-based copy.
-- No viewer names in email — drive users back to the app to see who viewed them.

UPDATE public.email_templates
SET
  subject_template = '{{view_count}} viewed your PLAYR profile',
  content_json = '[
    {"type": "paragraph", "text": "Hi {{first_name}},"},
    {"type": "paragraph", "text": "{{view_count}} checked out your PLAYR profile this week."},
    {"type": "paragraph", "text": "Log in to see who''s been looking and what caught their attention.", "color": "#6b7280"},
    {"type": "button", "text": "{{cta_label}}", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Tip: Keep your profile up to date so others can see everything you have to offer."}
  ]'::jsonb,
  text_template = E'Hi {{first_name}},\n\n{{view_count}} checked out your PLAYR profile this week.\n\nLog in to see who''s been looking and what caught their attention.\n\n{{cta_label}}:\n{{cta_url}}\n\nTip: Keep your profile up to date so others can see everything you have to offer.\n\n---\nYou''re receiving this because you''re on PLAYR.\nManage preferences: {{settings_url}}',
  description = 'Weekly digest teasing profile view count. Drives users back to the app to see who viewed them.',
  variables = '[
    {"name": "first_name", "description": "Recipient first name", "required": true},
    {"name": "view_count", "description": "View count phrase (e.g. ''3 people'' or ''1 person'')", "required": true},
    {"name": "cta_url", "description": "Link to profile viewers section", "required": true},
    {"name": "cta_label", "description": "CTA button text", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  updated_at = now()
WHERE template_key = 'profile_view_digest';
