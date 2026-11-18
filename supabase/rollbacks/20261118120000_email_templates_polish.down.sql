-- Rollback for 20261118120000_email_templates_polish.sql: every row whose
-- current version is the one that migration wrote (matched by its change
-- note) goes back to the fragments it had, and that version row is removed.
-- current_version returns to the highest remaining version. A row edited
-- after the migration (a newer version exists) is left alone with a NOTICE.

DO $down$
DECLARE
  t record;
  f record;
  v_subject text;
  v_text text;
  v_content text;
  v_prev int;
BEGIN
  FOR t IN
    SELECT e.id, e.template_key, e.subject_template, e.text_template, e.content_json, e.current_version
    FROM public.email_templates e
    JOIN public.email_template_versions v
      ON v.template_id = e.id
     AND v.change_note = $c$Email polish 2026-11-18: plural subject, text matches HTML, role-neutral wording, one footer$c$
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.email_template_versions v
      WHERE v.template_id = t.id
        AND v.version_number > (
          SELECT p.version_number FROM public.email_template_versions p
          WHERE p.template_id = t.id
            AND p.change_note = $c$Email polish 2026-11-18: plural subject, text matches HTML, role-neutral wording, one footer$c$
        )
    ) THEN
      RAISE NOTICE 'email_templates polish rollback: % skipped (edited since)', t.template_key;
      CONTINUE;
    END IF;

    v_subject := t.subject_template;
    v_text := t.text_template;
    v_content := t.content_json::text;

    FOR f IN
      SELECT * FROM (VALUES
        ($k$message_digest$k$, $o$You have {{message_count}} new messages on Hockia$o$, $n$New messages on Hockia ({{message_count}})$n$),
        ($k$message_digest$k$, $o$Hi {{first_name}},

{{conversations_text}}$o$, $n$Hi {{first_name}}, you have unread messages on Hockia.

{{conversations_text}}$n$),
        ($k$message_digest__es$k$, $o$Hola, {{first_name}}:

{{conversations_text}}$o$, $n$Hola, {{first_name}}. Tienes mensajes sin leer en Hockia.

{{conversations_text}}$n$),
        ($k$onboarding_reminder$k$, $o$"text": "Your profile is waiting for you", "type": "heading"$o$, $n$"text": "{{heading}}", "type": "heading"$n$),
        ($k$onboarding_reminder__es$k$, $o$"text": "Tu perfil te espera", "type": "heading"$o$, $n$"text": "{{heading}}", "type": "heading"$n$),
        ($k$vacancy_notification$k$, $o$a club has published a new opportunity that may interest you.$o$, $n$a new opportunity that may interest you was published on Hockia.$n$),
        ($k$vacancy_notification__es$k$, $o$Un club publicó una nueva oportunidad que puede interesarte.$o$, $n$Se publicó una nueva oportunidad que puede interesarte.$n$),
        ($k$friend_request$k$, $o$Someone wants to connect with you on Hockia.$o$, $n${{requester_name}} wants to connect with you on Hockia.$n$),
        ($k$friend_request__es$k$, $o$Alguien quiere agregarte como conexión en Hockia.$o$, $n${{requester_name}} quiere agregarte como conexión en Hockia.$n$),
        ($k$*$k$, $o$You're receiving this because you're on Hockia.$o$, $n$You're receiving this because you have a Hockia account.$n$),
        ($k$*$k$, $o$Manage preferences: {{settings_url}}$o$, $n$Notification settings: {{settings_url}}$n$)
      ) AS x(template_key, old_fragment, new_fragment)
      WHERE x.template_key = t.template_key OR x.template_key = '*'
    LOOP
      v_subject := replace(v_subject, f.new_fragment, f.old_fragment);
      -- vacancy_notification had the "have a Hockia account" footer before; keep it.
      IF NOT (t.template_key = 'vacancy_notification' AND f.old_fragment LIKE 'You''re receiving%') THEN
        v_text := replace(v_text, f.new_fragment, f.old_fragment);
      END IF;
      v_content := replace(v_content, f.new_fragment, f.old_fragment);
    END LOOP;

    DELETE FROM public.email_template_versions v
    WHERE v.template_id = t.id
      AND v.change_note = $c$Email polish 2026-11-18: plural subject, text matches HTML, role-neutral wording, one footer$c$;

    SELECT MAX(v.version_number) INTO v_prev
    FROM public.email_template_versions v
    WHERE v.template_id = t.id;

    UPDATE public.email_templates
    SET subject_template = v_subject,
        content_json     = v_content::jsonb,
        text_template    = v_text,
        current_version  = COALESCE(v_prev, current_version),
        updated_at       = now()
    WHERE id = t.id;
  END LOOP;
END
$down$;
