-- SECURITY: stop any authenticated user from destroying other users' files.
--
-- Found and EXPLOITED during the 2026-08-08 security review: signed in as one
-- test account and deleted a file owned by a different account —
-- {"message":"Successfully deleted"} — on production.
--
-- Cause: policy stacking. The `gallery` bucket carried BOTH a correctly
-- owner-scoped policy AND an older permissive one:
--
--     ((bucket_id = 'gallery') AND (auth.role() = 'authenticated'))
--
-- Postgres OR-combines PERMISSIVE policies, so the loose policy always won and
-- the strict one was decorative. Any logged-in user could therefore delete or
-- overwrite EVERY gallery photo on the platform, including replacing another
-- member's photo with arbitrary content that then renders on their public
-- profile.
--
-- `world-club-logos` had the same shape, but with NO scoped policy underneath —
-- so it is rebuilt admin-only here rather than merely trimmed. Logos are
-- uploaded from exactly one place, the admin-only EditWorldClubModal, so this
-- matches real usage (and mirrors world_clubs' own INSERT/DELETE policies,
-- which already require is_platform_admin()).
--
-- `avatars` was verified NOT affected: its UPDATE/DELETE are owner-scoped and a
-- cross-user overwrite attempt returned 400 during the review.

-- ── gallery: drop the three loose policies ────────────────────────────────
-- The scoped replacements already exist and are left untouched:
--   "Users upload gallery files"  INSERT  split_part(name,'/',1) = auth.uid()
--   "Users update gallery files"  UPDATE  owner = auth.uid()
--   "Users delete gallery files"  DELETE  owner = auth.uid()
DROP POLICY IF EXISTS "Authenticated users can upload gallery photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update gallery photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete gallery photos" ON storage.objects;

-- ── world-club-logos: rebuild as admin-only ───────────────────────────────
DROP POLICY IF EXISTS world_club_logos_auth_insert ON storage.objects;
DROP POLICY IF EXISTS world_club_logos_auth_update ON storage.objects;
DROP POLICY IF EXISTS world_club_logos_auth_delete ON storage.objects;

CREATE POLICY world_club_logos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'world-club-logos' AND public.is_platform_admin());

CREATE POLICY world_club_logos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'world-club-logos' AND public.is_platform_admin())
  WITH CHECK (bucket_id = 'world-club-logos' AND public.is_platform_admin());

CREATE POLICY world_club_logos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'world-club-logos' AND public.is_platform_admin());

-- Public read is unchanged on both buckets (world_club_logos_public_read /
-- "Public can view gallery photos") — these are public-by-design image buckets
-- and the app builds plain getPublicUrl() links everywhere.
