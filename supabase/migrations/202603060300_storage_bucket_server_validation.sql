-- ============================================================================
-- M-30: Server-side file upload validation on storage buckets
-- ============================================================================
-- Enforces allowed_mime_types and file_size_limit at the bucket level so
-- malicious uploads are rejected server-side, not just client-side.
-- ============================================================================

-- Image-only buckets: avatars, gallery, journey, brand-products, brand-posts, world-club-logos
-- Max 10 MB for images (client optimizes to ~1-2 MB, this is a safety net)
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp'],
  file_size_limit = 10485760  -- 10 MB
WHERE id IN ('avatars', 'gallery', 'journey', 'brand-products', 'brand-posts', 'world-club-logos');

-- user-posts bucket: images + video (already has 100 MB limit from prior migration)
-- Add mime type restrictions
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
WHERE id = 'user-posts';
