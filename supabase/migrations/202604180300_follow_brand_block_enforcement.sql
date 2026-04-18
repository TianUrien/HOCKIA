-- Block enforcement on brand follows (RPC + direct-table RLS)
--
-- Two gaps in the existing block system:
--   1. follow_brand RPC had no is_blocked_pair check, so a blocked user could
--      follow a brand whose owner had blocked them (or whom they had blocked).
--   2. The brand_followers INSERT policy only checked follower_id = auth.uid().
--      A client could bypass the RPC and write directly to the table, evading
--      the RPC's own guards (not-a-brand, brand-exists, self-follow).
--
-- Fix: bidirectional block check in both paths, and move all the RPC guards
-- (brand exists + not deleted, follower is not a brand, not self) into the
-- RLS WITH CHECK so the direct-table path is no worse than the RPC path.

SET search_path = public;

-- ============================================================================
-- 1. follow_brand RPC — add bidirectional block check
-- ============================================================================

CREATE OR REPLACE FUNCTION public.follow_brand(p_brand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_role TEXT;
  v_brand_profile_id UUID;
  v_new_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT role INTO v_user_role FROM profiles WHERE id = v_user_id;
  IF v_user_role = 'brand' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Brands cannot follow other brands');
  END IF;

  SELECT profile_id INTO v_brand_profile_id
  FROM brands WHERE id = p_brand_id AND deleted_at IS NULL;

  IF v_brand_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Brand not found');
  END IF;

  IF v_brand_profile_id = v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot follow your own brand');
  END IF;

  -- Bidirectional block check — generic error to avoid leaking direction.
  IF public.is_blocked_pair(v_user_id, v_brand_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unable to follow this brand');
  END IF;

  INSERT INTO brand_followers (brand_id, follower_id)
  VALUES (p_brand_id, v_user_id)
  ON CONFLICT (brand_id, follower_id) DO NOTHING;

  SELECT COUNT(*) INTO v_new_count FROM brand_followers WHERE brand_id = p_brand_id;
  UPDATE brands SET follower_count = v_new_count WHERE id = p_brand_id;

  RETURN jsonb_build_object(
    'success', true,
    'followed', true,
    'follower_count', v_new_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.follow_brand(UUID) TO authenticated;

-- ============================================================================
-- 2. brand_followers INSERT RLS — close the direct-table bypass
-- ============================================================================

DROP POLICY IF EXISTS brand_followers_insert ON public.brand_followers;
CREATE POLICY brand_followers_insert ON public.brand_followers
  FOR INSERT
  WITH CHECK (
    follower_id = auth.uid()
    -- Target brand must exist and not be soft-deleted.
    AND EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.id = brand_followers.brand_id
        AND b.deleted_at IS NULL
    )
    -- Follower must not be a brand themselves.
    AND COALESCE(public.current_profile_role(), '') <> 'brand'
    -- Follower cannot be the brand owner.
    AND NOT EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.id = brand_followers.brand_id
        AND b.profile_id = auth.uid()
    )
    -- Bidirectional block check against the brand owner.
    AND NOT EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.id = brand_followers.brand_id
        AND public.is_blocked_pair(auth.uid(), b.profile_id)
    )
  );

NOTIFY pgrst, 'reload schema';
