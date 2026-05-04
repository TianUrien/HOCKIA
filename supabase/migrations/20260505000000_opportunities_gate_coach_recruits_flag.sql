-- =========================================================================
-- Opportunities — gate INSERT/UPDATE/DELETE on coach_recruits_for_team
-- =========================================================================
-- Phase 1A.4 added the `coach_recruits_for_team` boolean to profiles, but
-- the gate was UI-only. The existing policy "Publishers can manage their
-- opportunities" allowed any coach (regardless of the flag) to write to
-- opportunities. Closing it here so a candidate-only coach can't bypass
-- the UI by calling the table directly:
--
--   await supabase.from('opportunities').insert({ ... })
--
-- Clubs are unaffected — they're always recruiters by definition. Only
-- coaches need to have flipped the recruiter toggle.
-- =========================================================================

DROP POLICY IF EXISTS "Publishers can manage their opportunities" ON public.opportunities;

CREATE POLICY "Publishers can manage their opportunities"
  ON public.opportunities
  FOR ALL
  USING (
    auth.uid() = club_id
    AND (
      -- Clubs always allowed.
      COALESCE(public.current_profile_role(), '') = 'club'
      -- Coaches allowed only when they've enabled recruiter mode.
      OR (
        COALESCE(public.current_profile_role(), '') = 'coach'
        AND COALESCE(
          (SELECT coach_recruits_for_team FROM public.profiles WHERE id = auth.uid()),
          false
        ) = true
      )
    )
  )
  WITH CHECK (
    auth.uid() = club_id
    AND (
      COALESCE(public.current_profile_role(), '') = 'club'
      OR (
        COALESCE(public.current_profile_role(), '') = 'coach'
        AND COALESCE(
          (SELECT coach_recruits_for_team FROM public.profiles WHERE id = auth.uid()),
          false
        ) = true
      )
    )
  );
