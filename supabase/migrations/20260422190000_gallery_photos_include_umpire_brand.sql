-- Captured from prod's supabase_migrations.schema_migrations on 2026-04-25.
-- This is the version that landed on prod via dashboard. The earlier
-- repo file at 20260423120000 was a duplicate (same content under
-- a different timestamp) and was deleted in commit ffc2340.

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
