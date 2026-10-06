-- ROLLBACK for 20261004200000_role_organisation_name.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261004200000 --linked
--
-- Restores the previous bodies of _fill_waiting_applications, make_offer,
-- withdraw_offer, mark_signed, undo_mark_signed (20260928120000), send_invite
-- (20261001210000) and confirm_signing (20261003100000), restates their
-- grants, then drops role_organisation. Career entries and messages already
-- written stay as they are.


-- _fill_waiting_applications: body of 20260928120000_recruiting_server_functions.sql, verbatim.

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


-- send_invite: body of 20261001210000_send_invite_no_reinvite_same_role.sql, verbatim.

CREATE OR REPLACE FUNCTION public.send_invite(p_player_id uuid, p_opportunity_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     OR public.is_minor(v_player.id)
     OR (v_player.role = 'player' AND NOT public.profile_is_adult(v_player.date_of_birth))
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

  -- A player who passed on this role can't be invited to it again (founder ruling 2026-10-01).
  -- Other roles of the club stay invitable, subject to the rules above.
  IF EXISTS (SELECT 1 FROM public.opportunity_invites i
              WHERE i.club_id = v_uid AND i.player_id = v_player.id
                AND i.opportunity_id = v_opp.id AND i.status = 'declined') THEN
    RAISE EXCEPTION 'This player passed on this role' USING ERRCODE = 'P0001';
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
$function$;

REVOKE ALL ON FUNCTION public.send_invite(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_invite(uuid, uuid, text) TO authenticated, service_role;


-- make_offer: body of 20260928120000_recruiting_server_functions.sql, verbatim.

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

REVOKE ALL ON FUNCTION public.make_offer(uuid, date, date, text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.make_offer(uuid, date, date, text, text, text[], text) TO authenticated;


-- withdraw_offer: body of 20260928120000_recruiting_server_functions.sql, verbatim.

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

REVOKE ALL ON FUNCTION public.withdraw_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_offer(uuid) TO authenticated;


-- mark_signed: body of 20260928120000_recruiting_server_functions.sql, verbatim.

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

REVOKE ALL ON FUNCTION public.mark_signed(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_signed(uuid, boolean) TO authenticated;


-- undo_mark_signed: body of 20260928120000_recruiting_server_functions.sql, verbatim.

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

REVOKE ALL ON FUNCTION public.undo_mark_signed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_mark_signed(uuid) TO authenticated;


-- confirm_signing: body of 20261003100000_signing_switches_current_club.sql, verbatim.

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
    -- Season style, e.g. '2026–27' (founder answer 2026-09-26).
    to_char(v_start, 'YYYY') || '–' || to_char(v_start + interval '1 year', 'YY'),
    coalesce(nullif(btrim(v_opp.level_sought), ''),
             CASE WHEN v_opp.gender::text IN ('Women', 'Girls') THEN v_pub.womens_league_division
                  WHEN v_opp.gender::text IN ('Men', 'Boys') THEN v_pub.mens_league_division END,
             ''),
    'club',
    v_opp.location_city, v_opp.location_country, v_start, v_world_id,
    true, v_now, v_app.id)
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_career_id;

  -- Founder ruling 2026-10-02: the current club switches on the start date.
  -- Today or past: now. Future: signing_current_club_daily on the day.
  IF v_career_id IS NOT NULL AND v_start <= v_now::date THEN
    PERFORM public._apply_signing_current_club(v_career_id);
  END IF;

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

REVOKE ALL ON FUNCTION public.confirm_signing(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_signing(uuid, boolean) TO authenticated, service_role;


DROP FUNCTION IF EXISTS public.role_organisation(uuid);

NOTIFY pgrst, 'reload schema';
