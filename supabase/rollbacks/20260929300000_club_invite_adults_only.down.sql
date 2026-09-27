-- ROLLBACK for 20260929300000_club_invite_adults_only.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20260929300000 --linked
--
-- Restores the pre-migration body of invite_club_member (live staging body,
-- pg_get_functiondef 2026-09-27): no age check. Grants are unchanged by either
-- version (CREATE OR REPLACE keeps them).

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

  SELECT role INTO v_member_role FROM profiles WHERE id = p_member_profile_id AND onboarding_completed = true;
  IF v_member_role IS NULL OR v_member_role NOT IN ('player', 'coach') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only players and coaches can be invited');
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

COMMENT ON FUNCTION public.invite_club_member(uuid) IS NULL;
