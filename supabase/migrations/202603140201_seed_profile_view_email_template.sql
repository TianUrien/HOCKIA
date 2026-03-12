-- Seed the profile_view_digest email template for Admin Portal visibility.
-- This makes the template editable, testable, and trackable in the Admin Email portal.

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
