-- Rollback for 20261117120000_email_templates_spanish_tu.sql: puts the
-- Spanish subjects, text and content inserted by 20261116120000 back on the
-- 6 '__es' rows and removes the version rows that migration added
-- (matched by its change note). current_version returns to the version that
-- was current before. A row edited after the migration (its content no longer
-- equals the new copy) is left alone with a NOTICE. English rows untouched.

DO $down$
DECLARE
  r record;
  v_id uuid;
  v_ver int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    -- application_notification__es
    ($t$application_notification__es$t$,
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
     $t$[{"text":"Hay una nueva postulación","type":"heading","level":1},{"text":"Llegó una nueva postulación a una de tus oportunidades.","type":"paragraph"},{"type":"card","label":"Oportunidad","title":"{{opportunity_title}}"},{"type":"user_card","label":"Postulante","name_var":"applicant_name","avatar_var":"applicant_avatar_url","detail_vars":["applicant_position","applicant_location"]},{"url":"{{cta_url}}","text":"Ver perfil","type":"button"},{"text":"En el perfil hay más información.","type":"footnote"}]$t$::jsonb,
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

Puedes ver más información en su perfil.

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Hay una nueva postulación","type":"heading","level":1},{"text":"Llegó una nueva postulación a una de tus oportunidades.","type":"paragraph"},{"type":"card","label":"Oportunidad","title":"{{opportunity_title}}"},{"type":"user_card","label":"Postulante","name_var":"applicant_name","avatar_var":"applicant_avatar_url","detail_vars":["applicant_position","applicant_location"]},{"url":"{{cta_url}}","text":"Ver perfil","type":"button"},{"text":"Puedes ver más información en su perfil.","type":"footnote"}]$t$::jsonb),
    -- friend_request__es
    ($t$friend_request__es$t$,
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
     $t$[{"text":"Nueva solicitud de amistad","type":"heading","level":1},{"text":"Alguien quiere sumarte a sus amistades en Hockia.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["requester_location"]},{"url":"{{cta_url}}","text":"Ver solicitud","type":"button"},{"size":"small","text":"En <a href=\"{{profile_url}}\">su perfil</a> hay más información.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb,
     $t${{requester_name}} te envió una solicitud de conexión en Hockia$t$,
     $t$Nueva solicitud de conexión en Hockia

{{requester_name}} quiere agregarte como conexión en Hockia.
Ubicación: {{requester_location}}

Ver solicitud:
{{cta_url}}

Ver perfil:
{{profile_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Nueva solicitud de conexión","type":"heading","level":1},{"text":"Alguien quiere agregarte como conexión en Hockia.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["requester_location"]},{"url":"{{cta_url}}","text":"Ver solicitud","type":"button"},{"size":"small","text":"Puedes ver más información en <a href=\"{{profile_url}}\">su perfil</a>.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb),
    -- message_digest__es
    ($t$message_digest__es$t$,
     $t$Mensajes nuevos en Hockia ({{message_count}})$t$,
     $t${{heading}}

Hola, {{first_name}}:

{{conversations_text}}

{{cta_label}}:
{{cta_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"{{heading}}","type":"heading","level":1},{"text":"Hola, {{first_name}}. Hay mensajes sin leer en Hockia.","type":"paragraph"},{"type":"conversation_list","conversations_var":"conversations"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"}]$t$::jsonb,
     $t$Mensajes nuevos en Hockia ({{message_count}})$t$,
     $t${{heading}}

Hola, {{first_name}}:

{{conversations_text}}

{{cta_label}}:
{{cta_url}}

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"{{heading}}","type":"heading","level":1},{"text":"Hola, {{first_name}}. Tienes mensajes sin leer en Hockia.","type":"paragraph"},{"type":"conversation_list","conversations_var":"conversations"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"}]$t$::jsonb),
    -- onboarding_reminder__es
    ($t$onboarding_reminder__es$t$,
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
     $t$[{"text":"Tu perfil te espera","type":"heading","level":1},{"text":"Hola, {{first_name}}:","type":"paragraph"},{"text":"{{body_text}}","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"type":"divider"},{"text":"Si esta cuenta no es tuya, este email se puede ignorar.","type":"footnote"}]$t$::jsonb,
     $t$Falta poco para completar tu perfil de Hockia$t$,
     $t${{heading}}

Hola, {{first_name}}:

{{body_text}}

{{cta_label}}:
{{cta_url}}

Si esta cuenta no es tuya, puedes ignorar este email.

---
Este email te llega porque se creó una cuenta de Hockia con esta dirección.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Tu perfil te espera","type":"heading","level":1},{"text":"Hola, {{first_name}}:","type":"paragraph"},{"text":"{{body_text}}","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"type":"divider"},{"text":"Si esta cuenta no es tuya, puedes ignorar este email.","type":"footnote"}]$t$::jsonb),
    -- profile_view_digest__es
    ($t$profile_view_digest__es$t$,
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
     $t$[{"text":"Hola, {{first_name}}:","type":"paragraph"},{"text":"Esta semana, tu perfil de Hockia tuvo visitas de {{view_count}}.","type":"paragraph"},{"text":"{{stats_line}}","type":"paragraph","conditional":true},{"text":"{{trend_line}}","type":"paragraph","conditional":true},{"text":"Al iniciar sesión se puede ver quién pasó por tu perfil y qué le llamó la atención.","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"text":"Consejo: un perfil al día muestra todo lo que hay para ofrecer.","type":"footnote"}]$t$::jsonb,
     $t$Tu perfil de Hockia recibió la visita de {{view_count}}$t$,
     $t$Hola, {{first_name}}:

Esta semana, tu perfil de Hockia recibió la visita de {{view_count}}.
{{stats_line}}
{{trend_line}}

Inicia sesión para ver quién pasó por tu perfil y qué le llamó la atención.

{{cta_label}}:
{{cta_url}}

Consejo: mantén tu perfil al día para mostrar todo lo que tienes para ofrecer.

---
Este email te llega por tu cuenta en Hockia.
Ajustes de notificaciones: {{settings_url}}$t$,
     $t$[{"text":"Hola, {{first_name}}:","type":"paragraph"},{"text":"Esta semana, tu perfil de Hockia recibió la visita de {{view_count}}.","type":"paragraph"},{"text":"{{stats_line}}","type":"paragraph","conditional":true},{"text":"{{trend_line}}","type":"paragraph","conditional":true},{"text":"Inicia sesión para ver quién pasó por tu perfil y qué le llamó la atención.","type":"paragraph"},{"url":"{{cta_url}}","text":"{{cta_label}}","type":"button"},{"text":"Consejo: mantén tu perfil al día para mostrar todo lo que tienes para ofrecer.","type":"footnote"}]$t$::jsonb),
    -- reference_request__es
    ($t$reference_request__es$t$,
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
     $t$[{"text":"Nueva solicitud de referencia","type":"heading","level":1},{"text":"Alguien de Hockia pidió una referencia tuya.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["relationship_type","requester_location"]},{"text":"{{request_note}}","type":"note","label":"Mensaje de {{requester_name}}","conditional":true},{"url":"{{cta_url}}","text":"Ver solicitud","type":"button"},{"size":"small","text":"En <a href=\"{{profile_url}}\">su perfil</a> hay más información.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb,
     $t${{requester_name}} te pidió una referencia en Hockia$t$,
     $t$Solicitud de referencia en Hockia

{{requester_name}} te pidió una referencia.
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
     $t$[{"text":"Nueva solicitud de referencia","type":"heading","level":1},{"text":"Alguien de Hockia te pidió una referencia.","type":"paragraph"},{"type":"user_card","name_var":"requester_name","avatar_var":"requester_avatar_url","detail_vars":["relationship_type","requester_location"]},{"text":"{{request_note}}","type":"note","label":"Mensaje de {{requester_name}}","conditional":true},{"url":"{{cta_url}}","text":"Ver solicitud","type":"button"},{"size":"small","text":"Puedes ver más información en <a href=\"{{profile_url}}\">su perfil</a>.","type":"paragraph","align":"center","color":"muted","is_html":true}]$t$::jsonb)
    ) AS x(template_key, old_subject, old_text, old_content, new_subject, new_text, new_content)
  LOOP
    v_id := NULL;
    SELECT t.id, t.current_version INTO v_id, v_ver
    FROM public.email_templates t
    JOIN public.email_template_versions v
      ON v.template_id = t.id AND v.version_number = t.current_version
     AND v.change_note = $t$Spanish quality pass 2026-11-16: tú, conexiones, reference request wording$t$
    WHERE t.template_key = r.template_key
      AND t.subject_template = r.new_subject
      AND t.text_template IS NOT DISTINCT FROM r.new_text
      AND t.content_json = r.new_content;

    IF v_id IS NULL THEN
      RAISE NOTICE 'email_templates spanish tu rollback: % skipped (not on the 20261117120000 version)', r.template_key;
      CONTINUE;
    END IF;

    UPDATE public.email_templates
    SET subject_template = r.old_subject,
        content_json     = r.old_content,
        text_template    = r.old_text,
        current_version  = v_ver - 1,
        updated_at       = now()
    WHERE id = v_id;

    DELETE FROM public.email_template_versions
    WHERE template_id = v_id AND version_number = v_ver
      AND change_note = $t$Spanish quality pass 2026-11-16: tú, conexiones, reference request wording$t$;
  END LOOP;
END
$down$;
