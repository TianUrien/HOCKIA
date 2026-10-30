-- Email templates: rebrand copy (2026-10-25 founder rulings)
--
-- Updates the 10 active rows of public.email_templates (subjects, content_json,
-- text_template) to the rebrand copy rules in docs/design-handoff/decisions.md
-- (2026-10-25 "Copy for the rebrand" and "PR 3 copy sweep": the name is "Hockia"
-- in running text, sentence case for headings and buttons, postings are
-- "opportunities", no em dashes). The HTML layout and colours live in
-- supabase/functions/_shared/email-renderer.ts and change in the same PR.
-- Nothing else changes: same keys, variables, triggers and schedule; the
-- outreach emails keep their message (only the name, casing, dashes and
-- "vacancies" wording change).
--
-- Versioning follows the admin portal: each change is a new row in
-- email_template_versions (next version number, change note) and the main row
-- takes that content with current_version pointing at it, as
-- admin_save_email_template_draft + admin_activate_email_template do.
--
-- Safety: a row is only changed when its subject, text and content still equal
-- the production values read on 2026-10-30. A row edited since then (in the
-- admin portal) is skipped with a NOTICE, never overwritten.
--
-- Rollback: supabase/rollbacks/20261030120000_email_templates_rebrand.down.sql

DO $mig$
DECLARE
  r record;
  v_id uuid;
  v_vars jsonb;
  v_next int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    -- application_notification
    ($t$application_notification$t$,
     $t$New application for "{{opportunity_title}}"$t$,
     $t$You've received a new application on HOCKIA! 🏑

You have a new application for one of your opportunities.

OPPORTUNITY:
{{opportunity_title}}

APPLICANT:
{{applicant_name}}
Position: {{applicant_position}}
Location: {{applicant_location}}

View their profile:
{{cta_url}}

Open their profile to learn more.

---
You're receiving this because you're on HOCKIA.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"You've received a new application! 🏑","type":"heading","level":1},{"text":"You have a new application for one of your opportunities.","type":"paragraph"},{"type":"card","label":"Opportunity","title":"{{opportunity_title}}"},{"type":"user_card","label":"Applicant","name_var":"applicant_name","avatar_var":"applicant_avatar_url","detail_vars":["applicant_position","applicant_location"]},{"url":"{{cta_url}}","text":"View Profile","type":"button"},{"text":"Open their profile to learn more.","type":"footnote"}]$t$::jsonb,
     $t$New application for "{{opportunity_title}}"$t$,
     $t$You have a new application on Hockia

You have a new application for one of your opportunities.

OPPORTUNITY:
{{opportunity_title}}

APPLICANT:
{{applicant_name}}
Position: {{applicant_position}}
Location: {{applicant_location}}

View their profile:
{{cta_url}}

Open their profile to learn more.

---
You're receiving this because you're on Hockia.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"You have a new application","type":"heading","level":1},{"text":"You have a new application for one of your opportunities.","type":"paragraph"},{"type":"card","label":"Opportunity","title":"{{opportunity_title}}"},{"type":"user_card","label":"Applicant","name_var":"applicant_name","avatar_var":"applicant_avatar_url","detail_vars":["applicant_position","applicant_location"]},{"url":"{{cta_url}}","text":"View profile","type":"button"},{"text":"Open their profile to learn more.","type":"footnote"}]$t$::jsonb),
    -- friend_request
    ($t$friend_request$t$,
     $t${{requester_name}} sent you a friend request on HOCKIA$t$,
     $t$New Friend Request on HOCKIA

{{requester_name}} wants to connect with you on HOCKIA.
Location: {{requester_location}}

View their request:
{{cta_url}}

View their profile:
{{profile_url}}

---
You're receiving this because you're on HOCKIA.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"You have a new friend request! 🏑","type":"heading","level":1},{"text":"Someone wants to connect with you on HOCKIA.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["requester_location"]},{"url":"{{cta_url}}","text":"View Request","type":"button"},{"size":"small","text":"<a href=\"{{profile_url}}\">View their profile</a> to learn more.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb,
     $t${{requester_name}} sent you a friend request on Hockia$t$,
     $t$New friend request on Hockia

{{requester_name}} wants to connect with you on Hockia.
Location: {{requester_location}}

View their request:
{{cta_url}}

View their profile:
{{profile_url}}

---
You're receiving this because you're on Hockia.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"You have a new friend request","type":"heading","level":1},{"text":"Someone wants to connect with you on Hockia.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["requester_location"]},{"url":"{{cta_url}}","text":"View request","type":"button"},{"size":"small","text":"<a href=\"{{profile_url}}\">View their profile</a> to learn more.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb),
    -- message_digest
    ($t$message_digest$t$,
     $t$You have {{message_count}} new messages on HOCKIA$t$,
     $t${{heading}}

Hi {{first_name}},

{{conversations_text}}

{{cta_label}}:
{{cta_url}}

---
You're receiving this because you're on HOCKIA.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"{{heading}}","type":"heading","level":1},{"text":"Hi {{first_name}}, you have unread messages on HOCKIA.","type":"paragraph"},{"type":"conversation_list","conversations_var":"conversations"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"}]$t$::jsonb,
     $t$You have {{message_count}} new messages on Hockia$t$,
     $t${{heading}}

Hi {{first_name}},

{{conversations_text}}

{{cta_label}}:
{{cta_url}}

---
You're receiving this because you're on Hockia.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"{{heading}}","type":"heading","level":1},{"text":"Hi {{first_name}}, you have unread messages on Hockia.","type":"paragraph"},{"type":"conversation_list","conversations_var":"conversations"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"}]$t$::jsonb),
    -- onboarding_reminder
    ($t$onboarding_reminder$t$,
     $t$Complete your HOCKIA profile and start connecting$t$,
     $t${{heading}}

Hi {{first_name}},

{{body_text}}

{{cta_label}}:
{{cta_url}}

If you didn't create this account, you can safely ignore this email.

---
You're receiving this because you signed up for HOCKIA.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"Your profile is waiting for you 🏑","type":"heading","level":1},{"text":"Hi {{first_name}},","type":"paragraph"},{"text":"{{body_text}}","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"type":"divider"},{"text":"If you didn't create this account, you can safely ignore this email.","type":"footnote"}]$t$::jsonb,
     $t$Complete your Hockia profile and start connecting$t$,
     $t${{heading}}

Hi {{first_name}},

{{body_text}}

{{cta_label}}:
{{cta_url}}

If you didn't create this account, you can safely ignore this email.

---
You're receiving this because you signed up for Hockia.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"Your profile is waiting for you","type":"heading","level":1},{"text":"Hi {{first_name}},","type":"paragraph"},{"text":"{{body_text}}","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"type":"divider"},{"text":"If you didn't create this account, you can safely ignore this email.","type":"footnote"}]$t$::jsonb),
    -- outreach_introduction
    ($t$outreach_introduction$t$,
     $t$Finding players for next season$t$,
     $t$Players around the world are looking for clubs like yours

Hi{{contact_name_greeting}},

HOCKIA is a field hockey network where players search for clubs and apply to opportunities. Clubs in England and Spain are already using the platform to connect with talent from around the world.

Create your club profile and start posting opportunities to reach players and coaches actively looking for their next move.

Claim Your Club Profile:
{{cta_url}}

HOCKIA is free for clubs. No commitment required.

---
HOCKIA Hockey | inhockia.com$t$,
     $t$[{"text":"The new field hockey network","type":"heading","level":1},{"text":"Hi {{contact_name_greeting}},","type":"paragraph"},{"text":"We started HOCKIA with a simple idea:\n\nfield hockey needed its own platform.\n\nPlayers are already joining and building their profiles.\nNow we’re inviting clubs and coaches to join too.\n","type":"paragraph"},{"text":"We built HOCKIA — a space where clubs, players and coaches connect. A place where a club in {{country}} can find a goalkeeper in Argentina, or a young player in Spain can discover an opportunity they never knew existed. Clubs in England, Spain and Italy are already part of it. We'd love for {{club_name}} to be on HOCKIA too.","type":"paragraph"},{"url":"{{cta_url}}","text":"Create Your Club Profile","type":"button"},{"text":"HOCKIA is free for clubs. No commitment required.","type":"footnote"}]$t$::jsonb,
     $t$Finding players for next season$t$,
     $t$Players around the world are looking for clubs like yours

Hi{{contact_name_greeting}},

Hockia is a field hockey network where players search for clubs and apply to opportunities. Clubs in England and Spain are already using the platform to connect with talent from around the world.

Create your club profile and start posting opportunities to reach players and coaches actively looking for their next move.

Claim your club profile:
{{cta_url}}

Hockia is free for clubs. No commitment required.

---
Hockia | inhockia.com$t$,
     $t$[{"text":"The new field hockey network","type":"heading","level":1},{"text":"Hi {{contact_name_greeting}},","type":"paragraph"},{"text":"We started Hockia with a simple idea:\n\nfield hockey needed its own platform.\n\nPlayers are already joining and building their profiles.\nNow we’re inviting clubs and coaches to join too.\n","type":"paragraph"},{"text":"We built Hockia: a space where clubs, players and coaches connect. A place where a club in {{country}} can find a goalkeeper in Argentina, or a young player in Spain can discover an opportunity they never knew existed. Clubs in England, Spain and Italy are already part of it. We'd love for {{club_name}} to be on Hockia too.","type":"paragraph"},{"url":"{{cta_url}}","text":"Create your club profile","type":"button"},{"text":"Hockia is free for clubs. No commitment required.","type":"footnote"}]$t$::jsonb),
    -- outreach_social_proof
    ($t$outreach_social_proof$t$,
     $t${{club_name}} — clubs in {{country}} are already on HOCKIA$t$,
     $t$Clubs in {{country}} are on HOCKIA

Hi{{contact_name_greeting}},

Field hockey clubs across {{country}} are using HOCKIA to find players and coaches. Don't miss out on connecting with the next generation of talent.

Claiming your profile takes less than 2 minutes — and it's completely free.

Claim {{club_name}}'s Profile:
{{cta_url}}

This is our last email about this. We won't contact you again unless you sign up.

---
HOCKIA Hockey | inhockia.com$t$,
     $t$[{"text":"Clubs in {{country}} are on HOCKIA","type":"heading","level":1},{"text":"Hi{{contact_name_greeting}},","type":"paragraph"},{"text":"Field hockey clubs across {{country}} are using HOCKIA to find players and coaches. Don't miss out on connecting with the next generation of talent.","type":"paragraph"},{"text":"Claiming your profile takes less than 2 minutes — and it's completely free.","type":"paragraph"},{"url":"{{cta_url}}","text":"Claim {{club_name}}'s Profile","type":"button"},{"text":"This is our last email about this. We won't contact you again unless you sign up.","type":"footnote"}]$t$::jsonb,
     $t${{club_name}}: clubs in {{country}} are already on Hockia$t$,
     $t$Clubs in {{country}} are on Hockia

Hi{{contact_name_greeting}},

Field hockey clubs across {{country}} are using Hockia to find players and coaches. Don't miss out on connecting with the next generation of talent.

Claiming your profile takes less than 2 minutes, and it's completely free.

Claim {{club_name}}'s profile:
{{cta_url}}

This is our last email about this. We won't contact you again unless you sign up.

---
Hockia | inhockia.com$t$,
     $t$[{"text":"Clubs in {{country}} are on Hockia","type":"heading","level":1},{"text":"Hi{{contact_name_greeting}},","type":"paragraph"},{"text":"Field hockey clubs across {{country}} are using Hockia to find players and coaches. Don't miss out on connecting with the next generation of talent.","type":"paragraph"},{"text":"Claiming your profile takes less than 2 minutes, and it's completely free.","type":"paragraph"},{"url":"{{cta_url}}","text":"Claim {{club_name}}'s profile","type":"button"},{"text":"This is our last email about this. We won't contact you again unless you sign up.","type":"footnote"}]$t$::jsonb),
    -- outreach_value_proof
    ($t$outreach_value_proof$t$,
     $t$Find your next player or coach on HOCKIA$t$,
     $t$How clubs use HOCKIA

Hi{{contact_name_greeting}},

Clubs on HOCKIA post opportunities and receive applications from verified players and coaches — complete with highlight videos, references, and playing history.

What you can do:
- Post opportunities (player & coach vacancies)
- Browse talent (filter by position, nationality, experience)
- Get applications (with video, references & history)

Get Started — It's Free:
{{cta_url}}

Questions? Reply to this email — we read every message.

---
HOCKIA Hockey | inhockia.com$t$,
     $t$[{"text":"How clubs use HOCKIA","type":"heading","level":1},{"text":"Hi{{contact_name_greeting}},","type":"paragraph"},{"text":"Clubs on HOCKIA post opportunities and receive applications from verified players and coaches — complete with highlight videos, references, and playing history.","type":"paragraph"},{"type":"card","title":"What you can do","fields":[{"label":"Post opportunities","value":"Player & coach vacancies"},{"label":"Browse talent","value":"Filter by position, nationality, experience"},{"label":"Get applications","value":"With video, references & history"}]},{"url":"{{cta_url}}","text":"Get Started — It's Free","type":"button"},{"text":"Questions? Reply to this email — we read every message.","type":"footnote"}]$t$::jsonb,
     $t$Find your next player or coach on Hockia$t$,
     $t$How clubs use Hockia

Hi{{contact_name_greeting}},

Clubs on Hockia post opportunities and receive applications from players and coaches, complete with highlight videos, references, and playing history.

What you can do:
- Post opportunities (for players and coaches)
- Browse talent (filter by position, nationality, experience)
- Get applications (with video, references and history)

Get started, it's free:
{{cta_url}}

Questions? Reply to this email. We read every message.

---
Hockia | inhockia.com$t$,
     $t$[{"text":"How clubs use Hockia","type":"heading","level":1},{"text":"Hi{{contact_name_greeting}},","type":"paragraph"},{"text":"Clubs on Hockia post opportunities and receive applications from players and coaches, complete with highlight videos, references, and playing history.","type":"paragraph"},{"type":"card","title":"What you can do","fields":[{"label":"Post opportunities","value":"For players and coaches"},{"label":"Browse talent","value":"Filter by position, nationality, experience"},{"label":"Get applications","value":"With video, references and history"}]},{"url":"{{cta_url}}","text":"Get started, it's free","type":"button"},{"text":"Questions? Reply to this email. We read every message.","type":"footnote"}]$t$::jsonb),
    -- profile_view_digest
    ($t$profile_view_digest$t$,
     $t${{view_count}} viewed your HOCKIA profile$t$,
     $t$Hi {{first_name}},

{{view_count}} checked out your HOCKIA profile this week.
{{stats_line}}
{{trend_line}}

Log in to see who's been looking and what caught their attention.

{{cta_label}}:
{{cta_url}}

Tip: Keep your profile up to date so others can see everything you have to offer.

---
You're receiving this because you're on HOCKIA.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"Hi {{first_name}},","type":"paragraph"},{"text":"{{view_count}} checked out your HOCKIA profile this week.","type":"paragraph"},{"text":"{{stats_line}}","type":"paragraph","conditional":true},{"text":"{{trend_line}}","type":"paragraph","color":"#6b7280","conditional":true},{"text":"Log in to see who's been looking and what caught their attention.","type":"paragraph","color":"#6b7280"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"text":"Tip: Keep your profile up to date so others can see everything you have to offer.","type":"footnote"}]$t$::jsonb,
     $t${{view_count}} viewed your Hockia profile$t$,
     $t$Hi {{first_name}},

{{view_count}} checked out your Hockia profile this week.
{{stats_line}}
{{trend_line}}

Log in to see who's been looking and what caught their attention.

{{cta_label}}:
{{cta_url}}

Tip: Keep your profile up to date so others can see everything you have to offer.

---
You're receiving this because you're on Hockia.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"Hi {{first_name}},","type":"paragraph"},{"text":"{{view_count}} checked out your Hockia profile this week.","type":"paragraph"},{"text":"{{stats_line}}","type":"paragraph","conditional":true},{"text":"{{trend_line}}","type":"paragraph","conditional":true},{"text":"Log in to see who's been looking and what caught their attention.","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"text":"Tip: Keep your profile up to date so others can see everything you have to offer.","type":"footnote"}]$t$::jsonb),
    -- reference_request
    ($t$reference_request$t$,
     $t${{requester_name}} requested a reference from you on HOCKIA$t$,
     $t$Reference Request on HOCKIA

{{requester_name}} has asked you to write a reference for them.
Relationship: {{relationship_type}}
Location: {{requester_location}}

Message: "{{request_note}}"

View the request:
{{cta_url}}

View their profile:
{{profile_url}}

---
You're receiving this because you're on HOCKIA.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"Someone has requested a reference! 🏑","type":"heading","level":1},{"text":"A HOCKIA member has asked you to write a reference for them.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["relationship_type","requester_location"]},{"text":"{{request_note}}","type":"note","label":"Message from {{requester_name}}","conditional":true},{"url":"{{cta_url}}","text":"View Request","type":"button"},{"size":"small","text":"<a href=\"{{profile_url}}\">View their profile</a> to learn more.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb,
     $t${{requester_name}} requested a reference from you on Hockia$t$,
     $t$Reference request on Hockia

{{requester_name}} has asked you to write a reference for them.
Relationship: {{relationship_type}}
Location: {{requester_location}}

Message: "{{request_note}}"

View the request:
{{cta_url}}

View their profile:
{{profile_url}}

---
You're receiving this because you're on Hockia.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"Someone has requested a reference","type":"heading","level":1},{"text":"A Hockia member has asked you to write a reference for them.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["relationship_type","requester_location"]},{"text":"{{request_note}}","type":"note","label":"Message from {{requester_name}}","conditional":true},{"url":"{{cta_url}}","text":"View request","type":"button"},{"size":"small","text":"<a href=\"{{profile_url}}\">View their profile</a> to learn more.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb),
    -- vacancy_notification
    ($t$vacancy_notification$t$,
     $t${{club_name}} posted: {{vacancy_title}}$t$,
     $t$New Opportunity

Hi {{first_name}}, a club has published a new opportunity that may interest you.

{{vacancy_title}}
{{club_name}}
Position: {{position}}
Location: {{location}}

{{summary}}

View this opportunity:
{{cta_url}}

---
You're receiving this because you have a HOCKIA account.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"New Opportunity","type":"heading","level":1},{"text":"Hi {{first_name}}, a club has published a new opportunity that may interest you.","type":"paragraph"},{"type":"card","title":"{{vacancy_title}}","fields":[{"label":"Position","value":"{{position}}","conditional":true},{"label":"Location","value":"{{location}}","conditional":true}],"subtitle":"{{club_name}}"},{"text":"{{summary}}","type":"paragraph","conditional":true},{"url":"{{cta_url}}","text":"View Opportunity","type":"button"}]$t$::jsonb,
     $t${{club_name}} posted: {{vacancy_title}}$t$,
     $t$New opportunity

Hi {{first_name}}, a club has published a new opportunity that may interest you.

{{vacancy_title}}
{{club_name}}
Position: {{position}}
Location: {{location}}

{{summary}}

View this opportunity:
{{cta_url}}

---
You're receiving this because you have a Hockia account.
Manage preferences: {{settings_url}}$t$,
     $t$[{"text":"New opportunity","type":"heading","level":1},{"text":"Hi {{first_name}}, a club has published a new opportunity that may interest you.","type":"paragraph"},{"type":"card","title":"{{vacancy_title}}","fields":[{"label":"Position","value":"{{position}}","conditional":true},{"label":"Location","value":"{{location}}","conditional":true}],"subtitle":"{{club_name}}"},{"text":"{{summary}}","type":"paragraph","conditional":true},{"url":"{{cta_url}}","text":"View opportunity","type":"button"}]$t$::jsonb)
    ) AS x(template_key, old_subject, old_text, old_content, new_subject, new_text, new_content)
  LOOP
    SELECT t.id, t.variables INTO v_id, v_vars
    FROM public.email_templates t
    WHERE t.template_key = r.template_key
      AND t.subject_template = r.old_subject
      AND t.text_template IS NOT DISTINCT FROM r.old_text
      AND t.content_json = r.old_content;

    IF v_id IS NULL THEN
      RAISE NOTICE 'email_templates rebrand: % skipped (missing or edited since 2026-10-30)', r.template_key;
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_next
    FROM public.email_template_versions v
    WHERE v.template_id = v_id;

    INSERT INTO public.email_template_versions (
      template_id, version_number, subject_template, content_json,
      text_template, variables, change_note, created_by
    ) VALUES (
      v_id, v_next, r.new_subject, r.new_content,
      r.new_text, v_vars, $t$Rebrand 2026-10-25: Hockia name, sentence case, opportunity wording, no em dashes$t$, NULL
    );

    UPDATE public.email_templates
    SET subject_template = r.new_subject,
        content_json     = r.new_content,
        text_template    = r.new_text,
        current_version  = v_next,
        updated_at       = now()
    WHERE id = v_id;
  END LOOP;
END
$mig$;
