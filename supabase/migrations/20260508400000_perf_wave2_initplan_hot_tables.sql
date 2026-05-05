-- =========================================================================
-- Performance Wave 2 — wrap auth.uid() / auth.role() in RLS policies on
-- the 5 hottest tables (24 policies total)
-- =========================================================================
-- The audit's perf advisor flagged 103 RLS policies that call auth.uid()
-- or auth.role() directly. PostgreSQL evaluates these per row instead of
-- caching the result, so as tables grow query times degrade super-
-- linearly. Wrapping the call as `(SELECT auth.<fn>())` lets the planner
-- evaluate it once and treat the result as a parameter — same semantics,
-- big speedup at scale.
--
-- Wave 2 covers the 5 hot tables that account for 24 of the 103
-- findings:
--   career_history             5 policies
--   opportunity_applications   5 policies
--   profile_friendships        5 policies
--   profile_references         5 policies
--   profiles                   4 policies
--
-- The remaining 79 policies are spread thin across many tables with
-- 1-2 each — Wave 3 territory.
--
-- Mechanical rewrite: each policy is DROPped and re-CREATEd with the
-- exact same USING / WITH CHECK / cmd / role, only the auth.* calls
-- wrapped. Other functions (is_platform_admin(), current_profile_role(),
-- club_has_applicant()) are left unchanged.
-- =========================================================================

-- ─────────────────────────────────────────────────────────────────────
-- career_history (5)
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can delete own career history" ON public.career_history;
CREATE POLICY "Users can delete own career history"
  ON public.career_history
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own career history" ON public.career_history;
CREATE POLICY "Users can insert own career history"
  ON public.career_history
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage their playing history" ON public.career_history;
CREATE POLICY "Users can manage their playing history"
  ON public.career_history
  FOR ALL
  USING (
    ((SELECT auth.uid()) = user_id)
    AND (COALESCE(current_profile_role(), '') = ANY (ARRAY['player', 'coach']))
  )
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    AND (COALESCE(current_profile_role(), '') = ANY (ARRAY['player', 'coach']))
  );

DROP POLICY IF EXISTS "Users can update own career history" ON public.career_history;
CREATE POLICY "Users can update own career history"
  ON public.career_history
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own career history" ON public.career_history;
CREATE POLICY "Users can view own career history"
  ON public.career_history
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- opportunity_applications (5)
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Applicants can create applications" ON public.opportunity_applications;
CREATE POLICY "Applicants can create applications"
  ON public.opportunity_applications
  FOR INSERT
  WITH CHECK (
    ((SELECT auth.uid()) = applicant_id)
    AND (EXISTS (
      SELECT 1
      FROM profiles p
      JOIN opportunities o ON o.id = opportunity_applications.opportunity_id
      WHERE p.id = (SELECT auth.uid())
        AND o.status = 'open'::opportunity_status
        AND (
          (p.role = 'player' AND o.opportunity_type = 'player'::opportunity_type)
          OR (p.role = 'coach' AND o.opportunity_type = 'coach'::opportunity_type)
        )
    ))
  );

DROP POLICY IF EXISTS "Applicants can view own applications" ON public.opportunity_applications;
CREATE POLICY "Applicants can view own applications"
  ON public.opportunity_applications
  FOR SELECT
  USING ((SELECT auth.uid()) = applicant_id);

DROP POLICY IF EXISTS "Players can view their own applications" ON public.opportunity_applications;
CREATE POLICY "Players can view their own applications"
  ON public.opportunity_applications
  FOR SELECT
  USING ((SELECT auth.uid()) = applicant_id);

DROP POLICY IF EXISTS "Publishers can update application status" ON public.opportunity_applications;
CREATE POLICY "Publishers can update application status"
  ON public.opportunity_applications
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM opportunities o
    WHERE o.id = opportunity_applications.opportunity_id
      AND o.club_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM opportunities o
    WHERE o.id = opportunity_applications.opportunity_id
      AND o.club_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Publishers can view applications to their opportunities" ON public.opportunity_applications;
CREATE POLICY "Publishers can view applications to their opportunities"
  ON public.opportunity_applications
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM opportunities o
    WHERE o.id = opportunity_applications.opportunity_id
      AND o.club_id = (SELECT auth.uid())
  ));

-- ─────────────────────────────────────────────────────────────────────
-- profile_friendships (5)
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "friendships delete" ON public.profile_friendships;
CREATE POLICY "friendships delete"
  ON public.profile_friendships
  FOR DELETE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.uid()) = user_one
    OR (SELECT auth.uid()) = user_two
  );

DROP POLICY IF EXISTS "friendships insert" ON public.profile_friendships;
CREATE POLICY "friendships insert"
  ON public.profile_friendships
  FOR INSERT
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) = requester_id
      AND ((SELECT auth.uid()) = user_one OR (SELECT auth.uid()) = user_two)
      AND status = 'pending'::friendship_status
    )
  );

DROP POLICY IF EXISTS "friendships readable" ON public.profile_friendships;
CREATE POLICY "friendships readable"
  ON public.profile_friendships
  FOR SELECT
  USING (
    status = 'accepted'::friendship_status
    OR (SELECT auth.uid()) = user_one
    OR (SELECT auth.uid()) = user_two
    OR (SELECT auth.role()) = 'service_role'
  );

DROP POLICY IF EXISTS "friendships recipient update" ON public.profile_friendships;
CREATE POLICY "friendships recipient update"
  ON public.profile_friendships
  FOR UPDATE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) <> requester_id
      AND ((SELECT auth.uid()) = user_one OR (SELECT auth.uid()) = user_two)
    )
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) <> requester_id
      AND ((SELECT auth.uid()) = user_one OR (SELECT auth.uid()) = user_two)
      AND status = ANY (ARRAY['accepted'::friendship_status, 'rejected'::friendship_status, 'blocked'::friendship_status])
    )
  );

DROP POLICY IF EXISTS "friendships requester update" ON public.profile_friendships;
CREATE POLICY "friendships requester update"
  ON public.profile_friendships
  FOR UPDATE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.uid()) = requester_id
    OR (
      status = ANY (ARRAY['cancelled'::friendship_status, 'rejected'::friendship_status])
      AND ((SELECT auth.uid()) = user_one OR (SELECT auth.uid()) = user_two)
    )
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) = requester_id
      AND status = ANY (ARRAY['pending'::friendship_status, 'cancelled'::friendship_status, 'rejected'::friendship_status, 'blocked'::friendship_status])
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- profile_references (5)
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS profile_references_delete ON public.profile_references;
CREATE POLICY profile_references_delete
  ON public.profile_references
  FOR DELETE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.uid()) = requester_id
    OR (SELECT auth.uid()) = reference_id
  );

DROP POLICY IF EXISTS profile_references_insert ON public.profile_references;
CREATE POLICY profile_references_insert
  ON public.profile_references
  FOR INSERT
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) = requester_id
      AND status = 'pending'::profile_reference_status
    )
  );

DROP POLICY IF EXISTS profile_references_read ON public.profile_references;
CREATE POLICY profile_references_read
  ON public.profile_references
  FOR SELECT
  USING (
    status = 'accepted'::profile_reference_status
    OR (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.uid()) = requester_id
    OR (SELECT auth.uid()) = reference_id
  );

DROP POLICY IF EXISTS profile_references_reference_update ON public.profile_references;
CREATE POLICY profile_references_reference_update
  ON public.profile_references
  FOR UPDATE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.uid()) = reference_id
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) = reference_id
      AND status = ANY (ARRAY['pending'::profile_reference_status, 'accepted'::profile_reference_status, 'declined'::profile_reference_status, 'revoked'::profile_reference_status])
    )
  );

DROP POLICY IF EXISTS profile_references_requester_update ON public.profile_references;
CREATE POLICY profile_references_requester_update
  ON public.profile_references
  FOR UPDATE
  USING (
    (SELECT auth.role()) = 'service_role'
    OR (SELECT auth.uid()) = requester_id
  )
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR (
      (SELECT auth.uid()) = requester_id
      AND status = ANY (ARRAY['pending'::profile_reference_status, 'revoked'::profile_reference_status])
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- profiles (4)
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Clubs can view applicant player profiles" ON public.profiles;
CREATE POLICY "Clubs can view applicant player profiles"
  ON public.profiles
  FOR SELECT
  USING (
    role = 'player'
    AND club_has_applicant((SELECT auth.uid()), id)
  );

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING ((SELECT auth.uid()) = id);
