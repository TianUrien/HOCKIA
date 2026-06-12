-- ============================================================================
-- Club membership — invite players/coaches to a club roster
-- ============================================================================
-- Today "Club Members" is derived read-only from profiles.current_world_club_id
-- (a player self-declares their club). This adds a managed roster a club can
-- BUILD: invite a player/coach directly (they accept/decline) or via a reusable
-- team invite link. Mirrors the brand_ambassadors bilateral-consent pattern.
--
-- Product decisions:
--   * Reusable invite link (one active link per club; revocable).
--   * On join we set the member's current club ONLY IF they have none — never
--     overwrite self-declared career data (_apply_join_current_club).
--   * club_members is the roster source of truth; get_club_members returns it
--     UNIONed with the existing self-declared members (nothing disappears).
--
-- Security: every mutation is a SECURITY DEFINER RPC gated on auth.uid()
-- (club-owner for invites/links/removal, invitee for accept/decline). The
-- tables grant only SELECT to authenticated and gate rows with RLS; no direct
-- client writes (matches the profiles/messages lockdown approach).

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','declined')),
  invited_via       text NOT NULL DEFAULT 'direct'  CHECK (invited_via IN ('direct','link')),
  invited_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  member_role       text,
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  responded_at      timestamptz,
  accepted_at       timestamptz,
  CONSTRAINT club_members_distinct CHECK (club_profile_id <> member_profile_id),
  CONSTRAINT club_members_unique   UNIQUE (club_profile_id, member_profile_id)
);
COMMENT ON TABLE public.club_members IS 'Managed club roster: invited/active/declined memberships of players & coaches.';

CREATE INDEX IF NOT EXISTS idx_club_members_member_status ON public.club_members(member_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_club_members_club_status   ON public.club_members(club_profile_id, status);

CREATE TABLE IF NOT EXISTS public.club_invite_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  join_count      int NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.club_invite_links IS 'Reusable, revocable invite links for a club roster (one active link per club).';

-- one active (non-revoked) link per club
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_invite_links_one_active
  ON public.club_invite_links(club_profile_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_club_invite_links_token
  ON public.club_invite_links(token) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Grants + RLS — SELECT only for authenticated; writes via RPCs only
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.club_members      FROM anon, authenticated;
REVOKE ALL ON public.club_invite_links FROM anon, authenticated;
GRANT SELECT ON public.club_members      TO authenticated;
GRANT SELECT ON public.club_invite_links TO authenticated;

ALTER TABLE public.club_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_invite_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "club_members visible to club and member" ON public.club_members;
CREATE POLICY "club_members visible to club and member"
  ON public.club_members FOR SELECT
  USING (
    (SELECT auth.uid()) = club_profile_id
    OR (SELECT auth.uid()) = member_profile_id
    OR (SELECT auth.role()) = 'service_role'
  );

DROP POLICY IF EXISTS "club_invite_links visible to owner" ON public.club_invite_links;
CREATE POLICY "club_invite_links visible to owner"
  ON public.club_invite_links FOR SELECT
  USING ((SELECT auth.uid()) = club_profile_id OR (SELECT auth.role()) = 'service_role');

-- ----------------------------------------------------------------------------
-- 3. Helper — set the member's current club ONLY if they have none
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_join_current_club(
  p_club_profile_id uuid,
  p_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_club  boolean;
  v_club_name text;
  v_world_ids uuid[];
BEGIN
  SELECT (current_world_club_id IS NOT NULL)
         OR (COALESCE(btrim(current_club), '') <> '')
    INTO v_has_club
    FROM profiles WHERE id = p_member_id;

  IF v_has_club THEN
    RETURN;  -- never overwrite an existing club
  END IF;

  SELECT full_name INTO v_club_name FROM profiles WHERE id = p_club_profile_id;
  SELECT array_agg(id) INTO v_world_ids FROM world_clubs WHERE claimed_profile_id = p_club_profile_id;

  UPDATE profiles
     SET current_club = COALESCE(v_club_name, current_club),
         -- only adopt a structured world-club link when the club has exactly
         -- one (avoid guessing men's vs women's team)
         current_world_club_id = CASE WHEN array_length(v_world_ids, 1) = 1
                                      THEN v_world_ids[1] ELSE current_world_club_id END,
         updated_at = timezone('utc', now())
   WHERE id = p_member_id;
END;
$$;
REVOKE ALL ON FUNCTION public._apply_join_current_club(uuid, uuid) FROM anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- 4. invite_club_member — club invites a specific player/coach (direct)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_club_member(p_member_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.invite_club_member(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. respond_to_club_invite — invitee accepts/declines
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_club_invite(
  p_club_member_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;

  SELECT * INTO v_row FROM club_members WHERE id = p_club_member_id;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Invitation not found'); END IF;
  IF v_row.member_profile_id <> v_uid THEN RETURN jsonb_build_object('success', false, 'error', 'Not authorized'); END IF;
  IF v_row.status <> 'invited' THEN RETURN jsonb_build_object('success', false, 'error', 'Invitation is no longer pending'); END IF;

  IF p_accept THEN
    UPDATE club_members
       SET status = 'active', accepted_at = timezone('utc', now()),
           responded_at = timezone('utc', now()), updated_at = timezone('utc', now())
     WHERE id = p_club_member_id;
    PERFORM _apply_join_current_club(v_row.club_profile_id, v_uid);
    PERFORM enqueue_notification(
      v_row.club_profile_id, v_uid,
      'club_invitation_accepted'::profile_notification_kind, p_club_member_id, '{}'::jsonb, NULL
    );
  ELSE
    UPDATE club_members
       SET status = 'declined', responded_at = timezone('utc', now()), updated_at = timezone('utc', now())
     WHERE id = p_club_member_id;
  END IF;

  -- clear the original "invitation received" notification either way
  UPDATE profile_notifications
     SET cleared_at = timezone('utc', now())
   WHERE kind = 'club_invitation_received' AND source_entity_id = p_club_member_id;

  RETURN jsonb_build_object('success', true, 'action', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END);
END;
$$;
GRANT EXECUTE ON FUNCTION public.respond_to_club_invite(uuid, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Invite links — create (get-or-create), revoke, preview, join
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_club_invite_link()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_role     text;
  v_existing record;
  v_token    text;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only clubs can create invite links');
  END IF;

  SELECT id, token INTO v_existing
  FROM club_invite_links
  WHERE club_profile_id = v_uid AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > timezone('utc', now()))
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'token', v_existing.token, 'id', v_existing.id);
  END IF;

  -- clear any stale (expired-but-not-revoked) link so the partial unique holds
  UPDATE club_invite_links SET revoked_at = timezone('utc', now())
   WHERE club_profile_id = v_uid AND revoked_at IS NULL;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO club_invite_links (club_profile_id, token, created_by)
  VALUES (v_uid, v_token, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'token', v_token, 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_club_invite_link() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_club_invite_link()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only clubs can revoke invite links');
  END IF;

  UPDATE club_invite_links SET revoked_at = timezone('utc', now())
   WHERE club_profile_id = v_uid AND revoked_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_club_invite_link() TO authenticated;

-- Public preview for the /invite/club/:token landing page (anon allowed).
CREATE OR REPLACE FUNCTION public.get_club_invite_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link        record;
  v_club        record;
  v_uid         uuid := auth.uid();
  v_caller_role text;
  v_status      text;
BEGIN
  SELECT * INTO v_link FROM club_invite_links WHERE token = p_token;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= timezone('utc', now())) THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT id, full_name, username, avatar_url, base_location, role
    INTO v_club FROM profiles WHERE id = v_link.club_profile_id;
  IF v_club.id IS NULL OR v_club.role IS DISTINCT FROM 'club' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT role INTO v_caller_role FROM profiles WHERE id = v_uid;
    SELECT status INTO v_status FROM club_members
     WHERE club_profile_id = v_link.club_profile_id AND member_profile_id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'club_profile_id', v_club.id,
    'club_name', v_club.full_name,
    'club_username', v_club.username,
    'club_avatar_url', v_club.avatar_url,
    'club_location', v_club.base_location,
    'caller_role', v_caller_role,
    'caller_member_status', v_status
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_club_invite_preview(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_club_via_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_link     record;
  v_role     text;
  v_existing record;
  v_id       uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;

  SELECT * INTO v_link FROM club_invite_links WHERE token = p_token;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= timezone('utc', now())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invite link is no longer valid');
  END IF;
  IF v_link.club_profile_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'This is your own club');
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_uid AND onboarding_completed = true;
  IF v_role IS NULL OR v_role NOT IN ('player', 'coach') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only players and coaches can join a club');
  END IF;

  SELECT id, status INTO v_existing FROM club_members
   WHERE club_profile_id = v_link.club_profile_id AND member_profile_id = v_uid;
  IF v_existing.status = 'active' THEN
    RETURN jsonb_build_object('success', true, 'already_member', true, 'club_profile_id', v_link.club_profile_id);
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE club_members
       SET status = 'active', invited_via = 'link', member_role = v_role,
           accepted_at = timezone('utc', now()), responded_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     WHERE id = v_existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO club_members (club_profile_id, member_profile_id, status, invited_via, member_role, accepted_at, responded_at)
    VALUES (v_link.club_profile_id, v_uid, 'active', 'link', v_role, timezone('utc', now()), timezone('utc', now()))
    RETURNING id INTO v_id;
  END IF;

  UPDATE club_invite_links SET join_count = join_count + 1 WHERE id = v_link.id;
  PERFORM _apply_join_current_club(v_link.club_profile_id, v_uid);

  -- if a direct invite was pending, clear its notification
  UPDATE profile_notifications SET cleared_at = timezone('utc', now())
   WHERE kind = 'club_invitation_received' AND source_entity_id = v_id;

  PERFORM enqueue_notification(
    v_link.club_profile_id, v_uid,
    'club_invitation_accepted'::profile_notification_kind, v_id,
    jsonb_build_object('via', 'link'), NULL
  );

  RETURN jsonb_build_object('success', true, 'club_profile_id', v_link.club_profile_id, 'club_member_id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_club_via_link(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. remove_club_member (club) + leave_club (member)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_club_member(p_member_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_deleted record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  DELETE FROM club_members
   WHERE club_profile_id = v_uid AND member_profile_id = p_member_profile_id
  RETURNING id, status INTO v_deleted;

  IF v_deleted.id IS NOT NULL AND v_deleted.status = 'invited' THEN
    UPDATE profile_notifications SET cleared_at = timezone('utc', now())
     WHERE kind = 'club_invitation_received' AND source_entity_id = v_deleted.id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.remove_club_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_club(p_club_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  DELETE FROM club_members WHERE club_profile_id = p_club_profile_id AND member_profile_id = v_uid;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.leave_club(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. get_club_invitations — owner-facing pending list
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_club_invitations(p_club_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR v_uid <> p_club_profile_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'club_member_id', cm.id,
             'member_profile_id', p.id,
             'full_name', p.full_name,
             'avatar_url', p.avatar_url,
             'role', p.role,
             'position', p.position,
             'base_location', p.base_location,
             'invited_via', cm.invited_via,
             'created_at', cm.created_at
           ) AS row_data,
           cm.created_at
    FROM club_members cm
    JOIN profiles p ON p.id = cm.member_profile_id
    WHERE cm.club_profile_id = p_club_profile_id AND cm.status = 'invited'
  ) sub;

  RETURN jsonb_build_object('success', true, 'invitations', v_out);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_club_invitations(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. get_club_members — now UNION of self-declared + active roster members
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_club_members(uuid, int, int);
CREATE OR REPLACE FUNCTION public.get_club_members(
  p_profile_id uuid,
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  role text,
  nationality text,
  nationality_country_id int,
  nationality2_country_id int,
  base_location text,
  "position" text,
  secondary_position text,
  current_club text,
  current_world_club_id uuid,
  created_at timestamptz,
  open_to_play boolean,
  open_to_coach boolean,
  is_test_account boolean,
  is_roster_member boolean,
  club_member_id uuid,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club_ids AS (
    SELECT wc.id AS world_club_id FROM world_clubs wc WHERE wc.claimed_profile_id = p_profile_id
  ),
  roster AS (
    SELECT cm.member_profile_id AS pid, cm.id AS club_member_id
    FROM club_members cm WHERE cm.club_profile_id = p_profile_id AND cm.status = 'active'
  ),
  members AS (
    SELECT p.id AS pid, (r.pid IS NOT NULL) AS is_roster, r.club_member_id
    FROM profiles p
    LEFT JOIN roster r ON r.pid = p.id
    WHERE p.role IN ('player', 'coach')
      AND p.onboarding_completed = true
      AND (
        p.current_world_club_id IN (SELECT world_club_id FROM club_ids)
        OR r.pid IS NOT NULL
      )
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM members)
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.role::text,
    p.nationality,
    p.nationality_country_id,
    p.nationality2_country_id,
    p.base_location,
    p.position,
    p.secondary_position,
    p.current_club,
    p.current_world_club_id,
    p.created_at,
    p.open_to_play,
    p.open_to_coach,
    p.is_test_account,
    m.is_roster,
    m.club_member_id,
    c.cnt
  FROM members m
  JOIN profiles p ON p.id = m.pid
  CROSS JOIN counted c
  ORDER BY p.full_name ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION public.get_club_members(uuid, int, int) TO anon, authenticated;

COMMIT;
