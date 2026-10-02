-- ROLLBACK for 20261003100000_signing_switches_current_club.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261003100000 --linked
--
-- Unschedules signing_current_club_daily, drops the sweep and the helper,
-- restores the previous bodies of confirm_signing (20260928120000) and
-- guard_career_history_client_write (20260928110000), drops the partial index
-- and career_history.current_club_applied. Profiles already switched by a
-- signing stay as they are (the switch is the founder-ruled outcome, not data
-- to undo).

DO $$
BEGIN
  PERFORM cron.unschedule('signing_current_club_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No signing_current_club_daily schedule found';
END $$;

DROP FUNCTION IF EXISTS public.apply_due_signing_current_clubs();

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

DROP FUNCTION IF EXISTS public._apply_signing_current_club(uuid);

CREATE OR REPLACE FUNCTION public.guard_career_history_client_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.signed_via_hockia := false;
    NEW.signed_at         := NULL;
    NEW.application_id    := NULL;
    RETURN NEW;
  END IF;

  IF NEW.signed_via_hockia IS DISTINCT FROM OLD.signed_via_hockia
     OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    RAISE EXCEPTION '"Signed through Hockia" is set by the signing itself' USING ERRCODE = '42501';
  END IF;

  IF OLD.signed_via_hockia
     AND (NEW.user_id       IS DISTINCT FROM OLD.user_id
       OR NEW.club_name     IS DISTINCT FROM OLD.club_name
       OR NEW.world_club_id IS DISTINCT FROM OLD.world_club_id
       OR NEW.years         IS DISTINCT FROM OLD.years
       OR NEW.start_date    IS DISTINCT FROM OLD.start_date
       OR NEW.entry_type    IS DISTINCT FROM OLD.entry_type) THEN
    RAISE EXCEPTION 'A signing made through Hockia keeps its club and season. You can hide or delete it.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS public.career_history_signing_due_idx;
ALTER TABLE public.career_history DROP COLUMN IF EXISTS current_club_applied;

NOTIFY pgrst, 'reload schema';
