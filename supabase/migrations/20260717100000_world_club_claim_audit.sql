-- World Phase 1 — claim audit trail + friction-free security hardening
-- ============================================================================
-- Founder ruling (2026-07-17): club claiming stays ZERO-friction for growth —
-- no proof fields, no approval gate. What changes is invisible to users:
--
--   1. Every claim is recorded in world_club_claims (audit trail) so claims
--      can be reviewed POST-HOC in the Admin Portal and revoked if bad.
--   2. The claim RPCs derive identity from auth.uid() instead of trusting a
--      client-supplied p_profile_id. Before this, BOTH RPCs were granted to
--      anon with no auth check — anyone holding the public anon key could
--      claim any club as any profile. Signatures and response shapes are
--      unchanged, so pinned native bundles keep working.
--   3. Claiming requires profiles.role = 'club' (matches the admin
--      force-claim rule; ClubClaimStep only mounts for club accounts, and
--      the role is persisted at role-selection time, before that step).
--   4. A review-mode switch (app_settings 'world_club_claim_review_mode',
--      default 'auto') lets us flip to manual approval later with NO schema
--      or client change: 'auto' grants instantly and logs; 'manual' files
--      the same row as 'pending' and grants nothing until admin approval.
--   5. world_clubs gains verified_at/verified_by — the admin-granted trust
--      mark (separate from claiming), for Tian's manual review work.
--   6. The open "any authenticated user can INSERT into world_clubs" RLS
--      policy becomes admin-only. All user-facing creation goes through the
--      SECURITY DEFINER RPCs (which bypass RLS), so nothing user-visible
--      changes; this only closes the raw-PostgREST bypass.
--
-- Also fixes (same class as 20260716130000): create_and_claim_world_club's
-- duplicate check used `v_existing IS NOT NULL`, which is FALSE for a found
-- row containing NULL columns (composite-NULL semantics) — a duplicate
-- create fell through to the INSERT and surfaced a raw 23505. Now IF FOUND.

-- ============================================================================
-- 1. Claim audit table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.world_club_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_club_id UUID NOT NULL REFERENCES public.world_clubs(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE): the audit row must survive account deletion.
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'claimed_existing',      -- club claimed an existing directory entry
    'created_and_claimed',   -- club created the entry and claimed it
    'legacy_backfill',       -- pre-audit claim, backfilled below
    'admin_force_claim'      -- admin assigned ownership from the portal
  )),
  status TEXT NOT NULL DEFAULT 'auto_approved' CHECK (status IN (
    'pending',        -- manual mode: awaiting admin approval
    'auto_approved',  -- auto mode: granted instantly, reviewable post-hoc
    'approved',       -- manual mode: admin approved
    'rejected',       -- manual mode: admin rejected
    'revoked'         -- admin revoked a previously granted claim
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_world_club_claims_club
  ON public.world_club_claims (world_club_id);
CREATE INDEX IF NOT EXISTS idx_world_club_claims_profile
  ON public.world_club_claims (profile_id);
-- The admin queue reads newest-first, filtered by status / unreviewed.
CREATE INDEX IF NOT EXISTS idx_world_club_claims_status_created
  ON public.world_club_claims (status, created_at DESC);
-- One live pending request per club+profile (manual-mode idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS idx_world_club_claims_one_pending
  ON public.world_club_claims (world_club_id, profile_id)
  WHERE status = 'pending';

ALTER TABLE public.world_club_claims ENABLE ROW LEVEL SECURITY;

-- Admins manage everything (review queue, revoke, force-claim audit rows).
CREATE POLICY "Admins manage world club claims" ON public.world_club_claims
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- A club can see its own claim history (e.g. a future "claim pending" chip).
CREATE POLICY "Users read own world club claims" ON public.world_club_claims
  FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()));

-- Grants: the outer fence. Default privileges (20260528110000) give
-- anon/authenticated CRUD on new public tables — anon has no business here,
-- and regular-user writes only ever happen through the DEFINER RPCs.
REVOKE ALL ON TABLE public.world_club_claims FROM anon;

COMMENT ON TABLE public.world_club_claims IS
  'Audit trail of world_clubs ownership claims. auto mode grants instantly and logs; manual mode (app_settings world_club_claim_review_mode) holds as pending for admin approval.';

-- ============================================================================
-- 2. Verified mark on world_clubs (admin-granted, separate from claiming)
-- ============================================================================

ALTER TABLE public.world_clubs
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.world_clubs.verified_at IS
  'Set by an admin after manually verifying the club is real and correctly represented. Independent of is_claimed: exists → claimed → verified are three separate levels.';

-- ============================================================================
-- 3. Review-mode switch (default: auto — zero-friction growth phase)
-- ============================================================================

INSERT INTO public.app_settings (key, value)
VALUES ('world_club_claim_review_mode', 'auto')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 4. Backfill: every existing claim becomes a legacy audit row
-- ============================================================================

INSERT INTO public.world_club_claims (world_club_id, profile_id, action, status, created_at)
SELECT wc.id, wc.claimed_profile_id, 'legacy_backfill', 'auto_approved',
       COALESCE(wc.claimed_at, timezone('utc', now()))
FROM public.world_clubs wc
WHERE wc.is_claimed = true
  AND NOT EXISTS (
    SELECT 1 FROM public.world_club_claims c
    WHERE c.world_club_id = wc.id AND c.action = 'legacy_backfill'
  );

-- ============================================================================
-- 5. claim_world_club — auth.uid() identity, role check, mode switch, audit
-- ============================================================================
-- Signature and response shapes UNCHANGED (pinned native bundles call this):
--   {success:false, error:'Club not found' | 'Club has already been claimed'}
--   {success:true, club_id}                (+ pending:true in manual mode)

CREATE OR REPLACE FUNCTION public.claim_world_club(
  p_world_club_id UUID,
  p_profile_id UUID,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID;
  v_role TEXT;
  v_mode TEXT;
  v_club RECORD;
  v_profile_avatar TEXT;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  -- Identity comes from the session, never from the payload. Legit clients
  -- (including old pinned native bundles) always pass their own profile id,
  -- so requiring a match is invisible to them and only stops forgery.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_profile_id IS DISTINCT FROM v_caller THEN
    RETURN json_build_object('success', false, 'error', 'You can only claim a club for your own account');
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN json_build_object('success', false, 'error', 'Only club accounts can claim a club');
  END IF;

  v_mode := COALESCE(
    (SELECT value FROM app_settings WHERE key = 'world_club_claim_review_mode'),
    'auto'
  );

  SELECT * INTO v_club FROM world_clubs WHERE id = p_world_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Club not found');
  END IF;

  IF v_club.is_claimed THEN
    RETURN json_build_object('success', false, 'error', 'Club has already been claimed');
  END IF;

  SELECT avatar_url INTO v_profile_avatar FROM profiles WHERE id = v_caller;
  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  IF v_mode = 'manual' THEN
    -- File the request; grant nothing on the directory row. The club's own
    -- profile still gets the association so their account works normally.
    INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
    VALUES (p_world_club_id, v_caller, 'claimed_existing', 'pending')
    ON CONFLICT (world_club_id, profile_id) WHERE status = 'pending' DO NOTHING;

    UPDATE profiles
    SET current_world_club_id = p_world_club_id,
        mens_league_division = v_men_league_name,
        womens_league_division = v_women_league_name,
        mens_league_id = p_men_league_id,
        womens_league_id = p_women_league_id,
        world_region_id = v_club.province_id
    WHERE id = v_caller;

    RETURN json_build_object('success', true, 'club_id', p_world_club_id, 'pending', true);
  END IF;

  -- auto mode: grant instantly (today's behavior) and log it.
  UPDATE world_clubs
  SET
    is_claimed = true,
    claimed_profile_id = v_caller,
    claimed_at = timezone('utc', now()),
    men_league_id = p_men_league_id,
    women_league_id = p_women_league_id,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND v_profile_avatar IS NOT NULL THEN v_profile_avatar
      ELSE avatar_url
    END
  WHERE id = p_world_club_id;

  UPDATE profiles
  SET
    current_world_club_id = p_world_club_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = v_club.province_id,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND v_club.avatar_url IS NOT NULL THEN v_club.avatar_url
      ELSE avatar_url
    END
  WHERE id = v_caller;

  INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
  VALUES (p_world_club_id, v_caller, 'claimed_existing', 'auto_approved');

  RETURN json_build_object('success', true, 'club_id', p_world_club_id);
END;
$function$;

-- ============================================================================
-- 6. create_and_claim_world_club — same hardening + composite-NULL dup fix
-- ============================================================================
-- Response shapes unchanged:
--   {success:false, error:'A club with this name already exists in this region'}
--   {success:true, club_id, created:true}   (+ pending:true in manual mode)

CREATE OR REPLACE FUNCTION public.create_and_claim_world_club(
  p_club_name TEXT,
  p_country_id INT,
  p_province_id INT DEFAULT NULL,
  p_profile_id UUID DEFAULT NULL,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID;
  v_role TEXT;
  v_mode TEXT;
  v_normalized TEXT;
  v_club_id TEXT;
  v_new_id UUID;
  v_existing RECORD;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_profile_id IS DISTINCT FROM v_caller THEN
    RETURN json_build_object('success', false, 'error', 'You can only claim a club for your own account');
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN json_build_object('success', false, 'error', 'Only club accounts can claim a club');
  END IF;

  v_mode := COALESCE(
    (SELECT value FROM app_settings WHERE key = 'world_club_claim_review_mode'),
    'auto'
  );

  v_normalized := lower(trim(p_club_name));
  IF length(v_normalized) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Club name must be at least 2 characters');
  END IF;

  -- IF FOUND, not `v_existing IS NOT NULL`: composite-NULL semantics made the
  -- old check false for any found row with NULL columns, so duplicates fell
  -- through to the INSERT and hit the unique index with a raw 23505.
  SELECT * INTO v_existing FROM world_clubs
  WHERE club_name_normalized = v_normalized
    AND country_id = p_country_id
    AND COALESCE(province_id, 0) = COALESCE(p_province_id, 0);
  IF FOUND THEN
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END IF;

  v_club_id := replace(v_normalized, ' ', '_') || '_' || p_country_id || '_' || extract(epoch from now())::int;

  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  BEGIN
    INSERT INTO world_clubs (
      club_id, club_name, club_name_normalized, country_id, province_id,
      men_league_id, women_league_id, is_claimed, claimed_profile_id,
      claimed_at, created_from
    ) VALUES (
      v_club_id, p_club_name, v_normalized, p_country_id, p_province_id,
      p_men_league_id, p_women_league_id,
      (v_mode <> 'manual'),
      CASE WHEN v_mode <> 'manual' THEN v_caller ELSE NULL END,
      CASE WHEN v_mode <> 'manual' THEN timezone('utc', now()) ELSE NULL END,
      'user'
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent creator won the race: same answer as the dup check above.
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END;

  INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
  VALUES (
    v_new_id, v_caller, 'created_and_claimed',
    CASE WHEN v_mode = 'manual' THEN 'pending' ELSE 'auto_approved' END
  );

  UPDATE profiles
  SET
    current_world_club_id = v_new_id,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = p_province_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name
  WHERE id = v_caller;

  IF v_mode = 'manual' THEN
    RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true, 'pending', true);
  END IF;
  RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true);
END;
$function$;

-- ============================================================================
-- 7. Function grants: authenticated only (anon could previously execute both)
-- ============================================================================

REVOKE ALL ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) TO authenticated, service_role;

-- ============================================================================
-- 8. world_clubs INSERT: admin-only (user creation goes through DEFINER RPCs)
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can create world clubs" ON public.world_clubs;
CREATE POLICY "Admins can create world clubs" ON public.world_clubs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

-- ============================================================================
-- 9. Self-checks
-- ============================================================================

DO $$
DECLARE
  v_claimed_count INT;
  v_backfill_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'world_club_claim_review_mode') THEN
    RAISE EXCEPTION 'world_club_claim_review_mode missing from app_settings';
  END IF;

  SELECT count(*) INTO v_claimed_count FROM public.world_clubs WHERE is_claimed = true;
  SELECT count(*) INTO v_backfill_count FROM public.world_club_claims WHERE action = 'legacy_backfill';
  IF v_backfill_count < v_claimed_count THEN
    RAISE EXCEPTION 'legacy backfill incomplete: % claimed clubs but % backfill rows',
      v_claimed_count, v_backfill_count;
  END IF;

  IF has_function_privilege('anon', 'public.claim_world_club(UUID, UUID, INT, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon still holds EXECUTE on claim_world_club';
  END IF;
  IF has_function_privilege('anon', 'public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon still holds EXECUTE on create_and_claim_world_club';
  END IF;
END $$;