-- Email templates: polish pass on the stored rows (2026-11-18).
--
-- Source: engineering-lead audit of every member email in both languages,
-- after reading real Spanish emails sent from staging. Fixes, by row:
--   message_digest            subject no longer reads "1 new messages"; the
--                             text version gets the sentence the HTML has.
--   message_digest__es        the text version gets the sentence the HTML has.
--   onboarding_reminder(+es)  the HTML heading follows the reminder number,
--                             like the text version already does.
--   vacancy_notification(+es) no longer says "a club" (coaches publish too).
--   friend_request(+es)       the HTML names the requester, like the text.
--   every English row         one footer wording in the text version, the
--                             same as the HTML footer.
--
-- How: text fragments are replaced in place, so a row edited in the admin
-- portal keeps its other edits. A fragment that is no longer there is simply
-- not replaced. A row with nothing to replace is skipped with a NOTICE.
-- Versioning follows the admin portal (same as 20261117120000): each changed
-- row gets a new email_template_versions row and current_version points at it.
--
-- Not breaking: the edge functions read whatever row is active, and every
-- variable used here ({{heading}}, {{requester_name}}, {{message_count}}) is
-- already sent by the deployed functions. No grant or RLS changes.
--
-- Rollback: supabase/rollbacks/20261118120000_email_templates_polish.down.sql

DO $mig$
DECLARE
  t record;
  f record;
  v_subject text;
  v_text text;
  v_content text;
  v_next int;
BEGIN
  FOR t IN
    SELECT id, template_key, subject_template, text_template, content_json, variables
    FROM public.email_templates
    WHERE template_key NOT LIKE 'outreach\_%'
  LOOP
    v_subject := t.subject_template;
    v_text := t.text_template;
    v_content := t.content_json::text;

    FOR f IN
      SELECT * FROM (VALUES
        -- message digest
        ($k$message_digest$k$, $o$You have {{message_count}} new messages on Hockia$o$, $n$New messages on Hockia ({{message_count}})$n$),
        ($k$message_digest$k$, $o$Hi {{first_name}},

{{conversations_text}}$o$, $n$Hi {{first_name}}, you have unread messages on Hockia.

{{conversations_text}}$n$),
        ($k$message_digest__es$k$, $o$Hola, {{first_name}}:

{{conversations_text}}$o$, $n$Hola, {{first_name}}. Tienes mensajes sin leer en Hockia.

{{conversations_text}}$n$),
        -- onboarding reminder: the heading of reminder 1 was fixed in the HTML
        ($k$onboarding_reminder$k$, $o$"text": "Your profile is waiting for you", "type": "heading"$o$, $n$"text": "{{heading}}", "type": "heading"$n$),
        ($k$onboarding_reminder__es$k$, $o$"text": "Tu perfil te espera", "type": "heading"$o$, $n$"text": "{{heading}}", "type": "heading"$n$),
        -- new opportunity: coaches publish too
        ($k$vacancy_notification$k$, $o$a club has published a new opportunity that may interest you.$o$, $n$a new opportunity that may interest you was published on Hockia.$n$),
        ($k$vacancy_notification__es$k$, $o$Un club publicó una nueva oportunidad que puede interesarte.$o$, $n$Se publicó una nueva oportunidad que puede interesarte.$n$),
        -- friend request: name the requester in the HTML too
        ($k$friend_request$k$, $o$Someone wants to connect with you on Hockia.$o$, $n${{requester_name}} wants to connect with you on Hockia.$n$),
        ($k$friend_request__es$k$, $o$Alguien quiere agregarte como conexión en Hockia.$o$, $n${{requester_name}} quiere agregarte como conexión en Hockia.$n$),
        -- English text footer: the HTML footer's wording ('*' = every row)
        ($k$*$k$, $o$You're receiving this because you're on Hockia.$o$, $n$You're receiving this because you have a Hockia account.$n$),
        ($k$*$k$, $o$Manage preferences: {{settings_url}}$o$, $n$Notification settings: {{settings_url}}$n$)
      ) AS x(template_key, old_fragment, new_fragment)
      WHERE x.template_key = t.template_key OR x.template_key = '*'
    LOOP
      v_subject := replace(v_subject, f.old_fragment, f.new_fragment);
      v_text := replace(v_text, f.old_fragment, f.new_fragment);
      v_content := replace(v_content, f.old_fragment, f.new_fragment);
    END LOOP;

    IF v_subject = t.subject_template
       AND v_text IS NOT DISTINCT FROM t.text_template
       AND v_content::jsonb = t.content_json THEN
      RAISE NOTICE 'email_templates polish: % unchanged', t.template_key;
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_next
    FROM public.email_template_versions v
    WHERE v.template_id = t.id;

    INSERT INTO public.email_template_versions (
      template_id, version_number, subject_template, content_json,
      text_template, variables, change_note, created_by
    ) VALUES (
      t.id, v_next, v_subject, v_content::jsonb,
      v_text, t.variables, $c$Email polish 2026-11-18: plural subject, text matches HTML, role-neutral wording, one footer$c$, NULL
    );

    UPDATE public.email_templates
    SET subject_template = v_subject,
        content_json     = v_content::jsonb,
        text_template    = v_text,
        current_version  = v_next,
        updated_at       = now()
    WHERE id = t.id;
  END LOOP;
END
$mig$;
