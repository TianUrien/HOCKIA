-- =========================================================================
-- Signing switches the current club (D4 follow-up)
-- =========================================================================
-- Founder ruling 2026-10-02: after a signing confirmed through Hockia, the
-- player's / coach's CURRENT CLUB becomes the signed club ON THE START DATE:
-- at confirm when the start date is today or past, otherwise by a daily job
-- on the start date. Until now nothing touched profiles.current_club /
-- current_world_club_id, so "Plays at" kept the old club.
--
-- What ships here:
--   * career_history.current_club_applied (boolean, default false): the row's
--     club switch has been applied. Server-owned like the other signing
--     columns: the client guard trigger keeps it as it was on direct writes.
--   * _apply_signing_current_club(career_history_id): sets current_club to the
--     club name the career entry stores and current_world_club_id to the
--     entry's world club (NULL when the signing has none: keeping the old link
--     would show the old club's league under the new club's name). Only for
--     signed_via_hockia rows whose start date has arrived; idempotent through
--     the applied flag; skips the profile write when nothing would change.
--     The league on "Plays at" is derived at read time from the world club
--     (player_league()), so no league column is written.
--   * confirm_signing: the live body plus one call after the career row is
--     inserted, when the start date is today or past. Nothing else changes.
--   * apply_due_signing_current_clubs(): the daily sweep. Every unapplied
--     signing whose start date has arrived (today's, plus any missed earlier
--     ones), oldest start first so the latest signing wins.
--   * cron signing_current_club_daily, 08:20 UTC, after recruiting_expiry_daily.
--
-- Single-row profile UPDATEs: set_profiles_updated_at runs as usual (the bulk
-- write rule does not apply). Grants: both new functions are service_role
-- only; the helper is called from inside SECURITY DEFINER functions, never by
-- clients. career_history grants are table-level, so the column needs none.
-- Rollback: supabase/rollbacks/20261003100000_signing_switches_current_club.down.sql
-- Probe:    supabase/tests/security/signing_current_club.probe.sql
-- =========================================================================


-- ═══ 1 · career_history.current_club_applied ═══════════════════════════════════

ALTER TABLE public.career_history
  ADD COLUMN IF NOT EXISTS current_club_applied boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.career_history.current_club_applied IS
  'Signed-through-Hockia rows only: the profile''s current club was switched to this entry (at confirm or by signing_current_club_daily on the start date).';

CREATE INDEX IF NOT EXISTS career_history_signing_due_idx
  ON public.career_history (start_date)
  WHERE signed_via_hockia AND NOT current_club_applied;


-- ═══ 2 · client guard: the flag is server-owned ════════════════════════════════
-- Live body (20260928110000) plus two lines: a direct client write never sets
-- or changes current_club_applied (kept silently, like the INSERT reset of the
-- other signing columns).

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
    NEW.signed_via_hockia    := false;
    NEW.signed_at            := NULL;
    NEW.application_id       := NULL;
    NEW.current_club_applied := false;
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

  NEW.current_club_applied := OLD.current_club_applied;
  RETURN NEW;
END;
$$;


-- ═══ 3 · _apply_signing_current_club (helper) ══════════════════════════════════
-- Returns true when the switch was applied by this call, false when the row is
-- not a signing, its start date has not arrived, or it was applied before.

CREATE OR REPLACE FUNCTION public._apply_signing_current_club(p_career_history_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('utc', now())::date;
  v_row   record;
  v_club  text;
BEGIN
  SELECT ch.id, ch.user_id, ch.club_name, ch.world_club_id
    INTO v_row
    FROM public.career_history ch
   WHERE ch.id = p_career_history_id
     AND ch.signed_via_hockia
     AND NOT ch.current_club_applied
     AND ch.start_date IS NOT NULL
     AND ch.start_date <= v_today
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RETURN false;
  END IF;

  v_club := nullif(btrim(v_row.club_name), '');

  -- One row, only when something changes (no needless updated_at bump).
  UPDATE public.profiles p
     SET current_club          = v_club,
         current_world_club_id = v_row.world_club_id
   WHERE p.id = v_row.user_id
     AND p.role IN ('player', 'coach')
     AND (p.current_club IS DISTINCT FROM v_club
          OR p.current_world_club_id IS DISTINCT FROM v_row.world_club_id);

  UPDATE public.career_history
     SET current_club_applied = true
   WHERE id = v_row.id;

  RETURN true;
END;
$$;


-- ═══ 4 · confirm_signing (player) ══════════════════════════════════════════════
-- Live body (20260928120000) + the block marked "Founder ruling 2026-10-02".

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


-- ═══ 5 · apply_due_signing_current_clubs (daily sweep) ═════════════════════════
-- Oldest start first, then signing order, so a later signing is the one that
-- stays when a person has more than one due.

CREATE OR REPLACE FUNCTION public.apply_due_signing_current_clubs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date := timezone('utc', now())::date;
  v_due     integer := 0;
  v_applied integer := 0;
  r         record;
BEGIN
  FOR r IN
    SELECT ch.id
      FROM public.career_history ch
     WHERE ch.signed_via_hockia
       AND NOT ch.current_club_applied
       AND ch.start_date IS NOT NULL
       AND ch.start_date <= v_today
     ORDER BY ch.start_date, ch.signed_at NULLS FIRST, ch.created_at
  LOOP
    v_due := v_due + 1;
    IF public._apply_signing_current_club(r.id) THEN
      v_applied := v_applied + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('as_of', v_today, 'due', v_due, 'applied', v_applied);
END;
$$;


-- ═══ Grants ════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public._apply_signing_current_club(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._apply_signing_current_club(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.apply_due_signing_current_clubs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_due_signing_current_clubs() TO service_role;

-- Unchanged, restated.
REVOKE ALL ON FUNCTION public.confirm_signing(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_signing(uuid, boolean) TO authenticated, service_role;


-- ═══ Schedule ══════════════════════════════════════════════════════════════════
-- Same pattern as recruiting_expiry_daily (20260928120000). Runs as the database
-- owner. 08:20 UTC, after the recruiting expiry sweep.

DO $$
BEGIN
  PERFORM cron.unschedule('signing_current_club_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior signing_current_club_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('signing_current_club_daily', '20 8 * * *',
    $cron$SELECT public.apply_due_signing_current_clubs();$cron$);
END $$;

NOTIFY pgrst, 'reload schema';
