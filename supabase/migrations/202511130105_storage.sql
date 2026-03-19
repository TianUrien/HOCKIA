-- 005_storage.sql
-- Storage bucket provisioning and policies for HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/005_storage.sql

SET search_path = storage;

-- ============================================================================
-- BUCKET CREATION
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', TRUE),
  ('gallery', 'gallery', TRUE),
  ('club-media', 'club-media', TRUE),
  ('player-media', 'player-media', TRUE)
ON CONFLICT (id) DO NOTHING;

SET search_path = storage;

-- Helper expressions reused in policies
-- split_part(name, '/', 1) equals the root folder when the convention is userId/filename

-- ============================================================================
-- AVATARS BUCKET POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public avatar access" ON storage.objects;
CREATE POLICY "Public avatar access"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users upload avatars" ON storage.objects;
CREATE POLICY "Users upload avatars"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "Users update avatars" ON storage.objects;
CREATE POLICY "Users update avatars"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "Users delete avatars" ON storage.objects;
CREATE POLICY "Users delete avatars"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

-- ============================================================================
-- GALLERY BUCKET POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public gallery access" ON storage.objects;
CREATE POLICY "Public gallery access"
ON storage.objects FOR SELECT
USING (bucket_id = 'gallery');

DROP POLICY IF EXISTS "Users upload gallery files" ON storage.objects;
CREATE POLICY "Users upload gallery files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'gallery'
  AND auth.role() = 'authenticated'
  AND split_part(name, '/', 1) = auth.uid()::TEXT
);

DROP POLICY IF EXISTS "Users update gallery files" ON storage.objects;
CREATE POLICY "Users update gallery files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'gallery'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "Users delete gallery files" ON storage.objects;
CREATE POLICY "Users delete gallery files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'gallery'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

-- ============================================================================
-- CLUB MEDIA BUCKET POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "Public club media access" ON storage.objects;
CREATE POLICY "Public club media access"
ON storage.objects FOR SELECT
USING (bucket_id = 'club-media');

DROP POLICY IF EXISTS "Clubs upload club media" ON storage.objects;
CREATE POLICY "Clubs upload club media"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'club-media'
  AND auth.role() = 'authenticated'
  AND split_part(name, '/', 1) = auth.uid()::TEXT
);

DROP POLICY IF EXISTS "Clubs update club media" ON storage.objects;
CREATE POLICY "Clubs update club media"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'club-media'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "Clubs delete club media" ON storage.objects;
CREATE POLICY "Clubs delete club media"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'club-media'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

-- ============================================================================
-- PLAYER MEDIA BUCKET POLICIES (LEGACY SUPPORT)
-- ============================================================================
DROP POLICY IF EXISTS "Public player media access" ON storage.objects;
CREATE POLICY "Public player media access"
ON storage.objects FOR SELECT
USING (bucket_id = 'player-media');

DROP POLICY IF EXISTS "Users upload player media" ON storage.objects;
CREATE POLICY "Users upload player media"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'player-media'
  AND auth.role() = 'authenticated'
  AND split_part(name, '/', 1) = auth.uid()::TEXT
);

DROP POLICY IF EXISTS "Users update player media" ON storage.objects;
CREATE POLICY "Users update player media"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'player-media'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "Users delete player media" ON storage.objects;
CREATE POLICY "Users delete player media"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'player-media'
  AND auth.role() = 'authenticated'
  AND owner = auth.uid()
);
