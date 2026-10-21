-- Rollback for 20261021200000_ambassador_invite_fences.sql: the body from
-- 202603030100_brand_ambassadors_bilateral.sql (no contact fences).

CREATE OR REPLACE FUNCTION public.add_brand_ambassador(
  p_brand_id UUID,
  p_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_brand_profile_id UUID;
  v_player_role TEXT;
  v_existing_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify caller owns this brand
  SELECT profile_id INTO v_brand_profile_id
  FROM brands WHERE id = p_brand_id AND deleted_at IS NULL;

  IF v_brand_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Brand not found');
  END IF;

  IF v_brand_profile_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Verify target is a player with completed onboarding
  SELECT role INTO v_player_role
  FROM profiles WHERE id = p_player_id AND onboarding_completed = true;

  IF v_player_role IS NULL OR v_player_role != 'player' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only players can be ambassadors');
  END IF;

  -- Check for existing row
  SELECT status INTO v_existing_status
  FROM brand_ambassadors
  WHERE brand_id = p_brand_id AND player_id = p_player_id;

  IF v_existing_status = 'accepted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player is already an ambassador');
  END IF;

  IF v_existing_status = 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already pending');
  END IF;

  -- If declined, delete old row to allow re-invitation
  IF v_existing_status = 'declined' THEN
    DELETE FROM brand_ambassadors
    WHERE brand_id = p_brand_id AND player_id = p_player_id;
  END IF;

  -- Insert new pending request
  INSERT INTO brand_ambassadors (brand_id, player_id, status)
  VALUES (p_brand_id, p_player_id, 'pending')
  ON CONFLICT (brand_id, player_id) DO NOTHING;

  -- Do NOT update ambassador_count (pending doesn't count)

  RETURN jsonb_build_object(
    'success', true,
    'status', 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_brand_ambassador(uuid, uuid) TO authenticated;
