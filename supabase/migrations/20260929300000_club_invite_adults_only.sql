-- =========================================================================
-- Squad invites: players must be 18+ by a known date of birth
-- =========================================================================
-- Founder approval of Club v2 leaf 7 (Squad, D1.15), 2026-09-27: a club's
-- direct squad invite (invite_club_member) follows the D2 club-facing age rule.
--
--   * Players: refused unless public.profile_is_adult(date_of_birth), i.e. a
--     KNOWN date of birth at least 18 years ago (D2, 20260928210000). An
--     unknown date of birth is refused.
--   * Coaches: not age-gated. Same as D2 club-facing search
--     (20260928230000: `p.role <> 'player' OR profile_is_adult(...)`).
--   * People already in the squad are untouched: this only gates new invites.
--     Players who list the club as their current club still show on its
--     squad (get_club_members), whatever their age.
--
-- Refusal keeps this function's jsonb contract (success false, no exception)
-- and adds a machine code the client maps:
--   { "success": false, "error": "This person can't be invited yet.",
--     "code": "not_invitable" }
-- The same message is used for every age case so the reason never leaks.
--
-- Body = live staging body (pg_get_functiondef, 2026-09-27) + the age check.
-- SECURITY DEFINER and search_path unchanged. CREATE OR REPLACE keeps the
-- existing EXECUTE grants; they are restated below so the migration is explicit.
-- Rollback: supabase/rollbacks/20260929300000_club_invite_adults_only.down.sql
-- Probe:    supabase/tests/security/club_invite_adults_only.probe.sql
-- =========================================================================

CREATE OR REPLACE FUNCTION public.invite_club_member(p_member_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_club_role   text;
  v_member_role text;
  v_member_dob  date;
  v_existing    record;
  v_id          uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;

  SELECT role INTO v_club_role FROM profiles WHERE id = v_uid;
  IF v_club_role IS DISTINCT FROM 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only clubs can invite members');
  END IF;
  IF p_member_profile_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot invite yourself');
  END IF;

  SELECT role, date_of_birth INTO v_member_role, v_member_dob
    FROM profiles WHERE id = p_member_profile_id AND onboarding_completed = true;
  IF v_member_role IS NULL OR v_member_role NOT IN ('player', 'coach') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only players and coaches can be invited');
  END IF;

  -- D2 club-facing age rule: players need a known DOB and 18+. Coaches are not age-gated.
  IF v_member_role = 'player' AND NOT public.profile_is_adult(v_member_dob) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This person can''t be invited yet.', 'code', 'not_invitable');
  END IF;

  SELECT id, status INTO v_existing
  FROM club_members WHERE club_profile_id = v_uid AND member_profile_id = p_member_profile_id;

  IF v_existing.status = 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already a member');
  END IF;
  IF v_existing.status = 'invited' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invitation already pending', 'id', v_existing.id);
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE club_members
       SET status = 'invited', invited_via = 'direct', invited_by = v_uid,
           member_role = v_member_role, responded_at = NULL, accepted_at = NULL,
           updated_at = timezone('utc', now())
     WHERE id = v_existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO club_members (club_profile_id, member_profile_id, status, invited_via, invited_by, member_role)
    VALUES (v_uid, p_member_profile_id, 'invited', 'direct', v_uid, v_member_role)
    RETURNING id INTO v_id;
  END IF;

  PERFORM enqueue_notification(
    p_member_profile_id, v_uid,
    'club_invitation_received'::profile_notification_kind, v_id,
    jsonb_build_object('club_member_id', v_id), NULL
  );

  RETURN jsonb_build_object('success', true, 'id', v_id, 'status', 'invited');
END;
$function$;

COMMENT ON FUNCTION public.invite_club_member(uuid) IS
  'Club invites a player or coach to its squad (club_members status invited). Players must be 18+ by a known DOB (D2 rule); coaches are not age-gated.';

-- Grants as they are today (anon calls get "Not authenticated").
GRANT EXECUTE ON FUNCTION public.invite_club_member(uuid) TO anon, authenticated, service_role;
