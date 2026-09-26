-- Track C · step 3 — server functions for invites, offers and signings (D3/D4).
-- Rollback: supabase/rollbacks/20260928110000_recruiting_invites_offers_schema.down.sql
--
-- Every status change on opportunity_invites / opportunity_offers and every move onto
-- the offer / signing road of an application happens here. All user-facing functions:
--   * SECURITY DEFINER, SET search_path = public, EXECUTE for authenticated only;
--   * check the caller: publisher side = public.is_recruiter(uid) AND owns the role
--     (opportunities.club_id); player side = the applicant / invitee;
--   * lock the row they change (FOR UPDATE) so double taps can't race;
--   * write one card message in the club ↔ player conversation (metadata = the card,
--     content = a readable fallback of at most 1000 characters for app versions that
--     don't render cards — Android 1.17 / iOS 1.3.16) and one recruiting_update
--     notification for the other side. Cards and notifications never carry offer terms.
--   * raise with a readable message on refusal (ERRCODE 42501 = not allowed,
--     P0001 = not possible in the current state), return jsonb on success.
--
-- Founder rulings 2026-09-26 implemented here:
--   invites   max 20 per publisher per rolling 24 h, 5 in the account's first 7 days;
--             one open invite per player per club; never to under-18s (by DOB; unknown
--             DOB is refused too) or players not open to play; expire with the role or
--             after 14 days.
--   offers    club may withdraw before the answer (back to shortlisted, player told);
--             each edit = new version, previous superseded; terms private to the two.
--   player    may withdraw any time until confirming a signing, never after.
--   signing   club may undo "Mark as signed" while waiting; auto-expires after 14 days.
--   filled    every still-waiting application (incl. unreviewed) gets status filled and
--             the kind note, whichever way the role is closed as filled.


-- ═══ Helpers (no client access) ════════════════════════════════════════════════

-- Find or create the club ↔ player conversation. New threads get p_origin.
CREATE OR REPLACE FUNCTION public._recruiting_conversation(p_a uuid, p_b uuid, p_origin text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT c.id INTO v_id
    FROM public.conversations c
   WHERE least(c.participant_one_id, c.participant_two_id) = least(p_a, p_b)
     AND greatest(c.participant_one_id, c.participant_two_id) = greatest(p_a, p_b);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations (participant_one_id, participant_two_id, origin)
  VALUES (p_a, p_b, p_origin)
  ON CONFLICT (least(participant_one_id, participant_two_id), greatest(participant_one_id, participant_two_id))
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id
      FROM public.conversations c
     WHERE least(c.participant_one_id, c.participant_two_id) = least(p_a, p_b)
       AND greatest(c.participant_one_id, c.participant_two_id) = greatest(p_a, p_b);
  END IF;
  RETURN v_id;
END;
$$;

-- Insert a card message. p_soft = true: if the thread is closed (block, hidden
-- account) the step still happens and simply has no card (returns NULL).
CREATE OR REPLACE FUNCTION public._post_recruiting_card(
  p_conversation_id uuid, p_sender uuid, p_content text, p_card jsonb, p_soft boolean DEFAULT true)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_id, content, metadata)
    VALUES (p_conversation_id, p_sender, left(p_content, 1000), p_card)
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    IF NOT p_soft THEN
      RAISE;
    END IF;
    v_id := NULL;
  END;
  RETURN v_id;
END;
$$;

-- One recruiting_update notification. title/summary make it readable on clients that
-- don't know the kind yet (their default renderer shows metadata.summary and routes
-- to target_url).
CREATE OR REPLACE FUNCTION public._recruiting_notify(
  p_recipient uuid, p_actor uuid, p_source uuid, p_event text,
  p_title text, p_summary text, p_extra jsonb, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
    p_recipient,
    p_actor,
    'recruiting_update'::public.profile_notification_kind,
    p_source,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
      'event', p_event,
      'title', left(p_title, 200),
      'summary', left(p_summary, 300),
      'target_url', p_url),
    p_url);
END;
$$;

-- Move an application to a new status as the server. Clears the club's reason code and
-- any previous system marker so the history row describes THIS change.
CREATE OR REPLACE FUNCTION public._set_application_status(p_application_id uuid, p_status text, p_via text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.opportunity_applications a
     SET status   = p_status::public.application_status,
         metadata = (coalesce(a.metadata, '{}'::jsonb) - 'status_reason' - 'changed_via')
                    || CASE WHEN p_via IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('changed_via', p_via) END
   WHERE a.id = p_application_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._recruiting_date_label(p_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT to_char(p_date, 'FMDD Mon YYYY');
$$;

-- Status an application returns to when an offer / signing step is undone.
CREATE OR REPLACE FUNCTION public._application_resting_status(p_application_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.opportunity_offers f
     WHERE f.application_id = p_application_id AND f.status = 'accepted'
  ) THEN 'accepted' ELSE 'shortlisted' END;
$$;

REVOKE ALL ON FUNCTION public._recruiting_conversation(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._post_recruiting_card(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._recruiting_notify(uuid, uuid, uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._set_application_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._recruiting_date_label(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._application_resting_status(uuid) FROM PUBLIC, anon, authenticated;


-- ═══ Filled roles and closed roles (trigger on opportunities) ══════════════════
-- Runs for every writer (club UI, fill_role, confirm_signing, admin), so the rule
-- "every still-waiting application gets the kind note" can't be skipped.

CREATE OR REPLACE FUNCTION public._fill_waiting_applications(p_opportunity_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp   record;
  v_app   record;
  v_count integer := 0;
BEGIN
  SELECT o.id, o.club_id, o.title, o.position, p.full_name AS club_name
    INTO v_opp
    FROM public.opportunities o
    LEFT JOIN public.profiles p ON p.id = o.club_id
   WHERE o.id = p_opportunity_id;

  FOR v_app IN
    SELECT a.id, a.applicant_id
      FROM public.opportunity_applications a
     WHERE a.opportunity_id = p_opportunity_id
       AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted')
     FOR UPDATE
  LOOP
    UPDATE public.opportunity_offers
       SET status = 'cancelled', responded_at = timezone('utc', now())
     WHERE application_id = v_app.id AND status = 'live';

    PERFORM public._set_application_status(v_app.id, 'filled', 'role_filled');

    -- Same kind the applicant already gets for shortlisted / rejected, so every app
    -- version renders it ("<club> updated your application").
    PERFORM public.enqueue_notification(
      v_app.applicant_id,
      v_opp.club_id,
      'vacancy_application_status'::public.profile_notification_kind,
      v_app.id,
      jsonb_build_object(
        'application_id', v_app.id,
        'opportunity_id', p_opportunity_id,
        'vacancy_title', v_opp.title,
        'club_name', v_opp.club_name,
        'position', v_opp.position,
        'status', 'filled'),
      NULL);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._fill_waiting_applications(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_opportunity_recruiting_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Invites expire with the role.
  IF OLD.status = 'open' AND NEW.status <> 'open' THEN
    UPDATE public.opportunity_invites
       SET status = 'expired'
     WHERE opportunity_id = NEW.id AND status = 'sent';
  END IF;

  -- Closed as filled → everyone still waiting gets the kind note.
  IF NEW.status = 'closed' AND NEW.closed_reason = 'filled'
     AND (OLD.status IS DISTINCT FROM 'closed' OR OLD.closed_reason IS DISTINCT FROM 'filled') THEN
    PERFORM public._fill_waiting_applications(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_opportunity_recruiting_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_opportunity_recruiting_close ON public.opportunities;
CREATE TRIGGER trg_opportunity_recruiting_close
  AFTER UPDATE OF status, closed_reason ON public.opportunities
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.closed_reason IS DISTINCT FROM NEW.closed_reason)
  EXECUTE FUNCTION public.handle_opportunity_recruiting_close();


-- ═══ Invite → application (AFTER half of the link from 20260928110000) ═════════

CREATE OR REPLACE FUNCTION public.mark_invite_applied()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_player_name text;
  v_title text;
BEGIN
  IF NEW.invite_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.opportunity_invites
     SET status = 'applied', responded_at = timezone('utc', now()), application_id = NEW.id
   WHERE id = NEW.invite_id AND status = 'sent'
  RETURNING id, conversation_id, opportunity_id INTO v_inv;

  IF v_inv.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_player_name FROM public.profiles WHERE id = NEW.applicant_id;
  SELECT title INTO v_title FROM public.opportunities WHERE id = NEW.opportunity_id;

  -- The club already gets "new applicant" from the existing application trigger.
  PERFORM public._post_recruiting_card(
    v_inv.conversation_id, NEW.applicant_id,
    format('%s applied for %s.', coalesce(v_player_name, 'The player'), coalesce(v_title, 'your role')),
    jsonb_build_object('type', 'application_event', 'event', 'invite_applied',
                       'invite_id', v_inv.id, 'application_id', NEW.id,
                       'opportunity_id', NEW.opportunity_id));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_invite_applied() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mark_invite_applied ON public.opportunity_applications;
CREATE TRIGGER trg_mark_invite_applied
  AFTER INSERT ON public.opportunity_applications
  FOR EACH ROW WHEN (NEW.invite_id IS NOT NULL)
  EXECUTE FUNCTION public.mark_invite_applied();


-- ═══ D3 · send_invite ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_invite(p_player_id uuid, p_opportunity_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_me        record;
  v_opp       record;
  v_player    record;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_limit     integer;
  v_sent_24h  integer;
  v_expires   timestamptz;
  v_invite_id uuid;
  v_conv_id   uuid;
  v_msg_id    uuid;
  v_content   text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can invite players' USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name, created_at INTO v_me FROM public.profiles WHERE id = v_uid;

  SELECT o.id, o.club_id, o.status, o.title, o.opportunity_type, o.application_deadline
    INTO v_opp
    FROM public.opportunities o
   WHERE o.id = p_opportunity_id;
  IF v_opp.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only invite players to your own roles' USING ERRCODE = '42501';
  END IF;
  IF v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'This role is not open' USING ERRCODE = 'P0001';
  END IF;

  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'The note can be up to 500 characters' USING ERRCODE = '22023';
  END IF;

  -- Who can be invited. One message for every "no" so the reason (e.g. age) never leaks.
  SELECT p.id, p.full_name, p.role, p.open_to_play, p.open_to_coach, p.date_of_birth,
         p.onboarding_completed, p.is_blocked, p.frozen_minor_at, p.dob_required_since
    INTO v_player
    FROM public.profiles p
   WHERE p.id = p_player_id;
  IF v_player.id IS NULL
     OR v_player.id = v_uid
     OR NOT coalesce(v_player.onboarding_completed, false)
     OR v_player.date_of_birth IS NULL
     OR public.is_minor(v_player.id)
     OR public.profile_is_uncontactable(v_player.is_blocked, v_player.frozen_minor_at, v_player.role,
                                        v_player.date_of_birth, v_player.dob_required_since)
     OR public.is_blocked_pair(v_uid, v_player.id)
     OR NOT (   (v_opp.opportunity_type = 'player' AND v_player.role = 'player' AND coalesce(v_player.open_to_play, false))
             OR (v_opp.opportunity_type = 'coach'  AND v_player.role = 'coach'  AND coalesce(v_player.open_to_coach, false))) THEN
    RAISE EXCEPTION 'This person can''t be invited to this role' USING ERRCODE = 'P0001';
  END IF;

  -- Already in this club's pipeline → the club sees their status instead (D3 dev note).
  IF EXISTS (SELECT 1 FROM public.opportunity_applications a
              WHERE a.opportunity_id = v_opp.id AND a.applicant_id = v_player.id)
     OR EXISTS (SELECT 1
                  FROM public.opportunity_applications a
                  JOIN public.opportunities o ON o.id = a.opportunity_id
                 WHERE a.applicant_id = v_player.id
                   AND o.club_id = v_uid
                   AND o.status = 'open'
                   AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted',
                                          'signed_pending_confirmation')) THEN
    RAISE EXCEPTION 'This player has already applied to one of your roles' USING ERRCODE = 'P0001';
  END IF;

  -- Serialise this publisher's invites so the count and the one-open rule can't race.
  PERFORM pg_advisory_xact_lock(hashtext('invite_rate:' || v_uid::text));

  IF EXISTS (SELECT 1 FROM public.opportunity_invites i
              WHERE i.club_id = v_uid AND i.player_id = v_player.id AND i.status = 'sent') THEN
    RAISE EXCEPTION 'This player already has an open invite from you' USING ERRCODE = 'P0001';
  END IF;

  v_limit := CASE WHEN v_me.created_at > timezone('utc', now()) - interval '7 days' THEN 5 ELSE 20 END;
  SELECT count(*) INTO v_sent_24h
    FROM public.opportunity_invites i
   WHERE i.club_id = v_uid AND i.sent_at > timezone('utc', now()) - interval '24 hours';
  IF v_sent_24h >= v_limit THEN
    RAISE EXCEPTION 'Daily invite limit reached (% per day)', v_limit USING ERRCODE = 'P0001';
  END IF;

  -- Expires after 14 days, or at the end of the role's deadline day if that is sooner.
  v_expires := timezone('utc', now()) + interval '14 days';
  IF v_opp.application_deadline IS NOT NULL THEN
    v_expires := least(v_expires, (v_opp.application_deadline + 1)::timestamp AT TIME ZONE 'UTC');
  END IF;

  INSERT INTO public.opportunity_invites (opportunity_id, club_id, player_id, note, expires_at)
  VALUES (v_opp.id, v_uid, v_player.id, v_note, v_expires)
  RETURNING id INTO v_invite_id;

  v_conv_id := public._recruiting_conversation(v_uid, v_player.id, 'Invitation');

  v_content := format('%s invited you to apply for %s.', coalesce(v_me.full_name, 'A club'), v_opp.title)
               || CASE WHEN v_note IS NOT NULL THEN E'\n\n' || v_note ELSE '' END
               || E'\n\nOpen the role on Hockia to apply or say you''re not interested.';
  v_msg_id := public._post_recruiting_card(
    v_conv_id, v_uid, v_content,
    jsonb_build_object('type', 'opportunity_invite', 'invite_id', v_invite_id,
                       'opportunity_id', v_opp.id),
    false);

  UPDATE public.opportunity_invites
     SET conversation_id = v_conv_id, message_id = v_msg_id
   WHERE id = v_invite_id;

  PERFORM public._recruiting_notify(
    v_player.id, v_uid, v_invite_id, 'invite_received',
    format('%s invited you to apply', coalesce(v_me.full_name, 'A club')),
    v_opp.title,
    jsonb_build_object('invite_id', v_invite_id, 'opportunity_id', v_opp.id,
                       'conversation_id', v_conv_id, 'club_name', v_me.full_name),
    '/messages/' || v_conv_id::text);

  RETURN jsonb_build_object('invite_id', v_invite_id, 'conversation_id', v_conv_id,
                            'message_id', v_msg_id, 'expires_at', v_expires,
                            'remaining_today', v_limit - v_sent_24h - 1);
END;
$$;


-- ═══ D3 · respond_invite ('apply' | 'decline') ═════════════════════════════════

CREATE OR REPLACE FUNCTION public.respond_invite(p_invite_id uuid, p_response text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_inv    record;
  v_opp    record;
  v_me     record;
  v_app_id uuid;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_response NOT IN ('apply', 'decline') THEN
    RAISE EXCEPTION 'Response must be apply or decline' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.opportunity_invites WHERE id = p_invite_id FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.player_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'sent' THEN
    RAISE EXCEPTION 'This invite has already been answered' USING ERRCODE = 'P0001';
  END IF;

  SELECT o.id, o.status, o.title, o.opportunity_type, o.club_id INTO v_opp
    FROM public.opportunities o WHERE o.id = v_inv.opportunity_id;
  IF v_inv.expires_at <= timezone('utc', now()) OR v_opp.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'This invite has expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, full_name, role INTO v_me FROM public.profiles WHERE id = v_uid;

  IF p_response = 'decline' THEN
    UPDATE public.opportunity_invites
       SET status = 'declined', responded_at = timezone('utc', now())
     WHERE id = v_inv.id;

    PERFORM public._post_recruiting_card(
      v_inv.conversation_id, v_uid,
      format('%s passed on %s.', coalesce(v_me.full_name, 'The player'), v_opp.title),
      jsonb_build_object('type', 'application_event', 'event', 'invite_declined',
                         'invite_id', v_inv.id, 'opportunity_id', v_opp.id));
    PERFORM public._recruiting_notify(
      v_inv.club_id, v_uid, v_inv.id, 'invite_declined',
      format('%s passed on your invite', coalesce(v_me.full_name, 'A player')),
      v_opp.title,
      jsonb_build_object('invite_id', v_inv.id, 'opportunity_id', v_opp.id,
                         'conversation_id', v_inv.conversation_id),
      CASE WHEN v_inv.conversation_id IS NOT NULL THEN '/messages/' || v_inv.conversation_id::text
           ELSE '/dashboard/opportunities/' || v_opp.id::text || '/applicants' END);
    RETURN jsonb_build_object('invite_id', v_inv.id, 'status', 'declined');
  END IF;

  -- apply: the same checks as the Applicants INSERT policy, then a normal pending
  -- application. The link triggers tag it with the invite and mark the invite applied;
  -- check_application_eligibility still runs.
  IF NOT ((v_opp.opportunity_type = 'player' AND v_me.role = 'player')
       OR (v_opp.opportunity_type = 'coach'  AND v_me.role = 'coach')) THEN
    RAISE EXCEPTION 'This role is for a different profile type' USING ERRCODE = 'P0001';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'The note can be up to 1000 characters' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.opportunity_applications (opportunity_id, applicant_id, status, metadata)
    VALUES (v_opp.id, v_uid, 'pending',
            CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('message', v_note) END)
    RETURNING id INTO v_app_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You have already applied to this role' USING ERRCODE = 'P0001';
  END;

  RETURN jsonb_build_object('invite_id', v_inv.id, 'status', 'applied', 'application_id', v_app_id);
END;
$$;


-- ═══ D4 · make_offer (first offer or a new version) ════════════════════════════

CREATE OR REPLACE FUNCTION public.make_offer(
  p_application_id uuid,
  p_open_until date,
  p_start_date date DEFAULT NULL,
  p_length text DEFAULT NULL,
  p_pay text DEFAULT NULL,
  p_package text[] DEFAULT NULL,
  p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_app      record;
  v_opp      record;
  v_club     record;
  v_player   record;
  v_version  integer;
  v_offer_id uuid;
  v_conv_id  uuid;
  v_msg_id   uuid;
  v_package  text[];
  v_length   text;
  v_pay      text;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_is_edit  boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can make offers' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = p_application_id FOR UPDATE;
  SELECT o.* INTO v_opp FROM public.opportunities o WHERE o.id = v_app.opportunity_id;
  IF v_app.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = '42501';
  END IF;
  IF v_opp.status <> 'open' THEN
    RAISE EXCEPTION 'This role is not open' USING ERRCODE = 'P0001';
  END IF;
  IF v_app.status::text NOT IN ('shortlisted', 'offered') THEN
    RAISE EXCEPTION 'Offers can be made to shortlisted applicants only' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, full_name, role, is_blocked, frozen_minor_at INTO v_player
    FROM public.profiles WHERE id = v_app.applicant_id;
  IF public.profile_is_hidden(v_player.is_blocked, v_player.frozen_minor_at)
     OR public.is_minor(v_player.id)
     OR public.is_blocked_pair(v_uid, v_player.id) THEN
    RAISE EXCEPTION 'This player can''t receive an offer' USING ERRCODE = 'P0001';
  END IF;

  IF p_open_until IS NULL OR p_open_until < (timezone('utc', now()))::date
     OR p_open_until > (timezone('utc', now()))::date + 90 THEN
    RAISE EXCEPTION 'Open until must be a date from today up to 90 days ahead' USING ERRCODE = '22023';
  END IF;

  -- Defaults come from the role; the club can change them for this player.
  v_length  := coalesce(nullif(btrim(coalesce(p_length, '')), ''), v_opp.duration_text);
  v_pay     := coalesce(nullif(btrim(coalesce(p_pay, '')), ''), v_opp.compensation);
  IF p_package IS NULL THEN
    v_package := coalesce(v_opp.benefits, '{}'::text[]) || coalesce(v_opp.custom_benefits, '{}'::text[]);
  ELSE
    SELECT coalesce(array_agg(btrim(x)), '{}'::text[]) INTO v_package
      FROM unnest(p_package) AS x
     WHERE nullif(btrim(x), '') IS NOT NULL;
  END IF;
  IF coalesce(array_length(v_package, 1), 0) > 12
     OR EXISTS (SELECT 1 FROM unnest(v_package) x WHERE char_length(x) > 60)
     OR char_length(coalesce(v_length, '')) > 100
     OR char_length(coalesce(v_pay, '')) > 200
     OR char_length(coalesce(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'Offer fields are too long' USING ERRCODE = '22023';
  END IF;

  SELECT id, full_name INTO v_club FROM public.profiles WHERE id = v_uid;

  -- New version; the previous live one (if any) is superseded.
  UPDATE public.opportunity_offers
     SET status = 'superseded'
   WHERE application_id = v_app.id AND status = 'live';
  v_is_edit := FOUND;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.opportunity_offers WHERE application_id = v_app.id;

  INSERT INTO public.opportunity_offers (
    application_id, opportunity_id, club_id, player_id, version,
    start_date, length, pay, package, open_until, note)
  VALUES (
    v_app.id, v_opp.id, v_uid, v_player.id, v_version,
    coalesce(p_start_date, v_opp.start_date), v_length, v_pay, v_package, p_open_until, v_note)
  RETURNING id INTO v_offer_id;

  IF v_app.status::text <> 'offered' THEN
    PERFORM public._set_application_status(v_app.id, 'offered');
  END IF;

  v_conv_id := public._recruiting_conversation(v_uid, v_player.id, 'Application');
  -- No terms in the fallback text or the card: they live in opportunity_offers only.
  v_msg_id := public._post_recruiting_card(
    v_conv_id, v_uid,
    format('%s %s for %s, open until %s. Open Hockia to see the terms and answer.',
           coalesce(v_club.full_name, 'The club'),
           CASE WHEN v_is_edit THEN 'updated its offer' ELSE 'sent you an offer' END,
           v_opp.title, public._recruiting_date_label(p_open_until)),
    jsonb_build_object('type', 'opportunity_offer', 'offer_id', v_offer_id, 'version', v_version,
                       'application_id', v_app.id, 'opportunity_id', v_opp.id),
    false);
  UPDATE public.opportunity_offers SET message_id = v_msg_id WHERE id = v_offer_id;

  PERFORM public._recruiting_notify(
    v_player.id, v_uid, v_app.id, 'offer_received',
    format('%s %s', coalesce(v_club.full_name, 'The club'),
           CASE WHEN v_is_edit THEN 'updated its offer' ELSE 'sent you an offer' END),
    v_opp.title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_opp.id,
                       'offer_id', v_offer_id, 'conversation_id', v_conv_id),
    '/messages/' || v_conv_id::text);

  RETURN jsonb_build_object('offer_id', v_offer_id, 'version', v_version,
                            'conversation_id', v_conv_id, 'message_id', v_msg_id);
END;
$$;


-- ═══ D4 · withdraw_offer (club, before the answer) ═════════════════════════════

CREATE OR REPLACE FUNCTION public.withdraw_offer(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_offer record;
  v_app   record;
  v_title text;
  v_club  text;
  v_conv  uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can withdraw offers' USING ERRCODE = '42501';
  END IF;

  SELECT f.* INTO v_offer FROM public.opportunity_offers f WHERE f.id = p_offer_id;
  IF v_offer.id IS NULL OR v_offer.club_id IS DISTINCT FROM v_uid
     OR NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = v_offer.opportunity_id AND o.club_id = v_uid) THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = v_offer.application_id FOR UPDATE;
  SELECT f.status INTO v_offer.status FROM public.opportunity_offers f WHERE f.id = p_offer_id;
  IF v_offer.status <> 'live' OR v_app.status::text <> 'offered' THEN
    RAISE EXCEPTION 'Only an offer still waiting for an answer can be withdrawn' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.opportunity_offers
     SET status = 'withdrawn', responded_at = timezone('utc', now())
   WHERE id = v_offer.id;
  PERFORM public._set_application_status(v_app.id, 'shortlisted');

  SELECT title INTO v_title FROM public.opportunities WHERE id = v_offer.opportunity_id;
  SELECT full_name INTO v_club FROM public.profiles WHERE id = v_uid;
  v_conv := public._recruiting_conversation(v_uid, v_offer.player_id, 'Application');

  PERFORM public._post_recruiting_card(
    v_conv, v_uid,
    format('%s withdrew its offer for %s.', coalesce(v_club, 'The club'), v_title),
    jsonb_build_object('type', 'application_event', 'event', 'offer_withdrawn',
                       'offer_id', v_offer.id, 'application_id', v_app.id,
                       'opportunity_id', v_offer.opportunity_id));
  PERFORM public._recruiting_notify(
    v_offer.player_id, v_uid, v_app.id, 'offer_withdrawn',
    format('%s withdrew its offer', coalesce(v_club, 'The club')), v_title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_offer.opportunity_id,
                       'offer_id', v_offer.id, 'conversation_id', v_conv),
    '/messages/' || v_conv::text);

  RETURN jsonb_build_object('offer_id', v_offer.id, 'status', 'withdrawn', 'application_status', 'shortlisted');
END;
$$;


-- ═══ D4 · respond_offer (player accepts / declines) ════════════════════════════

CREATE OR REPLACE FUNCTION public.respond_offer(p_offer_id uuid, p_accept boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_offer  record;
  v_app    record;
  v_title  text;
  v_player text;
  v_conv   uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'Answer is required' USING ERRCODE = '22023';
  END IF;

  SELECT f.* INTO v_offer FROM public.opportunity_offers f WHERE f.id = p_offer_id;
  IF v_offer.id IS NULL OR v_offer.player_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = v_offer.application_id FOR UPDATE;
  SELECT f.status, f.open_until INTO v_offer.status, v_offer.open_until
    FROM public.opportunity_offers f WHERE f.id = p_offer_id;
  IF v_app.applicant_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = '42501';
  END IF;
  IF v_offer.status <> 'live' OR v_app.status::text <> 'offered' THEN
    RAISE EXCEPTION 'This offer is no longer open' USING ERRCODE = 'P0001';
  END IF;
  IF v_offer.open_until < (timezone('utc', now()))::date THEN
    RAISE EXCEPTION 'This offer has expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'The reason can be up to 500 characters' USING ERRCODE = '22023';
  END IF;

  SELECT title INTO v_title FROM public.opportunities WHERE id = v_offer.opportunity_id;
  SELECT full_name INTO v_player FROM public.profiles WHERE id = v_uid;

  IF p_accept THEN
    UPDATE public.opportunity_offers
       SET status = 'accepted', responded_at = timezone('utc', now())
     WHERE id = v_offer.id;
    PERFORM public._set_application_status(v_app.id, 'accepted');
  ELSE
    UPDATE public.opportunity_offers
       SET status = 'declined', responded_at = timezone('utc', now()), decline_reason = v_reason
     WHERE id = v_offer.id;
    -- Recorded as offer_declined in the history, then back to shortlisted
    -- (founder ruling 2026-09-25).
    PERFORM public._set_application_status(v_app.id, 'offer_declined');
    PERFORM public._set_application_status(v_app.id, 'shortlisted');
  END IF;

  v_conv := public._recruiting_conversation(v_offer.club_id, v_uid, 'Application');
  PERFORM public._post_recruiting_card(
    v_conv, v_uid,
    format('%s %s the offer for %s.', coalesce(v_player, 'The player'),
           CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, v_title),
    jsonb_build_object('type', 'application_event',
                       'event', CASE WHEN p_accept THEN 'offer_accepted' ELSE 'offer_declined' END,
                       'offer_id', v_offer.id, 'application_id', v_app.id,
                       'opportunity_id', v_offer.opportunity_id));
  PERFORM public._recruiting_notify(
    v_offer.club_id, v_uid, v_app.id,
    CASE WHEN p_accept THEN 'offer_accepted' ELSE 'offer_declined' END,
    format('%s %s your offer', coalesce(v_player, 'The player'),
           CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END),
    v_title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_offer.opportunity_id,
                       'offer_id', v_offer.id, 'conversation_id', v_conv),
    '/messages/' || v_conv::text);

  RETURN jsonb_build_object('offer_id', v_offer.id,
                            'status', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
                            'application_status', CASE WHEN p_accept THEN 'accepted' ELSE 'shortlisted' END);
END;
$$;


-- ═══ D4 · withdraw_application (player, until the signing is confirmed) ════════

CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_app    record;
  v_opp    record;
  v_player text;
  v_conv   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = p_application_id FOR UPDATE;
  IF v_app.id IS NULL OR v_app.applicant_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = '42501';
  END IF;
  IF v_app.status::text = 'signed' THEN
    RAISE EXCEPTION 'A confirmed signing can''t be withdrawn' USING ERRCODE = 'P0001';
  END IF;
  IF v_app.status::text NOT IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted',
                                'signed_pending_confirmation') THEN
    RAISE EXCEPTION 'This application is already closed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.opportunity_offers
     SET status = 'cancelled', responded_at = timezone('utc', now())
   WHERE application_id = v_app.id AND status = 'live';

  UPDATE public.opportunity_applications
     SET signing_requested_at = NULL, signing_close_role = NULL
   WHERE id = v_app.id;
  PERFORM public._set_application_status(v_app.id, 'withdrawn');

  SELECT o.id, o.club_id, o.title INTO v_opp FROM public.opportunities o WHERE o.id = v_app.opportunity_id;
  SELECT full_name INTO v_player FROM public.profiles WHERE id = v_uid;

  -- A card only in a thread that already exists; the club is always notified.
  SELECT c.id INTO v_conv
    FROM public.conversations c
   WHERE least(c.participant_one_id, c.participant_two_id) = least(v_opp.club_id, v_uid)
     AND greatest(c.participant_one_id, c.participant_two_id) = greatest(v_opp.club_id, v_uid);
  PERFORM public._post_recruiting_card(
    v_conv, v_uid,
    format('%s withdrew their application for %s.', coalesce(v_player, 'The player'), v_opp.title),
    jsonb_build_object('type', 'application_event', 'event', 'application_withdrawn',
                       'application_id', v_app.id, 'opportunity_id', v_opp.id));
  PERFORM public._recruiting_notify(
    v_opp.club_id, v_uid, v_app.id, 'application_withdrawn',
    format('%s withdrew their application', coalesce(v_player, 'A player')), v_opp.title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_opp.id, 'conversation_id', v_conv),
    CASE WHEN v_conv IS NOT NULL THEN '/messages/' || v_conv::text
         ELSE '/dashboard/opportunities/' || v_opp.id::text || '/applicants' END);

  RETURN jsonb_build_object('application_id', v_app.id, 'status', 'withdrawn');
END;
$$;


-- ═══ D4 · mark_signed / undo_mark_signed (club) ════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_signed(p_application_id uuid, p_close_role boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_app  record;
  v_opp  record;
  v_club text;
  v_conv uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can mark a signing' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = p_application_id FOR UPDATE;
  SELECT o.id, o.club_id, o.title, o.status INTO v_opp FROM public.opportunities o WHERE o.id = v_app.opportunity_id;
  IF v_app.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = '42501';
  END IF;
  -- After an accepted offer, or straight from shortlisted when offers weren't used.
  IF v_app.status::text NOT IN ('accepted', 'shortlisted') THEN
    RAISE EXCEPTION 'Only a shortlisted applicant or an accepted offer can be marked as signed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.opportunity_applications
     SET signing_requested_at = timezone('utc', now()),
         signing_close_role   = coalesce(p_close_role, true)
   WHERE id = v_app.id;
  PERFORM public._set_application_status(v_app.id, 'signed_pending_confirmation');

  SELECT full_name INTO v_club FROM public.profiles WHERE id = v_uid;
  v_conv := public._recruiting_conversation(v_uid, v_app.applicant_id, 'Application');
  PERFORM public._post_recruiting_card(
    v_conv, v_uid,
    format('%s marked you as signed for %s. Confirm it on Hockia to add the signing to your career.',
           coalesce(v_club, 'The club'), v_opp.title),
    jsonb_build_object('type', 'application_event', 'event', 'signing_marked',
                       'application_id', v_app.id, 'opportunity_id', v_opp.id));
  PERFORM public._recruiting_notify(
    v_app.applicant_id, v_uid, v_app.id, 'signing_marked',
    format('Confirm your signing with %s', coalesce(v_club, 'the club')), v_opp.title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_opp.id, 'conversation_id', v_conv),
    '/messages/' || v_conv::text);

  RETURN jsonb_build_object('application_id', v_app.id, 'status', 'signed_pending_confirmation',
                            'expires_at', timezone('utc', now()) + interval '14 days');
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_mark_signed(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_app    record;
  v_opp    record;
  v_club   text;
  v_conv   uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can undo a signing mark' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = p_application_id FOR UPDATE;
  SELECT o.id, o.club_id, o.title INTO v_opp FROM public.opportunities o WHERE o.id = v_app.opportunity_id;
  IF v_app.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = '42501';
  END IF;
  IF v_app.status::text <> 'signed_pending_confirmation' THEN
    RAISE EXCEPTION 'Only a signing still waiting for the player can be undone' USING ERRCODE = 'P0001';
  END IF;

  v_status := public._application_resting_status(v_app.id);
  UPDATE public.opportunity_applications
     SET signing_requested_at = NULL, signing_close_role = NULL
   WHERE id = v_app.id;
  PERFORM public._set_application_status(v_app.id, v_status);

  SELECT full_name INTO v_club FROM public.profiles WHERE id = v_uid;
  v_conv := public._recruiting_conversation(v_uid, v_app.applicant_id, 'Application');
  PERFORM public._post_recruiting_card(
    v_conv, v_uid,
    format('%s undid the signing for %s.', coalesce(v_club, 'The club'), v_opp.title),
    jsonb_build_object('type', 'application_event', 'event', 'signing_undone',
                       'application_id', v_app.id, 'opportunity_id', v_opp.id));
  PERFORM public._recruiting_notify(
    v_app.applicant_id, v_uid, v_app.id, 'signing_undone',
    format('%s undid the signing', coalesce(v_club, 'The club')), v_opp.title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_opp.id, 'conversation_id', v_conv),
    '/messages/' || v_conv::text);

  RETURN jsonb_build_object('application_id', v_app.id, 'status', v_status);
END;
$$;


-- ═══ D4 · confirm_signing (player) ═════════════════════════════════════════════
-- signed + signed_at; career entry "Signed through Hockia"; squad membership when the
-- publisher is a club account; optionally stop showing the player to other clubs; and
-- the role closes as filled if the club chose that at mark_signed.

CREATE OR REPLACE FUNCTION public.confirm_signing(p_application_id uuid, p_hide_from_clubs boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_now       timestamptz := timezone('utc', now());
  v_app       record;
  v_opp       record;
  v_pub       record;
  v_me        record;
  v_offer     record;
  v_world_id  uuid;
  v_start     date;
  v_club_name text;
  v_career_id uuid;
  v_conv      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app FROM public.opportunity_applications a WHERE a.id = p_application_id FOR UPDATE;
  IF v_app.id IS NULL OR v_app.applicant_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = '42501';
  END IF;
  IF v_app.status::text <> 'signed_pending_confirmation' THEN
    RAISE EXCEPTION 'There is no signing waiting for your confirmation' USING ERRCODE = 'P0001';
  END IF;
  IF v_app.signing_requested_at IS NULL OR v_app.signing_requested_at < v_now - interval '14 days' THEN
    RAISE EXCEPTION 'This signing request has expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT o.* INTO v_opp FROM public.opportunities o WHERE o.id = v_app.opportunity_id;
  SELECT p.id, p.full_name, p.role, p.current_club, p.current_world_club_id,
         p.womens_league_division, p.mens_league_division
    INTO v_pub FROM public.profiles p WHERE p.id = v_opp.club_id;
  SELECT p.id, p.full_name, p.role INTO v_me FROM public.profiles p WHERE p.id = v_uid;
  SELECT f.start_date, f.length INTO v_offer
    FROM public.opportunity_offers f
   WHERE f.application_id = v_app.id AND f.status = 'accepted'
   ORDER BY f.version DESC LIMIT 1;

  UPDATE public.opportunity_applications
     SET signed_at = v_now, signing_requested_at = NULL
   WHERE id = v_app.id;
  PERFORM public._set_application_status(v_app.id, 'signed');

  -- Career entry. Club = the role's organisation name, else the club account's name
  -- (a coach publisher's current club).
  v_club_name := coalesce(nullif(btrim(v_opp.organization_name), ''),
                          CASE WHEN v_pub.role = 'club' THEN v_pub.full_name
                               ELSE nullif(btrim(v_pub.current_club), '') END,
                          v_pub.full_name, 'Club');
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(w.id))[1] END INTO v_world_id
    FROM public.world_clubs w WHERE w.claimed_profile_id = v_opp.club_id;
  v_world_id := coalesce(v_opp.world_club_id, v_world_id, v_pub.current_world_club_id);
  v_start := coalesce(v_offer.start_date, v_opp.start_date, v_now::date);

  INSERT INTO public.career_history (
    user_id, club_name, position_role, years, division_league, entry_type,
    location_city, location_country, start_date, world_club_id,
    signed_via_hockia, signed_at, application_id)
  VALUES (
    v_uid,
    v_club_name,
    coalesce(initcap(replace(v_opp.position::text, '_', ' ')), initcap(v_opp.opportunity_type::text)),
    to_char(v_start, 'YYYY'),
    coalesce(nullif(btrim(v_opp.level_sought), ''),
             CASE WHEN v_opp.gender::text IN ('Women', 'Girls') THEN v_pub.womens_league_division
                  WHEN v_opp.gender::text IN ('Men', 'Boys') THEN v_pub.mens_league_division END,
             ''),
    'club',
    v_opp.location_city, v_opp.location_country, v_start, v_world_id,
    true, v_now, v_app.id)
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_career_id;

  -- Squad: the player joins the club account's roster.
  IF v_pub.role = 'club' THEN
    INSERT INTO public.club_members AS cm (club_profile_id, member_profile_id, status, invited_via, invited_by,
                                           responded_at, accepted_at)
    VALUES (v_opp.club_id, v_uid, 'active', 'direct', v_opp.club_id, v_now, v_now)
    ON CONFLICT (club_profile_id, member_profile_id) DO UPDATE
      SET status = 'active', accepted_at = coalesce(cm.accepted_at, EXCLUDED.accepted_at),
          responded_at = EXCLUDED.responded_at, updated_at = v_now;
  END IF;

  -- "Stop showing me to other clubs" (default on) turns off Open to play / to coach.
  IF coalesce(p_hide_from_clubs, true) THEN
    UPDATE public.profiles
       SET open_to_play  = CASE WHEN v_me.role = 'player' THEN false ELSE open_to_play END,
           open_to_coach = CASE WHEN v_me.role = 'coach' THEN false ELSE open_to_coach END
     WHERE id = v_uid;
  END IF;

  -- The club's choice at mark_signed. The trigger on opportunities sends everyone
  -- still waiting the kind note and expires open invites.
  IF coalesce(v_app.signing_close_role, true) AND v_opp.status <> 'closed' THEN
    UPDATE public.opportunities
       SET status = 'closed', closed_reason = 'filled', filled_via_hockia = true
     WHERE id = v_opp.id;
  ELSIF v_opp.status = 'closed' AND v_opp.closed_reason = 'filled' THEN
    UPDATE public.opportunities SET filled_via_hockia = true WHERE id = v_opp.id;
  END IF;

  v_conv := public._recruiting_conversation(v_opp.club_id, v_uid, 'Application');
  PERFORM public._post_recruiting_card(
    v_conv, v_uid,
    format('%s confirmed the signing for %s. Signed through Hockia.', coalesce(v_me.full_name, 'The player'), v_opp.title),
    jsonb_build_object('type', 'application_event', 'event', 'signing_confirmed',
                       'application_id', v_app.id, 'opportunity_id', v_opp.id));
  PERFORM public._recruiting_notify(
    v_opp.club_id, v_uid, v_app.id, 'signing_confirmed',
    format('%s confirmed the signing', coalesce(v_me.full_name, 'The player')), v_opp.title,
    jsonb_build_object('application_id', v_app.id, 'opportunity_id', v_opp.id, 'conversation_id', v_conv),
    '/messages/' || v_conv::text);

  RETURN jsonb_build_object('application_id', v_app.id, 'status', 'signed', 'signed_at', v_now,
                            'career_entry_id', v_career_id);
END;
$$;


-- ═══ D4 · set_trial (club) ═════════════════════════════════════════════════════
-- Internal step on the club's road; the player's road (Shortlisted → Offer → Signed)
-- doesn't show it, so no card and no notification.

CREATE OR REPLACE FUNCTION public.set_trial(p_application_id uuid, p_trial boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app record;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can record a trial' USING ERRCODE = '42501';
  END IF;

  SELECT a.id, a.status INTO v_app
    FROM public.opportunity_applications a
    JOIN public.opportunities o ON o.id = a.opportunity_id
   WHERE a.id = p_application_id AND o.club_id = v_uid
   FOR UPDATE OF a;
  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = '42501';
  END IF;
  IF v_app.status::text NOT IN ('shortlisted', 'offered', 'accepted', 'signed_pending_confirmation') THEN
    RAISE EXCEPTION 'A trial can be recorded for shortlisted applicants only' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.opportunity_applications SET trial = coalesce(p_trial, false) WHERE id = v_app.id;
  RETURN jsonb_build_object('application_id', v_app.id, 'trial', coalesce(p_trial, false));
END;
$$;


-- ═══ D4 · fill_role (club) ═════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fill_role(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_opp     record;
  v_waiting integer;
  v_signed  boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RAISE EXCEPTION 'Only clubs and coaches who recruit can fill a role' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.club_id, o.status, o.closed_reason INTO v_opp
    FROM public.opportunities o WHERE o.id = p_opportunity_id FOR UPDATE;
  IF v_opp.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Role not found' USING ERRCODE = '42501';
  END IF;
  IF v_opp.status = 'draft' THEN
    RAISE EXCEPTION 'A draft role can''t be filled' USING ERRCODE = 'P0001';
  END IF;
  IF v_opp.status = 'closed' AND v_opp.closed_reason = 'filled' THEN
    RAISE EXCEPTION 'This role is already filled' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_waiting
    FROM public.opportunity_applications a
   WHERE a.opportunity_id = v_opp.id
     AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted');
  SELECT EXISTS (SELECT 1 FROM public.opportunity_applications a
                  WHERE a.opportunity_id = v_opp.id AND a.status::text = 'signed') INTO v_signed;

  -- The trigger on opportunities does the rest (kind note, offers, invites).
  UPDATE public.opportunities
     SET status = 'closed', closed_reason = 'filled', filled_via_hockia = v_signed
   WHERE id = v_opp.id;

  RETURN jsonb_build_object('opportunity_id', v_opp.id, 'status', 'closed', 'closed_reason', 'filled',
                            'filled_via_hockia', v_signed, 'applications_notified', v_waiting);
END;
$$;


-- ═══ Expiry sweep (scheduler / service role only) ══════════════════════════════
--   * invites past expires_at, or whose role is no longer open → expired
--   * live offers past open_until → expired; application back to shortlisted; club told
--   * signings waiting > 14 days → back to accepted / shortlisted; club told

CREATE OR REPLACE FUNCTION public.expire_offers_and_invites()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz := timezone('utc', now());
  v_invites  integer;
  v_offers   integer := 0;
  v_signings integer := 0;
  r          record;
  v_status   text;
BEGIN
  UPDATE public.opportunity_invites i
     SET status = 'expired'
   WHERE i.status = 'sent'
     AND (i.expires_at <= v_now
          OR NOT EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = i.opportunity_id AND o.status = 'open'));
  GET DIAGNOSTICS v_invites = ROW_COUNT;

  FOR r IN
    SELECT f.id AS offer_id, f.application_id, f.opportunity_id, f.club_id, f.player_id,
           o.title, p.full_name AS player_name
      FROM public.opportunity_offers f
      JOIN public.opportunities o ON o.id = f.opportunity_id
      LEFT JOIN public.profiles p ON p.id = f.player_id
     WHERE f.status = 'live' AND f.open_until < v_now::date
     FOR UPDATE OF f
  LOOP
    UPDATE public.opportunity_offers SET status = 'expired' WHERE id = r.offer_id;
    IF EXISTS (SELECT 1 FROM public.opportunity_applications a WHERE a.id = r.application_id AND a.status::text = 'offered') THEN
      PERFORM public._set_application_status(r.application_id, 'shortlisted', 'recruiting_expiry');
    END IF;
    PERFORM public._recruiting_notify(
      r.club_id, NULL, r.application_id, 'offer_expired',
      format('Your offer to %s expired', coalesce(r.player_name, 'a player')), r.title,
      jsonb_build_object('application_id', r.application_id, 'opportunity_id', r.opportunity_id, 'offer_id', r.offer_id),
      '/dashboard/opportunities/' || r.opportunity_id::text || '/applicants');
    v_offers := v_offers + 1;
  END LOOP;

  FOR r IN
    SELECT a.id AS application_id, a.opportunity_id, o.club_id, o.title, p.full_name AS player_name
      FROM public.opportunity_applications a
      JOIN public.opportunities o ON o.id = a.opportunity_id
      LEFT JOIN public.profiles p ON p.id = a.applicant_id
     WHERE a.status::text = 'signed_pending_confirmation'
       AND a.signing_requested_at < v_now - interval '14 days'
     FOR UPDATE OF a
  LOOP
    v_status := public._application_resting_status(r.application_id);
    UPDATE public.opportunity_applications
       SET signing_requested_at = NULL, signing_close_role = NULL
     WHERE id = r.application_id;
    PERFORM public._set_application_status(r.application_id, v_status, 'recruiting_expiry');
    PERFORM public._recruiting_notify(
      r.club_id, NULL, r.application_id, 'signing_expired',
      format('%s didn''t confirm the signing in 14 days', coalesce(r.player_name, 'The player')), r.title,
      jsonb_build_object('application_id', r.application_id, 'opportunity_id', r.opportunity_id),
      '/dashboard/opportunities/' || r.opportunity_id::text || '/applicants');
    v_signings := v_signings + 1;
  END LOOP;

  RETURN jsonb_build_object('invites_expired', v_invites, 'offers_expired', v_offers,
                            'signings_expired', v_signings);
END;
$$;


-- ═══ Grants ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.send_invite(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_invite(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.make_offer(uuid, date, date, text, text, text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_offer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_offer(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_signed(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_mark_signed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_signing(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_trial(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fill_role(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.send_invite(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_invite(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_offer(uuid, date, date, text, text, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_offer(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_signed(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_mark_signed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_signing(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_trial(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fill_role(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.expire_offers_and_invites() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_offers_and_invites() TO service_role;


-- ═══ Schedule ══════════════════════════════════════════════════════════════════
-- Same pattern as application_expiry_daily (20260706090000). Runs as the database
-- owner. 08:15 UTC, after the application expiry sweep.

DO $$
BEGIN
  PERFORM cron.unschedule('recruiting_expiry_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior recruiting_expiry_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('recruiting_expiry_daily', '15 8 * * *',
    $cron$SELECT public.expire_offers_and_invites();$cron$);
END $$;

NOTIFY pgrst, 'reload schema';
