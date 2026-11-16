-- Email templates: Spanish rows for the member emails (Spanish localization;
-- founder decision 2026-11-15: emails and pushes follow the member's interface
-- language; plan in docs/engineering/spanish-localization-plan.md).
--
-- What it does: adds one NEW row to public.email_templates for each of the 7
-- member templates, keyed '<key>__es':
--   application_notification, friend_request, message_digest,
--   onboarding_reminder, profile_view_digest, reference_request,
--   vacancy_notification.
-- Each Spanish row copies the English row's category, description and
-- variables, keeps the same block structure and variable names, is named
-- '<English name> (Spanish)', is active, and starts at version 1 with a
-- matching email_template_versions row (the admin portal's history, same
-- pattern as 202603140201_seed_profile_view_email_template.sql).
-- Translated from the English copy written by 20261030120000 (production
-- content on 2026-11-16). Spanish style: client/src/locales/glossary.md.
--
-- Who gets them: only members whose profiles.ui_language is 'es'
-- (20261116100000). The edge functions (_shared/email-renderer.ts
-- renderTemplate) look for '<key>__es' first and fall back to the English row
-- when the Spanish one is missing or inactive, so this migration can be
-- applied before or after the code ships. Nothing existing changes: the
-- English rows, outreach templates and campaigns are untouched. Text filled
-- in by code (headings, button labels, counts) is translated in the functions.
--
-- Access: email_templates and email_template_versions keep their admin-only
-- RLS; edge functions read them with the service role. No grant changes.
--
-- Idempotent: ON CONFLICT (template_key) DO NOTHING; a key whose English row
-- is missing is skipped with a NOTICE. Not breaking.
--
-- Rollback: supabase/rollbacks/20261116120000_email_templates_spanish.down.sql

DO $mig$
DECLARE
  r record;
  v_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    -- application_notification (to the club or coach who posted the opportunity)
    ($t$application_notification$t$,
     $t$Nueva postulación para "{{opportunity_title}}"$t$,
     $t$Hay una nueva postulación en Hockia

Llegó una nueva postulación a una de tus oportunidades.

OPORTUNIDAD:
{{opportunity_title}}

POSTULANTE:
{{applicant_name}}
Posición: {{applicant_position}}
Ubicación: {{applicant_location}}

Ver perfil:
{{cta_url}}

En el perfil hay más información.

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Hay una nueva postulación","type":"heading","level":1},{"text":"Llegó una nueva postulación a una de tus oportunidades.","type":"paragraph"},{"type":"card","label":"Oportunidad","title":"{{opportunity_title}}"},{"type":"user_card","label":"Postulante","name_var":"applicant_name","avatar_var":"applicant_avatar_url","detail_vars":["applicant_position","applicant_location"]},{"url":"{{cta_url}}","text":"Ver perfil","type":"button"},{"text":"En el perfil hay más información.","type":"footnote"}]$t$::jsonb),
    -- friend_request
    ($t$friend_request$t$,
     $t${{requester_name}} te envió una solicitud de amistad en Hockia$t$,
     $t$Nueva solicitud de amistad en Hockia

{{requester_name}} quiere sumarte a sus amistades en Hockia.
Ubicación: {{requester_location}}

Ver solicitud:
{{cta_url}}

Ver perfil:
{{profile_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Nueva solicitud de amistad","type":"heading","level":1},{"text":"Alguien quiere sumarte a sus amistades en Hockia.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["requester_location"]},{"url":"{{cta_url}}","text":"Ver solicitud","type":"button"},{"size":"small","text":"En <a href=\"{{profile_url}}\">su perfil</a> hay más información.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb),
    -- message_digest
    ($t$message_digest$t$,
     $t$Mensajes nuevos en Hockia ({{message_count}})$t$,
     $t${{heading}}

Hola, {{first_name}}:

{{conversations_text}}

{{cta_label}}:
{{cta_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"{{heading}}","type":"heading","level":1},{"text":"Hola, {{first_name}}. Hay mensajes sin leer en Hockia.","type":"paragraph"},{"type":"conversation_list","conversations_var":"conversations"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"}]$t$::jsonb),
    -- onboarding_reminder (the subject is set per reminder in code)
    ($t$onboarding_reminder$t$,
     $t$Falta poco para completar tu perfil de Hockia$t$,
     $t${{heading}}

Hola, {{first_name}}:

{{body_text}}

{{cta_label}}:
{{cta_url}}

Si esta cuenta no es tuya, este email se puede ignorar.

---
Este email te llega porque se creó una cuenta de Hockia con esta dirección.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Tu perfil te espera","type":"heading","level":1},{"text":"Hola, {{first_name}}:","type":"paragraph"},{"text":"{{body_text}}","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"type":"divider"},{"text":"Si esta cuenta no es tuya, este email se puede ignorar.","type":"footnote"}]$t$::jsonb),
    -- profile_view_digest ({{view_count}} is "1 persona" / "3 personas")
    ($t$profile_view_digest$t$,
     $t$Tu perfil de Hockia tuvo visitas de {{view_count}}$t$,
     $t$Hola, {{first_name}}:

Esta semana, tu perfil de Hockia tuvo visitas de {{view_count}}.
{{stats_line}}
{{trend_line}}

Al iniciar sesión se puede ver quién pasó por tu perfil y qué le llamó la atención.

{{cta_label}}:
{{cta_url}}

Consejo: un perfil al día muestra todo lo que hay para ofrecer.

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Hola, {{first_name}}:","type":"paragraph"},{"text":"Esta semana, tu perfil de Hockia tuvo visitas de {{view_count}}.","type":"paragraph"},{"text":"{{stats_line}}","type":"paragraph","conditional":true},{"text":"{{trend_line}}","type":"paragraph","conditional":true},{"text":"Al iniciar sesión se puede ver quién pasó por tu perfil y qué le llamó la atención.","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"text":"Consejo: un perfil al día muestra todo lo que hay para ofrecer.","type":"footnote"}]$t$::jsonb),
    -- reference_request
    ($t$reference_request$t$,
     $t${{requester_name}} te pidió una referencia en Hockia$t$,
     $t$Solicitud de referencia en Hockia

{{requester_name}} pidió una referencia tuya.
Relación: {{relationship_type}}
Ubicación: {{requester_location}}

Mensaje: "{{request_note}}"

Ver solicitud:
{{cta_url}}

Ver perfil:
{{profile_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Nueva solicitud de referencia","type":"heading","level":1},{"text":"Alguien de Hockia pidió una referencia tuya.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["relationship_type","requester_location"]},{"text":"{{request_note}}","type":"note","label":"Mensaje de {{requester_name}}","conditional":true},{"url":"{{cta_url}}","text":"Ver solicitud","type":"button"},{"size":"small","text":"En <a href=\"{{profile_url}}\">su perfil</a> hay más información.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb),
    -- vacancy_notification
    ($t$vacancy_notification$t$,
     $t${{club_name}} publicó: {{vacancy_title}}$t$,
     $t$Nueva oportunidad

Hola, {{first_name}}. Un club publicó una nueva oportunidad que puede interesarte.

{{vacancy_title}}
{{club_name}}
Posición: {{position}}
Ubicación: {{location}}

{{summary}}

Ver oportunidad:
{{cta_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Nueva oportunidad","type":"heading","level":1},{"text":"Hola, {{first_name}}. Un club publicó una nueva oportunidad que puede interesarte.","type":"paragraph"},{"type":"card","title":"{{vacancy_title}}","fields":[{"label":"Posición","value":"{{position}}","conditional":true},{"label":"Ubicación","value":"{{location}}","conditional":true}],"subtitle":"{{club_name}}"},{"text":"{{summary}}","type":"paragraph","conditional":true},{"url":"{{cta_url}}","text":"Ver oportunidad","type":"button"}]$t$::jsonb)
    ) AS x(template_key, subject_template, text_template, content_json)
  LOOP
    v_id := NULL;

    INSERT INTO public.email_templates (
      template_key, name, description, category, subject_template,
      content_json, text_template, variables, is_active, current_version
    )
    SELECT
      r.template_key || '__es',
      t.name || ' (Spanish)',
      t.description,
      t.category,
      r.subject_template,
      r.content_json,
      r.text_template,
      t.variables,
      true,
      1
    FROM public.email_templates t
    WHERE t.template_key = r.template_key
    ON CONFLICT (template_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE NOTICE 'email_templates spanish: %__es skipped (English row missing or Spanish row already present)', r.template_key;
      CONTINUE;
    END IF;

    INSERT INTO public.email_template_versions (
      template_id, version_number, subject_template, content_json,
      text_template, variables, change_note, created_by
    )
    SELECT v_id, 1, t.subject_template, t.content_json, t.text_template, t.variables,
           $t$Spanish version (localization 2026-11-16), translated from the 2026-10-30 English copy$t$, NULL
    FROM public.email_templates t
    WHERE t.id = v_id
    ON CONFLICT (template_id, version_number) DO NOTHING;
  END LOOP;
END
$mig$;
