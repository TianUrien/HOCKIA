-- =========================================================================
-- Invite to apply (D3): players need a known date of birth
-- =========================================================================
-- Founder ruling 2026-09-27: a club can only invite a player to apply when the
-- player is 18+ by a KNOWN date of birth. Players with no date of birth are
-- refused (this replaces the earlier "allow unknown DOB" for invites).
--
--   * Players: refused unless public.profile_is_adult(date_of_birth).
--   * Coaches (coach roles): not age-gated, same as club-facing search and
--     invite_club_member (20260929300000).
--   * Refusal reuses the existing single message ("This person can't be
--     invited to this role"), so the reason never leaks.
--
-- Body = live staging body (pg_get_functiondef, 2026-09-30) + one condition.
-- SECURITY DEFINER, search_path, limits and the one-open-invite rule unchanged.
-- Grants restated explicitly (CREATE OR REPLACE keeps them anyway).
-- Rollback: supabase/rollbacks/20261001200000_send_invite_requires_dob.down.sql
-- Probe:    supabase/tests/security/send_invite_dob.probe.sql
-- =========================================================================

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
