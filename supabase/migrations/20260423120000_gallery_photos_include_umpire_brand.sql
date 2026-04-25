-- =========================================================================
-- gallery_photos RLS — widen to include umpire + brand roles
-- =========================================================================
-- The original 202511130103_rls_policies.sql gated gallery_photos manage
-- policy to `role IN ('player', 'coach')`. That made sense when only
-- player and coach dashboards used the gallery surface.
--
-- Phase F1 (commit 55a278a) added a Gallery tab to UmpireDashboard wired
-- to the same gallery_photos table. But the RLS policy was never widened,
-- so umpire INSERT / UPDATE / DELETE attempts silently fail — the object
-- reaches the storage bucket (which is role-agnostic) but the metadata
-- row is rejected, leaving orphaned files and an empty-looking Gallery
-- on the umpire's own dashboard.
--
-- Brand is included defensively: brands manage media via `club_media` /
-- brand-specific tables today, but a Gallery tab could be ported to them
-- in the same way. Widening now avoids a repeat of this bug.
--
-- Club is intentionally NOT added: clubs use `club_media` (separate
-- table with its own policy) and their Gallery surface is distinct.
-- =========================================================================

DROP POLICY IF EXISTS "Users can manage their gallery photos" ON public.gallery_photos;
CREATE POLICY "Users can manage their gallery photos"
  ON public.gallery_photos
  FOR ALL
  USING (
    auth.uid() = user_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach', 'umpire', 'brand')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND coalesce(public.current_profile_role(), '') IN ('player', 'coach', 'umpire', 'brand')
  );

COMMENT ON POLICY "Users can manage their gallery photos" ON public.gallery_photos IS
  'Owner-scoped write access. Widened from (player, coach) to include umpire and brand in 2026-04 once those dashboards started using the shared gallery_photos surface.';
