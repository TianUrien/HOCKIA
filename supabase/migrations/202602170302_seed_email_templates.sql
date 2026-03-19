-- ============================================================================
-- Seed Email Templates — Migrate 5 existing notification templates
-- ============================================================================
-- Converts the 5 hardcoded TypeScript email templates into structured
-- content_json rows in email_templates, each with a version 1 snapshot.
-- ============================================================================

-- ============================================================================
-- 1. Vacancy Notification
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'vacancy_notification',
  'Vacancy Notification',
  'Sent when a club publishes a new opportunity. Recipients: eligible players/coaches matching the vacancy type.',
  'notification',
  'New opportunity on HOCKIA: {{vacancy_title}}',
  '[
    {"type": "heading", "text": "New Opportunity Available! \uD83C\uDFD1", "level": 1},
    {"type": "paragraph", "text": "A club has just published a new opportunity."},
    {"type": "card", "title": "{{vacancy_title}}", "subtitle": "{{club_name}}", "fields": [
      {"label": "Position", "value": "{{position}}", "conditional": true},
      {"label": "Location", "value": "{{location}}", "conditional": true}
    ]},
    {"type": "paragraph", "text": "{{summary}}", "conditional": true},
    {"type": "button", "text": "View Opportunity", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Don''t miss out \u2013 great opportunities go fast!"}
  ]'::jsonb,
  E'New Opportunity Available on HOCKIA! \uD83C\uDFD1\n\nA club has just published a new opportunity.\n\n{{vacancy_title}}\n{{club_name}}\nPosition: {{position}}\nLocation: {{location}}\n\n{{summary}}\n\nView this opportunity:\n{{cta_url}}\n\nDon''t miss out \u2013 great opportunities go fast!\n\n---\nYou''re receiving this because you''re on HOCKIA.\nManage preferences: {{settings_url}}',
  '[
    {"name": "vacancy_title", "description": "Opportunity title", "required": true},
    {"name": "club_name", "description": "Club display name", "required": true},
    {"name": "position", "description": "Position type (e.g. Goalkeeper, Midfielder)", "required": false},
    {"name": "location", "description": "City, Country", "required": false},
    {"name": "summary", "description": "Description excerpt (max 200 chars)", "required": false},
    {"name": "cta_url", "description": "Link to the opportunity page", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
);

-- ============================================================================
-- 2. Application Notification
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'application_notification',
  'Application Notification',
  'Sent to clubs when a player applies to their opportunity.',
  'notification',
  'New application for "{{opportunity_title}}"',
  '[
    {"type": "heading", "text": "You''ve received a new application! \uD83C\uDFD1", "level": 1},
    {"type": "paragraph", "text": "You have a new application for one of your opportunities."},
    {"type": "card", "title": "{{opportunity_title}}", "label": "Opportunity"},
    {"type": "user_card", "name_var": "applicant_name", "avatar_var": "applicant_avatar_url", "detail_vars": ["applicant_position", "applicant_location"], "label": "Applicant"},
    {"type": "button", "text": "View Profile", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Open their profile to learn more."}
  ]'::jsonb,
  E'You''ve received a new application on HOCKIA! \uD83C\uDFD1\n\nYou have a new application for one of your opportunities.\n\nOPPORTUNITY:\n{{opportunity_title}}\n\nAPPLICANT:\n{{applicant_name}}\nPosition: {{applicant_position}}\nLocation: {{applicant_location}}\n\nView their profile:\n{{cta_url}}\n\nOpen their profile to learn more.\n\n---\nYou''re receiving this because you''re on HOCKIA.\nManage preferences: {{settings_url}}',
  '[
    {"name": "opportunity_title", "description": "Title of the opportunity", "required": true},
    {"name": "applicant_name", "description": "Applicant display name", "required": true},
    {"name": "applicant_position", "description": "Primary + secondary positions", "required": false},
    {"name": "applicant_location", "description": "Applicant base location", "required": false},
    {"name": "applicant_avatar_url", "description": "Applicant avatar image URL", "required": false},
    {"name": "cta_url", "description": "Link to applicant profile", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
);

-- ============================================================================
-- 3. Friend Request
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'friend_request',
  'Friend Request',
  'Sent when a user receives a friend request.',
  'notification',
  '{{requester_name}} sent you a friend request on HOCKIA',
  '[
    {"type": "heading", "text": "You have a new friend request! \uD83C\uDFD1", "level": 1},
    {"type": "paragraph", "text": "Someone wants to connect with you on HOCKIA."},
    {"type": "user_card", "name_var": "requester_name", "avatar_var": "requester_avatar_url", "detail_vars": ["requester_location"]},
    {"type": "button", "text": "View Request", "url": "{{cta_url}}"},
    {"type": "paragraph", "text": "<a href=\"{{profile_url}}\">View their profile</a> to learn more.", "is_html": true, "align": "center", "size": "small", "color": "muted"}
  ]'::jsonb,
  E'New Friend Request on HOCKIA\n\n{{requester_name}} wants to connect with you on HOCKIA.\nLocation: {{requester_location}}\n\nView their request:\n{{cta_url}}\n\nView their profile:\n{{profile_url}}\n\n---\nYou''re receiving this because you''re on HOCKIA.\nManage preferences: {{settings_url}}',
  '[
    {"name": "requester_name", "description": "Requester display name", "required": true},
    {"name": "requester_location", "description": "Requester base location", "required": false},
    {"name": "requester_avatar_url", "description": "Requester avatar image URL", "required": false},
    {"name": "cta_url", "description": "Link to friend requests page", "required": true},
    {"name": "profile_url", "description": "Link to requester profile", "required": false},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
);

-- ============================================================================
-- 4. Reference Request
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'reference_request',
  'Reference Request',
  'Sent when a user requests a reference from someone.',
  'notification',
  '{{requester_name}} requested a reference from you on HOCKIA',
  '[
    {"type": "heading", "text": "Someone has requested a reference! \uD83C\uDFD1", "level": 1},
    {"type": "paragraph", "text": "A HOCKIA member has asked you to write a reference for them."},
    {"type": "user_card", "name_var": "requester_name", "avatar_var": "requester_avatar_url", "detail_vars": ["relationship_type", "requester_location"]},
    {"type": "note", "text": "{{request_note}}", "label": "Message from {{requester_name}}", "conditional": true},
    {"type": "button", "text": "View Request", "url": "{{cta_url}}"},
    {"type": "paragraph", "text": "<a href=\"{{profile_url}}\">View their profile</a> to learn more.", "is_html": true, "align": "center", "size": "small", "color": "muted"}
  ]'::jsonb,
  E'Reference Request on HOCKIA\n\n{{requester_name}} has asked you to write a reference for them.\nRelationship: {{relationship_type}}\nLocation: {{requester_location}}\n\nMessage: "{{request_note}}"\n\nView the request:\n{{cta_url}}\n\nView their profile:\n{{profile_url}}\n\n---\nYou''re receiving this because you''re on HOCKIA.\nManage preferences: {{settings_url}}',
  '[
    {"name": "requester_name", "description": "Requester display name", "required": true},
    {"name": "relationship_type", "description": "Relationship type (e.g. Coach, Teammate)", "required": true},
    {"name": "request_note", "description": "Optional message from requester", "required": false},
    {"name": "requester_location", "description": "Requester base location", "required": false},
    {"name": "requester_avatar_url", "description": "Requester avatar image URL", "required": false},
    {"name": "cta_url", "description": "Link to reference requests page", "required": true},
    {"name": "profile_url", "description": "Link to requester profile", "required": false},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
);

-- ============================================================================
-- 5. Message Digest
-- ============================================================================

INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'message_digest',
  'Message Digest',
  'Sent as a digest of unread messages. Triggered by pg_cron every 30 minutes, max once per 6 hours per user.',
  'notification',
  'You have {{message_count}} new messages on HOCKIA',
  '[
    {"type": "heading", "text": "{{heading}}", "level": 1},
    {"type": "paragraph", "text": "Hi {{first_name}}, you have unread messages on HOCKIA."},
    {"type": "conversation_list", "conversations_var": "conversations"},
    {"type": "button", "text": "{{cta_label}}", "url": "{{cta_url}}"}
  ]'::jsonb,
  E'{{heading}}\n\nHi {{first_name}},\n\n{{conversations_text}}\n\n{{cta_label}}:\n{{cta_url}}\n\n---\nYou''re receiving this because you''re on HOCKIA.\nManage preferences: {{settings_url}}',
  '[
    {"name": "first_name", "description": "Recipient first name", "required": true},
    {"name": "heading", "description": "Dynamic heading (single sender or generic)", "required": true},
    {"name": "message_count", "description": "Total unread message count", "required": true},
    {"name": "conversations", "description": "Array of {conversation_id, message_count, sender_name, sender_avatar_url}", "required": true},
    {"name": "conversations_text", "description": "Plain text list of conversations", "required": true},
    {"name": "cta_url", "description": "Link to messages page", "required": true},
    {"name": "cta_label", "description": "CTA button text (View Conversation / Open Messages)", "required": true},
    {"name": "settings_url", "description": "Link to notification settings", "required": false}
  ]'::jsonb,
  true,
  1
);

-- ============================================================================
-- Create version 1 for each seeded template
-- ============================================================================

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
  'Initial version — migrated from hardcoded TypeScript templates'
FROM public.email_templates t;
